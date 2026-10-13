import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  DEFAULT_PAGE_APPEARANCE,
  type PageAppearanceSettings,
} from "../theme/pageAppearance";
import { type PageTheme } from "../theme/pageTheme";
import { PdfInteractionService } from "./interaction";
import { clearTextLayer } from "./textLayer";
import {
  isPageRenderCancellation,
  startPageRender,
  type PageRenderHandle,
  type RenderedPage,
} from "./renderPage";
import { t } from "../i18n/i18n";

export const MIN_MANUAL_SCALE = 0.5;
export const MAX_MANUAL_SCALE = 4;
const MIN_FIT_SCALE = 0.1;
const MAX_RENDERED_PAGES = 8;
const MAX_RETAINED_TEXT_PAGES = 16;
const MAX_CACHED_CANVAS_PIXELS = 64 * 1024 * 1024;
const RENDER_MARGIN = "2400px 2400px";

export type ZoomMode =
  | "automatic"
  | "actual"
  | "page-fit"
  | "page-width"
  | "custom";

export type ScrollMode = "vertical" | "horizontal" | "wrapped" | "page";
export type SpreadMode = "none" | "odd" | "even";

type OptionalContentConfig = Awaited<
  ReturnType<PDFDocumentProxy["getOptionalContentConfig"]>
>;

interface PageState {
  annotationLayer: HTMLDivElement;
  baseHeight: number;
  baseWidth: number;
  canvas: HTMLCanvasElement;
  element: HTMLElement;
  lastUsed: number;
  nearViewport: boolean;
  pageNumber: number;
  renderHandle: PageRenderHandle | null;
  rendered: RenderedPage | null;
  renderedScale: number | null;
  renderedTheme: PageTheme | null;
  hasPreviewBitmap: boolean;
  textLayer: HTMLElement;
}

/** A reading position that survives zoom and layout changes. */
export interface ViewPosition {
  pageNumber: number;
  /** Offset of the viewport top within the page, as a fraction of its height. */
  fraction: number;
}

export interface PdfViewerOptions {
  initialAppearance?: PageAppearanceSettings;
  initialPage?: number;
  initialScale?: number;
  initialTheme?: PageTheme;
  initialZoomMode?: ZoomMode;
  initialScrollMode?: ScrollMode;
  initialSpreadMode?: SpreadMode;
  onCurrentPageChange?(pageNumber: number): void;
  onGeminiTestPhraseFound?(): void;
  onNamedAction?(action: string): void;
  /** Called before following an internal link, so callers can record history. */
  onLinkNavigation?(): void;
  onRenderError?(message: string): void;
}

export class PdfViewer {
  readonly totalPages: number;

  #currentPage = 1;
  #disposed = false;
  #fieldObjects: Awaited<
    ReturnType<PDFDocumentProxy["getFieldObjects"]>
  > = null;
  #fieldObjectsPromise: ReturnType<
    PDFDocumentProxy["getFieldObjects"]
  > | null = null;
  #fitCommitTimer: number | null = null;
  #interaction: PdfInteractionService;
  #optionalContentConfig: OptionalContentConfig | null = null;
  #optionalContentConfigPromise: Promise<OptionalContentConfig | null> =
    Promise.resolve(null);
  #optionalContentListeners = new Set<() => void>();
  #pageAppearance: PageAppearanceSettings;
  #pageTheme: PageTheme;
  #pages: PageState[] = [];
  #nearPages = new Set<PageState>();
  #residentPages = new Set<PageState>();
  #textPages = new Set<PageState>();
  #selectingPages = new Set<PageState>();
  #lastVisibilityPages = new Set<PageState>();
  #textContentRevision = 0;
  #renderObserver: IntersectionObserver;
  #renderRevision = 0;
  #resizeObserver: ResizeObserver;
  #rotation = 0;
  #scrollMode: ScrollMode = "vertical";
  #spreadMode: SpreadMode = "none";
  #currentPageRaf: number | null = null;
  #navigationSequence = 0;
  #scale: number;
  #layoutScale: number;
  #scalePreviewActive = false;
  #textLayerRenderedListeners = new Set<(pageNumber: number) => void>();
  #useCounter = 0;
  #zoomMode: ZoomMode = "custom";

  constructor(
    private readonly pdf: PDFDocumentProxy,
    private readonly container: HTMLElement,
    private readonly scrollRoot: HTMLElement,
    private readonly options: PdfViewerOptions = {},
  ) {
    this.totalPages = pdf.numPages;
    const requestedPage = options.initialPage ?? 1;
    this.#currentPage = Number.isFinite(requestedPage)
      ? Math.min(this.totalPages, Math.max(1, Math.round(requestedPage)))
      : 1;
    this.#zoomMode = options.initialZoomMode ?? "custom";
    this.#scrollMode = options.initialScrollMode ?? "vertical";
    this.#spreadMode = options.initialSpreadMode ?? "none";
    this.#scale = this.#normalizeScale(options.initialScale ?? 1, this.#zoomMode);
    this.#layoutScale = this.#scale;
    this.#pageAppearance =
      options.initialAppearance ?? DEFAULT_PAGE_APPEARANCE;
    this.#pageTheme = options.initialTheme ?? "original";
    this.#interaction = new PdfInteractionService(pdf, {
      getCurrentPage: () => this.#currentPage,
      getRotation: () => this.#rotation,
      goToPage: (pageNumber, offsetFraction) =>
        this.goToPage(pageNumber, { offsetFraction }),
      onLinkNavigation: () => this.options.onLinkNavigation?.(),
      onNamedAction: (action) => this.options.onNamedAction?.(action),
      onOptionalContentAction: (action) => {
        this.applyOptionalContentState(action);
      },
    });

    this.#renderObserver = new IntersectionObserver(
      (entries) => this.#handleRenderIntersections(entries),
      {
        root: scrollRoot,
        rootMargin: RENDER_MARGIN,
        threshold: 0,
      },
    );

    this.#resizeObserver = new ResizeObserver(() => {
      this.#handleResize();
    });
  }

  get currentPage(): number {
    return this.#currentPage;
  }

  get scale(): number {
    return this.#scale;
  }

  get pageAppearance(): PageAppearanceSettings {
    return this.#pageAppearance;
  }

  get pageTheme(): PageTheme {
    return this.#pageTheme;
  }

  get rotation(): number {
    return this.#rotation;
  }

  get scrollMode(): ScrollMode {
    return this.#scrollMode;
  }

  get spreadMode(): SpreadMode {
    return this.#spreadMode;
  }

  get optionalContentConfig(): OptionalContentConfig | null {
    return this.#optionalContentConfig;
  }

  whenOptionalContentConfigReady(): Promise<OptionalContentConfig | null> {
    return this.#optionalContentConfigPromise;
  }

  get zoomMode(): ZoomMode {
    return this.#zoomMode;
  }

  get navigationVersion(): number {
    return this.#navigationSequence;
  }

  getPageElement(pageNumber: number): HTMLElement | null {
    return this.#pages[pageNumber - 1]?.element ?? null;
  }

  getTextLayerElement(pageNumber: number): HTMLElement | null {
    return this.#pages[pageNumber - 1]?.textLayer ?? null;
  }

  onTextLayerRendered(listener: (pageNumber: number) => void): () => void {
    this.#textLayerRenderedListeners.add(listener);
    return () => this.#textLayerRenderedListeners.delete(listener);
  }

  onOptionalContentChanged(listener: () => void): () => void {
    this.#optionalContentListeners.add(listener);
    return () => this.#optionalContentListeners.delete(listener);
  }

  #ensureFieldObjects(): ReturnType<
    PDFDocumentProxy["getFieldObjects"]
  > {
    if (this.#fieldObjectsPromise) {
      return this.#fieldObjectsPromise;
    }

    this.#fieldObjectsPromise = this.pdf
      .getFieldObjects()
      .then((fieldObjects) => {
        if (!this.#disposed) {
          this.#fieldObjects = fieldObjects;
        }
        return fieldObjects;
      })
      .catch((error) => {
        this.#fieldObjectsPromise = null;
        throw error;
      });

    return this.#fieldObjectsPromise;
  }

  setLayerVisibility(id: string, visible: boolean): void {
    if (!this.#optionalContentConfig) {
      return;
    }

    this.#optionalContentConfig.setVisibility(id, visible, true);
    this.#textContentRevision += 1;
    this.#renderRevision += 1;
    this.#notifyOptionalContentChanged();
    this.#rerenderForViewChange();
  }

  applyOptionalContentState(action: {
    state: Array<string>;
    preserveRB?: boolean;
  }): void {
    if (!this.#optionalContentConfig) {
      return;
    }

    this.#optionalContentConfig.setOCGState({
      state: action.state,
      preserveRB: action.preserveRB ?? true,
    });
    this.#textContentRevision += 1;
    this.#renderRevision += 1;
    this.#notifyOptionalContentChanged();
    this.#rerenderForViewChange();
  }

  canCleanupPageResources(pageNumber: number): boolean {
    const page = this.#pages[pageNumber - 1];
    return Boolean(page && !page.renderHandle && !page.rendered);
  }

  cancelPendingNavigation(): void {
    this.#navigationSequence += 1;
  }

  async ensurePageRendered(pageNumber: number): Promise<boolean> {
    const page = this.#pages[pageNumber - 1];
    return page ? this.#ensureRendered(page, true) : false;
  }

  /** Resolve a PDF destination (named or explicit) to a page and offset. */
  resolveDestination(
    destination: string | Array<unknown>,
  ): Promise<ViewPosition | null> {
    return this.#interaction.resolveDestination(destination);
  }

  /** Where the top of the visible area currently sits in the document. */
  getViewPosition(): ViewPosition {
    const page = this.#pages[this.#currentPage - 1];

    if (!page) {
      return { pageNumber: this.#currentPage, fraction: 0 };
    }

    const rootRect = this.scrollRoot.getBoundingClientRect();
    const pageRect = page.element.getBoundingClientRect();
    const visibleTop = rootRect.top + this.#topInset() + 16;
    const fraction =
      pageRect.height > 0 ? (visibleTop - pageRect.top) / pageRect.height : 0;

    return {
      pageNumber: this.#currentPage,
      fraction: Math.min(1, Math.max(0, fraction)),
    };
  }

  async goToPage(
    pageNumber: number,
    { offsetFraction = 0 }: { offsetFraction?: number } = {},
  ): Promise<boolean> {
    const navigation = ++this.#navigationSequence;
    const clamped = Math.min(this.totalPages, Math.max(1, Math.round(pageNumber)));
    const page = this.#pages[clamped - 1];

    if (!page || this.#disposed) {
      return false;
    }

    const pageModeTransition =
      this.#scrollMode === "page" &&
      clamped !== this.#currentPage;

    if (pageModeTransition && this.#zoomMode !== "custom") {
      // Keep the old page visible while the target page is prepared at its
      // final fit scale. Visibility changes only after the target is sharp.
      this.#currentPage = clamped;
      this.#applyZoomMode();
      this.#cancelFitCommit();
      this.commitScalePreview();
      await this.#ensureRendered(page, true);
    } else {
      await this.#ensureRendered(page, true);

      if (this.#disposed || navigation !== this.#navigationSequence) {
        return false;
      }

      this.#currentPage = clamped;

      if (this.#zoomMode !== "custom") {
        this.#applyZoomMode();
        this.#cancelFitCommit();
        this.commitScalePreview();
        await this.#ensureRendered(page, true);
      }
    }

    if (this.#disposed || navigation !== this.#navigationSequence) {
      return false;
    }

    this.#updateAllPageVisibility();

    const settledRootRect = this.scrollRoot.getBoundingClientRect();
    const settledPageRect = page.element.getBoundingClientRect();
    this.scrollRoot.scrollTo({
      left:
        this.scrollRoot.scrollLeft +
        settledPageRect.left -
        settledRootRect.left -
        16,
      top:
        this.scrollRoot.scrollTop +
        settledPageRect.top +
        settledPageRect.height * Math.min(1, Math.max(0, offsetFraction)) -
        settledRootRect.top -
        16 -
        this.#topInset(),
      behavior: "auto",
    });

    this.options.onCurrentPageChange?.(clamped);
    this.#scheduleCurrentPageUpdate();
    return true;
  }

  setZoomMode(mode: Exclude<ZoomMode, "custom">): void {
    this.#zoomMode = mode;
    this.#applyZoomMode();
  }

  refreshZoomMode(): void {
    if (this.#zoomMode !== "custom") {
      this.#applyZoomMode();
    }
  }

  async initialize(): Promise<void> {
    // Match PDF.js's first-page-first startup: begin non-critical document
    // metadata work immediately, but never block the first visible page on it.
    this.#optionalContentConfigPromise = this.pdf
      .getOptionalContentConfig({ intent: "display" })
      .then((config) => {
        if (!this.#disposed) {
          this.#optionalContentConfig = config;
        }
        return config;
      })
      .catch(() => null);

    const firstPage = await this.pdf.getPage(this.#currentPage);
    if (this.#disposed) return;
    const firstViewport = firstPage.getViewport({
      scale: 1,
      rotation:
        ((firstPage.rotate + this.#rotation) % 360 + 360) % 360,
    });
    firstPage.cleanup();

    this.container.dataset.scrollMode = this.#scrollMode;
    this.container.dataset.spreadMode = this.#spreadMode;
    this.container.style.setProperty("--scale-factor", String(this.#layoutScale));
    this.container.style.setProperty("--preview-zoom", "1");

    const fragment = document.createDocumentFragment();

    for (let pageNumber = 1; pageNumber <= this.totalPages; pageNumber += 1) {
      const element = document.createElement("section");
      element.className = "pdf-page";
      element.dataset.pageNumber = String(pageNumber);
      element.dataset.pageTheme = this.#pageTheme;
      element.setAttribute("aria-label", `Page ${pageNumber}`);

      const canvas = document.createElement("canvas");
      canvas.className = "pdf-canvas";
      canvas.width = 0;
      canvas.height = 0;

      const textLayer = document.createElement("div");
      textLayer.className = "textLayer";

      const annotationLayer = document.createElement("div");
      annotationLayer.className = "annotationLayer";

      element.append(canvas, textLayer, annotationLayer);
      fragment.append(element);

      const state: PageState = {
        annotationLayer,
        baseHeight: firstViewport.height,
        baseWidth: firstViewport.width,
        canvas,
        element,
        lastUsed: 0,
        nearViewport: pageNumber === this.#currentPage,
        pageNumber,
        renderHandle: null,
        rendered: null,
        renderedScale: null,
        renderedTheme: null,
        hasPreviewBitmap: false,
        textLayer,
      };

      this.#pages.push(state);
      if (state.nearViewport) this.#nearPages.add(state);
      this.#updatePagePlaceholder(state);
      this.#updatePageVisibility(state);
    }

    this.container.replaceChildren(fragment);

    // Resolve the initial spread's geometry before any expensive rendering.
    // A restored page must not pay for a discarded render of page one.
    for (const state of this.#currentSpreadPages()) {
      if (state.pageNumber === this.#currentPage) continue;
      const pdfPage = await this.pdf.getPage(state.pageNumber);
      if (this.#disposed) return;
      const viewport = pdfPage.getViewport({ scale: 1, rotation: pdfPage.rotate });
      state.baseWidth = viewport.width;
      state.baseHeight = viewport.height;
    }
    if (this.#zoomMode !== "custom") {
      this.#scale = this.#normalizeScale(this.#fitScale(), this.#zoomMode, 3);
      this.#layoutScale = this.#scale;
      this.container.style.setProperty("--scale-factor", String(this.#scale));
      for (const page of this.#pages) this.#updatePagePlaceholder(page);
    }
    this.#lastVisibilityPages = new Set(this.#currentSpreadPages());
    const first = this.#pages[this.#currentPage - 1];
    if (first) {
      const rendered = await this.#ensureRendered(first, true);
      if (!rendered && !this.#disposed) {
        throw new Error("Failed to render the initial PDF page.");
      }
    }
    this.#realignCurrentPage();

    if (this.#disposed) {
      return;
    }

    for (const page of this.#pages) {
      this.#renderObserver.observe(page.element);
    }

    this.scrollRoot.addEventListener("scroll", this.#handleViewportChange, {
      passive: true,
    });
    document.addEventListener(
      "selectionchange",
      this.#handleSelectionChange,
    );
    window.addEventListener("resize", this.#handleResize, {
      passive: true,
    });
    this.#resizeObserver.observe(this.scrollRoot);
    this.#scheduleCurrentPageUpdate();
  }

  setScale(nextScale: number, mode: ZoomMode = "custom"): void {
    if (this.#disposed) {
      return;
    }

    this.#scalePreviewActive = false;
    const rounded = this.#normalizeScale(nextScale, mode);
    this.#zoomMode = mode;

    if (rounded === this.#scale) {
      const current = this.#pages[this.#currentPage - 1];
      if (
        current &&
        current.renderedScale !== rounded
      ) {
        this.#commitScaleRender();
      }
      return;
    }

    this.#scale = rounded;
    this.#commitScaleRender();
  }

  previewScale(
    nextScale: number,
    anchor?: { clientX: number; clientY: number },
    mode: ZoomMode = "custom",
  ): void {
    if (this.#disposed) {
      return;
    }

    const rounded = this.#normalizeScale(
      nextScale,
      mode,
      3,
    );

    if (rounded === this.#scale) {
      return;
    }

    const previousScale = this.#scale;
    const current = this.#pages[this.#currentPage - 1];
    const rootRect = this.scrollRoot.getBoundingClientRect();
    const pageRect = current?.element.getBoundingClientRect();
    const anchorX =
      anchor?.clientX ??
      rootRect.left + this.scrollRoot.clientWidth / 2;
    const anchorY =
      anchor?.clientY ??
      rootRect.top + this.scrollRoot.clientHeight / 2;
    const pageOffsetX = pageRect ? anchorX - pageRect.left : 0;
    const pageOffsetY = pageRect ? anchorY - pageRect.top : 0;

    this.#scale = rounded;
    this.#zoomMode = mode;
    this.#scalePreviewActive = true;
    this.container.style.setProperty(
      "--preview-zoom",
      String(this.#scale / this.#layoutScale),
    );

    if (mode === "custom") {
      this.#cancelFitCommit();
    }

    if (current && pageRect && previousScale > 0) {
      const ratio = rounded / previousScale;
      const nextPageRect = current.element.getBoundingClientRect();
      const nextAnchorX = nextPageRect.left + pageOffsetX * ratio;
      const nextAnchorY = nextPageRect.top + pageOffsetY * ratio;

      this.scrollRoot.scrollLeft += nextAnchorX - anchorX;
      this.scrollRoot.scrollTop += nextAnchorY - anchorY;
    }

    this.#scheduleCurrentPageUpdate();
  }

  commitScalePreview(): void {
    if (this.#disposed || !this.#scalePreviewActive) {
      return;
    }

    this.#scalePreviewActive = false;
    this.#commitScaleRender();
  }

  setPageTheme(theme: PageTheme): void {
    if (this.#disposed || theme === this.#pageTheme) {
      return;
    }

    this.#pageTheme = theme;
    this.#renderRevision += 1;

    for (const page of this.#pages) {
      page.element.dataset.pageTheme = theme;
      const preservePreview =
        page.pageNumber === this.#currentPage || page.nearViewport;
      this.#invalidatePage(page, preservePreview);
    }

    this.#renderNearPages();
  }

  setPageAppearance(settings: PageAppearanceSettings): void {
    if (this.#disposed) {
      return;
    }

    this.#pageAppearance = { ...settings };
    this.#renderRevision += 1;
    this.#rerenderForViewChange();
  }

  setRotation(rotation: number): void {
    if (this.#disposed) {
      return;
    }

    const normalized = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;

    if (normalized === this.#rotation) {
      return;
    }

    const previousRotation = this.#rotation;
    this.#rotation = normalized;
    this.#renderRevision += 1;
    const swapsDimensions =
      Math.abs(normalized - previousRotation) % 180 === 90;

    for (const page of this.#pages) {
      if (swapsDimensions) {
        [page.baseWidth, page.baseHeight] = [
          page.baseHeight,
          page.baseWidth,
        ];
      }

      const preservePreview =
        page.pageNumber === this.#currentPage || page.nearViewport;
      this.#invalidatePage(page, preservePreview);
      this.#updatePagePlaceholder(page);
    }

    this.#renderNearPages();
    this.#scheduleCurrentPageUpdate();
  }

  setScrollMode(mode: ScrollMode): void {
    if (this.#disposed || mode === this.#scrollMode) {
      return;
    }

    this.#scrollMode = mode;
    this.container.dataset.scrollMode = mode;
    this.#updateAllPageVisibility(true);

    window.requestAnimationFrame(() => {
      this.#realignCurrentPage();
    });
  }

  setSpreadMode(mode: SpreadMode): void {
    if (this.#disposed || mode === this.#spreadMode) {
      return;
    }

    this.#spreadMode = mode;
    this.container.dataset.spreadMode = mode;
    this.#updateAllPageVisibility(true);

    window.requestAnimationFrame(() => {
      this.#realignCurrentPage();
    });
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#navigationSequence += 1;
    this.#renderObserver.disconnect();
    this.#resizeObserver.disconnect();
    this.scrollRoot.removeEventListener("scroll", this.#handleViewportChange);
    document.removeEventListener(
      "selectionchange",
      this.#handleSelectionChange,
    );
    window.removeEventListener("resize", this.#handleResize);

    if (this.#currentPageRaf !== null) {
      cancelAnimationFrame(this.#currentPageRaf);
      this.#currentPageRaf = null;
    }

    this.#cancelFitCommit();

    for (const page of this.#pages) {
      page.renderHandle?.cancel();
      page.renderHandle = null;
      page.rendered?.dispose();
      page.rendered = null;
      page.canvas.width = 0;
      page.canvas.height = 0;
      clearTextLayer(page.textLayer);
    }

    this.#nearPages.clear();
    this.#residentPages.clear();
    this.#textPages.clear();
    this.#selectingPages.clear();
    this.#lastVisibilityPages.clear();
    this.#pages = [];
    this.#optionalContentListeners.clear();
    this.#textLayerRenderedListeners.clear();
    this.container.replaceChildren();
  }

  #handleRenderIntersections(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const page = this.#pageFromElement(entry.target);
      if (!page) {
        continue;
      }

      page.nearViewport = entry.isIntersecting;
      if (entry.isIntersecting) this.#nearPages.add(page);
      else this.#nearPages.delete(page);

      if (entry.isIntersecting) {
        page.lastUsed = ++this.#useCounter;
        void this.#ensureRendered(page);
      } else if (page.pageNumber !== this.#currentPage) {
        page.renderHandle?.cancel();

        if (!page.rendered && !page.hasPreviewBitmap) {
          page.canvas.width = 0;
          page.canvas.height = 0;
          page.element.dataset.renderState = "evicted";
        }
      }
    }

    this.#evictOldPages();
    this.#scheduleCurrentPageUpdate();
  }

  #handleViewportChange = (): void => {
    this.#scheduleCurrentPageUpdate();
  };

  #handleSelectionChange = (): void => {
    const selection = document.getSelection();
    const range =
      selection &&
      !selection.isCollapsed &&
      selection.rangeCount > 0
        ? selection.getRangeAt(0)
        : null;

    const previous = this.#selectingPages;
    this.#selectingPages = new Set();
    for (const page of new Set([...this.#textPages, ...previous])) {
      let selecting = false;

      if (range) {
        try {
          selecting = range.intersectsNode(page.textLayer);
        } catch {
          selecting = false;
        }
      }

      page.textLayer.classList.toggle("selecting", selecting);
      if (selecting) this.#selectingPages.add(page);
    }
    this.#evictOldPages();
  };

  #handleResize = (): void => {
    if (this.#zoomMode !== "custom") {
      this.#applyZoomMode();
    }
    this.#scheduleCurrentPageUpdate();
  };

  #cancelFitCommit(): void {
    if (this.#fitCommitTimer !== null) {
      window.clearTimeout(this.#fitCommitTimer);
      this.#fitCommitTimer = null;
    }
  }

  #scheduleFitCommit(): void {
    this.#cancelFitCommit();

    this.#fitCommitTimer = window.setTimeout(() => {
      this.#fitCommitTimer = null;

      if (!this.#disposed && this.#zoomMode !== "custom") {
        this.commitScalePreview();
      }
    }, 120);
  }

  /** Height of floating chrome (the toolbar) overlaying the top of the scroll root. */
  #topInset(): number {
    return parseFloat(getComputedStyle(this.scrollRoot).scrollPaddingTop) || 0;
  }

  #fitScale(): number {
    const spread = this.#currentSpreadPages();
    if (!spread.length) return 1;
    const gap = spread.length > 1 ? 14 : 0;
    const width = spread.reduce((sum, page) => sum + page.baseWidth, 0) + gap;
    const height = Math.max(...spread.map((page) => page.baseHeight));
    const widthScale = Math.max(100, this.scrollRoot.clientWidth - 64) / width;
    const heightScale =
      Math.max(100, this.scrollRoot.clientHeight - 40 - this.#topInset()) / height;
    switch (this.#zoomMode) {
      case "page-width": return widthScale;
      case "page-fit": return Math.min(widthScale, heightScale);
      case "automatic": return Math.min(1.25, widthScale);
      default: return 1;
    }
  }

  #applyZoomMode(): void {
    if (this.#disposed || this.#zoomMode === "custom") {
      return;
    }

    const page = this.#pages[this.#currentPage - 1] ?? this.#pages[0];
    if (!page) {
      return;
    }

    const rootBefore = this.scrollRoot.getBoundingClientRect();
    const pageBefore = page.element.getBoundingClientRect();
    this.previewScale(
      this.#fitScale(),
      {
        clientX:
          rootBefore.left +
          Math.min(
            Math.max(
              pageBefore.left -
                rootBefore.left +
                pageBefore.width / 2,
              0,
            ),
            this.scrollRoot.clientWidth,
          ),
        clientY:
          rootBefore.top +
          Math.min(
            Math.max(
              pageBefore.top -
                rootBefore.top +
                pageBefore.height / 2,
              0,
            ),
            this.scrollRoot.clientHeight,
          ),
      },
      this.#zoomMode,
    );
    this.#scheduleFitCommit();
  }

  #scheduleCurrentPageUpdate(): void {
    if (this.#disposed || this.#currentPageRaf !== null) {
      return;
    }

    this.#currentPageRaf = requestAnimationFrame(() => {
      this.#currentPageRaf = null;
      this.#updateCurrentPageFromGeometry();
    });
  }

  #updateCurrentPageFromGeometry(): void {
    if (this.#scrollMode === "page") {
      return;
    }

    const rootRect = this.scrollRoot.getBoundingClientRect();
    const visibleTop = rootRect.top + this.#topInset();
    let best: PageState | null = null;
    let bestVisibleArea = 0;

    const visibleArea = (page: PageState): number => {
      const rect = page.element.getBoundingClientRect();
      const width = Math.max(
        0,
        Math.min(rect.right, rootRect.right) -
          Math.max(rect.left, rootRect.left),
      );
      const height = Math.max(
        0,
        Math.min(rect.bottom, rootRect.bottom) -
          Math.max(rect.top, visibleTop),
      );
      return width * height;
    };

    // IntersectionObserver supplies the candidate window even after a large
    // scroll jump and in wrapped/horizontal/spread layouts.
    const candidates = new Set(this.#nearPages);
    const currentCandidate = this.#pages[this.#currentPage - 1];
    if (currentCandidate) candidates.add(currentCandidate);
    for (const page of candidates) {
      const area = visibleArea(page);

      if (area > bestVisibleArea) {
        best = page;
        bestVisibleArea = area;
      }
    }

    if (!best) {
      return;
    }

    const current = this.#pages[this.#currentPage - 1];
    const currentVisibleArea = current ? visibleArea(current) : 0;
    const switchThreshold = Math.max(
      1200,
      this.scrollRoot.clientWidth * this.scrollRoot.clientHeight * 0.02,
    );

    if (
      best.pageNumber !== this.#currentPage &&
      (currentVisibleArea === 0 ||
        bestVisibleArea > currentVisibleArea + switchThreshold)
    ) {
      const previousCurrent = current;
      this.#currentPage = best.pageNumber;
      this.#updateAllPageVisibility();
      this.options.onCurrentPageChange?.(best.pageNumber);

      if (
        previousCurrent &&
        !previousCurrent.nearViewport &&
        !previousCurrent.rendered &&
        !previousCurrent.hasPreviewBitmap
      ) {
        previousCurrent.renderHandle?.cancel();
        previousCurrent.canvas.width = 0;
        previousCurrent.canvas.height = 0;
        previousCurrent.element.dataset.renderState = "evicted";
      }

      if (this.#zoomMode !== "custom") {
        this.#applyZoomMode();
      }
    }
  }

  #realignCurrentPage(): void {
    if (this.#disposed) {
      return;
    }

    const page = this.#pages[this.#currentPage - 1];
    if (!page) {
      return;
    }

    const rootRect = this.scrollRoot.getBoundingClientRect();
    const pageRect = page.element.getBoundingClientRect();

    this.scrollRoot.scrollTo({
      left:
        this.scrollRoot.scrollLeft +
        pageRect.left -
        rootRect.left -
        16,
      top:
        this.scrollRoot.scrollTop +
        pageRect.top -
        rootRect.top -
        16 -
        this.#topInset(),
      behavior: "auto",
    });
  }

  #notifyOptionalContentChanged(): void {
    for (const listener of this.#optionalContentListeners) {
      listener();
    }
  }

  #rerenderForViewChange(): void {
    for (const page of this.#pages) {
      const preservePreview =
        page.pageNumber === this.#currentPage || page.nearViewport;
      this.#invalidatePage(page, preservePreview);
    }

    this.#renderNearPages();
  }

  #currentSpreadPages(): PageState[] {
    if (this.#spreadMode === "none") {
      const current = this.#pages[this.#currentPage - 1];
      return current ? [current] : [];
    }

    let firstPageNumber: number;

    if (this.#spreadMode === "odd") {
      firstPageNumber =
        this.#currentPage % 2 === 1
          ? this.#currentPage
          : this.#currentPage - 1;
    } else if (this.#currentPage === 1) {
      firstPageNumber = 1;
    } else {
      firstPageNumber =
        this.#currentPage % 2 === 0
          ? this.#currentPage
          : this.#currentPage - 1;
    }

    const first = this.#pages[firstPageNumber - 1];
    const second =
      this.#spreadMode === "even" && firstPageNumber === 1
        ? null
        : this.#pages[firstPageNumber] ?? null;

    return [first, second].filter(
      (page): page is PageState => Boolean(page),
    );
  }

  #isPageInCurrentSpread(pageNumber: number): boolean {
    return this.#currentSpreadPages().some(
      (page) => page.pageNumber === pageNumber,
    );
  }

  #updateAllPageVisibility(full = false): void {
    const next = new Set(this.#currentSpreadPages());
    const current = this.#pages[this.#currentPage - 1];
    if (current) next.add(current);
    const changed = full
      ? this.#pages
      : new Set([...this.#lastVisibilityPages, ...next]);
    for (const page of changed) this.#updatePageVisibility(page);
    this.#lastVisibilityPages = next;
  }

  #updatePageVisibility(page: PageState): void {
    const isCurrent = page.pageNumber === this.#currentPage;
    page.element.dataset.current = String(isCurrent);

    if (this.#scrollMode !== "page") {
      page.element.dataset.pageVisible = "true";
      return;
    }

    const visible = new Set<number>();

    if (this.#spreadMode === "none") {
      visible.add(this.#currentPage);
    } else if (this.#spreadMode === "odd") {
      const first =
        this.#currentPage % 2 === 1
          ? this.#currentPage
          : this.#currentPage - 1;
      visible.add(first);
      if (first + 1 <= this.totalPages) {
        visible.add(first + 1);
      }
    } else if (this.#currentPage === 1) {
      visible.add(1);
    } else {
      const first =
        this.#currentPage % 2 === 0
          ? this.#currentPage
          : this.#currentPage - 1;
      visible.add(first);
      if (first + 1 <= this.totalPages) {
        visible.add(first + 1);
      }
    }

    page.element.dataset.pageVisible = String(visible.has(page.pageNumber));
  }

  #pageFromElement(target: Element): PageState | undefined {
    const pageNumber = Number((target as HTMLElement).dataset.pageNumber);
    return this.#pages[pageNumber - 1];
  }

  #normalizeScale(
    nextScale: number,
    mode: ZoomMode,
    precision = 2,
  ): number {
    const minimumScale =
      mode === "custom" ? MIN_MANUAL_SCALE : MIN_FIT_SCALE;

    const factor = 10 ** precision;

    return (
      Math.round(
        Math.min(
          MAX_MANUAL_SCALE,
          Math.max(minimumScale, nextScale),
        ) * factor,
      ) / factor
    );
  }

  #commitScaleRender(): void {
    this.#layoutScale = this.#scale;
    this.container.style.setProperty(
      "--scale-factor",
      String(this.#layoutScale),
    );
    this.container.style.setProperty("--preview-zoom", "1");

    for (const page of this.#pages) {
      const preservePreview =
        page.pageNumber === this.#currentPage || page.nearViewport;
      this.#invalidatePage(page, preservePreview);
      this.#updatePagePlaceholder(page);
    }

    this.#renderNearPages();
    this.#scheduleCurrentPageUpdate();
  }

  #updatePagePlaceholder(page: PageState): void {
    const width = page.baseWidth * this.#layoutScale;
    const height = page.baseHeight * this.#layoutScale;

    page.element.style.width = `${width}px`;
    page.element.style.height = `${height}px`;
  }

  #invalidatePage(page: PageState, preserveCanvas: boolean): void {
    // A stale bitmap is still a valid visual preview. Keep that distinction
    // separate from whether the page has a current sharp render.
    page.renderHandle?.cancel();

    const hadVisibleBitmap =
      page.canvas.width > 0 && page.canvas.height > 0;

    page.rendered?.dispose({
      preserveCanvas,
      // DOM has its own retention budget and native-selection protection.
      preserveLayers: true,
    });
    if (!preserveCanvas) {
      page.canvas.width = 0;
      page.canvas.height = 0;
      this.#residentPages.delete(page);
    }
    page.rendered = null;
    page.renderedScale = null;
    page.renderedTheme = null;
    page.hasPreviewBitmap = preserveCanvas && hadVisibleBitmap;

    if (page.hasPreviewBitmap) {
      page.element.dataset.renderState = "preview";
    }
  }

  #renderNearPages(): void {
    const current = this.#pages[this.#currentPage - 1];

    if (current) {
      void this.#ensureRendered(current);
    }

    for (const page of this.#nearPages) {
      if (
        page !== current &&
        page.nearViewport
      ) {
        void this.#ensureRendered(page);
      }
    }
  }

  async #ensureRendered(
    page: PageState,
    awaitRetry = false,
  ): Promise<boolean> {
    if (this.#disposed) {
      return false;
    }

    if (this.#scalePreviewActive) {
      return Boolean(page.rendered);
    }

    if (
      page.rendered &&
      page.renderedScale === this.#scale &&
      page.renderedTheme === this.#pageTheme
    ) {
      page.lastUsed = ++this.#useCounter;
      return true;
    }

    if (page.renderHandle) {
      if (!awaitRetry) {
        return false;
      }

      try {
        await page.renderHandle.promise;
      } catch {
        // A cancelled/stale render is retried below with the current state.
      }

      if (this.#disposed) {
        return false;
      }

      await Promise.resolve();
      return this.#ensureRendered(page, true);
    }

    const scale = this.#scale;
    const theme = this.#pageTheme;
    const revision = this.#renderRevision;
    const handle = startPageRender(
      this.pdf,
      page.pageNumber,
      page.element,
      page.canvas,
      page.textLayer,
      page.annotationLayer,
      scale,
      theme,
      this.#pageAppearance,
      this.#rotation,
      this.#optionalContentConfig,
      this.#optionalContentConfigPromise,
      this.pdf.annotationStorage,
      this.#fieldObjects,
      () => this.#ensureFieldObjects(),
      this.#interaction,
      page.pageNumber === this.#currentPage || awaitRetry
        ? "high"
        : "normal",
      this.#textContentRevision,
    );

    page.renderHandle = handle;

    try {
      const rendered = await handle.promise;
      if (this.#disposed) {
        rendered.dispose();
        return false;
      }
      this.#residentPages.add(page);
      this.#textPages.add(page);

      if (page.renderHandle !== handle) {
        const preserveCanvas =
          page.hasPreviewBitmap ||
          page.nearViewport ||
          page.pageNumber === this.#currentPage;
        rendered.dispose({
          preserveCanvas,
          preserveLayers: preserveCanvas,
        });
        page.hasPreviewBitmap =
          preserveCanvas && page.canvas.width > 0 && page.canvas.height > 0;
        return false;
      }

      page.renderHandle = null;

      if (
        this.#disposed ||
        scale !== this.#scale ||
        theme !== this.#pageTheme ||
        revision !== this.#renderRevision
      ) {
        const preserveCanvas =
          page.hasPreviewBitmap ||
          page.nearViewport ||
          page.pageNumber === this.#currentPage;
        rendered.dispose({
          preserveCanvas,
          preserveLayers: preserveCanvas,
        });
        page.hasPreviewBitmap =
          preserveCanvas && page.canvas.width > 0 && page.canvas.height > 0;

        if (
          !this.#disposed &&
          !this.#scalePreviewActive &&
          (page.nearViewport || page.pageNumber === this.#currentPage)
        ) {
          if (awaitRetry) {
            return this.#ensureRendered(page, true);
          }
          void this.#ensureRendered(page);
        }
        return false;
      }

      page.rendered?.dispose();
      page.rendered = rendered;
      page.renderedScale = scale;
      page.renderedTheme = theme;
      page.hasPreviewBitmap = false;
      const dimensionsChanged =
        page.baseWidth !== rendered.baseWidth ||
        page.baseHeight !== rendered.baseHeight;
      page.baseWidth = rendered.baseWidth;
      page.baseHeight = rendered.baseHeight;
      page.lastUsed = ++this.#useCounter;
      this.#updatePagePlaceholder(page);

      const geminiPhrase = "PDF-GEMINI-TEST-92841";
      const phraseIsInTextLayer =
        rendered.extractedText.includes(geminiPhrase) &&
        (page.textLayer.textContent?.includes(geminiPhrase) ?? false);

      if (phraseIsInTextLayer) {
        this.options.onGeminiTestPhraseFound?.();
      }

      for (const listener of this.#textLayerRenderedListeners) {
        listener(page.pageNumber);
      }

      if (
        dimensionsChanged &&
        this.#isPageInCurrentSpread(page.pageNumber) &&
        this.#zoomMode !== "custom"
      ) {
        queueMicrotask(() => {
          if (!this.#disposed) {
            this.#applyZoomMode();
          }
        });
      }

      this.#evictOldPages();
      this.#scheduleCurrentPageUpdate();
      return true;
    } catch (error) {
      const wasCurrentHandle = page.renderHandle === handle;
      const wasCancelled = isPageRenderCancellation(error);

      if (wasCurrentHandle) {
        page.renderHandle = null;
      }

      if (!wasCancelled) {
        this.options.onRenderError?.(
          t("Failed to render page {page}.", { page: page.pageNumber }),
        );
      }

      if (
        wasCurrentHandle &&
        wasCancelled &&
        !this.#disposed &&
        !this.#scalePreviewActive &&
        (page.nearViewport || page.pageNumber === this.#currentPage)
      ) {
        if (awaitRetry) {
          return this.#ensureRendered(page, true);
        }
        void this.#ensureRendered(page);
      } else if (
        wasCancelled &&
        !page.nearViewport &&
        page.pageNumber !== this.#currentPage &&
        !page.rendered &&
        !page.hasPreviewBitmap
      ) {
        page.canvas.width = 0;
        page.canvas.height = 0;
        page.element.dataset.renderState = "evicted";
      }

      return false;
    }
  }

  #isInteractionPinned(page: PageState): boolean {
    if (document.activeElement && page.element.contains(document.activeElement)) return true;
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return false;
    try {
      return selection.getRangeAt(0).intersectsNode(page.textLayer);
    } catch {
      return false;
    }
  }

  #evictOldPages(): void {
    // Include stale previews: rendered === null does not mean zero pixels.
    for (const page of this.#residentPages) {
      if (!page.canvas.width || !page.canvas.height) this.#residentPages.delete(page);
    }
    let pixels = 0;
    for (const page of this.#residentPages) pixels += page.canvas.width * page.canvas.height;
    let count = this.#residentPages.size;
    const canEvict = (page: PageState) =>
      !page.nearViewport && page.pageNumber !== this.#currentPage &&
      !page.renderHandle && !this.#isInteractionPinned(page);
    const candidates = [...this.#residentPages]
      .filter(canEvict).sort((a, b) => a.lastUsed - b.lastUsed);
    for (const page of candidates) {
      if (count <= MAX_RENDERED_PAGES && pixels <= MAX_CACHED_CANVAS_PIXELS) break;
      pixels -= page.canvas.width * page.canvas.height;
      page.rendered?.dispose({ preserveLayers: true });
      page.canvas.width = 0;
      page.canvas.height = 0;
      page.rendered = null;
      page.renderedScale = null;
      page.renderedTheme = null;
      page.hasPreviewBitmap = false;
      page.element.dataset.renderState = "evicted";
      this.#residentPages.delete(page);
      count -= 1;
    }

    // Keep more real text pages than bitmaps. Selected/focused/nearby pages
    // are pinned; these are soft budgets, never a reason to break selection.
    const textCandidates = [...this.#textPages]
      .filter((page) => canEvict(page) && !page.rendered)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const page of textCandidates) {
      if (this.#textPages.size <= MAX_RETAINED_TEXT_PAGES) break;
      clearTextLayer(page.textLayer);
      page.annotationLayer.replaceChildren();
      this.#textPages.delete(page);
    }
  }
}
