import {
  TextLayer,
  type PDFPageProxy,
  type PageViewport,
} from "pdfjs-dist";

export interface PreparedTextLayer {
  commit(): void;
  destroy(): void;
  extractedText: string;
}

export interface TextLayerRenderTask {
  cancel(): void;
  promise: Promise<PreparedTextLayer>;
}

interface CommittedTextLayer {
  page: PDFPageProxy;
  scale: number;
  rotation: number;
  width: number;
  height: number;
  contentRevision: number;
  firstChild: ChildNode | null;
  extractedText: string;
}

// Reuse actual DOM, not a hidden text copy. Color-only changes must not
// replace the nodes used by native selection, Look Up, or tab sharing.
const committedLayers = new WeakMap<HTMLElement, CommittedTextLayer>();

export function clearTextLayer(container: HTMLElement): void {
  committedLayers.delete(container);
  container.replaceChildren();
}

function abortError(): DOMException {
  return new DOMException("Text layer rendering cancelled.", "AbortError");
}

function commitLayer(
  target: HTMLElement,
  staging: HTMLElement,
): void {
  target.style.cssText = staging.style.cssText;

  for (const name of [...target.getAttributeNames()]) {
    if (name.startsWith("data-")) {
      target.removeAttribute(name);
    }
  }

  for (const name of staging.getAttributeNames()) {
    if (name.startsWith("data-")) {
      const value = staging.getAttribute(name);
      if (value !== null) {
        target.setAttribute(name, value);
      }
    }
  }

  target.replaceChildren(...staging.childNodes);
}

export function startTextLayerRender(
  page: PDFPageProxy,
  viewport: PageViewport,
  container: HTMLElement,
  contentRevision = 0,
): TextLayerRenderTask {
  const cached = committedLayers.get(container);
  if (
    cached && cached.page === page && cached.scale === viewport.scale &&
    cached.rotation === viewport.rotation && cached.width === viewport.width &&
    cached.height === viewport.height && cached.contentRevision === contentRevision &&
    cached.firstChild === container.firstChild
  ) {
    return {
      cancel() {},
      promise: Promise.resolve({
        commit() {},
        destroy() {},
        extractedText: cached.extractedText,
      }),
    };
  }

  let cancelled = false;
  let textLayer: TextLayer | null = null;
  let committed = false;
  const staging = document.createElement("div");
  staging.className = container.className;
  staging.style.cssText = container.style.cssText;

  const promise = (async (): Promise<PreparedTextLayer> => {
    const textContent = await page.getTextContent();

    if (cancelled) {
      throw abortError();
    }

    textLayer = new TextLayer({
      textContentSource: textContent,
      container: staging,
      viewport,
    });

    await textLayer.render();

    if (cancelled) {
      throw abortError();
    }

    const extractedText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");

    return {
      extractedText,
      commit() {
        if (committed || cancelled) {
          return;
        }

        committed = true;
        commitLayer(container, staging);
        committedLayers.set(container, {
          page,
          scale: viewport.scale,
          rotation: viewport.rotation,
          width: viewport.width,
          height: viewport.height,
          contentRevision,
          firstChild: container.firstChild,
          extractedText,
        });
      },
      destroy() {
        textLayer?.cancel();

        if (!committed) {
          staging.replaceChildren();
        }
      },
    };
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      textLayer?.cancel();
      staging.replaceChildren();
    },
  };
}
