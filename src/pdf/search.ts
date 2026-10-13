import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfViewer } from "./viewer";

interface SearchMatch {
  pageNumber: number;
  occurrence: number;
}

export interface SearchState {
  current: number;
  query: string;
  searching: boolean;
  total: number;
}

type SearchStateListener = (state: SearchState) => void;

interface HighlightRegistryLike {
  delete(name: string): boolean;
  set(name: string, highlight: unknown): unknown;
}

interface HighlightConstructor {
  new (...ranges: Range[]): unknown;
}

interface FoldedText {
  boundaries: number[];
  text: string;
}

const HIGHLIGHT_ALL = "pdf-search-all";
const HIGHLIGHT_CURRENT = "pdf-search-current";

function foldText(value: string): FoldedText {
  const text = value.toLocaleLowerCase();
  const boundaries = [0];
  let originalOffset = 0;

  for (const character of value) {
    const originalEnd = originalOffset + character.length;
    const foldedLength = character.toLocaleLowerCase().length;

    for (let index = 0; index < foldedLength; index += 1) {
      boundaries.push(originalEnd);
    }

    originalOffset = originalEnd;
  }

  if (boundaries.length !== text.length + 1) {
    const rebuilt = [0];
    let previousFoldedLength = 0;
    let sourceOffset = 0;

    for (const character of value) {
      sourceOffset += character.length;
      const foldedLength = value
        .slice(0, sourceOffset)
        .toLocaleLowerCase().length;

      for (
        let index = previousFoldedLength;
        index < foldedLength;
        index += 1
      ) {
        rebuilt.push(sourceOffset);
      }

      previousFoldedLength = foldedLength;
    }

    return { boundaries: rebuilt, text };
  }

  return { boundaries, text };
}

export class PdfSearchController {
  #activationSequence = 0;
  #currentIndex = -1;
  #disposed = false;
  #generation = 0;
  #matches: SearchMatch[] = [];
  #pageTextCache = new Map<number, string>();
  #foldedPageTextCache = new Map<number, string>();
  #pageTextPromises = new Map<number, Promise<string>>();
  #query = "";
  #unsubscribeTextLayerRendered: () => void;

  constructor(
    private readonly pdf: PDFDocumentProxy,
    private readonly viewer: PdfViewer,
    private readonly onStateChange: SearchStateListener,
  ) {
    this.#unsubscribeTextLayerRendered = viewer.onTextLayerRendered(
      (pageNumber) => {
        this.#restoreHighlightForRenderedPage(pageNumber);
      },
    );
  }

  async search(query: string): Promise<void> {
    const generation = ++this.#generation;
    this.#activationSequence += 1;
    this.viewer.cancelPendingNavigation();

    this.#query = query;
    this.#matches = [];
    this.#currentIndex = -1;
    this.#clearHighlights();

    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      this.#emit(false);
      return;
    }

    const foldedNeedle = normalizedQuery.toLocaleLowerCase();

    if (!foldedNeedle) {
      this.#emit(false);
      return;
    }

    this.#emit(true);
    let lastYield = performance.now();

    for (
      let pageNumber = 1;
      pageNumber <= this.pdf.numPages;
      pageNumber += 1
    ) {
      if (!this.#isGenerationCurrent(generation)) {
        return;
      }

      let haystack = this.#foldedPageTextCache.get(pageNumber);
      if (haystack === undefined) {
        const text = await this.#getPageText(pageNumber);
        if (!this.#isGenerationCurrent(generation)) return;
        haystack = text.toLocaleLowerCase();
        this.#foldedPageTextCache.set(pageNumber, haystack);
        // Search only needs the folded string; DOM highlighting owns its
        // original text. Do not retain a second document-sized string cache.
        this.#pageTextCache.delete(pageNumber);
      }

      if (!this.#isGenerationCurrent(generation)) {
        return;
      }

      // Offset maps are only needed for the visible DOM highlight, not for
      // every character of every page on each keystroke.
      let start = 0;
      let occurrence = 0;

      while (start <= haystack.length - foldedNeedle.length) {
        const index = haystack.indexOf(foldedNeedle, start);

        if (index < 0) {
          break;
        }

        this.#matches.push({ pageNumber, occurrence });
        occurrence += 1;
        start = index + Math.max(1, foldedNeedle.length);
      }

      if (this.#currentIndex < 0 && this.#matches.length > 0) {
        this.#currentIndex = 0;
        await this.#activateCurrentMatch(generation);
        if (!this.#isGenerationCurrent(generation)) return;
        this.#emit(true);
      }
      if (performance.now() - lastYield >= 8) {
        this.#emit(true);
        // A resolved Promise does not yield a paint/input opportunity.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        lastYield = performance.now();
      }
    }

    if (!this.#isGenerationCurrent(generation)) {
      return;
    }

    if (this.#isGenerationCurrent(generation)) {
      this.#emit(false);
    }
  }

  async next(): Promise<void> {
    if (this.#matches.length === 0 || this.#disposed) {
      return;
    }

    const generation = this.#generation;
    this.#currentIndex = (this.#currentIndex + 1) % this.#matches.length;
    await this.#activateCurrentMatch(generation);

    if (this.#isGenerationCurrent(generation)) {
      this.#emit(false);
    }
  }

  async previous(): Promise<void> {
    if (this.#matches.length === 0 || this.#disposed) {
      return;
    }

    const generation = this.#generation;
    this.#currentIndex =
      (this.#currentIndex - 1 + this.#matches.length) %
      this.#matches.length;

    await this.#activateCurrentMatch(generation);

    if (this.#isGenerationCurrent(generation)) {
      this.#emit(false);
    }
  }

  clear(): void {
    this.#generation += 1;
    this.#activationSequence += 1;
    this.viewer.cancelPendingNavigation();

    this.#query = "";
    this.#matches = [];
    this.#currentIndex = -1;
    this.#clearHighlights();

    if (!this.#disposed) {
      this.#emit(false);
    }
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#generation += 1;
    this.#activationSequence += 1;
    this.viewer.cancelPendingNavigation();
    this.#unsubscribeTextLayerRendered();
    this.#clearHighlights();
    this.#pageTextCache.clear();
    this.#foldedPageTextCache.clear();
    this.#pageTextPromises.clear();
  }

  async #getPageText(pageNumber: number): Promise<string> {
    const cached = this.#pageTextCache.get(pageNumber);
    if (cached !== undefined) {
      return cached;
    }

    const existing = this.#pageTextPromises.get(pageNumber);
    if (existing) return existing;
    const pending = (async () => {
      const page = await this.pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join("");
      if (!this.#disposed) this.#pageTextCache.set(pageNumber, text);
      return text;
    })();
    this.#pageTextPromises.set(pageNumber, pending);
    try {
      return await pending;
    } finally {
      if (this.#pageTextPromises.get(pageNumber) === pending) this.#pageTextPromises.delete(pageNumber);
    }
  }

  async #activateCurrentMatch(generation: number): Promise<void> {
    const activation = ++this.#activationSequence;
    const match = this.#matches[this.#currentIndex];
    const query = this.#query.trim();

    if (!match || !query || !this.#isActivationCurrent(generation, activation)) {
      return;
    }

    const navigationVersion = this.viewer.navigationVersion;
    const rendered = await this.viewer.ensurePageRendered(match.pageNumber);

    if (
      !rendered ||
      this.viewer.navigationVersion !== navigationVersion ||
      !this.#isActivationCurrent(generation, activation)
    ) {
      return;
    }

    const navigated = await this.viewer.goToPage(match.pageNumber);

    if (
      !navigated ||
      !this.#isActivationCurrent(generation, activation)
    ) {
      return;
    }

    const textLayer = this.viewer.getTextLayerElement(match.pageNumber);

    if (!textLayer) {
      return;
    }

    this.#highlightPageMatches(
      textLayer,
      query,
      match.occurrence,
      true,
    );
  }

  #restoreHighlightForRenderedPage(pageNumber: number): void {
    if (this.#disposed || this.#currentIndex < 0) {
      return;
    }

    const match = this.#matches[this.#currentIndex];
    const query = this.#query.trim();

    if (!match || match.pageNumber !== pageNumber || !query) {
      return;
    }

    const textLayer = this.viewer.getTextLayerElement(pageNumber);

    if (textLayer) {
      this.#highlightPageMatches(
        textLayer,
        query,
        match.occurrence,
        false,
      );
    }
  }

  #highlightPageMatches(
    textLayer: HTMLElement,
    query: string,
    currentOccurrence: number,
    scrollToCurrent: boolean,
  ): void {
    this.#clearHighlights();

    const registry = this.#highlightRegistry();
    const HighlightClass = this.#highlightConstructor();

    if (!registry || !HighlightClass || !query) {
      return;
    }

    const fullText = textLayer.textContent ?? "";
    const foldedHaystack = foldText(fullText);
    const foldedNeedle = foldText(query).text;
    const allRanges: Range[] = [];
    let currentRange: Range | null = null;
    let start = 0;
    let occurrence = 0;

    while (
      foldedNeedle &&
      start <= foldedHaystack.text.length - foldedNeedle.length
    ) {
      const index = foldedHaystack.text.indexOf(foldedNeedle, start);

      if (index < 0) {
        break;
      }

      const originalStart = foldedHaystack.boundaries[index] ?? 0;
      const originalEnd =
        foldedHaystack.boundaries[index + foldedNeedle.length] ??
        fullText.length;

      const range = this.#rangeForOffsets(
        textLayer,
        originalStart,
        originalEnd,
      );

      if (range) {
        allRanges.push(range);

        if (occurrence === currentOccurrence) {
          currentRange = range;
        }
      }

      occurrence += 1;
      start = index + Math.max(1, foldedNeedle.length);
    }

    if (allRanges.length > 0) {
      registry.set(HIGHLIGHT_ALL, new HighlightClass(...allRanges));
    }

    if (currentRange) {
      registry.set(HIGHLIGHT_CURRENT, new HighlightClass(currentRange));

      if (scrollToCurrent) {
        const matchElement =
          currentRange.startContainer.parentElement instanceof HTMLElement
            ? currentRange.startContainer.parentElement
            : null;

        matchElement?.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "auto",
        });
      }
    }
  }

  #rangeForOffsets(
    root: HTMLElement,
    startOffset: number,
    endOffset: number,
  ): Range | null {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let cursor = 0;
    let startNode: Text | null = null;
    let endNode: Text | null = null;
    let localStart = 0;
    let localEnd = 0;

    while (node) {
      const textNode = node as Text;
      const nextCursor = cursor + textNode.data.length;

      if (!startNode && startOffset >= cursor && startOffset <= nextCursor) {
        startNode = textNode;
        localStart = startOffset - cursor;
      }

      if (endOffset >= cursor && endOffset <= nextCursor) {
        endNode = textNode;
        localEnd = endOffset - cursor;
        break;
      }

      cursor = nextCursor;
      node = walker.nextNode();
    }

    if (!startNode || !endNode) {
      return null;
    }

    const range = document.createRange();
    range.setStart(startNode, Math.min(localStart, startNode.data.length));
    range.setEnd(endNode, Math.min(localEnd, endNode.data.length));
    return range;
  }

  #isGenerationCurrent(generation: number): boolean {
    return !this.#disposed && generation === this.#generation;
  }

  #isActivationCurrent(generation: number, activation: number): boolean {
    return (
      this.#isGenerationCurrent(generation) &&
      activation === this.#activationSequence
    );
  }

  #highlightRegistry(): HighlightRegistryLike | null {
    return (
      (
        CSS as typeof CSS & {
          highlights?: HighlightRegistryLike;
        }
      ).highlights ?? null
    );
  }

  #highlightConstructor(): HighlightConstructor | null {
    return (
      (
        globalThis as typeof globalThis & {
          Highlight?: HighlightConstructor;
        }
      ).Highlight ?? null
    );
  }

  #clearHighlights(): void {
    const registry = this.#highlightRegistry();
    registry?.delete(HIGHLIGHT_ALL);
    registry?.delete(HIGHLIGHT_CURRENT);
  }

  #emit(searching: boolean): void {
    this.onStateChange({
      current: this.#currentIndex >= 0 ? this.#currentIndex + 1 : 0,
      query: this.#query,
      searching,
      total: this.#matches.length,
    });
  }
}
