import type { PDFDocumentProxy } from "pdfjs-dist";

export interface PdfInteractionCallbacks {
  getCurrentPage(): number;
  getRotation(): number;
  goToPage(pageNumber: number, offsetFraction?: number): Promise<boolean>;
  onLinkNavigation?(): void;
  onNamedAction?(action: string): void;
  onOptionalContentAction?(action: {
    state: Array<string>;
    preserveRB?: boolean;
  }): void;
}

export class LocalDownloadManager {
  downloadData(
    data: Uint8Array,
    filename: string,
    contentType = "application/octet-stream",
  ): void {
    const blob = new Blob([data as BlobPart], { type: contentType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = filename || "attachment";
    anchor.click();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  openOrDownloadData(
    data: Uint8Array,
    filename: string,
  ): void {
    this.downloadData(data, filename);
  }
}

export class PdfInteractionService {
  readonly downloadManager = new LocalDownloadManager();
  eventBus: undefined = undefined;
  externalLinkEnabled = true;

  constructor(
    private readonly pdf: PDFDocumentProxy,
    private readonly callbacks: PdfInteractionCallbacks,
  ) {}

  get pagesCount(): number {
    return this.pdf.numPages;
  }

  get page(): number {
    return this.callbacks.getCurrentPage();
  }

  set page(value: number) {
    void this.callbacks.goToPage(value);
  }

  get rotation(): number {
    return this.callbacks.getRotation();
  }

  get isInPresentationMode(): boolean {
    return Boolean(document.fullscreenElement);
  }

  /**
   * Resolve a destination to a page number plus the target's vertical offset
   * as a fraction of the (rotated) page height.
   */
  async resolveDestination(
    destination: string | Array<unknown>,
  ): Promise<{ pageNumber: number; fraction: number } | null> {
    let resolved: Array<unknown> | null;

    try {
      resolved =
        typeof destination === "string"
          ? await this.pdf.getDestination(destination)
          : destination;
    } catch {
      return null;
    }

    if (!Array.isArray(resolved)) {
      return null;
    }

    const pageRef = resolved[0];
    let pageNumber: number | null = null;

    if (typeof pageRef === "number") {
      pageNumber = pageRef + 1;
    } else if (pageRef && typeof pageRef === "object") {
      try {
        pageNumber =
          (await this.pdf.getPageIndex(
            pageRef as Parameters<PDFDocumentProxy["getPageIndex"]>[0],
          )) + 1;
      } catch {
        return null;
      }
    }

    if (!pageNumber || pageNumber < 1 || pageNumber > this.pdf.numPages) {
      return null;
    }

    // [page, /XYZ left top zoom], [page, /FitH top], [page, /FitR l b r t]…
    const mode = (resolved[1] as { name?: string } | undefined)?.name;
    let x: number | null = null;
    let y: number | null = null;

    switch (mode) {
      case "XYZ":
        x = resolved[2] as number | null;
        y = resolved[3] as number | null;
        break;
      case "FitH":
      case "FitBH":
        y = resolved[2] as number | null;
        break;
      case "FitR":
        x = resolved[2] as number;
        y = resolved[5] as number;
        break;
      default:
        break;
    }

    if (typeof y !== "number" || !Number.isFinite(y)) {
      return { pageNumber, fraction: 0 };
    }

    try {
      const page = await this.pdf.getPage(pageNumber);
      const viewport = page.getViewport({
        scale: 1,
        rotation: (page.rotate + this.callbacks.getRotation()) % 360,
      });
      const [, top] = viewport.convertToViewportPoint(
        typeof x === "number" && Number.isFinite(x) ? x : 0,
        y,
      );
      return {
        pageNumber,
        fraction: Math.min(1, Math.max(0, top / viewport.height)),
      };
    } catch {
      return { pageNumber, fraction: 0 };
    }
  }

  async goToDestination(destination: string | Array<unknown>): Promise<void> {
    const target = await this.resolveDestination(destination);

    if (target) {
      this.callbacks.onLinkNavigation?.();
      // Leave a little context above the target line.
      await this.callbacks.goToPage(
        target.pageNumber,
        Math.max(0, target.fraction - 0.035),
      );
    }
  }

  goToPage(value: number | string): void {
    const pageNumber = Number(value);

    if (Number.isInteger(pageNumber)) {
      void this.callbacks.goToPage(pageNumber);
    }
  }

  goToXY(pageNumber: number): void {
    void this.callbacks.goToPage(pageNumber);
  }

  addLinkAttributes(
    link: HTMLAnchorElement,
    url: string,
    newWindow = false,
  ): void {
    const parsed = this.#safeExternalUrl(url);

    if (!parsed) {
      link.removeAttribute("href");
      link.title = "Blocked unsafe link";
      return;
    }

    link.href = parsed.href;
    link.title = parsed.href;
    link.target = newWindow ? "_blank" : "_blank";
    link.rel = "noopener noreferrer";
  }

  /** Encodes the destination so hover previews can recover it from the link. */
  getDestinationHash(destination: unknown): string {
    if (destination === null || destination === undefined) {
      return "#";
    }

    try {
      return `#pdfdest=${encodeURIComponent(JSON.stringify(destination))}`;
    } catch {
      return "#";
    }
  }

  getAnchorUrl(anchor: string): string {
    return anchor || "#";
  }

  executeNamedAction(action: string): void {
    const current = this.callbacks.getCurrentPage();

    switch (action) {
      case "NextPage":
        void this.callbacks.goToPage(current + 1);
        return;
      case "PrevPage":
      case "PreviousPage":
        void this.callbacks.goToPage(current - 1);
        return;
      case "FirstPage":
        void this.callbacks.goToPage(1);
        return;
      case "LastPage":
        void this.callbacks.goToPage(this.pdf.numPages);
        return;
      default:
        this.callbacks.onNamedAction?.(action);
    }
  }

  executeSetOCGState(action: {
    state: Array<string>;
    preserveRB?: boolean;
  }): void {
    this.callbacks.onOptionalContentAction?.(action);
  }

  async getAttachmentContent(id: string): Promise<Uint8Array | null> {
    try {
      return await this.pdf.getAttachmentContent(id);
    } catch {
      return null;
    }
  }

  #safeExternalUrl(value: string): URL | null {
    try {
      const url = new URL(value, window.location.href);

      return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol)
        ? url
        : null;
    } catch {
      return null;
    }
  }
}
