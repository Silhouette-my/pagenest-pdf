import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { runCanvasRenderExclusive } from "./canvasRenderQueue";

const THUMBNAIL_WIDTH = 118;

type OptionalContentConfig = Awaited<
  ReturnType<PDFDocumentProxy["getOptionalContentConfig"]>
>;

interface ThumbnailState {
  button: HTMLButtonElement;
  canvas: HTMLCanvasElement;
  pageNumber: number;
  rendered: boolean;
  rendering: boolean;
}

export class ThumbnailController {
  #disposed = false;
  #currentPage = 0;
  #queueAbort = new AbortController();
  #generation = 0;
  #observer: IntersectionObserver;
  #rotation = 0;
  #states: ThumbnailState[] = [];
  #tasks = new Set<RenderTask>();

  constructor(
    private readonly pdf: PDFDocumentProxy,
    private readonly container: HTMLElement,
    private readonly scrollRoot: HTMLElement,
    private readonly canCleanupPageResources: (pageNumber: number) => boolean,
    private readonly getOptionalContentConfig: () => OptionalContentConfig | null,
    private readonly onSelectPage: (pageNumber: number) => void,
  ) {
    this.#observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }

          const pageNumber = Number(
            (entry.target as HTMLElement).dataset.pageNumber,
          );
          const state = this.#states[pageNumber - 1];

          if (state) {
            void this.#render(state);
          }
        }
      },
      {
        root: this.scrollRoot,
        rootMargin: "500px 0px",
        threshold: 0,
      },
    );
  }

  initialize(): void {
    const fragment = document.createDocumentFragment();

    for (let pageNumber = 1; pageNumber <= this.pdf.numPages; pageNumber += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "thumbnail";
      button.dataset.pageNumber = String(pageNumber);
      button.setAttribute("aria-label", `Go to page ${pageNumber}`);

      const canvas = document.createElement("canvas");
      canvas.className = "thumbnail-canvas";

      const label = document.createElement("span");
      label.className = "thumbnail-label";
      label.textContent = String(pageNumber);

      button.append(canvas, label);
      button.addEventListener("click", () => this.onSelectPage(pageNumber));
      fragment.append(button);

      this.#states.push({
        button,
        canvas,
        pageNumber,
        rendered: false,
        rendering: false,
      });
    }

    this.container.replaceChildren(fragment);

    for (const state of this.#states) {
      this.#observer.observe(state.button);
    }
  }

  setCurrentPage(pageNumber: number): void {
    if (pageNumber === this.#currentPage) return;
    const previous = this.#states[this.#currentPage - 1];
    previous?.button.classList.remove("selected");
    previous?.button.setAttribute("aria-current", "false");
    this.#currentPage = pageNumber;
    const selected = this.#states[pageNumber - 1];
    selected?.button.classList.add("selected");
    selected?.button.setAttribute("aria-current", "page");
    selected?.button.scrollIntoView({ block: "nearest" });
  }

  setRotation(rotation: number): void {
    const normalized = ((rotation % 360) + 360) % 360;

    if (normalized === this.#rotation) {
      return;
    }

    this.#rotation = normalized;
    this.refresh();
  }

  refresh(): void {
    if (this.#disposed) {
      return;
    }

    this.#generation += 1;
    this.#queueAbort.abort();
    this.#queueAbort = new AbortController();

    for (const task of this.#tasks) {
      task.cancel();
    }

    for (const state of this.#states) {
      state.rendered = false;
      state.rendering = false;
      state.canvas.width = 0;
      state.canvas.height = 0;
      state.button.classList.remove("thumbnail-error");
      this.#observer.observe(state.button);
    }

    for (const state of this.#states) {
      if (
        state.button.getAttribute("aria-current") === "page" ||
        this.#isNearViewport(state.button)
      ) {
        void this.#render(state);
      }
    }
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#queueAbort.abort();
    this.#observer.disconnect();

    for (const task of this.#tasks) {
      task.cancel();
    }

    this.#tasks.clear();
    this.#states = [];
    this.container.replaceChildren();
  }

  async #render(state: ThumbnailState): Promise<void> {
    if (
      this.#disposed ||
      state.rendered ||
      state.rendering
    ) {
      return;
    }

    const generation = this.#generation;
    state.rendering = true;

    try {
      await runCanvasRenderExclusive(async () => {
        if (
          this.#disposed ||
          generation !== this.#generation
        ) {
          return;
        }

        const page = await this.pdf.getPage(state.pageNumber);
        const effectiveRotation =
          ((page.rotate + this.#rotation) % 360 + 360) % 360;
        const baseViewport = page.getViewport({
          scale: 1,
          rotation: effectiveRotation,
        });
        const scale = THUMBNAIL_WIDTH / baseViewport.width;
        const viewport = page.getViewport({
          scale,
          rotation: effectiveRotation,
        });
        const outputScale = 1;

        state.canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
        state.canvas.height = Math.max(
          1,
          Math.floor(viewport.height * outputScale),
        );
        state.canvas.style.width = `${viewport.width}px`;
        state.canvas.style.height = `${viewport.height}px`;

        const optionalContentConfig =
          this.getOptionalContentConfig();

        const task = page.render({
          canvas: state.canvas,
          viewport,
          transform:
            outputScale === 1
              ? undefined
              : [outputScale, 0, 0, outputScale, 0, 0],
          background: "#ffffff",
          optionalContentConfigPromise: optionalContentConfig
            ? Promise.resolve(optionalContentConfig)
            : undefined,
        });

        this.#tasks.add(task);

        try {
          await task.promise;

          if (generation === this.#generation) {
            state.rendered = true;
            this.#observer.unobserve(state.button);
          }
        } finally {
          this.#tasks.delete(task);

          if (this.canCleanupPageResources(state.pageNumber)) {
            page.cleanup();
          }
        }
      }, "low", this.#queueAbort.signal);
    } catch {
      if (
        !this.#disposed &&
        generation === this.#generation
      ) {
        state.button.classList.add("thumbnail-error");
      }
    } finally {
      if (generation === this.#generation) {
        state.rendering = false;
      }
    }
  }

  #isNearViewport(element: HTMLElement): boolean {
    const root = this.scrollRoot.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const margin = 500;

    return !(
      rect.bottom < root.top - margin ||
      rect.top > root.bottom + margin ||
      rect.right < root.left ||
      rect.left > root.right
    );
  }
}
