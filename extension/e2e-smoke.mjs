import { spawn } from "node:child_process";
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
  process.env.GPR_E2E_PDF_URL ??
  "http://127.0.0.1:9290/gemini-text-layer-test.pdf";

const reader = spawn(
  "npm",
  ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173"],
  {
    cwd: ROOT,
    stdio: "ignore",
  },
);

const pdfServer = spawn(
  "python3",
  ["-m", "http.server", "9290", "--directory", "public"],
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
    `--user-data-dir=/tmp/gpr-extension-e2e-${process.pid}`,
  ],
  {
    stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
  },
);

let buffer = Buffer.alloc(0);
let nextId = 0;
const pending = new Map();
const observedTargetUrls = new Set();

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

    if (
      (message.method === "Target.targetCreated" ||
        message.method === "Target.targetInfoChanged") &&
      message.params?.targetInfo?.url
    ) {
      observedTargetUrls.add(message.params.targetInfo.url);
    }

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
    }, 15_000);

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
      result.exceptionDetails.text || "Runtime evaluation failed.",
    );
  }

  return result.result.value;
}

async function waitForHttp(url, timeout = 10_000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry while the local server starts.
    }

    await delay(80);
  }

  throw new Error(`Server did not start: ${url}`);
}

async function waitForReader(sessionId, timeout = 25_000) {
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
          status: document.querySelector("#status")?.textContent ?? null,
          windowBridge: document.documentElement.dataset.readerWindowBridge ?? null,
          windowId: document.documentElement.dataset.readerWindowId ?? null
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
      // Execution contexts are replaced during navigation.
    }

    await delay(100);
  }

  throw new Error(
    `Reader did not receive PDF. Last state: ${JSON.stringify(last)}`,
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function evaluateExtensionPage(extensionId, expression) {
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
    return await evaluate(attached.sessionId, expression);
  } finally {
    await call("Target.closeTarget", {
      targetId: target.targetId,
    }).catch(() => {});
  }
}

function cleanup() {
  chrome.kill();
  reader.kill();
  pdfServer.kill();
}

try {
  await Promise.all([
    waitForHttp(READER_ORIGIN),
    waitForHttp(PDF_URL),
  ]);

  await call("Target.setDiscoverTargets", {
    discover: true,
  });

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

  await delay(150);

  const defaultAutoWebPdf = await evaluateExtensionPage(
    extension.id,
    `chrome.storage.local
      .get({ autoWebPdf: false })
      .then((settings) => Boolean(settings.autoWebPdf))`,
  );

  if (defaultAutoWebPdf) {
    throw new Error(
      "Web PDF auto-takeover must be disabled by default.",
    );
  }

  const defaultTarget = await call("Target.createTarget", {
    url: PDF_URL,
  });

  await delay(900);

  const defaultTargets = await call("Target.getTargets");
  const readerAppearedByDefault =
    defaultTargets.targetInfos.some(
      (item) =>
        item.type === "page" &&
        item.url.startsWith(READER_ORIGIN),
    );

  if (readerAppearedByDefault) {
    throw new Error(
      "Web PDF was automatically taken over with the default settings.",
    );
  }

  await call("Target.closeTarget", {
    targetId: defaultTarget.targetId,
  }).catch(() => {});

  await evaluateExtensionPage(
    extension.id,
    `chrome.storage.local
      .set({ autoWebPdf: true })
      .then(() => true)`,
  );
  await delay(250);
  observedTargetUrls.clear();

  const target = await call("Target.createTarget", {
    url: PDF_URL,
  });
  const attached = await call("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });

  await call("Runtime.enable", {}, attached.sessionId);
  await call("Page.enable", {}, attached.sessionId);

  const finalState = await waitForReader(attached.sessionId);
  const nativePdfViewerSeen = [...observedTargetUrls].some(
    (url) =>
      url.includes("mhjfbmdgcfjbbpaeojofohoefgiehjai"),
  );

  console.log(
    JSON.stringify(
      {
        extensionId: extension.id,
        defaultAutoWebPdf,
        readerAppearedByDefault,
        finalState,
        nativePdfViewerSeen,
      },
      null,
      2,
    ),
  );

  if (nativePdfViewerSeen && process.platform !== "darwin") {
    throw new Error(
      "Chrome built-in PDF Viewer was created during the fast path.",
    );
  }
} finally {
  cleanup();
}
