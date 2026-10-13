import { t } from "../i18n/i18n";

type OptionalContentConfig = Awaited<
  ReturnType<import("pdfjs-dist").PDFDocumentProxy["getOptionalContentConfig"]>
>;

interface OptionalContentGroupLike {
  name?: string;
  visible: boolean;
}

export class LayersController {
  #disposed = false;
  #unsubscribe: (() => void) | null = null;

  constructor(
    private readonly config: OptionalContentConfig,
    private readonly container: HTMLElement,
    private readonly setVisibility: (
      id: string,
      visible: boolean,
    ) => void,
    private readonly onAvailabilityChange: (available: boolean) => void,
    subscribeToChanges: (listener: () => void) => () => void,
  ) {
    this.#unsubscribe = subscribeToChanges(() => this.refresh());
  }

  initialize(): void {
    const order = this.config.getOrder();

    if (!order || order.length === 0) {
      this.onAvailabilityChange(false);
      this.container.replaceChildren();
      return;
    }

    this.onAvailabilityChange(true);
    this.refresh();
  }

  refresh(): void {
    if (this.#disposed) {
      return;
    }

    const order = this.config.getOrder();
    const fragment = document.createDocumentFragment();

    if (order) {
      for (const item of order) {
        const rendered = this.#renderOrderItem(item);
        if (rendered) {
          fragment.append(rendered);
        }
      }
    }

    this.container.replaceChildren(fragment);

    if (!this.container.firstChild) {
      const empty = document.createElement("p");
      empty.className = "sidebar-empty";
      empty.textContent = t("No optional content layers.");
      this.container.append(empty);
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.container.replaceChildren();
  }

  #renderOrderItem(item: unknown): HTMLElement | null {
    if (typeof item === "string") {
      const group = this.config.getGroup(item) as OptionalContentGroupLike | null;

      if (!group) {
        const heading = document.createElement("div");
        heading.className = "layer-heading";
        heading.textContent = item;
        return heading;
      }

      return this.#renderGroup(item, group);
    }

    if (!Array.isArray(item)) {
      return null;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "layer-group";

    for (const child of item) {
      const rendered = this.#renderOrderItem(child);
      if (rendered) {
        wrapper.append(rendered);
      }
    }

    return wrapper.childNodes.length > 0 ? wrapper : null;
  }

  #renderGroup(
    id: string,
    group: OptionalContentGroupLike,
  ): HTMLLabelElement {
    const label = document.createElement("label");
    label.className = "layer-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = group.visible;
    checkbox.addEventListener("change", () => {
      this.setVisibility(id, checkbox.checked);
    });

    const name = document.createElement("span");
    name.textContent = group.name || id;

    label.append(checkbox, name);
    return label;
  }
}
