import type { PdfViewer } from "./viewer";

export type UserHighlightColor = "yellow" | "green" | "pink" | "blue";

export interface UserHighlight {
  id: string;
  pageNumber: number;
  start: number;
  end: number;
  color: UserHighlightColor;
  text: string;
  note?: string;
  createdAt?: number;
  /** Top of the highlight within its page, as a fraction of page height. */
  fraction?: number;
}

type StoredHighlight = UserHighlight;

interface HighlightRegistryLike {
  delete(name: string): boolean;
  set(name: string, highlight: unknown): unknown;
}

interface HighlightConstructor {
  new (...ranges: Range[]): unknown;
}

const COLORS: UserHighlightColor[] = [
  "yellow",
  "green",
  "pink",
  "blue",
];

const HIGHLIGHT_PREFIX = "pdf-user-highlight-";
const FLASH_HIGHLIGHT = "pdf-user-highlight-flash";

export class UserHighlightController {
  #disposed = false;
  #highlights: StoredHighlight[];
  #unsubscribeTextLayer: () => void;
  #listeners = new Set<() => void>();
  #markers = new Map<string, HTMLButtonElement>();
  #flashTimer: number | null = null;

  constructor(
    private readonly viewer: PdfViewer,
    private readonly storageKey: string,
    private readonly onNoteMarkerClick?: (id: string, marker: HTMLElement) => void,
  ) {
    this.#highlights = this.#load();
    this.#unsubscribeTextLayer = viewer.onTextLayerRendered(() => {
      this.refresh();
    });
  }

  get count(): number {
    return this.#highlights.length;
  }

  get items(): readonly UserHighlight[] {
    return this.#highlights;
  }

  get(id: string): UserHighlight | undefined {
    return this.#highlights.find((item) => item.id === id);
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  update(id: string, patch: { color?: UserHighlightColor; note?: string }): void {
    const item = this.get(id);
    if (!item) return;
    if (patch.color && COLORS.includes(patch.color)) item.color = patch.color;
    if (patch.note !== undefined) {
      const note = patch.note.trim();
      if (note) item.note = patch.note;
      else delete item.note;
    }
    this.#save();
    this.refresh();
  }

  remove(id: string): void {
    this.#highlights = this.#highlights.filter((item) => item.id !== id);
    this.#save();
    this.refresh();
  }

  /** The live DOM range of a highlight, when its page's text layer exists. */
  rangeFor(id: string): Range | null {
    const item = this.get(id);
    const textLayer = item ? this.viewer.getTextLayerElement(item.pageNumber) : null;
    if (!item || !textLayer?.textContent) return null;
    return this.#rangeForOffsets(textLayer, item.start, item.end);
  }

  /** Highlight under a viewport point, if any. */
  highlightAt(clientX: number, clientY: number): string | null {
    const caret = this.#caretFromPoint(clientX, clientY);
    if (!caret) return null;
    const textLayer = this.#closestTextLayer(caret.node);
    const pageNumber = Number(
      textLayer?.closest<HTMLElement>(".pdf-page")?.dataset.pageNumber,
    );
    if (!textLayer || !Number.isInteger(pageNumber)) return null;
    const offset = this.#offsetWithinRoot(textLayer, caret.node, caret.offset);
    if (offset === null) return null;
    const hit = this.#highlights.find(
      (item) =>
        item.pageNumber === pageNumber && offset >= item.start && offset < item.end,
    );
    return hit?.id ?? null;
  }

  /** Briefly emphasise a highlight after jumping to it. */
  flash(id: string): void {
    const registry = this.#registry();
    const HighlightClass = this.#highlightConstructor();
    const range = this.rangeFor(id);
    if (!registry || !HighlightClass || !range) return;
    registry.set(FLASH_HIGHLIGHT, new HighlightClass(range));
    if (this.#flashTimer !== null) window.clearTimeout(this.#flashTimer);
    this.#flashTimer = window.setTimeout(() => {
      registry.delete(FLASH_HIGHLIGHT);
      this.#flashTimer = null;
    }, 1400);
  }

  canHighlightSelection(): boolean {
    return this.#selectionInfo() !== null;
  }

  /** How much of the current selection is already highlighted. */
  selectionCoverage(): "none" | "partial" | "full" {
    const info = this.#selectionInfo();
    if (!info) return "none";
    const covered = this.#coveredLength(info.pageNumber, info.start, info.end);
    if (covered === 0) return "none";
    return covered >= info.end - info.start ? "full" : "partial";
  }

  /** Remove highlighting from the selected text only (trim or split). */
  eraseSelection(): boolean {
    const info = this.#selectionInfo();
    if (!info || !this.#cut(info.pageNumber, info.start, info.end)) return false;
    this.#save();
    this.refresh();
    return true;
  }

  addSelection(color: UserHighlightColor): boolean {
    const info = this.#selectionInfo();

    if (!info) {
      return false;
    }

    // Re-highlighting replaces the overlap instead of stacking layers.
    this.#cut(info.pageNumber, info.start, info.end);

    this.#highlights.push({
      id: crypto.randomUUID(),
      pageNumber: info.pageNumber,
      start: info.start,
      end: info.end,
      color,
      text: info.text,
      createdAt: Date.now(),
      fraction: info.fraction,
    });

    this.#save();
    this.refresh();
    return true;
  }

  clearAll(): void {
    this.#highlights = [];
    this.#save();
    this.refresh();
  }

  refresh(): void {
    if (this.#disposed) {
      return;
    }

    const registry = this.#registry();
    const HighlightClass = this.#highlightConstructor();

    if (!registry || !HighlightClass) {
      return;
    }

    for (const color of COLORS) {
      registry.delete(HIGHLIGHT_PREFIX + color);
    }

    const rangesByColor = new Map<UserHighlightColor, Range[]>(
      COLORS.map((color) => [color, []]),
    );

    for (const item of this.#highlights) {
      const textLayer = this.viewer.getTextLayerElement(item.pageNumber);

      if (!textLayer || !textLayer.textContent) {
        continue;
      }

      const range = this.#rangeForOffsets(
        textLayer,
        item.start,
        item.end,
      );

      if (range) {
        rangesByColor.get(item.color)?.push(range);
        this.#placeNoteMarker(item, range);
      }
    }

    for (const [id, marker] of this.#markers) {
      if (!this.get(id)?.note) {
        marker.remove();
        this.#markers.delete(id);
      }
    }

    for (const color of COLORS) {
      const ranges = rangesByColor.get(color) ?? [];

      if (ranges.length > 0) {
        registry.set(
          HIGHLIGHT_PREFIX + color,
          new HighlightClass(...ranges),
        );
      }
    }
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#unsubscribeTextLayer();
    this.#listeners.clear();
    this.#markers.forEach((marker) => marker.remove());
    this.#markers.clear();
    if (this.#flashTimer !== null) window.clearTimeout(this.#flashTimer);

    const registry = this.#registry();
    registry?.delete(FLASH_HIGHLIGHT);
    for (const color of COLORS) {
      registry?.delete(HIGHLIGHT_PREFIX + color);
    }
  }

  #coveredLength(pageNumber: number, start: number, end: number): number {
    const spans = this.#highlights
      .filter((item) => item.pageNumber === pageNumber && item.end > start && item.start < end)
      .map((item) => [Math.max(start, item.start), Math.min(end, item.end)] as const)
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let cursor = start;
    for (const [from, to] of spans) {
      const begin = Math.max(cursor, from);
      if (to > begin) {
        covered += to - begin;
        cursor = to;
      }
    }
    return covered;
  }

  /** Subtract [start, end) from every highlight on the page. */
  #cut(pageNumber: number, start: number, end: number): boolean {
    const textLayer = this.viewer.getTextLayerElement(pageNumber);
    const textOf = (from: number, to: number, fallback: string): string =>
      (textLayer && this.#rangeForOffsets(textLayer, from, to)?.toString()) || fallback;
    let changed = false;
    const next: StoredHighlight[] = [];

    for (const item of this.#highlights) {
      if (item.pageNumber !== pageNumber || item.end <= start || item.start >= end) {
        next.push(item);
        continue;
      }

      changed = true;

      if (item.start < start) {
        next.push({ ...item, end: start, text: textOf(item.start, start, item.text) });
      }

      if (item.end > end) {
        next.push({
          ...item,
          id: item.start < start ? crypto.randomUUID() : item.id,
          start: end,
          text: textOf(end, item.end, item.text),
          // The note stays with the first piece.
          ...(item.start < start ? { note: undefined } : {}),
        });
      }
    }

    if (changed) {
      this.#highlights = next.map((item) => {
        if (item.note === undefined) {
          const { note: _note, ...rest } = item;
          return rest;
        }
        return item;
      });
    }

    return changed;
  }

  /** A small note badge at the end of a highlight that has a note. */
  #placeNoteMarker(item: StoredHighlight, range: Range): void {
    if (!item.note) return;
    const page = this.viewer.getPageElement(item.pageNumber);
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0);
    const last = rects.at(-1);
    if (!page || !last) return;
    const pageRect = page.getBoundingClientRect();
    if (pageRect.width === 0 || pageRect.height === 0) return;

    let marker = this.#markers.get(item.id);
    if (!marker) {
      marker = document.createElement("button");
      marker.type = "button";
      marker.className = "highlight-note-marker";
      marker.dataset.highlightId = item.id;
      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        this.onNoteMarkerClick?.(item.id, event.currentTarget as HTMLElement);
      });
      this.#markers.set(item.id, marker);
    }
    marker.dataset.color = item.color;
    marker.title = item.note;
    marker.setAttribute("aria-label", item.note);
    marker.style.left = `${((last.right - pageRect.left) / pageRect.width) * 100}%`;
    marker.style.top = `${((last.top - pageRect.top) / pageRect.height) * 100}%`;
    if (marker.parentElement !== page) page.append(marker);
  }

  #caretFromPoint(x: number, y: number): { node: Node; offset: number } | null {
    const doc = document as Document & {
      caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?(x: number, y: number): Range | null;
    };
    const position = doc.caretPositionFromPoint?.(x, y);
    if (position) return { node: position.offsetNode, offset: position.offset };
    const range = doc.caretRangeFromPoint?.(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }

  #selectionInfo(): {
    pageNumber: number;
    start: number;
    end: number;
    text: string;
    fraction: number;
  } | null {
    const selection = document.getSelection();

    if (
      !selection ||
      selection.isCollapsed ||
      selection.rangeCount === 0
    ) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const startLayer = this.#closestTextLayer(range.startContainer);
    const endLayer = this.#closestTextLayer(range.endContainer);

    if (!startLayer || startLayer !== endLayer) {
      return null;
    }

    const page = startLayer.closest<HTMLElement>(".pdf-page");
    const pageNumber = Number(page?.dataset.pageNumber);

    if (!Number.isInteger(pageNumber)) {
      return null;
    }

    const start = this.#offsetWithinRoot(
      startLayer,
      range.startContainer,
      range.startOffset,
    );
    const end = this.#offsetWithinRoot(
      startLayer,
      range.endContainer,
      range.endOffset,
    );

    if (start === null || end === null || end <= start) {
      return null;
    }

    const pageRect = page!.getBoundingClientRect();
    const rangeRect = range.getBoundingClientRect();

    return {
      pageNumber,
      start,
      end,
      text: range.toString(),
      fraction:
        pageRect.height > 0
          ? Math.min(1, Math.max(0, (rangeRect.top - pageRect.top) / pageRect.height))
          : 0,
    };
  }

  #closestTextLayer(node: Node): HTMLElement | null {
    const element =
      node instanceof HTMLElement ? node : node.parentElement;

    return element?.closest<HTMLElement>(".textLayer") ?? null;
  }

  #offsetWithinRoot(
    root: HTMLElement,
    target: Node,
    targetOffset: number,
  ): number | null {
    const range = document.createRange();
    range.selectNodeContents(root);

    try {
      range.setEnd(target, targetOffset);
    } catch {
      return null;
    }

    return range.toString().length;
  }

  #rangeForOffsets(
    root: HTMLElement,
    startOffset: number,
    endOffset: number,
  ): Range | null {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
    );
    let node = walker.nextNode();
    let cursor = 0;
    let startNode: Text | null = null;
    let endNode: Text | null = null;
    let localStart = 0;
    let localEnd = 0;

    while (node) {
      const textNode = node as Text;
      const nextCursor = cursor + textNode.data.length;

      if (
        !startNode &&
        startOffset >= cursor &&
        startOffset <= nextCursor
      ) {
        startNode = textNode;
        localStart = startOffset - cursor;
      }

      if (
        endOffset >= cursor &&
        endOffset <= nextCursor
      ) {
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
    range.setStart(
      startNode,
      Math.min(localStart, startNode.data.length),
    );
    range.setEnd(
      endNode,
      Math.min(localEnd, endNode.data.length),
    );
    return range;
  }

  #registry(): HighlightRegistryLike | null {
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

  #load(): StoredHighlight[] {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(this.storageKey) ?? "[]",
      ) as StoredHighlight[];

      return Array.isArray(parsed)
        ? parsed.filter(
            (item) =>
              Number.isInteger(item.pageNumber) &&
              Number.isInteger(item.start) &&
              Number.isInteger(item.end) &&
              item.end > item.start &&
              COLORS.includes(item.color) &&
              (item.note === undefined || typeof item.note === "string"),
          )
        : [];
    } catch {
      return [];
    }
  }

  #save(): void {
    try {
      localStorage.setItem(
        this.storageKey,
        JSON.stringify(this.#highlights),
      );
    } catch {
      // Storage full or unavailable: highlights stay for this session.
    }
    this.#listeners.forEach((listener) => listener());
  }
}
