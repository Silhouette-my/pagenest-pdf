(() => {
  if (window.__geminiPdfReaderBridgeInstalled) {
    return;
  }
  window.__geminiPdfReaderBridgeInstalled = true;

  const url = new URL(location.href);
  const queryToken = url.searchParams.get("extensionTransfer");
  const sourcePrefix = "#extensionSource=";
  const sourceUrl = url.hash.startsWith(sourcePrefix)
    ? url.hash.slice(sourcePrefix.length)
    : null;
  const token = queryToken || crypto.randomUUID();

  const port = chrome.runtime.connect({
    name: "reader-bridge",
  });

  port.onMessage.addListener((message) => {
    if (!message || message.token && message.token !== token) {
      return;
    }

    if (message.type === "pdf-direct-file") {
      openDirectFileBridge(token);
      return;
    }

    window.postMessage(
      {
        source: "gemini-pdf-reader-extension",
        ...message,
      },
      location.origin,
    );
  });

  function openDirectFileBridge(transferToken) {
    const iframe = document.createElement("iframe");
    iframe.src = chrome.runtime.getURL("file-bridge.html");
    iframe.hidden = true;
    iframe.setAttribute("aria-hidden", "true");
    document.documentElement.append(iframe);

    const timeout = window.setTimeout(() => {
      iframe.remove();
      window.postMessage(
        {
          source: "gemini-pdf-reader-extension",
          type: "pdf-direct-file-error",
          token: transferToken,
          message: "Local PDF bridge timed out.",
        },
        location.origin,
      );
    }, 15000);

    iframe.addEventListener(
      "load",
      () => {
        const channel = new MessageChannel();

        channel.port2.onmessage = (event) => {
          const payload = event.data;

          if (
            !payload ||
            payload.token !== transferToken
          ) {
            return;
          }

          const terminal =
            payload.type === "pdf-direct-file-bytes" ||
            payload.type === "pdf-direct-file-error";

          if (
            payload.type === "pdf-direct-file-bytes" &&
            payload.buffer instanceof ArrayBuffer
          ) {
            window.postMessage(
              {
                source: "gemini-pdf-reader-extension",
                ...payload,
              },
              location.origin,
              [payload.buffer],
            );
          } else {
            window.postMessage(
              {
                source: "gemini-pdf-reader-extension",
                ...payload,
              },
              location.origin,
            );
          }

          if (terminal) {
            window.clearTimeout(timeout);
            channel.port2.close();
            iframe.remove();
          }
        };

        iframe.contentWindow?.postMessage(
          {
            type: "connect-file-bridge",
            token: transferToken,
          },
          chrome.runtime.getURL("").slice(0, -1),
          [channel.port1],
        );
      },
      { once: true },
    );
  }

  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.source !== "gemini-pdf-reader-page"
    ) {
      return;
    }

    if (event.data.type === "exit-reader") {
      port.postMessage({
        type: "exit-reader",
        token,
      });
      return;
    }

    if (event.data?.token !== token) {
      return;
    }

    if (event.data.type === "pdf-chunk-ack") {
      port.postMessage({
        type: "pdf-chunk-ack",
        token,
        nextOffset: event.data.nextOffset,
      });
      return;
    }

    if (event.data.type === "pdf-progressive-ack") {
      port.postMessage({
        type: "pdf-progressive-ack",
        token,
        nextOffset: event.data.nextOffset,
      });
      return;
    }

    if (event.data.type === "pdf-range-request") {
      port.postMessage({
        type: "pdf-range-request",
        token,
        requestId: event.data.requestId,
        begin: event.data.begin,
        end: event.data.end,
      });
      return;
    }

    if (event.data.type === "pdf-transfer-abort") {
      port.postMessage({
        type: "pdf-transfer-abort",
        token,
      });
    }
  });

  port.postMessage({
    type: "request-pdf",
    token,
    sourceUrl,
  });
})();
