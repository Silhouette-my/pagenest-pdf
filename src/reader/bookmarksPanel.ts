/* Sidebar list of bookmarks: jump, rename (double-click) and delete. */
import type { Bookmark, BookmarkStore } from "./bookmarks";
import { t } from "../i18n/i18n";

export interface BookmarksPanelOptions {
  onAdd(): void;
  onJump(bookmark: Bookmark): void;
}

export class BookmarksPanel {
  #store: BookmarkStore | null = null;
  #unsubscribe: (() => void) | null = null;
  #list: HTMLDivElement;
  #addButton: HTMLButtonElement;
  #addLabel: HTMLSpanElement;

  constructor(
    root: HTMLElement,
    private readonly options: BookmarksPanelOptions,
  ) {
    const toolbar = document.createElement("div");
    toolbar.className = "panel-toolbar";
    this.#addButton = document.createElement("button");
    this.#addButton.type = "button";
    this.#addButton.className = "panel-add";
    this.#addButton.innerHTML =
      '<svg class="icon" aria-hidden="true"><use href="#i-bookmark-add" /></svg>';
    this.#addLabel = document.createElement("span");
    this.#addButton.append(this.#addLabel);
    this.#addButton.addEventListener("click", () => this.options.onAdd());
    toolbar.append(this.#addButton);

    this.#list = document.createElement("div");
    this.#list.className = "bookmark-list";
    root.replaceChildren(toolbar, this.#list);
    this.localize();
  }

  localize(): void {
    this.#addLabel.textContent = t("Add Bookmark");
    this.render();
  }

  setStore(store: BookmarkStore | null): void {
    this.#unsubscribe?.();
    this.#store = store;
    this.#unsubscribe = store?.onChange(() => this.render()) ?? null;
    this.#addButton.disabled = !store;
    this.render();
  }

  render(): void {
    const items = this.#store?.items ?? [];

    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "sidebar-empty";
      empty.textContent = t("No bookmarks yet. Press ⌘D to bookmark the current page.");
      this.#list.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const item of items) {
      const row = document.createElement("div");
      row.className = "bookmark-item";
      row.tabIndex = 0;
      row.setAttribute("role", "button");

      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("class", "icon bookmark-icon");
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = '<use href="#i-bookmark-fill" />';

      const label = document.createElement("span");
      label.className = "bookmark-label";
      label.textContent = item.label;
      label.title = t("Double-click to rename");

      const page = document.createElement("span");
      page.className = "bookmark-page";
      page.textContent = String(item.pageNumber);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "bookmark-remove";
      remove.title = t("Remove Bookmark");
      remove.setAttribute("aria-label", t("Remove Bookmark"));
      remove.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-xmark" /></svg>';
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        this.#store?.remove(item.id);
      });

      row.append(icon, label, page, remove);
      row.addEventListener("click", () => this.options.onJump(item));
      row.addEventListener("keydown", (event) => {
        if (event.target !== row) return;
        if (event.key === "Enter") this.options.onJump(item);
        if (event.key === "Backspace" || event.key === "Delete") this.#store?.remove(item.id);
      });
      label.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        this.#rename(item, label);
      });
      fragment.append(row);
    }

    this.#list.replaceChildren(fragment);
  }

  dispose(): void {
    this.#unsubscribe?.();
  }

  #rename(item: Bookmark, label: HTMLElement): void {
    const input = document.createElement("input");
    input.className = "bookmark-rename";
    input.value = item.label;
    let done = false;
    const finish = (save: boolean): void => {
      if (done) return;
      done = true;
      if (save) this.#store?.rename(item.id, input.value);
      this.render();
    };
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") finish(true);
      if (event.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("click", (event) => event.stopPropagation());
    label.replaceWith(input);
    input.focus();
    input.select();
  }
}
