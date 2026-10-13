import type { ViewPosition } from "../pdf/viewer";

export interface Bookmark extends ViewPosition {
  id: string;
  label: string;
  createdAt: number;
}

/** Per-document bookmarks persisted in localStorage. */
export class BookmarkStore {
  #items: Bookmark[];
  #listeners = new Set<() => void>();

  constructor(private readonly storageKey: string) {
    this.#items = this.#load();
  }

  get items(): readonly Bookmark[] {
    return this.#items;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  findOnPage(pageNumber: number): Bookmark | undefined {
    return this.#items.find((item) => item.pageNumber === pageNumber);
  }

  add(position: ViewPosition, label: string): Bookmark {
    const bookmark: Bookmark = {
      id: crypto.randomUUID(),
      pageNumber: position.pageNumber,
      fraction: position.fraction,
      label,
      createdAt: Date.now(),
    };
    this.#items.push(bookmark);
    this.#commit();
    return bookmark;
  }

  rename(id: string, label: string): void {
    const item = this.#items.find((entry) => entry.id === id);
    if (item && label.trim()) {
      item.label = label.trim();
      this.#commit();
    }
  }

  remove(id: string): void {
    this.#items = this.#items.filter((entry) => entry.id !== id);
    this.#commit();
  }

  #commit(): void {
    this.#items.sort((a, b) => a.pageNumber - b.pageNumber || a.fraction - b.fraction);
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.#items));
    } catch {
      // Storage full or unavailable: keep bookmarks for this session.
    }
    this.#listeners.forEach((listener) => listener());
  }

  #load(): Bookmark[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.storageKey) ?? "[]") as Bookmark[];
      return Array.isArray(parsed)
        ? parsed.filter(
            (item) =>
              typeof item?.id === "string" &&
              Number.isInteger(item.pageNumber) &&
              typeof item.fraction === "number" &&
              typeof item.label === "string",
          )
        : [];
    } catch {
      return [];
    }
  }
}
