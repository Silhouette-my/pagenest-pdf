/* Floating editor for one highlight: color, note and delete. */
import type { UserHighlightColor, UserHighlightController } from "../pdf/highlights";
import { t } from "../i18n/i18n";

const COLORS: UserHighlightColor[] = ["yellow", "green", "pink", "blue"];

export class HighlightPopover {
  #card: HTMLDivElement;
  #note: HTMLTextAreaElement;
  #swatches: HTMLButtonElement[] = [];
  #remove: HTMLButtonElement;
  #controller: UserHighlightController | null = null;
  #id: string | null = null;
  #saveTimer: number | null = null;

  constructor() {
    this.#card = document.createElement("div");
    this.#card.className = "highlight-popover";
    this.#card.hidden = true;
    this.#card.setAttribute("role", "dialog");

    const row = document.createElement("div");
    row.className = "highlight-popover-row";
    for (const color of COLORS) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "color-chip";
      swatch.dataset.color = color;
      swatch.addEventListener("click", () => {
        if (this.#id) this.#controller?.update(this.#id, { color });
        this.#syncSwatches();
      });
      this.#swatches.push(swatch);
      row.append(swatch);
    }

    this.#remove = document.createElement("button");
    this.#remove.type = "button";
    this.#remove.className = "highlight-popover-delete";
    this.#remove.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-trash" /></svg>';
    this.#remove.addEventListener("click", () => {
      if (this.#id) this.#controller?.remove(this.#id);
      this.hide();
    });
    row.append(this.#remove);

    this.#note = document.createElement("textarea");
    this.#note.rows = 3;
    this.#note.addEventListener("input", () => this.#scheduleSave());
    this.#note.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") this.hide();
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) this.hide();
    });

    this.#card.append(row, this.#note);
    document.body.append(this.#card);

    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!this.#card.hidden && !this.#card.contains(event.target as Node)) this.hide();
      },
      true,
    );
    this.localize();
  }

  get open(): boolean {
    return !this.#card.hidden;
  }

  localize(): void {
    this.#note.placeholder = t("Add a note…");
    this.#note.setAttribute("aria-label", t("Note"));
    this.#remove.title = t("Delete Highlight");
    this.#remove.setAttribute("aria-label", t("Delete Highlight"));
    const names: Record<UserHighlightColor, string> = {
      yellow: t("Yellow"), green: t("Green"), pink: t("Pink"), blue: t("Blue"),
    };
    for (const swatch of this.#swatches) {
      swatch.title = names[swatch.dataset.color as UserHighlightColor];
      swatch.setAttribute("aria-label", swatch.title);
    }
  }

  show(
    controller: UserHighlightController,
    id: string,
    anchor: DOMRect,
    { focusNote = false }: { focusNote?: boolean } = {},
  ): void {
    this.#flush();
    const item = controller.get(id);
    if (!item) return;
    this.#controller = controller;
    this.#id = id;
    this.#note.value = item.note ?? "";
    this.#syncSwatches();
    this.#card.hidden = false;

    const card = this.#card.getBoundingClientRect();
    const margin = 10;
    const below = anchor.bottom + 8;
    const top =
      below + card.height < window.innerHeight - margin
        ? below
        : Math.max(margin, anchor.top - 8 - card.height);
    const left = Math.min(
      window.innerWidth - card.width - margin,
      Math.max(margin, anchor.left + anchor.width / 2 - card.width / 2),
    );
    this.#card.style.left = `${left}px`;
    this.#card.style.top = `${top}px`;

    if (focusNote || item.note) {
      this.#note.focus({ preventScroll: true });
      this.#note.setSelectionRange(this.#note.value.length, this.#note.value.length);
    }
  }

  hide(): void {
    this.#flush();
    this.#card.hidden = true;
    this.#id = null;
  }

  #syncSwatches(): void {
    const color = this.#id ? this.#controller?.get(this.#id)?.color : undefined;
    for (const swatch of this.#swatches) {
      swatch.setAttribute("aria-pressed", String(swatch.dataset.color === color));
    }
  }

  #scheduleSave(): void {
    if (this.#saveTimer !== null) window.clearTimeout(this.#saveTimer);
    this.#saveTimer = window.setTimeout(() => this.#flush(), 400);
  }

  #flush(): void {
    if (this.#saveTimer !== null) {
      window.clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
    const item = this.#id ? this.#controller?.get(this.#id) : undefined;
    if (this.#id && item && (item.note ?? "") !== this.#note.value) {
      this.#controller?.update(this.#id, { note: this.#note.value });
    }
  }
}
