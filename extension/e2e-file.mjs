import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const EXTENSION_PATH = `${ROOT}/extension`;
const READER_ORIGIN = "http://127.0.0.1:5173";
const PDF_FILE = resolve(
  ROOT,
  "public/gemini-text-layer-test.pdf",
);
const PDF_URL = pathToFileURL(PDF_FILE).href;

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
    `--user-data-dir=/tmp/gpr-extension-file-e2e-${process.pid}`,
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

async function waitForText(sessionId, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  const loadingStages = [];
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
          loadingHidden:
            document.querySelector("#loading-shell")?.hidden ?? true,
          loadingStage:
            document.querySelector("#loading-stage")?.textContent ?? "",
          loadingDetail:
            document.querySelector("#loading-detail")?.textContent ?? "",
          loadingPercent:
            document.querySelector("#loading-percent")?.textContent ?? ""
        })`,
      );

      if (!last.loadingHidden && last.loadingStage) {
        const previous = loadingStages.at(-1);

        if (
          !previous ||
          previous.stage !== last.loadingStage ||
          previous.detail !== last.loadingDetail ||
          previous.percent !== last.loadingPercent
        ) {
          loadingStages.push({
            stage: last.loadingStage,
            detail: last.loadingDetail,
            percent: last.loadingPercent,
          });
        }
      }

      if (
        last.url.startsWith(READER_ORIGIN) &&
        last.total === "1" &&
        last.text?.includes("PDF-GEMINI-TEST-92841")
      ) {
        return {
          state: last,
          loadingStages,
        };
      }
    } catch {
      // Navigation replaces execution contexts.
    }

    await delay(20);
  }

  throw new Error(
    `Local file did not open correctly: ${JSON.stringify(last)}`,
  );
}

function cleanup() {
  chrome.kill();
  reader.kill();
}

try {
  await waitForReaderServer();

  const extension = await call("Extensions.loadUnpacked", {
    path: EXTENSION_PATH,
  });

  let workerInfo = null;
  const workerDeadline = Date.now() + 5000;

  while (Date.now() < workerDeadline && !workerInfo) {
    const targets = await call("Target.getTargets");
    workerInfo =
      targets.targetInfos.find(
        (item) =>
          item.type === "service_worker" &&
          item.url.includes(extension.id),
      ) ?? null;

    if (!workerInfo) {
      await delay(80);
    }
  }

  if (!workerInfo) {
    throw new Error("Extension service worker did not start.");
  }

  // Do not keep a DevTools attachment to the extension worker here:
  // service workers can be suspended between checks. The navigation itself is
  // the stronger assertion for file:// access and exercises the real product
  // path end-to-end.

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

  let readerAt = null;
  let readerTarget = null;
  const readerDeadline = Date.now() + 20_000;

  while (Date.now() < readerDeadline && !readerTarget) {
    const targets = await call("Target.getTargets");
    readerTarget =
      targets.targetInfos.find(
        (item) =>
          item.type === "page" &&
          item.url.startsWith(READER_ORIGIN),
      ) ?? null;

    if (!readerTarget) {
      await delay(40);
    }
  }

  if (!readerTarget) {
    throw new Error("Reader navigation timed out.");
  }

  readerAt = performance.now();

  const readerAttached = await call("Target.attachToTarget", {
    targetId: readerTarget.targetId,
    flatten: true,
  });

  await call("Runtime.enable", {}, readerAttached.sessionId);

  let loadingState = null;
  const loadingVisibleDeadline = Date.now() + 3000;

  while (Date.now() < loadingVisibleDeadline && !loadingState) {
    try {
      const state = await evaluate(
        readerAttached.sessionId,
        `(() => {
          const shell = document.querySelector("#loading-shell");
          if (!shell || shell.hidden) {
            return null;
          }

          return {
            stage:
              document.querySelector("#loading-stage")?.textContent ?? "",
            detail:
              document.querySelector("#loading-detail")?.textContent ?? "",
            percent:
              document.querySelector("#loading-percent")?.textContent ?? ""
          };
        })()`,
      );

      if (state) {
        loadingState = state;
        break;
      }
    } catch {
      // Reader is still booting.
    }

    await delay(20);
  }

  if (!loadingState) {
    throw new Error(
      "Loading shell was never visible during local-file handoff.",
    );
  }

  await evaluate(
    readerAttached.sessionId,
    `(() => {
      window.__gprLoadingLog = [];
      const shell = document.querySelector("#loading-shell");

      if (!shell) {
        return false;
      }

      const capture = () => {
        const entry = {
          hidden: shell.hidden,
          stage:
            document.querySelector("#loading-stage")?.textContent ?? "",
          detail:
            document.querySelector("#loading-detail")?.textContent ?? "",
          percent:
            document.querySelector("#loading-percent")?.textContent ?? ""
        };
        const previous = window.__gprLoadingLog.at(-1);

        if (
          !previous ||
          previous.hidden !== entry.hidden ||
          previous.stage !== entry.stage ||
          previous.detail !== entry.detail ||
          previous.percent !== entry.percent
        ) {
          window.__gprLoadingLog.push(entry);
        }
      };

      capture();
      const observer = new MutationObserver(capture);
      observer.observe(shell, {
        attributes: true,
        subtree: true,
        childList: true,
        characterData: true
      });
      window.__gprLoadingObserver = observer;
      return true;
    })()`,
  );

  const {
    state: finalState,
    loadingStages,
  } = await waitForText(readerAttached.sessionId);
  const textAt = performance.now();

  const loadingMutationLog = await evaluate(
    readerAttached.sessionId,
    `(() => {
      window.__gprLoadingObserver?.disconnect();
      return window.__gprLoadingLog ?? [];
    })()`,
  );

  let loadingHidden = false;
  const loadingDeadline = Date.now() + 3000;

  while (Date.now() < loadingDeadline && !loadingHidden) {
    loadingHidden = await evaluate(
      readerAttached.sessionId,
      `(() => {
        const shell = document.querySelector("#loading-shell");
        return Boolean(
          shell &&
          shell.hidden === true &&
          getComputedStyle(shell).display === "none"
        );
      })()`,
    );

    if (!loadingHidden) {
      await delay(50);
    }
  }

  await evaluate(
    readerAttached.sessionId,
    `(() => {
      const button = document.querySelector("#exit-reader");
      if (!(button instanceof HTMLButtonElement)) {
        return false;
      }
      button.click();
      return true;
    })()`,
  );

  let exitUrl = null;
  const exitDeadline = Date.now() + 8000;

  while (Date.now() < exitDeadline && !exitUrl) {
    const targets = await call("Target.getTargets");
    const exitedTarget = targets.targetInfos.find(
      (item) => item.targetId === readerTarget.targetId,
    );

    if (
      exitedTarget &&
      !exitedTarget.url.startsWith(READER_ORIGIN)
    ) {
      exitUrl = exitedTarget.url;
      break;
    }

    await delay(50);
  }

  if (!exitUrl) {
    throw new Error("Exit Reader did not return to the original PDF.");
  }

  await delay(1200);
  const postExitTargets = await call("Target.getTargets");
  const readerReturned = postExitTargets.targetInfos.some(
    (item) =>
      item.type === "page" &&
      item.url.startsWith(READER_ORIGIN),
  );

  console.log(
    JSON.stringify(
      {
        extensionId: extension.id,
        fileAccess: "verified-by-file-navigation",
        sourceUrl: PDF_URL,
        readerNavigationMs: Math.round(readerAt - startedAt),
        readerToTextMs: Math.round(textAt - readerAt),
        loadingState,
        loadingStages,
        loadingMutationLog,
        loadingHidden,
        finalState,
        exitUrl,
        readerReturned,
      },
      null,
      2,
    ),
  );

  if (readerReturned) {
    throw new Error(
      "Exit Reader looped back into the Reader.",
    );
  }

  if (
    !loadingMutationLog.some(
      (entry) => entry.stage === "Reading local PDF",
    ) ||
    !loadingMutationLog.some(
      (entry) => entry.stage === "Parsing PDF",
    ) ||
    !loadingMutationLog.some(
      (entry) => entry.stage === "Rendering first page",
    )
  ) {
    throw new Error(
      "Loading shell did not expose the expected local-PDF stages.",
    );
  }

  if (!loadingHidden) {
    throw new Error("Loading shell did not dismiss after first page.");
  }

  const numericPercents = loadingMutationLog
    .map((entry) => /^([0-9]+)%$/.exec(entry.percent)?.[1])
    .filter((value) => value !== undefined)
    .map(Number);

  for (let index = 1; index < numericPercents.length; index += 1) {
    if (numericPercents[index] < numericPercents[index - 1]) {
      throw new Error("Loading progress moved backwards.");
    }
  }
} finally {
  cleanup();
}
