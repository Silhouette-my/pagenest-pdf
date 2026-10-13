/*
 * Hover preview for internal links (citations, figure and section
 * references): shows the target region in a floating glass card, so the
 * reader can check "[12]" or "Fig. 3" without losing their place.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import { runCanvasRenderExclusive } from "./canvasRenderQueue";
import type { PdfViewer, ViewPosition } from "./viewer";
import { t } from "../i18n/i18n";

const SHOW_DELAY = 280;
const HIDE_DELAY = 220;
const PREVIEW_WIDTH = 400;
const PREVIEW_MAX_HEIGHT = 260;
const CONTEXT_ABOVE = 22;
const CACHE_SIZE = 12;
/** Share of the page width trimmed from each side (typical text margins). */
const SIDE_MARGIN = 0.1;

interface PreviewImage {
  canvas: HTMLCanvasElement;
  target: ViewPosition;
}

export interface LinkPreviewOptions {
  /** Whether to tint the preview like the current page theme. */
  getPageTheme(): string;
  onNavigate(target: ViewPosition): void;
}

export class LinkPreviewController {
  #card: HTMLDivElement;
  #body: HTMLDivElement;
  #title: HTMLSpanElement;
  #anchor: HTMLAnchorElement | null = null;
  #target: ViewPosition | null = null;
  #showTimer: number | null = null;
  #hideTimer: number | null = null;
  #sequence = 0;
  #cache = new Map<string, Promise<PreviewImage | null>>();
  #abort = new AbortController();

  constructor(
    private readonly pdf: PDFDocumentProxy,
    private readonly viewer: PdfViewer,
    root: HTMLElement,
    private readonly options: LinkPreviewOptions,
  ) {
    this.#card = document.createElement("div");
    this.#card.className = "link-preview";
    this.#card.hidden = true;
    this.#card.setAttribute("role", "tooltip");

    const header = document.createElement("div");
    header.className = "link-preview-header";
    this.#title = document.createElement("span");
    const hint = document.createElement("span");
    hint.className = "link-preview-hint";
    hint.textContent = t("Click to go");
    header.append(this.#title, hint);

    this.#body = document.createElement("div");
    this.#body.className = "link-preview-body";
    this.#card.append(header, this.#body);
    document.body.append(this.#card);

    const signal = this.#abort.signal;
    root.addEventListener("pointerover", this.#handleOver, { signal });
    root.addEventListener("pointerout", this.#handleOut, { signal });
    root.addEventListener("scroll", () => this.hide(), { signal, passive: true });
    this.#card.addEventListener("pointerenter", () => this.#cancelHide(), { signal });
    this.#card.addEventListener("pointerleave", () => this.#scheduleHide(), { signal });
    this.#card.addEventListener(
      "click",
      () => {
        const target = this.#target;
        this.hide();
        if (target) this.options.onNavigate(target);
      },
      { signal },
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") this.hide();
      },
      { signal },
    );
  }

  hide(): void {
    this.#sequence += 1;
    this.#clearTimers();
    this.#anchor = null;
    this.#target = null;
    this.#card.hidden = true;
  }

  dispose(): void {
    this.hide();
    this.#abort.abort();
    this.#card.remove();
    this.#cache.clear();
  }

  #handleOver = (event: PointerEvent): void => {
    const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>(
      "a[data-pdf-dest]",
    );

    if (!link || event.pointerType === "touch") {
      return;
    }

    if (link === this.#anchor) {
      this.#cancelHide();
      return;
    }

    this.#clearTimers();
    this.#anchor = link;
    this.#showTimer = window.setTimeout(() => void this.#show(link), SHOW_DELAY);
  };

  #handleOut = (event: PointerEvent): void => {
    const link = (event.target as Element | null)?.closest?.("a[data-pdf-dest]");
    if (!link || link !== this.#anchor) return;
    const next = event.relatedTarget as Node | null;
    if (next && (link.contains(next) || this.#card.contains(next))) return;

    if (this.#card.hidden) {
      this.#clearTimers();
      this.#anchor = null;
    } else {
      this.#scheduleHide();
    }
  };

  async #show(link: HTMLAnchorElement): Promise<void> {
    const sequence = ++this.#sequence;
    let destination: string | Array<unknown>;

    try {
      destination = JSON.parse(link.dataset.pdfDest ?? "null");
    } catch {
      return;
    }

    if (!destination) return;

    const key = link.dataset.pdfDest!;
    let pending = this.#cache.get(key);
    if (!pending) {
      pending = this.#render(destination);
      this.#cache.set(key, pending);
      if (this.#cache.size > CACHE_SIZE) {
        this.#cache.delete(this.#cache.keys().next().value!);
      }
    }

    const image = await pending;
    if (!image || sequence !== this.#sequence || !link.isConnected) {
      if (!image) this.#cache.delete(key);
      return;
    }

    this.#target = image.target;
    this.#title.textContent = t("Page {page}", { page: image.target.pageNumber });
    this.#card.dataset.pageTheme = this.options.getPageTheme();
    this.#body.replaceChildren(image.canvas);
    this.#card.hidden = false;
    this.#position(link);
  }

  async #render(destination: string | Array<unknown>): Promise<PreviewImage | null> {
    const target = await this.viewer.resolveDestination(destination);
    if (!target) return null;

    try {
      const page = await this.pdf.getPage(target.pageNumber);
      const base = page.getViewport({ scale: 1 });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const scale = (PREVIEW_WIDTH / (base.width * (1 - SIDE_MARGIN * 2))) * ratio;
      const viewport = page.getViewport({ scale });
      const full = document.createElement("canvas");
      full.width = Math.ceil(viewport.width);
      full.height = Math.ceil(viewport.height);

      await runCanvasRenderExclusive(
        () => page.render({ canvas: full, viewport, background: "#ffffff" }).promise,
        "high",
      );

      // Crop a window starting a little above the destination line.
      const top = Math.max(0, target.fraction * full.height - CONTEXT_ABOVE * ratio);
      const height = Math.min(PREVIEW_MAX_HEIGHT * ratio, full.height - top);
      const left = Math.round(full.width * SIDE_MARGIN);
      const width = full.width - left * 2;
      const crop = document.createElement("canvas");
      crop.width = width;
      crop.height = Math.max(1, Math.round(height));
      crop.style.width = `${PREVIEW_WIDTH}px`;
      crop.style.height = `${crop.height / ratio}px`;
      crop.getContext("2d")?.drawImage(full, left, top, width, height, 0, 0, width, height);
      full.width = 0;
      full.height = 0;
      return { canvas: crop, target };
    } catch {
      return null;
    }
  }

  #position(link: HTMLElement): void {
    const rect = link.getBoundingClientRect();
    const card = this.#card.getBoundingClientRect();
    const margin = 10;
    const below = rect.bottom + margin;
    const fitsBelow = below + card.height < window.innerHeight - margin;
    const top = fitsBelow ? below : Math.max(margin, rect.top - margin - card.height);
    const left = Math.min(
      window.innerWidth - card.width - margin,
      Math.max(margin, rect.left + rect.width / 2 - card.width / 2),
    );
    this.#card.style.left = `${left}px`;
    this.#card.style.top = `${top}px`;
    this.#card.dataset.placement = fitsBelow ? "below" : "above";
  }

  #scheduleHide(): void {
    this.#cancelHide();
    this.#hideTimer = window.setTimeout(() => this.hide(), HIDE_DELAY);
  }

  #cancelHide(): void {
    if (this.#hideTimer !== null) {
      window.clearTimeout(this.#hideTimer);
      this.#hideTimer = null;
    }
  }

  #clearTimers(): void {
    this.#cancelHide();
    if (this.#showTimer !== null) {
      window.clearTimeout(this.#showTimer);
      this.#showTimer = null;
    }
  }
}
