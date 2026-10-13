/*
 * In-page printing. Each page is rasterised at print resolution into an
 * off-screen container that is the only thing visible under `@media print`,
 * so the browser prints the reader tab itself instead of handing the PDF to
 * a new tab (where Chrome's native viewer, or this extension, would take it).
 */
import { AnnotationMode, type PDFDocumentProxy } from "pdfjs-dist";
import { runCanvasRenderExclusive } from "./canvasRenderQueue";

const PRINT_DPI = 150;
const MAX_PRINT_PIXELS = 2 ** 24;
const PRINT_CLASS = "is-printing";

export interface PrintOptions {
  onProgress?(done: number, total: number): void;
  signal?: AbortSignal;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed."))),
      "image/png",
    );
  });
}

export async function printPdfDocument(
  pdf: PDFDocumentProxy,
  options: PrintOptions = {},
): Promise<void> {
  const container = document.createElement("div");
  container.id = "print-container";
  container.setAttribute("aria-hidden", "true");
  const pageStyle = document.createElement("style");
  const urls: string[] = [];
  const printStorage = pdf.annotationStorage.print;
  const total = pdf.numPages;

  const cleanup = (): void => {
    document.body.classList.remove(PRINT_CLASS);
    container.remove();
    pageStyle.remove();
    urls.forEach((url) => URL.revokeObjectURL(url));
  };

  try {
    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      options.signal?.throwIfAborted();
      const page = await pdf.getPage(pageNumber);

      try {
        const base = page.getViewport({ scale: 1 });
        const pixels = base.width * base.height * (PRINT_DPI / 72) ** 2;
        const scale = (PRINT_DPI / 72) * Math.min(1, Math.sqrt(MAX_PRINT_PIXELS / pixels));
        const viewport = page.getViewport({ scale });

        if (pageNumber === 1) {
          // Like PDF.js: the first page decides the sheet size.
          pageStyle.textContent =
            `@page { size: ${base.width}pt ${base.height}pt; margin: 0; }`;
        }

        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        await runCanvasRenderExclusive(
          () =>
            page.render({
              canvas,
              viewport,
              intent: "print",
              annotationMode: AnnotationMode.ENABLE_STORAGE,
              printAnnotationStorage: printStorage,
              background: "#ffffff",
            }).promise,
          "low",
          options.signal,
        );

        const url = URL.createObjectURL(await canvasToBlob(canvas));
        urls.push(url);
        canvas.width = 0;
        canvas.height = 0;

        const sheet = document.createElement("div");
        sheet.className = "print-page";
        const image = new Image();
        image.alt = "";
        image.src = url;
        sheet.append(image);
        container.append(sheet);
      } finally {
        page.cleanup();
      }

      options.onProgress?.(pageNumber, total);
    }

    document.head.append(pageStyle);
    document.body.append(container);
    await Promise.all(
      Array.from(container.querySelectorAll("img"), (image) =>
        image.decode().catch(() => undefined),
      ),
    );
    options.signal?.throwIfAborted();

    document.body.classList.add(PRINT_CLASS);
    await new Promise<void>((resolve) => {
      const done = (): void => {
        window.removeEventListener("afterprint", done);
        resolve();
      };
      window.addEventListener("afterprint", done);
      window.print();
      // Some environments never fire afterprint; print() blocks until the
      // dialog closes in Chrome, so resolve on the next task as a fallback.
      window.setTimeout(done, 0);
    });
  } finally {
    cleanup();
  }
}
