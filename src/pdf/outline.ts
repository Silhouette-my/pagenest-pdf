import type { PDFDocumentProxy } from "pdfjs-dist";
import { t } from "../i18n/i18n";
import type { ViewPosition } from "./viewer";

interface OutlineNode {
  title: string;
  dest: string | Array<unknown> | null;
  url: string | null;
  newWindow?: boolean;
  items: OutlineNode[];
}

export class OutlineController {
  #disposed = false;
  #navigationSequence = 0;

  constructor(
    private readonly pdf: PDFDocumentProxy,
    private readonly container: HTMLElement,
    private readonly resolveDestination: (
      destination: string | Array<unknown>,
    ) => Promise<ViewPosition | null>,
    private readonly onSelect: (target: ViewPosition) => void,
  ) {}

  async initialize(): Promise<void> {
    const outline = (await this.pdf.getOutline()) as OutlineNode[];

    if (this.#disposed) {
      return;
    }

    if (!outline || outline.length === 0) {
      const empty = document.createElement("p");
      empty.className = "sidebar-empty";
      empty.textContent = t("No document outline.");
      this.container.replaceChildren(empty);
      return;
    }

    this.container.replaceChildren(this.#renderList(outline));
  }

  dispose(): void {
    this.#disposed = true;
    this.#navigationSequence += 1;
    this.container.replaceChildren();
  }

  #renderList(nodes: OutlineNode[]): HTMLUListElement {
    const list = document.createElement("ul");
    list.className = "outline-list";

    for (const node of nodes) {
      const children = node.items ?? [];
      const item = document.createElement("li");
      item.className = "outline-node";

      const row = document.createElement("div");
      row.className = "outline-row";

      if (children.length > 0) {
        const disclosure = document.createElement("button");
        disclosure.type = "button";
        disclosure.className = "outline-disclosure";
        disclosure.textContent = "▾";
        disclosure.setAttribute("aria-label", "Collapse section");
        disclosure.addEventListener("click", () => {
          const childList = item.querySelector<HTMLElement>(
            ":scope > .outline-list",
          );

          if (!childList) {
            return;
          }

          const collapsed = childList.hidden;
          childList.hidden = !collapsed;
          disclosure.textContent = collapsed ? "▾" : "▸";
          disclosure.setAttribute(
            "aria-label",
            collapsed ? "Collapse section" : "Expand section",
          );
        });
        row.append(disclosure);
      } else {
        const spacer = document.createElement("span");
        spacer.className = "outline-disclosure-spacer";
        row.append(spacer);
      }

      if (node.url) {
        const link = document.createElement("a");
        link.className = "outline-link";
        link.textContent = node.title || t("Untitled");
        link.href = node.url;
        link.target = node.newWindow ? "_blank" : "_self";
        link.rel = "noopener noreferrer";
        row.append(link);
      } else {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "outline-link";
        button.textContent = node.title || t("Untitled");
        button.addEventListener("click", () => {
          void this.#navigateToDestination(node.dest);
        });
        row.append(button);
      }

      item.append(row);

      if (children.length > 0) {
        item.append(this.#renderList(children));
      }

      list.append(item);
    }

    return list;
  }

  async #navigateToDestination(
    destination: string | Array<unknown> | null,
  ): Promise<void> {
    if (!destination || this.#disposed) {
      return;
    }

    const navigation = ++this.#navigationSequence;
    const target = await this.resolveDestination(destination);

    if (target && !this.#disposed && navigation === this.#navigationSequence) {
      this.onSelect(target);
    }
  }
}
