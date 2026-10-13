import {
  AnnotationMode,
  OPS,
  OutputScale,
  RenderingCancelledException,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from "pdfjs-dist";
import type { PageAppearanceSettings } from "../theme/pageAppearance";
import { getPageThemeConfig, type PageTheme } from "../theme/pageTheme";
import {
  runCanvasRenderExclusive,
  type CanvasRenderPriority,
} from "./canvasRenderQueue";
import {
  beginCanvasThemeScope,
  resetCanvasThemeState,
} from "../theme/themedCanvas";
import {
  prepareAnnotationLayer,
  type PreparedAnnotationLayer,
} from "./annotationLayer";
import type { PdfInteractionService } from "./interaction";
import { clearTextLayer, startTextLayerRender, type TextLayerRenderTask } from "./textLayer";

type OptionalContentConfig = Awaited<
  ReturnType<PDFDocumentProxy["getOptionalContentConfig"]>
>;

export interface RenderedPage {
  baseHeight: number;
  baseWidth: number;
  dispose(options?: {
    preserveCanvas?: boolean;
    preserveLayers?: boolean;
  }): void;
  extractedText: string;
  outputScale: number;
}

export interface PageRenderHandle {
  cancel(): void;
  promise: Promise<RenderedPage>;
}

const MIN_MAIN_OUTPUT_SCALE = 1.5;
const MAX_CANVAS_PIXELS = 2 ** 25;
const MAX_CANVAS_DIMENSION = 32767;
const colorFallbackCache = new WeakMap<
  PDFPageProxy,
  Promise<boolean>
>();

function abortError(): DOMException {
  return new DOMException("Page rendering cancelled.", "AbortError");
}

function containsSoftMask(value: unknown, depth = 0): boolean {
  if (value === "SMask") {
    return true;
  }

  if (depth >= 5 || value === null || value === undefined) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsSoftMask(item, depth + 1));
  }

  if (typeof value === "object") {
    return Object.entries(value).some(
      ([key, item]) =>
        key === "SMask" || containsSoftMask(item, depth + 1),
    );
  }

  return false;
}

function pageNeedsPdfJsColorFallback(
  page: PDFPageProxy,
): Promise<boolean> {
  const cached = colorFallbackCache.get(page);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    const operatorList = await page.getOperatorList();

    for (let index = 0; index < operatorList.fnArray.length; index += 1) {
      const operation = operatorList.fnArray[index];

      if (
        operation === OPS.shadingFill ||
        operation === OPS.setFillColorN ||
        operation === OPS.setStrokeColorN
      ) {
        return true;
      }

      if (
        operation === OPS.setGState &&
        containsSoftMask(operatorList.argsArray[index])
      ) {
        return true;
      }
    }

    return false;
  })();

  colorFallbackCache.set(page, pending);
  pending.catch(() => {
    if (colorFallbackCache.get(page) === pending) {
      colorFallbackCache.delete(page);
    }
  });
  return pending;
}

export function isPageRenderCancellation(error: unknown): boolean {
  return (
    error instanceof RenderingCancelledException ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

export function startPageRender(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  pageElement: HTMLElement,
  canvas: HTMLCanvasElement,
  textLayerElement: HTMLElement,
  annotationLayerElement: HTMLDivElement,
  scale: number,
  theme: PageTheme,
  appearance: PageAppearanceSettings,
  rotation: number,
  optionalContentConfig: OptionalContentConfig | null,
  optionalContentConfigPromise: Promise<OptionalContentConfig | null>,
  annotationStorage: PDFDocumentProxy["annotationStorage"],
  fieldObjects: Awaited<ReturnType<PDFDocumentProxy["getFieldObjects"]>>,
  getFieldObjects: () => Promise<
    Awaited<ReturnType<PDFDocumentProxy["getFieldObjects"]>>
  >,
  interaction: PdfInteractionService,
  priority: CanvasRenderPriority = "normal",
  contentRevision = 0,
): PageRenderHandle {
  let cancelled = false;
  const queueController = new AbortController();
  const canvasTaskRef: { current: RenderTask | null } = { current: null };
  let canvasPromise: Promise<void> | null = null;
  let textTask: TextLayerRenderTask | null = null;
  let annotationLayer: PreparedAnnotationLayer | null = null;
  let annotationPromise: Promise<PreparedAnnotationLayer> | null = null;

  const promise = (async (): Promise<RenderedPage> => {
    const renderingPage = await pdf.getPage(pageNumber);

    if (cancelled) {
      renderingPage.cleanup();
      throw abortError();
    }

    const effectiveRotation =
      ((renderingPage.rotate + rotation) % 360 + 360) % 360;
    const viewport = renderingPage.getViewport({
      scale,
      rotation: effectiveRotation,
    });
    const baseViewport = renderingPage.getViewport({
      scale: 1,
      rotation: effectiveRotation,
    });
    const outputScale = new OutputScale();

    // PDF.js normally renders at devicePixelRatio. On standard-DPI displays,
    // a small amount of supersampling makes glyph edges noticeably closer to
    // the stock viewer while still capping memory to PDF.js's default limits.
    outputScale.sx = Math.max(outputScale.sx, MIN_MAIN_OUTPUT_SCALE);
    outputScale.sy = Math.max(outputScale.sy, MIN_MAIN_OUTPUT_SCALE);
    outputScale.limitCanvas(
      viewport.width,
      viewport.height,
      MAX_CANVAS_PIXELS,
      MAX_CANVAS_DIMENSION,
    );

    const themeConfig = getPageThemeConfig(theme, appearance);
    const usePdfJsColorFallback =
      themeConfig.usePerceptualCanvasMapping &&
      (await pageNeedsPdfJsColorFallback(renderingPage));

    if (cancelled) {
      renderingPage.cleanup();
      throw abortError();
    }

    pageElement.dataset.pageNumber = String(pageNumber);
    pageElement.dataset.pageTheme = theme;
    pageElement.dataset.rotation = String(effectiveRotation);
    pageElement.dataset.themeRenderer = usePdfJsColorFallback
      ? "pdfjs-page-colors"
      : themeConfig.usePerceptualCanvasMapping
        ? "perceptual-canvas"
        : "original";
    pageElement.dataset.renderScale = String(scale);
    pageElement.dataset.outputScale = outputScale.sx.toFixed(3);
    pageElement.dataset.renderState = "rendering";
    pageElement.style.setProperty("--pdf-selection-color", themeConfig.selection);
    pageElement.style.width = `${viewport.width}px`;
    pageElement.style.height = `${viewport.height}px`;
    pageElement.style.background = themeConfig.background;

    // Keep the previous bitmap visible as a CSS-scaled preview while PDF.js
    // renders the new zoom level to a fresh high-resolution canvas. The visible
    // canvas is replaced only when the new raster is complete, so zoom feels
    // immediate and then automatically sharpens.
    canvas.style.width = "100%";
    canvas.style.height = "100%";

    const renderCanvas = document.createElement("canvas");
    // A queued task must not hold a full-resolution backing store.
    renderCanvas.width = 0;
    renderCanvas.height = 0;

    textTask = startTextLayerRender(
      renderingPage,
      viewport,
      textLayerElement,
      contentRevision,
    );

    annotationPromise = prepareAnnotationLayer(
      renderingPage,
      viewport,
      annotationLayerElement,
      interaction,
      optionalContentConfig,
      optionalContentConfigPromise,
      annotationStorage,
      fieldObjects,
      getFieldObjects,
    );

    canvasPromise = runCanvasRenderExclusive(
      async () => {
        if (cancelled) {
          throw abortError();
        }

        renderCanvas.width = Math.max(1, Math.ceil(viewport.width * outputScale.sx));
        renderCanvas.height = Math.max(1, Math.ceil(viewport.height * outputScale.sy));
        resetCanvasThemeState(renderCanvas);

        const themeScope = beginCanvasThemeScope(
          themeConfig.usePerceptualCanvasMapping && !usePdfJsColorFallback
            ? {
                background: themeConfig.background,
                foreground: themeConfig.foreground,
                saturation: themeConfig.saturation,
                temperature: themeConfig.temperature,
              }
            : null,
        );

        try {
          canvasTaskRef.current = renderingPage.render({
            canvas: renderCanvas,
            viewport,
            transform:
              outputScale.sx === 1 && outputScale.sy === 1
                ? undefined
                : [outputScale.sx, 0, 0, outputScale.sy, 0, 0],
            // Normal themed pages use render-scoped Canvas hooks so raster
            // drawImage/putImageData stays untouched. Pages with PDF soft masks
            // or shading use PDF.js pageColors instead, preserving composition
            // semantics and avoiding unmapped mesh pixels.
            annotationMode: AnnotationMode.ENABLE_FORMS,
            background: usePdfJsColorFallback ? undefined : "#ffffff",
            optionalContentConfigPromise: optionalContentConfig
              ? Promise.resolve(optionalContentConfig)
              : undefined,
            pageColors: usePdfJsColorFallback
              ? {
                  background: themeConfig.background,
                  foreground: themeConfig.foreground,
                }
              : undefined,
          });

          await canvasTaskRef.current.promise;

          if (cancelled) {
            throw abortError();
          }

          // The visible canvas is committed only after Canvas, Text Layer,
          // and Annotation Layer are all ready. Keeping this render entirely
          // off-screen prevents mixed/blank intermediate frames.
        } finally {
          themeScope.release();
        }
      },
      priority,
      queueController.signal,
    );

    try {
      const [, preparedTextLayer, preparedAnnotationLayer] =
        await Promise.all([
          canvasPromise,
          textTask.promise,
          annotationPromise,
        ]);

      if (cancelled) {
        preparedTextLayer.destroy();
        preparedAnnotationLayer.destroy({ preserveDom: true });
        throw abortError();
      }

      const visibleContext = canvas.getContext("2d");
      if (!visibleContext) {
        preparedTextLayer.destroy();
        preparedAnnotationLayer.destroy({ preserveDom: true });
        throw new Error("Canvas 2D rendering is unavailable.");
      }

      // Commit every visible surface in one synchronous turn. The browser
      // paints only after this turn completes, so users never see a blank
      // canvas or a missing Text/Annotation layer between revisions.
      canvas.width = renderCanvas.width;
      canvas.height = renderCanvas.height;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      resetCanvasThemeState(canvas);
      visibleContext.drawImage(renderCanvas, 0, 0);
      preparedTextLayer.commit();
      preparedAnnotationLayer.commit();
      annotationLayer = preparedAnnotationLayer;
      pageElement.dataset.renderState = "sharp";

      let disposed = false;

      return {
        baseHeight: baseViewport.height,
        baseWidth: baseViewport.width,
        extractedText: preparedTextLayer.extractedText,
        outputScale: outputScale.sx,
        dispose(options) {
          if (disposed) {
            return;
          }

          disposed = true;
          renderingPage.cleanup();

          if (!options?.preserveCanvas) {
            canvas.width = 0;
            canvas.height = 0;
          }

          annotationLayer?.destroy({
            preserveDom: options?.preserveLayers,
          });
          annotationLayer = null;

          if (!options?.preserveLayers) {
            clearTextLayer(textLayerElement);
          }
        },
      };
    } catch (error) {
      canvasTaskRef.current?.cancel();
      textTask?.cancel();

      const settled = await Promise.allSettled([
        canvasPromise ?? Promise.resolve(),
        textTask?.promise ?? Promise.resolve(),
        annotationPromise ?? Promise.resolve(null),
      ]);

      const textResult = settled[1];
      if (textResult?.status === "fulfilled") {
        textResult.value.destroy();
      }

      const annotationResult = settled[2];
      if (annotationResult?.status === "fulfilled") {
        annotationResult.value?.destroy({ preserveDom: true });
      }
      annotationLayer = null;

      renderingPage.cleanup();
      pageElement.dataset.renderState = isPageRenderCancellation(error)
        ? "preview"
        : "error";
      throw error;
    } finally {
      // drawImage has completed (or every cancelled task has settled).
      // Release pixels explicitly instead of waiting for garbage collection.
      renderCanvas.width = 0;
      renderCanvas.height = 0;
    }
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      queueController.abort();
      canvasTaskRef.current?.cancel();
      textTask?.cancel();
      annotationLayer?.destroy({ preserveDom: true });
      annotationLayer = null;
      pageElement.dataset.renderState = "preview";
    },
  };
}
