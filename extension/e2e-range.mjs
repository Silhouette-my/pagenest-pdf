import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const EXTENSION_PATH = `${ROOT}/extension`;
const READER_ORIGIN = "http://127.0.0.1:5173";
const PDF_URL =
  "http://127.0.0.1:9291/large-range-test.pdf";

function makeLargePdf() {
  const chunks = [];
  const offsets = [0];
  let length = 0;

  function push(value) {
    const chunk = Buffer.isBuffer(value)
      ? value
      : Buffer.from(value);
    chunks.push(chunk);
    length += chunk.length;
  }

  function object(id, body) {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    push(body);
    push("\nendobj\n");
  }

  push("%PDF-1.7\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  );

  const pageStream =
    "BT /F1 20 Tf 72 700 Td (PDF-GEMINI-TEST-92841) Tj ET\n";
  object(
    4,
    `<< /Length ${Buffer.byteLength(pageStream)} >>\nstream\n${pageStream}endstream`,
  );
  object(
    5,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  );

  const paddingSize = 16 * 1024 * 1024;
  offsets[6] = length;
  push("6 0 obj\n");
  push(`<< /Length ${paddingSize} >>\nstream\n`);
  push(Buffer.alloc(paddingSize, 0x20));
  push("\nendstream\nendobj\n");

  const xref = length;
  push("xref\n0 7\n");
  push("0000000000 65535 f \n");
  for (let id = 1; id <= 6; id += 1) {
    push(
      String(offsets[id]).padStart(10, "0") +
        " 00000 n \n",
    );
  }

  push(
    `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );

  return Buffer.concat(chunks);
}

const pdf = makeLargePdf();
const metrics = {
  bytes: 0,
  fullRequests: 0,
  rangeRequests: 0,
};

const pdfServer = createServer((request, response) => {
  if (request.url !== "/large-range-test.pdf") {
    response.writeHead(404);
    response.end();
    return;
  }

  const commonHeaders = {
    "Accept-Ranges": "bytes",
    "Content-Type": "application/pdf",
    "Cache-Control": "no-store",
  };

  if (request.method === "HEAD") {
    response.writeHead(200, {
      ...commonHeaders,
      "Content-Length": pdf.length,
    });
    response.end();
    return;
  }

  const range = request.headers.range;
  const match =
    typeof range === "string"
      ? /^bytes=(\d+)-(\d*)$/.exec(range)
      : null;

  if (match) {
    const begin = Number(match[1]);
    const requestedEnd =
      match[2] === ""
        ? pdf.length - 1
        : Number(match[2]);
    const end = Math.min(pdf.length - 1, requestedEnd);

    if (
      !Number.isSafeInteger(begin) ||
      !Number.isSafeInteger(end) ||
      begin < 0 ||
      end < begin ||
      begin >= pdf.length
    ) {
      response.writeHead(416, {
        "Content-Range": `bytes */${pdf.length}`,
      });
      response.end();
      return;
    }

    const body = pdf.subarray(begin, end + 1);
    metrics.rangeRequests += 1;
    metrics.bytes += body.length;

    response.writeHead(206, {
      ...commonHeaders,
      "Content-Length": body.length,
      "Content-Range": `bytes ${begin}-${end}/${pdf.length}`,
    });
    response.end(body);
    return;
  }

  metrics.fullRequests += 1;
  metrics.bytes += pdf.length;
  response.writeHead(200, {
    ...commonHeaders,
    "Content-Length": pdf.length,
  });
  response.end(pdf);
});

await new Promise((resolve, reject) => {
  pdfServer.once("error", reject);
  pdfServer.listen(9291, "127.0.0.1", resolve);
});

const reader = spawn(
  "npm",
  ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173"],
  {
    cwd: ROOT,
    stdio: "ignore",
  },
);

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--lang=en-US",
    "--accept-lang=en-US",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging",
    `--user-data-dir=/tmp/gpr-extension-range-e2e-${process.pid}`,
  ],
  {
    stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
  },
);

let buffer = Buffer.alloc(0);
let nextId = 0;
const pending = new Map();

chrome.stdio[4].on("data", (data) => {
  buffer = Buffer.concat([buffer, data]);

  for (;;) {
    const separator = buffer.indexOf(0);
    if (separator < 0) {
      break;
    }

    const payload = buffer.subarray(0, separator).toString();
    buffer = buffer.subarray(separator + 1);

    if (!payload) {
      continue;
    }

    const message = JSON.parse(payload);
    const handler = pending.get(message.id);

    if (handler) {
      pending.delete(message.id);
      handler(message);
    }
  }
});

function call(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 20_000);

    pending.set(id, (message) => {
      clearTimeout(timeout);

      if (message.error) {
        reject(new Error(JSON.stringify(message.error)));
      } else {
        resolve(message.result);
      }
    });

    chrome.stdio[3].write(
      JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }) + "\0",
    );
  });
}

async function evaluate(sessionId, expression) {
  const result = await call(
    "Runtime.evaluate",
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
    },
    sessionId,
  );

  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.text ||
        "Runtime evaluation failed.",
    );
  }

  return result.result.value;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function enableWebAutoTakeover(extensionId) {
  const target = await call("Target.createTarget", {
    url: `chrome-extension://${extensionId}/options.html`,
  });

  try {
    const attached = await call("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });

    await call("Runtime.enable", {}, attached.sessionId);
    await delay(80);
    await evaluate(
      attached.sessionId,
      `chrome.storage.local
        .set({ autoWebPdf: true })
        .then(() => true)`,
    );
  } finally {
    await call("Target.closeTarget", {
      targetId: target.targetId,
    }).catch(() => {});
  }

  await delay(250);
}

async function waitForReaderOrigin(sessionId, timeout = 20_000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      const url = await evaluate(sessionId, "location.href");
      if (url.startsWith(READER_ORIGIN)) {
        return;
      }
    } catch {
      // Navigation replaces execution contexts.
    }

    await delay(40);
  }

  throw new Error("Reader navigation timed out.");
}

async function waitForText(sessionId, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let last = null;

  while (Date.now() < deadline) {
    try {
      last = await evaluate(
        sessionId,
        `({
          url: location.href,
          total: document.querySelector("#total-pages")?.textContent ?? null,
          text: document.querySelector(".textLayer")?.textContent ?? null,
          status: document.querySelector("#status")?.textContent ?? null
        })`,
      );

      if (
        last.url.startsWith(READER_ORIGIN) &&
        last.total === "1" &&
        last.text?.includes("PDF-GEMINI-TEST-92841")
      ) {
        return last;
      }
    } catch {
      // Navigation replaces execution contexts.
    }

    await delay(40);
  }

  throw new Error(
    `Text Layer did not become ready: ${JSON.stringify(last)}`,
  );
}

async function waitForReaderServer(timeout = 10_000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(READER_ORIGIN);
      if (response.ok) {
        return;
      }
    } catch {
      // Vite is still starting.
    }

    await delay(50);
  }

  throw new Error("Reader server did not start.");
}

function cleanup() {
  chrome.kill();
  reader.kill();
  pdfServer.close();
}

try {
  await waitForReaderServer();

  const extension = await call("Extensions.loadUnpacked", {
    path: EXTENSION_PATH,
  });

  const workerDeadline = Date.now() + 5000;
  let workerReady = false;

  while (Date.now() < workerDeadline && !workerReady) {
    const targets = await call("Target.getTargets");
    workerReady = targets.targetInfos.some(
      (item) =>
        item.type === "service_worker" &&
        item.url.includes(extension.id),
    );

    if (!workerReady) {
      await delay(80);
    }
  }

  if (!workerReady) {
    throw new Error("Extension service worker did not start.");
  }

  await enableWebAutoTakeover(extension.id);

  const target = await call("Target.createTarget", {
    url: "about:blank",
  });
  const attached = await call("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });

  await call("Runtime.enable", {}, attached.sessionId);
  await call("Page.enable", {}, attached.sessionId);

  const startedAt = performance.now();
  await call(
    "Page.navigate",
    { url: PDF_URL },
    attached.sessionId,
  );

  await waitForReaderOrigin(attached.sessionId);
  const readerAt = performance.now();

  // Native Chrome PDF Viewer traffic on macOS is intentionally allowed before
  // safe takeover. Reset here so these metrics cover only the Reader phase.
  metrics.bytes = 0;
  metrics.fullRequests = 0;
  metrics.rangeRequests = 0;

  const finalState = await waitForText(attached.sessionId);
  const textAt = performance.now();

  const result = {
    extensionId: extension.id,
    pdfBytes: pdf.length,
    readerNavigationMs: Math.round(readerAt - startedAt),
    readerToTextMs: Math.round(textAt - readerAt),
    bytesAfterReaderNavigation: metrics.bytes,
    fullRequestsAfterReaderNavigation: metrics.fullRequests,
    rangeRequestsAfterReaderNavigation: metrics.rangeRequests,
    finalState,
  };

  console.log(JSON.stringify(result, null, 2));

  if (metrics.rangeRequests < 1) {
    throw new Error("Range mode was not used.");
  }

  if (metrics.fullRequests > 0) {
    throw new Error("Reader phase unexpectedly downloaded the full PDF.");
  }

  if (metrics.bytes >= pdf.length / 4) {
    throw new Error(
      "Reader fetched too much of the PDF before first-page text appeared.",
    );
  }
} finally {
  cleanup();
}
