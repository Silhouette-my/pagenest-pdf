import type { ViewPosition } from "../pdf/viewer";

const MAX_ENTRIES = 100;

function samePlace(a: ViewPosition, b: ViewPosition): boolean {
  return a.pageNumber === b.pageNumber && Math.abs(a.fraction - b.fraction) < 0.02;
}

/**
 * Back/forward stack for jumps (links, outline, thumbnails, bookmarks…).
 * Ordinary scrolling and next/previous page are not recorded, as in Preview.
 */
export class NavigationHistory {
  #back: ViewPosition[] = [];
  #forward: ViewPosition[] = [];

  constructor(private readonly onChange: () => void) {}

  get canGoBack(): boolean {
    return this.#back.length > 0;
  }

  get canGoForward(): boolean {
    return this.#forward.length > 0;
  }

  /** Remember where the reader was before a jump. */
  record(from: ViewPosition): void {
    const last = this.#back.at(-1);
    if (!last || !samePlace(last, from)) {
      this.#back.push(from);
      if (this.#back.length > MAX_ENTRIES) this.#back.shift();
    }
    this.#forward = [];
    this.onChange();
  }

  back(current: ViewPosition): ViewPosition | null {
    const target = this.#back.pop() ?? null;
    if (target) this.#forward.push(current);
    this.onChange();
    return target;
  }

  forward(current: ViewPosition): ViewPosition | null {
    const target = this.#forward.pop() ?? null;
    if (target) this.#back.push(current);
    this.onChange();
    return target;
  }

  reset(): void {
    this.#back = [];
    this.#forward = [];
    this.onChange();
  }
}
