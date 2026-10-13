import type { PDFDocumentProxy } from "pdfjs-dist";
import { LocalDownloadManager } from "./interaction";
import { t } from "../i18n/i18n";

interface CatalogAttachment {
  content?: Uint8Array | null;
  description: string;
  filename: string;
  rawFilename: string;
}

export class AttachmentsController {
  #disposed = false;
  #downloadManager = new LocalDownloadManager();

  constructor(
    private readonly pdf: PDFDocumentProxy,
    private readonly container: HTMLElement,
    private readonly onAvailabilityChange: (available: boolean) => void,
  ) {}

  async initialize(): Promise<void> {
    const attachments = (await this.pdf.getAttachments()) as
      | Map<string, CatalogAttachment>
      | null;

    if (this.#disposed) {
      return;
    }

    if (!attachments || attachments.size === 0) {
      this.onAvailabilityChange(false);
      this.container.replaceChildren();
      return;
    }

    this.onAvailabilityChange(true);
    const fragment = document.createDocumentFragment();

    for (const [id, attachment] of attachments) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "attachment-item";

      const name = document.createElement("span");
      name.className = "attachment-name";
      name.textContent = attachment.filename || attachment.rawFilename || id;

      const detail = document.createElement("span");
      detail.className = "attachment-description";
      detail.textContent = attachment.description || t("Download attachment");

      button.append(name, detail);
      button.addEventListener("click", () => {
        void this.#download(id, attachment);
      });
      fragment.append(button);
    }

    this.container.replaceChildren(fragment);
  }

  dispose(): void {
    this.#disposed = true;
    this.container.replaceChildren();
  }

  async #download(
    id: string,
    attachment: CatalogAttachment,
  ): Promise<void> {
    if (this.#disposed) {
      return;
    }

    const content =
      attachment.content ?? (await this.pdf.getAttachmentContent(id));

    if (!content || this.#disposed) {
      return;
    }

    this.#downloadManager.downloadData(
      content,
      attachment.filename || attachment.rawFilename || "attachment",
    );
  }
}
