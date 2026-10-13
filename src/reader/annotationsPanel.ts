/*
 * Sidebar list of highlights and notes: filter by color or text, jump to a
 * highlight, edit its note, and export everything as Markdown.
 */
import type { UserHighlight, UserHighlightColor, UserHighlightController } from "../pdf/highlights";
import { t } from "../i18n/i18n";

const COLORS: UserHighlightColor[] = ["yellow", "green", "pink", "blue"];
const COLOR_EMOJI: Record<UserHighlightColor, string> = {
  yellow: "🟡",
  green: "🟢",
  pink: "🩷",
  blue: "🔵",
};

export interface AnnotationsPanelOptions {
  onJump(highlight: UserHighlight): void;
  onEdit(highlight: UserHighlight, anchor: HTMLElement): void;
  onStatus(message: string): void;
  getDocumentName(): string;
}

function sortHighlights(items: readonly UserHighlight[]): UserHighlight[] {
  return [...items].sort((a, b) => a.pageNumber - b.pageNumber || a.start - b.start);
}

export function highlightsToMarkdown(
  title: string,
  items: readonly UserHighlight[],
): string {
  const lines = [`# ${title}`, ""];
  let page = 0;

  for (const item of sortHighlights(items)) {
    if (item.pageNumber !== page) {
      page = item.pageNumber;
      lines.push(`## ${t("Page {page}", { page })}`, "");
    }

    const quote = item.text.replace(/\s+/g, " ").trim();
    lines.push(`> ${COLOR_EMOJI[item.color]} ${quote}`, "");

    if (item.note?.trim()) {
      lines.push(...item.note.trim().split("\n"), "");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

export class AnnotationsPanel {
  #controller: UserHighlightController | null = null;
  #unsubscribe: (() => void) | null = null;
  #query = "";
  #colors = new Set<UserHighlightColor>(COLORS);
  #list: HTMLDivElement;
  #search: HTMLInputElement;
  #chips: HTMLButtonElement[] = [];
  #count: HTMLSpanElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: AnnotationsPanelOptions,
  ) {
    const toolbar = document.createElement("div");
    toolbar.className = "panel-toolbar";

    this.#search = document.createElement("input");
    this.#search.type = "search";
    this.#search.className = "panel-search";
    this.#search.addEventListener("input", () => {
      this.#query = this.#search.value.trim().toLowerCase();
      this.render();
    });

    const chips = document.createElement("div");
    chips.className = "color-chips";
    for (const color of COLORS) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "color-chip";
      chip.dataset.color = color;
      chip.setAttribute("aria-pressed", "true");
      chip.addEventListener("click", () => {
        if (this.#colors.has(color) && this.#colors.size > 1) this.#colors.delete(color);
        else this.#colors.add(color);
        this.render();
      });
      this.#chips.push(chip);
      chips.append(chip);
    }

    this.#count = document.createElement("span");
    this.#count.className = "panel-count";

    const copy = this.#actionButton("copy", () => void this.#copyMarkdown());
    const download = this.#actionButton("download", () => this.#downloadMarkdown());
    chips.append(this.#count, copy, download);
    toolbar.append(this.#search, chips);

    this.#list = document.createElement("div");
    this.#list.className = "annotation-list";
    root.replaceChildren(toolbar, this.#list);
    this.localize();
  }

  /** Re-apply UI strings after a language change. */
  localize(): void {
    this.#search.placeholder = t("Search highlights and notes");
    this.#search.setAttribute("aria-label", t("Search highlights and notes"));
    const names: Record<UserHighlightColor, string> = {
      yellow: t("Yellow"),
      green: t("Green"),
      pink: t("Pink"),
      blue: t("Blue"),
    };
    for (const chip of this.#chips) {
      const name = names[chip.dataset.color as UserHighlightColor];
      chip.title = t("Show {color}", { color: name });
      chip.setAttribute("aria-label", chip.title);
    }
    const [copy, download] = Array.from(this.root.querySelectorAll<HTMLButtonElement>(".panel-action"));
    if (copy) copy.title = t("Copy as Markdown");
    if (download) download.title = t("Download Markdown");
    copy?.setAttribute("aria-label", copy.title);
    download?.setAttribute("aria-label", download.title);
    this.render();
  }

  setController(controller: UserHighlightController | null): void {
    this.#unsubscribe?.();
    this.#controller = controller;
    this.#unsubscribe = controller?.onChange(() => this.render()) ?? null;
    this.render();
  }

  render(): void {
    for (const chip of this.#chips) {
      chip.setAttribute("aria-pressed", String(this.#colors.has(chip.dataset.color as UserHighlightColor)));
    }

    const all = this.#controller?.items ?? [];
    const visible = sortHighlights(all).filter(
      (item) =>
        this.#colors.has(item.color) &&
        (!this.#query ||
          item.text.toLowerCase().includes(this.#query) ||
          item.note?.toLowerCase().includes(this.#query)),
    );

    this.#count.textContent = all.length ? String(visible.length) : "";

    if (!all.length) {
      const empty = document.createElement("p");
      empty.className = "sidebar-empty";
      empty.textContent = t("No highlights yet. Select text and press the highlighter to add one.");
      this.#list.replaceChildren(empty);
      return;
    }

    if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "sidebar-empty";
      empty.textContent = t("No matching highlights.");
      this.#list.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    let page = 0;

    for (const item of visible) {
      if (item.pageNumber !== page) {
        page = item.pageNumber;
        const heading = document.createElement("div");
        heading.className = "annotation-page";
        heading.textContent = t("Page {page}", { page });
        fragment.append(heading);
      }

      const card = document.createElement("div");
      card.className = "annotation-item";
      card.dataset.color = item.color;
      card.tabIndex = 0;
      card.setAttribute("role", "button");

      const quote = document.createElement("div");
      quote.className = "annotation-quote";
      quote.textContent = item.text.replace(/\s+/g, " ").trim();
      card.append(quote);

      if (item.note) {
        const note = document.createElement("div");
        note.className = "annotation-note";
        note.textContent = item.note;
        card.append(note);
      }

      const actions = document.createElement("div");
      actions.className = "annotation-actions";
      const edit = this.#iconButton("note", item.note ? t("Edit Note") : t("Add Note"), (anchor) =>
        this.options.onEdit(item, anchor),
      );
      const remove = this.#iconButton("trash", t("Delete Highlight"), () =>
        this.#controller?.remove(item.id),
      );
      actions.append(edit, remove);
      card.append(actions);

      card.addEventListener("click", (event) => {
        if ((event.target as Element).closest(".annotation-actions")) return;
        this.options.onJump(item);
      });
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.options.onJump(item);
        }
      });
      fragment.append(card);
    }

    this.#list.replaceChildren(fragment);
  }

  dispose(): void {
    this.#unsubscribe?.();
  }

  #markdown(): string | null {
    const items = this.#controller?.items ?? [];
    if (!items.length) {
      this.options.onStatus(t("There are no highlights to export."));
      return null;
    }
    return highlightsToMarkdown(this.options.getDocumentName(), items);
  }

  async #copyMarkdown(): Promise<void> {
    const markdown = this.#markdown();
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      this.options.onStatus(t("Highlights copied as Markdown."));
    } catch {
      this.options.onStatus(t("Could not copy to the clipboard."));
    }
  }

  #downloadMarkdown(): void {
    const markdown = this.#markdown();
    if (!markdown) return;
    const name = this.options.getDocumentName().replace(/\.pdf$/i, "") || "highlights";
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name} – ${t("Highlights")}.md`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  #actionButton(icon: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "panel-action";
    button.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${icon}" /></svg>`;
    button.addEventListener("click", onClick);
    return button;
  }

  #iconButton(icon: string, label: string, onClick: (anchor: HTMLElement) => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${icon}" /></svg>`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick(button);
    });
    return button;
  }
}
