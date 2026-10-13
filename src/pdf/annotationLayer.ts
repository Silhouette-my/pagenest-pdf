import {
  AnnotationLayer,
  AnnotationType,
  type PDFPageProxy,
  type PageViewport,
} from "pdfjs-dist";
import type { PdfInteractionService } from "./interaction";

type PDFDocumentProxy = import("pdfjs-dist").PDFDocumentProxy;
type OptionalContentConfig = Awaited<
  ReturnType<PDFDocumentProxy["getOptionalContentConfig"]>
>;
type AnnotationStorage = PDFDocumentProxy["annotationStorage"];
type FieldObjects = Awaited<
  ReturnType<PDFDocumentProxy["getFieldObjects"]>
>;

export interface PreparedAnnotationLayer {
  commit(): void;
  destroy(options?: { preserveDom?: boolean }): void;
}

function syncFormControlsFromStorage(
  root: HTMLDivElement,
  annotationStorage: AnnotationStorage,
): void {
  const controls = root.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("[data-element-id]");

  for (const control of controls) {
    const id = control.getAttribute("data-element-id");

    if (!id || !annotationStorage.has(id)) {
      continue;
    }

    const stored = annotationStorage.getRawValue(id) as {
      value?: unknown;
    };

    if (!("value" in stored)) {
      continue;
    }

    const value = stored.value;

    if (
      control instanceof HTMLInputElement &&
      (control.type === "checkbox" || control.type === "radio")
    ) {
      control.checked = Boolean(value);
      continue;
    }

    if (control instanceof HTMLSelectElement) {
      const values = new Set(
        Array.isArray(value) ? value.map(String) : [String(value ?? "")],
      );

      for (const option of control.options) {
        option.selected = values.has(option.value);
      }
      continue;
    }

    control.value =
      value === null || value === undefined ? "" : String(value);
  }
}

function commitLayer(
  target: HTMLDivElement,
  staging: HTMLDivElement,
  annotationStorage: AnnotationStorage,
): void {
  syncFormControlsFromStorage(staging, annotationStorage);

  const activeElement = document.activeElement;
  const active =
    activeElement &&
    target.contains(activeElement) &&
    (activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement ||
      activeElement instanceof HTMLSelectElement)
      ? activeElement
      : null;

  const activeId =
    active instanceof HTMLElement
      ? active.getAttribute("data-element-id")
      : null;
  const selection =
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement
      ? {
          start: active.selectionStart,
          end: active.selectionEnd,
          direction: active.selectionDirection,
        }
      : null;

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

  if (activeId) {
    const replacement = target.querySelector<HTMLElement>(
      `[data-element-id="${CSS.escape(activeId)}"]`,
    );

    replacement?.focus({ preventScroll: true });

    if (
      selection &&
      (replacement instanceof HTMLInputElement ||
        replacement instanceof HTMLTextAreaElement)
    ) {
      try {
        replacement.setSelectionRange(
          selection.start,
          selection.end,
          selection.direction ?? undefined,
        );
      } catch {
        // Some input types do not expose text selection.
      }
    }
  }
}

function hasFormWidgets(annotations: unknown[]): boolean {
  return annotations.some((annotation) => {
    if (!annotation || typeof annotation !== "object") {
      return false;
    }

    return (
      "annotationType" in annotation &&
      annotation.annotationType === AnnotationType.WIDGET
    );
  });
}

function hasOptionalContentAnnotations(annotations: unknown[]): boolean {
  return annotations.some((annotation) => {
    if (!annotation || typeof annotation !== "object") {
      return false;
    }

    return "oc" in annotation && Boolean(annotation.oc);
  });
}

export async function prepareAnnotationLayer(
  page: PDFPageProxy,
  viewport: PageViewport,
  container: HTMLDivElement,
  interaction: PdfInteractionService,
  optionalContentConfig: OptionalContentConfig | null,
  optionalContentConfigPromise: Promise<OptionalContentConfig | null>,
  annotationStorage: AnnotationStorage,
  fieldObjects: FieldObjects,
  getFieldObjects: () => Promise<FieldObjects>,
): Promise<PreparedAnnotationLayer> {
  const annotations = await page.getAnnotations({ intent: "display" });
  const staging = document.createElement("div");
  staging.className = container.className;
  staging.style.cssText = container.style.cssText;
  let committed = false;

  const resolvedOptionalContentConfig =
    optionalContentConfig ??
    (hasOptionalContentAnnotations(annotations)
      ? await optionalContentConfigPromise
      : null);

  const resolvedFieldObjects =
    fieldObjects ??
    (hasFormWidgets(annotations)
      ? await getFieldObjects().catch(() => null)
      : null);

  if (annotations.length === 0) {
    return {
      commit() {
        if (committed) {
          return;
        }

        committed = true;
        container.replaceChildren();
      },
      destroy(options) {
        if (committed && !options?.preserveDom) {
          container.replaceChildren();
        }
      },
    };
  }

  const annotationViewport = viewport.clone({
    dontFlip: true,
  });

  const layer = new AnnotationLayer({
    div: staging,
    accessibilityManager: null,
    annotationCanvasMap: null,
    annotationEditorUIManager: null,
    page,
    viewport: annotationViewport,
    structTreeLayer: null,
    commentManager: null,
    linkService: interaction,
    annotationStorage,
  } as never);

  await layer.render({
    viewport: annotationViewport,
    div: staging,
    annotations,
    page,
    linkService: interaction as never,
    downloadManager: interaction.downloadManager as never,
    annotationStorage,
    renderForms: true,
    enableScripting: false,
    fieldObjects: resolvedFieldObjects,
    optionalContentConfig:
      resolvedOptionalContentConfig ?? undefined,
  } as never);

  // Internal links carry their destination for hover previews in a data
  // attribute; the visible href stays "#" so the status bubble is clean.
  for (const link of staging.querySelectorAll<HTMLAnchorElement>(
    'a[href^="#pdfdest="]',
  )) {
    link.dataset.pdfDest = decodeURIComponent(
      link.getAttribute("href")!.slice("#pdfdest=".length),
    );
    link.setAttribute("href", "#");
  }

  return {
    commit() {
      if (committed) {
        return;
      }

      committed = true;
      commitLayer(container, staging, annotationStorage);
    },
    destroy(options) {
      layer.destroy();

      if (committed && !options?.preserveDom) {
        container.replaceChildren();
      }
    },
  };
}
