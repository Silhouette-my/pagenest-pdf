/*
 * Which document should this tab restore?
 *   1. the tab's own last document (sessionStorage: survives reloads, tab
 *      discards and Chrome's session restore, and is copied on duplicate);
 *   2. the last document of this Chrome window (window id supplied by the
 *      companion extension's window bridge, when installed);
 *   3. the most recently opened document overall.
 */

const TAB_KEY = "gemini-pdf-reader.tab-document";
/** Stored when the reader was explicitly closed in this tab. */
const CLOSED = "";
const BRIDGE_WAIT_MS = 400;

/**
 * undefined: this tab has no memory yet; null: the reader was closed in this
 * tab (restore nothing); string: the tab's last document id.
 */
export function getTabDocumentId(): string | null | undefined {
  try {
    const value = sessionStorage.getItem(TAB_KEY);
    if (value === null) return undefined;
    return value === CLOSED ? null : value;
  } catch {
    return undefined;
  }
}

export function setTabDocumentId(id: string | null): void {
  try {
    sessionStorage.setItem(TAB_KEY, id ?? CLOSED);
  } catch {
    // Storage unavailable (e.g. sandboxed); fall back to window/global memory.
  }
}

/** The window id, if the bridge has already published it. */
export function currentWindowId(): number | null {
  const value = Number(document.documentElement.dataset.readerWindowId);
  return Number.isInteger(value) ? value : null;
}

/** Wait briefly for the extension's window bridge, if it is present. */
export function resolveWindowId(): Promise<number | null> {
  const known = currentWindowId();
  if (known !== null) return Promise.resolve(known);
  if (document.documentElement.dataset.readerWindowBridge !== "pending") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const finish = (): void => {
      observer.disconnect();
      window.clearTimeout(timer);
      resolve(currentWindowId());
    };
    const observer = new MutationObserver(() => {
      if (document.documentElement.dataset.readerWindowBridge !== "pending") finish();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-reader-window-bridge", "data-reader-window-id"],
    });
    const timer = window.setTimeout(finish, BRIDGE_WAIT_MS);
  });
}

/** Called when the bridge reports a (new) window id, e.g. after a tab move. */
export function onWindowIdChange(listener: (windowId: number) => void): void {
  window.addEventListener("message", (event) => {
    if (
      event.source === window &&
      event.data?.source === "gemini-pdf-reader-window" &&
      typeof event.data.windowId === "number"
    ) {
      listener(event.data.windowId);
    }
  });
}
