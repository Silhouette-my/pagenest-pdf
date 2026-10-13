/*
 * Runs on reader pages at document_start. A web page cannot know which Chrome
 * window it lives in, so this tells the reader its window id (via a DOM data
 * attribute and a postMessage) so each window can reopen its own last PDF.
 */
(() => {
  if (window.__geminiPdfReaderWindowBridge) return;
  window.__geminiPdfReaderWindowBridge = true;

  const root = document.documentElement;
  root.dataset.readerWindowBridge = "pending";

  const publish = (windowId) => {
    if (typeof windowId !== "number") {
      root.dataset.readerWindowBridge = "unavailable";
      return;
    }
    root.dataset.readerWindowId = String(windowId);
    root.dataset.readerWindowBridge = "ready";
    window.postMessage(
      { source: "gemini-pdf-reader-window", windowId },
      location.origin,
    );
  };

  chrome.runtime
    .sendMessage({ type: "get-window-id" })
    .then((response) => publish(response?.windowId))
    .catch(() => publish(null));

  // The tab was dragged into another window.
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "reader-window-changed") publish(message.windowId);
  });
})();
