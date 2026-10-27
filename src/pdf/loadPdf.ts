import {
  GlobalWorkerOptions,
  InvalidPDFException,
  PasswordException,
  PDFDataRangeTransport,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const cMapOptions = {
  cMapUrl: new URL(`${import.meta.env.BASE_URL}cmaps/`, window.location.href).href,
  cMapPacked: true,
};

export interface LoadedPdf {
  document: PDFDocumentProxy;
  destroy(): Promise<void>;
}

export interface PdfRangeSource {
  abort?(): void;
  initialData: Uint8Array;
  length: number;
  requestRange(begin: number, end: number): Promise<Uint8Array>;
}

export interface PdfProgressiveConsumer {
  done(): void;
  push(chunk: Uint8Array): void;
}

export interface PdfProgressiveSource {
  abort?(): void;
  initialData: Uint8Array;
  length: number;
  setConsumer(consumer: PdfProgressiveConsumer): void;
}

class CallbackProgressiveTransport extends PDFDataRangeTransport {
  constructor(private readonly source: PdfProgressiveSource) {
    super(
      source.length,
      source.initialData,
      false,
    );

    source.setConsumer({
      push: (chunk) => this.onDataProgressiveRead(chunk),
      done: () => this.onDataProgressiveDone(),
    });
  }

  override requestDataRange(): void {
    // Range loading is disabled for this transport. Data arrives
    // progressively through onDataProgressiveRead instead.
  }

  override abort(): void {
    this.source.abort?.();
  }
}

class CallbackRangeTransport extends PDFDataRangeTransport {
  constructor(private readonly source: PdfRangeSource) {
    super(
      source.length,
      source.initialData,
      true,
    );
  }

  override requestDataRange(begin: number, end: number): void {
    void this.source
      .requestRange(begin, end)
      .then((chunk) => {
        this.onDataRange(begin, chunk);
      });
  }

  override abort(): void {
    this.source.abort?.();
  }
}

export async function loadPdf(buffer: ArrayBuffer): Promise<LoadedPdf> {
  const loadingTask: PDFDocumentLoadingTask = getDocument({
    data: new Uint8Array(buffer),
    ...cMapOptions,
    useSystemFonts: true,
  });
  try {
    const document = await loadingTask.promise;

    return {
      document,
      destroy: () => loadingTask.destroy(),
    };
  } catch (error) {
    await loadingTask.destroy().catch(() => {});
    throw error;
  }
}

export async function loadPdfProgressively(
  source: PdfProgressiveSource,
): Promise<LoadedPdf> {
  const range = new CallbackProgressiveTransport(source);
  const loadingTask: PDFDocumentLoadingTask = getDocument({
    range,
    ...cMapOptions,
    disableRange: true,
    disableStream: false,
    useSystemFonts: true,
  });

  try {
    const document = await loadingTask.promise;

    return {
      document,
      destroy: () => loadingTask.destroy(),
    };
  } catch (error) {
    await loadingTask.destroy().catch(() => {});
    throw error;
  }
}

export async function loadPdfWithRange(
  source: PdfRangeSource,
): Promise<LoadedPdf> {
  const range = new CallbackRangeTransport(source);
  const loadingTask: PDFDocumentLoadingTask = getDocument({
    range,
    ...cMapOptions,
    rangeChunkSize: 64 * 1024,
    disableStream: true,
    useSystemFonts: true,
  });

  try {
    const document = await loadingTask.promise;

    return {
      document,
      destroy: () => loadingTask.destroy(),
    };
  } catch (error) {
    await loadingTask.destroy().catch(() => {});
    throw error;
  }
}

export function describePdfError(error: unknown): string {
  if (error instanceof PasswordException) {
    return "Password-protected PDFs are not supported yet.";
  }

  if (error instanceof InvalidPDFException) {
    return "Unsupported or corrupted PDF.";
  }

  return "Failed to open PDF.";
}
