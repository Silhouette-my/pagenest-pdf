window.addEventListener("message", async (event) => {
  if (
    event.source !== window.parent ||
    event.data?.type !== "connect-file-bridge" ||
    typeof event.data.token !== "string" ||
    event.ports.length !== 1
  ) {
    return;
  }

  const port = event.ports[0];
  const token = event.data.token;

  try {
    const claimed = await chrome.runtime.sendMessage({
      type: "claim-file-transfer",
      token,
    });

    if (
      !claimed?.ok ||
      typeof claimed.sourceUrl !== "string" ||
      typeof claimed.readerOrigin !== "string" ||
      event.origin !== claimed.readerOrigin
    ) {
      throw new Error("Local PDF bridge authorization failed.");
    }

    const response = await fetch(claimed.sourceUrl, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(
        `Local PDF request failed: ${response.status}`,
      );
    }

    const filename =
      typeof claimed.filename === "string"
        ? claimed.filename
        : "document.pdf";
    const contentLength = Number(
      response.headers.get("content-length"),
    );
    const knownLength =
      Number.isSafeInteger(contentLength) &&
      contentLength > 0 &&
      contentLength <= 512 * 1024 * 1024
        ? contentLength
        : null;

    let buffer;

    if (response.body && knownLength !== null) {
      const reader = response.body.getReader();
      const bytes = new Uint8Array(knownLength);
      let offset = 0;
      let lastReported = -1;

      port.postMessage({
        type: "pdf-direct-file-progress",
        token,
        filename,
        loaded: 0,
        total: knownLength,
      });

      for (;;) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        if (!value || value.byteLength === 0) {
          continue;
        }

        if (offset + value.byteLength > knownLength) {
          await reader.cancel();
          throw new Error(
            "Local PDF exceeded its reported file size.",
          );
        }

        bytes.set(value, offset);
        offset += value.byteLength;

        const percent = Math.floor(
          (offset / knownLength) * 100,
        );

        if (
          percent !== lastReported &&
          (percent === 100 ||
            percent - lastReported >= 2)
        ) {
          lastReported = percent;
          port.postMessage({
            type: "pdf-direct-file-progress",
            token,
            filename,
            loaded: offset,
            total: knownLength,
          });
        }
      }

      if (offset !== knownLength) {
        throw new Error(
          "Local PDF size did not match Content-Length.",
        );
      }

      buffer = bytes.buffer;
    } else if (response.body) {
      let loaded = 0;
      let lastReported = 0;
      const monitored = response.body.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            loaded += chunk.byteLength;

            if (loaded - lastReported >= 256 * 1024) {
              lastReported = loaded;
              port.postMessage({
                type: "pdf-direct-file-progress",
                token,
                filename,
                loaded,
                total: null,
              });
            }

            controller.enqueue(chunk);
          },
          flush() {
            port.postMessage({
              type: "pdf-direct-file-progress",
              token,
              filename,
              loaded,
              total: null,
            });
          },
        }),
      );

      buffer = await new Response(monitored).arrayBuffer();
    } else {
      port.postMessage({
        type: "pdf-direct-file-progress",
        token,
        filename,
        loaded: null,
        total: null,
      });

      buffer = await response.arrayBuffer();
    }

    const bytes = new Uint8Array(buffer);

    if (
      bytes.byteLength <= 0 ||
      bytes.byteLength > 512 * 1024 * 1024
    ) {
      throw new Error("Local PDF size is invalid.");
    }

    const header = new TextDecoder("ascii").decode(
      bytes.subarray(0, Math.min(5, bytes.byteLength)),
    );

    if (header !== "%PDF-") {
      throw new Error(
        "Local file does not start with a PDF header.",
      );
    }

    port.postMessage(
      {
        type: "pdf-direct-file-bytes",
        token,
        filename,
        contentType: "application/pdf",
        size: bytes.byteLength,
        buffer,
      },
      [buffer],
    );
  } catch (error) {
    port.postMessage({
      type: "pdf-direct-file-error",
      token,
      message:
        error instanceof Error
          ? error.message
          : "Local PDF bridge failed.",
    });
  } finally {
    port.close();
  }
});
