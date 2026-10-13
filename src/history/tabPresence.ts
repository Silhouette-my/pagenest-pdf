/*
 * Lets reader tabs see each other: a tab can ask which documents are open in
 * other reader tabs (and in which Chrome window), e.g. so a new tab in a
 * window that is already reading something offers the history instead of
 * opening yet another copy.
 */

const CHANNEL_NAME = "gemini-pdf-reader.tabs";
const DEFAULT_WAIT_MS = 250;

export interface OpenDocumentInfo {
  windowId: number | null;
  documentId: string;
}

type PresenceMessage =
  | { type: "query"; nonce: string }
  | { type: "state"; nonce: string; windowId: number | null; documentId: string };

export class TabPresence {
  #channel: BroadcastChannel | null = null;
  #listeners = new Map<string, (info: OpenDocumentInfo) => void>();

  constructor(
    private readonly getState: () => { windowId: number | null; documentId: string | null },
  ) {
    if (typeof BroadcastChannel === "undefined") return;
    this.#channel = new BroadcastChannel(CHANNEL_NAME);
    this.#channel.addEventListener("message", (event: MessageEvent<PresenceMessage>) => {
      const message = event.data;
      if (message?.type === "query") {
        const state = this.getState();
        if (state.documentId) {
          this.#channel?.postMessage({
            type: "state",
            nonce: message.nonce,
            windowId: state.windowId,
            documentId: state.documentId,
          } satisfies PresenceMessage);
        }
      } else if (message?.type === "state") {
        this.#listeners.get(message.nonce)?.({
          windowId: message.windowId,
          documentId: message.documentId,
        });
      }
    });
  }

  /** Documents currently open in other reader tabs that answer in time. */
  async openElsewhere(waitMs = DEFAULT_WAIT_MS): Promise<OpenDocumentInfo[]> {
    const channel = this.#channel;
    if (!channel) return [];

    const nonce = crypto.randomUUID();
    const answers: OpenDocumentInfo[] = [];
    this.#listeners.set(nonce, (info) => answers.push(info));
    channel.postMessage({ type: "query", nonce } satisfies PresenceMessage);
    await new Promise((resolve) => window.setTimeout(resolve, waitMs));
    this.#listeners.delete(nonce);
    return answers;
  }
}
