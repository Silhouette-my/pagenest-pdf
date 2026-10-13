const DEFAULT_SETTINGS = {
  enabled: true,
  autoWebPdf: false,
  readerUrl: "http://127.0.0.1:5173/",
};

const pendingTransfers = new Map();
const redirectingTabs = new Map();
const earlyPdfSources = new Map();
const readerSessions = new Map();
const bypassNavigations = new Map();
const rangeTransfers = new Map();
const streamTransfers = new Map();
const EARLY_PDF_RULE_ID = 1001;
const MAC_SAFE_REDIRECT_SETTLE_MS = 400;
const MAC_SAFE_VIEWER_STABLE_MS = 650;
const MAC_SAFE_REDIRECT_TIMEOUT_MS = 8000;
const CHROME_PDF_VIEWER_PREFIX =
  "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/";
const platformInfoPromise = chrome.runtime
  .getPlatformInfo()
  .catch(() => ({ os: "mac" }));
let autoWebPdfEnabled = false;

void chrome.storage.local
  .get(DEFAULT_SETTINGS)
  .then((settings) => {
    autoWebPdfEnabled = Boolean(settings.autoWebPdf);
  });

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set({
    enabled:
      typeof current.enabled === "boolean"
        ? current.enabled
        : DEFAULT_SETTINGS.enabled,
    autoWebPdf:
      typeof current.autoWebPdf === "boolean"
        ? current.autoWebPdf
        : DEFAULT_SETTINGS.autoWebPdf,
    readerUrl:
      typeof current.readerUrl === "string" && current.readerUrl
        ? current.readerUrl
        : DEFAULT_SETTINGS.readerUrl,
  });
  await refreshEarlyPdfRule();
  await refreshWindowBridge();
});

chrome.runtime.onStartup.addListener(() => {
  void refreshEarlyPdfRule();
  void refreshWindowBridge();
});

// ---- Reader window identity ----------------------------------------------
// Each reader tab learns its Chrome window id so the reader can reopen the
// last PDF of *that* window instead of the globally most recent one.
const WINDOW_BRIDGE_SCRIPT_ID = "reader-window-bridge";

async function refreshWindowBridge() {
  let pattern;
  try {
    const { readerUrl } = await getSettings();
    const url = new URL(readerUrl);
    // Match patterns ignore ports, so cover every port on the reader host.
    pattern = `${url.protocol}//${url.hostname}/*`;
  } catch {
    return;
  }

  const [existing] = await chrome.scripting
    .getRegisteredContentScripts({ ids: [WINDOW_BRIDGE_SCRIPT_ID] })
    .catch(() => []);
  if (existing?.matches?.length === 1 && existing.matches[0] === pattern) {
    return;
  }
  if (existing) {
    await chrome.scripting
      .unregisterContentScripts({ ids: [WINDOW_BRIDGE_SCRIPT_ID] })
      .catch(() => undefined);
  }

  try {
    await chrome.scripting.registerContentScripts([
      {
        id: WINDOW_BRIDGE_SCRIPT_ID,
        matches: [pattern],
        js: ["window-bridge.js"],
        runAt: "document_start",
        persistAcrossSessions: true,
      },
    ]);
  } catch (error) {
    console.warn("Could not register the reader window bridge.", error);
  }
}

void refreshWindowBridge();

chrome.tabs.onAttached.addListener((tabId, info) => {
  chrome.tabs
    .sendMessage(tabId, { type: "reader-window-changed", windowId: info.newWindowId })
    .catch(() => {
      // Not a reader tab.
    });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes.autoWebPdf) {
    autoWebPdfEnabled = Boolean(
      changes.autoWebPdf.newValue,
    );

    if (!autoWebPdfEnabled) {
      earlyPdfSources.clear();
    }
  }

  if (changes.enabled || changes.autoWebPdf || changes.readerUrl) {
    void refreshEarlyPdfRule();
  }

  if (changes.readerUrl) {
    void refreshWindowBridge();
  }
});

void refreshEarlyPdfRule();

registerPdfListeners();

function registerPdfListeners() {
  void chrome.storage.local.remove("startupError");

  try {
    chrome.webRequest.onBeforeRequest.addListener(
      (details) => {
        if (
          autoWebPdfEnabled &&
          details.tabId >= 0 &&
          details.type === "main_frame" &&
          looksLikePdfUrl(details.url) &&
          !isNavigationBypassed(details.tabId, details.url)
        ) {
          earlyPdfSources.set(details.tabId, details.url);
        }
      },
      {
        urls: ["http://*/*", "https://*/*"],
        types: ["main_frame"],
      },
    );

    chrome.webRequest.onHeadersReceived.addListener(
      (details) => {
        if (details.tabId < 0 || details.type !== "main_frame") {
          return;
        }

        const contentType = headerValue(
          details.responseHeaders,
          "content-type",
        );

        if (!contentType?.toLowerCase().includes("application/pdf")) {
          return;
        }

        void maybeAutoRedirectWebPdf(
          details.tabId,
          details.url,
        );
      },
      {
        urls: ["http://*/*", "https://*/*"],
        types: ["main_frame"],
      },
      ["responseHeaders"],
    );
  } catch (error) {
    void recordStartupError("webRequest", error);
  }

  try {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      const url = changeInfo.url;

      if (!url) {
        return;
      }

      void maybeInjectEarlyBridge(tabId, url);

      if (!looksLikePdfUrl(url)) {
        return;
      }

      if (url.startsWith("file://")) {
        void redirectPdfWithPlatformSafety(tabId, url);
        return;
      }

      if (
        url.startsWith("http://") ||
        url.startsWith("https://")
      ) {
        void maybeAutoRedirectWebPdf(tabId, url);
      }
    });
  } catch (error) {
    void recordStartupError("tabs", error);
  }
}

async function recordStartupError(stage, error) {
  const message =
    error instanceof Error ? error.message : String(error);

  await chrome.storage.local.set({
    startupError: `${stage}: ${message}`,
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  redirectingTabs.delete(tabId);
  earlyPdfSources.delete(tabId);

  for (const [token, transfer] of pendingTransfers) {
    if (transfer.tabId === tabId) {
      pendingTransfers.delete(token);
    }
  }

  for (const [token, transfer] of rangeTransfers) {
    if (transfer.tabId === tabId) {
      rangeTransfers.delete(token);
    }
  }

  for (const [token, transfer] of streamTransfers) {
    if (transfer.tabId === tabId) {
      transfer.controller.abort();
      streamTransfers.delete(token);
    }
  }

  for (const [token, session] of readerSessions) {
    if (session.readerTabId === tabId) {
      readerSessions.delete(token);
    }
  }

  bypassNavigations.delete(tabId);
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "reader-bridge") {
    return;
  }

  port.onMessage.addListener((message) => {
    if (message?.type === "request-pdf") {
      void streamPdfToReader(
        port,
        message.token,
        message.sourceUrl,
      );
      return;
    }

    if (message?.type === "pdf-range-request") {
      void sendPdfRange(port, message);
      return;
    }

    if (message?.type === "pdf-transfer-abort") {
      rangeTransfers.delete(message.token);

      const stream = streamTransfers.get(message.token);
      stream?.controller.abort();
      streamTransfers.delete(message.token);
      return;
    }

    if (message?.type === "exit-reader") {
      void exitReaderSession(
        port,
        message.token,
      );
    }
  });

  port.onDisconnect.addListener(() => {
    for (const [token, transfer] of rangeTransfers) {
      if (transfer.port === port) {
        rangeTransfers.delete(token);
      }
    }

    for (const [token, transfer] of streamTransfers) {
      if (transfer.port === port) {
        transfer.controller.abort();
        streamTransfers.delete(token);
      }
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "get-window-id") {
    sendResponse({ windowId: sender.tab?.windowId ?? null });
    return;
  }

  if (message?.type === "get-status") {
    void getStatus().then(sendResponse);
    return true;
  }

  if (message?.type === "set-enabled") {
    void chrome.storage.local
      .set({ enabled: Boolean(message.enabled) })
      .then(() => refreshEarlyPdfRule())
      .then(() => getStatus())
      .then(sendResponse);
    return true;
  }

  if (message?.type === "set-auto-web-pdf") {
    void chrome.storage.local
      .set({ autoWebPdf: Boolean(message.enabled) })
      .then(() => refreshEarlyPdfRule())
      .then(() => getStatus())
      .then(sendResponse);
    return true;
  }

  if (message?.type === "open-options") {
    void chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "open-current-pdf") {
    void openCurrentPdf(sender.tab?.id).then(sendResponse);
    return true;
  }

  if (message?.type === "claim-file-transfer") {
    void claimFileTransfer(
      message.token,
      sender,
    ).then(sendResponse);
    return true;
  }
});

async function getSettings() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);

  return {
    enabled: Boolean(settings.enabled),
    autoWebPdf: Boolean(settings.autoWebPdf),
    readerUrl: normalizeReaderUrl(settings.readerUrl),
  };
}

async function getStatus() {
  const settings = await getSettings();
  const fileAccess = await chrome.extension.isAllowedFileSchemeAccess();
  const diagnostics = await chrome.storage.local.get("startupError");

  return {
    ...settings,
    fileAccess,
    startupError:
      typeof diagnostics.startupError === "string"
        ? diagnostics.startupError
        : null,
  };
}

async function refreshEarlyPdfRule() {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) {
    return;
  }

  const [settings, platform] = await Promise.all([
    getSettings(),
    platformInfoPromise,
  ]);
  const addRules = [];

  if (
    settings.autoWebPdf &&
    platform.os !== "mac"
  ) {
    addRules.push({
      id: EARLY_PDF_RULE_ID,
      priority: 1,
      action: {
        type: "redirect",
        redirect: {
          url: settings.readerUrl,
        },
      },
      condition: {
        regexFilter:
          "^(https?://.+\\.pdf(?:\\?.*)?)$",
        resourceTypes: ["main_frame"],
      },
    });
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [EARLY_PDF_RULE_ID],
    addRules,
  });
}

async function maybeInjectEarlyBridge(tabId, url) {
  const settings = await getSettings();

  if (
    !earlyPdfSources.has(tabId) ||
    !isReaderUrl(url, settings.readerUrl)
  ) {
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["reader-bridge.js"],
    });
  } catch (error) {
    console.warn("Gemini PDF Reader bridge injection failed", error);
  }
}

function isNavigationBypassed(tabId, sourceUrl) {
  const bypass = bypassNavigations.get(tabId);

  if (!bypass) {
    return false;
  }

  if (Date.now() >= bypass.expiresAt) {
    bypassNavigations.delete(tabId);
    return false;
  }

  return bypass.sourceUrl === sourceUrl;
}

async function installNavigationBypass(tabId, sourceUrl) {
  const expiresAt = Date.now() + 5000;
  const bypass = { sourceUrl, expiresAt, ruleId: null };
  bypassNavigations.set(tabId, bypass);

  if (
    (sourceUrl.startsWith("http://") ||
      sourceUrl.startsWith("https://")) &&
    chrome.declarativeNetRequest?.updateSessionRules
  ) {
    const ruleId =
      200000 + (Math.abs(tabId) % 1000000000);
    bypass.ruleId = ruleId;

    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId],
        addRules: [
          {
            id: ruleId,
            priority: 10000,
            action: { type: "allow" },
            condition: {
              tabIds: [tabId],
              resourceTypes: ["main_frame"],
            },
          },
        ],
      });
    } catch (error) {
      console.warn(
        "Gemini PDF Reader temporary bypass rule failed",
        error,
      );
      bypass.ruleId = null;
    }
  }

  setTimeout(() => {
    const current = bypassNavigations.get(tabId);

    if (current === bypass) {
      bypassNavigations.delete(tabId);
    }

    if (
      bypass.ruleId !== null &&
      chrome.declarativeNetRequest?.updateSessionRules
    ) {
      void chrome.declarativeNetRequest
        .updateSessionRules({
          removeRuleIds: [bypass.ruleId],
          addRules: [],
        })
        .catch(() => {});
    }
  }, 5500);
}

async function exitReaderSession(port, token) {
  const readerTabId = port.sender?.tab?.id;
  const session = readerSessions.get(token);

  if (
    readerTabId === undefined ||
    !session ||
    session.readerTabId !== readerTabId
  ) {
    try {
      port.postMessage({
        type: "exit-reader-result",
        token,
        ok: false,
        message: "Original PDF location is no longer available.",
      });
    } catch {
      // The Reader may already have disconnected.
    }
    return;
  }

  const { sourceUrl } = session;

  try {
    await installNavigationBypass(readerTabId, sourceUrl);

    const stream = streamTransfers.get(token);
    stream?.controller.abort();
    streamTransfers.delete(token);
    rangeTransfers.delete(token);
    pendingTransfers.delete(token);
    readerSessions.delete(token);
    redirectingTabs.delete(readerTabId);

    try {
      port.postMessage({
        type: "exit-reader-result",
        token,
        ok: true,
      });
    } catch {
      // Navigation may disconnect the port immediately.
    }

    await chrome.tabs.update(readerTabId, {
      url: sourceUrl,
    });
  } catch (error) {
    try {
      port.postMessage({
        type: "exit-reader-result",
        token,
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Could not exit the Reader.",
      });
    } catch {
      // The Reader may already have disconnected.
    }
  }
}

async function maybeAutoRedirectWebPdf(tabId, sourceUrl) {
  const settings = await getSettings();

  if (
    !settings.autoWebPdf ||
    isNavigationBypassed(tabId, sourceUrl)
  ) {
    return;
  }

  await redirectPdfWithPlatformSafety(
    tabId,
    sourceUrl,
    true,
  );
}

async function redirectPdfWithPlatformSafety(
  tabId,
  sourceUrl,
  force = false,
) {
  if (isNavigationBypassed(tabId, sourceUrl)) {
    return;
  }

  const platform = await platformInfoPromise;

  if (
    platform.os === "mac" &&
    sourceUrl.startsWith("file://")
  ) {
    await openLocalPdfInReaderTab(tabId, sourceUrl, force);
    return;
  }

  if (platform.os === "mac") {
    const settled = await waitForMacTabToSettle(
      tabId,
      sourceUrl,
    );

    if (!settled) {
      return;
    }
  }

  await maybeRedirectPdf(tabId, sourceUrl, force);
}

async function openLocalPdfInReaderTab(
  sourceTabId,
  sourceUrl,
  force = false,
) {
  const settings = await getSettings();

  if (
    (!settings.enabled && !force) ||
    redirectingTabs.get(sourceTabId) === sourceUrl
  ) {
    return;
  }

  const allowed =
    await chrome.extension.isAllowedFileSchemeAccess();

  if (!allowed) {
    return;
  }

  let sourceTab;

  try {
    sourceTab = await chrome.tabs.get(sourceTabId);
  } catch {
    return;
  }

  redirectingTabs.set(sourceTabId, sourceUrl);
  const token = crypto.randomUUID();
  const readerUrl = new URL(settings.readerUrl);
  readerUrl.searchParams.set("extensionTransfer", token);

  let readerTab;

  try {
    readerTab = await chrome.tabs.create({
      url: readerUrl.href,
      active: false,
      index: sourceTab.index + 1,
      windowId: sourceTab.windowId,
    });

    if (readerTab.id === undefined) {
      throw new Error("Chrome did not create a Reader tab.");
    }

    pendingTransfers.set(token, {
      sourceUrl,
      tabId: readerTab.id,
      createdAt: Date.now(),
    });
    readerSessions.set(token, {
      sourceUrl,
      readerTabId: readerTab.id,
      createdAt: Date.now(),
    });

    await waitForReaderAndInject(
      readerTab.id,
      readerUrl.origin,
      token,
    );

    if (sourceTab.active) {
      await chrome.tabs.update(readerTab.id, {
        active: true,
      });
    }

    await chrome.tabs.remove(sourceTabId).catch(() => {});
  } catch (error) {
    pendingTransfers.delete(token);
    readerSessions.delete(token);
    redirectingTabs.delete(sourceTabId);

    if (readerTab?.id !== undefined) {
      await chrome.tabs.remove(readerTab.id).catch(() => {});
    }

    console.warn(
      "Gemini PDF Reader local-tab handoff failed",
      error,
    );
  }
}

async function waitForMacTabToSettle(tabId, sourceUrl) {
  const deadline = Date.now() + MAC_SAFE_REDIRECT_TIMEOUT_MS;
  let stableUrl = "";
  let stableSince = Date.now();

  while (Date.now() < deadline) {
    let tab;

    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return false;
    }

    const currentUrl = tab.pendingUrl || tab.url || "";
    const isNativePdfViewer =
      currentUrl.startsWith(CHROME_PDF_VIEWER_PREFIX);
    const stillPdfNavigation =
      currentUrl === sourceUrl || isNativePdfViewer;

    if (!stillPdfNavigation) {
      return false;
    }

    if (currentUrl !== stableUrl) {
      stableUrl = currentUrl;
      stableSince = Date.now();
    }

    if (
      isNativePdfViewer &&
      Date.now() - stableSince >= MAC_SAFE_VIEWER_STABLE_MS
    ) {
      return true;
    }

    if (tab.status === "complete") {
      await delay(MAC_SAFE_REDIRECT_SETTLE_MS);

      try {
        const settledTab = await chrome.tabs.get(tabId);
        const settledUrl =
          settledTab.pendingUrl || settledTab.url || "";

        return (
          settledUrl === sourceUrl ||
          settledUrl.startsWith(CHROME_PDF_VIEWER_PREFIX)
        );
      } catch {
        return false;
      }
    }

    await delay(80);
  }

  return false;
}

async function maybeRedirectPdf(
  tabId,
  sourceUrl,
  force = false,
) {
  const settings = await getSettings();

  if (
    (!settings.enabled && !force) ||
    isReaderUrl(sourceUrl, settings.readerUrl) ||
    redirectingTabs.get(tabId) === sourceUrl ||
    isNavigationBypassed(tabId, sourceUrl)
  ) {
    return;
  }

  if (sourceUrl.startsWith("file://")) {
    const allowed = await chrome.extension.isAllowedFileSchemeAccess();
    if (!allowed) {
      return;
    }
  }

  redirectingTabs.set(tabId, sourceUrl);
  const token = crypto.randomUUID();

  pendingTransfers.set(token, {
    sourceUrl,
    tabId,
    createdAt: Date.now(),
  });
  readerSessions.set(token, {
    sourceUrl,
    readerTabId: tabId,
    createdAt: Date.now(),
  });

  const readerUrl = new URL(settings.readerUrl);
  readerUrl.searchParams.set("extensionTransfer", token);

  try {
    await chrome.tabs.update(tabId, {
      url: readerUrl.href,
    });
    await waitForReaderAndInject(tabId, readerUrl.origin, token);
  } catch (error) {
    pendingTransfers.delete(token);
    readerSessions.delete(token);
    redirectingTabs.delete(tabId);
    console.warn("Gemini PDF Reader redirect failed", error);
  }
}

async function waitForReaderAndInject(tabId, expectedOrigin, token) {
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    const currentUrl = tab.url ? new URL(tab.url) : null;

    if (
      currentUrl &&
      currentUrl.origin === expectedOrigin &&
      currentUrl.searchParams.get("extensionTransfer") === token &&
      tab.status === "complete"
    ) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["reader-bridge.js"],
      });
      return;
    }

    await delay(80);
  }

  throw new Error("Reader bridge timed out.");
}

async function streamPdfToReader(
  port,
  token,
  directSourceUrl,
) {
  const pending = pendingTransfers.get(token);
  const senderTabId = port.sender?.tab?.id ?? -1;
  const earlySourceUrl = earlyPdfSources.get(senderTabId);
  const transfer =
    pending ??
    (typeof directSourceUrl === "string"
      ? {
          sourceUrl: directSourceUrl,
          tabId: senderTabId,
          createdAt: Date.now(),
        }
      : typeof earlySourceUrl === "string"
        ? {
            sourceUrl: earlySourceUrl,
            tabId: senderTabId,
            createdAt: Date.now(),
          }
        : null);

  if (!transfer || !isSupportedPdfSource(transfer.sourceUrl)) {
    port.postMessage({
      type: "pdf-error",
      token,
      message: "PDF transfer expired or source is invalid.",
    });
    return;
  }

  if (senderTabId >= 0 && !readerSessions.has(token)) {
    readerSessions.set(token, {
      sourceUrl: transfer.sourceUrl,
      readerTabId: senderTabId,
      createdAt: Date.now(),
    });
  }

  const settings = await getSettings();
  const senderUrl = port.sender?.url;

  if (!senderUrl || !isReaderUrl(senderUrl, settings.readerUrl)) {
    port.postMessage({
      type: "pdf-error",
      message: "Reader origin is not allowed.",
    });
    return;
  }

  const controller = new AbortController();
  streamTransfers.set(token, {
    controller,
    port,
    tabId: transfer.tabId,
  });

  try {
    const isFileSource =
      transfer.sourceUrl.startsWith("file://");

    if (isFileSource) {
      port.postMessage({
        type: "pdf-direct-file",
        token,
      });
      streamTransfers.delete(token);
      return;
    }
    const supportsRangeProbe =
      transfer.sourceUrl.startsWith("http://") ||
      transfer.sourceUrl.startsWith("https://");
    let response = null;

    if (supportsRangeProbe) {
      try {
        const probe = await fetch(transfer.sourceUrl, {
          credentials: "include",
          cache: "default",
          headers: {
            Range: "bytes=0-65535",
          },
          signal: controller.signal,
        });
        const contentRange = parseContentRange(
          probe.headers.get("content-range"),
        );
        const contentEncoding =
          probe.headers.get("content-encoding");

        if (
          probe.status === 206 &&
          contentRange &&
          contentRange.begin === 0 &&
          contentRange.total > 0 &&
          contentRange.total <= 512 * 1024 * 1024 &&
          (!contentEncoding ||
            contentEncoding.toLowerCase() === "identity")
        ) {
          const initialData = new Uint8Array(
            await probe.arrayBuffer(),
          );
          const expectedLength =
            contentRange.end - contentRange.begin + 1;

          if (
            initialData.byteLength === expectedLength &&
            initialData.byteLength > 0
          ) {
            const contentType =
              probe.headers.get("content-type") ||
              "application/pdf";
            const filename = filenameFromUrl(
              transfer.sourceUrl,
            );

            streamTransfers.delete(token);
            rangeTransfers.set(token, {
              port,
              sourceUrl: transfer.sourceUrl,
              tabId: transfer.tabId,
              totalBytes: contentRange.total,
            });

            port.postMessage({
              type: "pdf-range-start",
              token,
              filename,
              contentType,
              totalBytes: contentRange.total,
              initialData: bytesToBase64(initialData),
              sourceUrl: transfer.sourceUrl,
            });

            if (pending) {
              pendingTransfers.delete(token);
              redirectingTabs.delete(transfer.tabId);
            }
            earlyPdfSources.delete(transfer.tabId);
            return;
          }
        }

        if (probe.status === 200 && probe.ok) {
          response = probe;
        }
      } catch {
        // Range probing is an optimization only. The full-stream fallback
        // below remains the compatibility path.
      }
    }

    response ??= await fetch(transfer.sourceUrl, {
      credentials: "include",
      cache: "default",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`PDF request failed: ${response.status}`);
    }

    const contentType =
      response.headers.get("content-type") || "application/pdf";
    const filename = filenameFromUrl(transfer.sourceUrl);

    if (isFileSource) {
      const bytes = new Uint8Array(await response.arrayBuffer());

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
        throw new Error("Local file does not start with a PDF header.");
      }

      port.postMessage({
        type: "pdf-start",
        token,
        filename,
        contentType,
        totalBytes: bytes.byteLength,
        sourceUrl: transfer.sourceUrl,
      });

      const chunkSize = 128 * 1024;

      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(
          offset,
          Math.min(bytes.length, offset + chunkSize),
        );

        await sendChunkWithBackpressure(
          port,
          token,
          offset,
          chunk,
        );
      }

      port.postMessage({
        type: "pdf-end",
        token,
      });

      if (pending) {
        pendingTransfers.delete(token);
        redirectingTabs.delete(transfer.tabId);
      }

      earlyPdfSources.delete(transfer.tabId);
      streamTransfers.delete(token);
      return;
    }

    const contentLength = Number(
      response.headers.get("content-length"),
    );
    const totalBytes =
      Number.isSafeInteger(contentLength) && contentLength > 0
        ? contentLength
        : null;

    if (totalBytes !== null && totalBytes > 512 * 1024 * 1024) {
      throw new Error("PDF is larger than the 512 MB safety limit.");
    }

    const reader = response.body?.getReader();

    if (
      reader &&
      totalBytes !== null &&
      !isFileSource
    ) {
      await streamPdfProgressively({
        contentType,
        filename,
        port,
        reader,
        sourceUrl: transfer.sourceUrl,
        token,
        totalBytes,
      });

      if (pending) {
        pendingTransfers.delete(token);
        redirectingTabs.delete(transfer.tabId);
      }
      earlyPdfSources.delete(transfer.tabId);
      streamTransfers.delete(token);
      return;
    }

    port.postMessage({
      type: "pdf-start",
      token,
      filename,
      contentType,
      totalBytes,
      sourceUrl: transfer.sourceUrl,
    });

    if (reader) {
      let offset = 0;

      for (;;) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        if (!value || value.byteLength === 0) {
          continue;
        }

        if (offset + value.byteLength > 512 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("PDF exceeded the 512 MB safety limit.");
        }

        const transferChunkSize = 128 * 1024;

        for (
          let chunkOffset = 0;
          chunkOffset < value.byteLength;
          chunkOffset += transferChunkSize
        ) {
          const chunk = value.subarray(
            chunkOffset,
            Math.min(
              value.byteLength,
              chunkOffset + transferChunkSize,
            ),
          );

          await sendChunkWithBackpressure(
            port,
            token,
            offset,
            chunk,
          );
          offset += chunk.byteLength;
        }
      }
    } else {
      // Some schemes/platforms may not expose a ReadableStream. Keep this
      // compatibility fallback, but still send only one bounded chunk at a
      // time so the runtime message queue cannot grow without limit.
      const bytes = new Uint8Array(await response.arrayBuffer());

      if (bytes.byteLength > 512 * 1024 * 1024) {
        throw new Error("PDF is larger than the 512 MB safety limit.");
      }

      const chunkSize = 128 * 1024;

      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(
          offset,
          Math.min(bytes.length, offset + chunkSize),
        );

        await sendChunkWithBackpressure(
          port,
          token,
          offset,
          chunk,
        );
      }
    }

    port.postMessage({
      type: "pdf-end",
      token,
    });

    if (pending) {
      pendingTransfers.delete(token);
      redirectingTabs.delete(transfer.tabId);
    }

    earlyPdfSources.delete(transfer.tabId);
    streamTransfers.delete(token);
  } catch (error) {
    try {
      port.postMessage({
        type: "pdf-error",
        token,
        message:
          error instanceof Error
            ? error.message
            : "Failed to load PDF.",
      });
    } catch {
      // The Reader tab may already be gone.
    }

    if (pending) {
      pendingTransfers.delete(token);
      redirectingTabs.delete(transfer.tabId);
    }

    earlyPdfSources.delete(transfer.tabId);
    streamTransfers.delete(token);
  }
}

async function streamPdfProgressively({
  contentType,
  filename,
  port,
  reader,
  sourceUrl,
  token,
  totalBytes,
}) {
  let offset = 0;
  let started = false;
  const transferChunkSize = 128 * 1024;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (!value || value.byteLength === 0) {
      continue;
    }

    if (offset + value.byteLength > totalBytes) {
      await reader.cancel();
      throw new Error(
        "Progressive PDF transfer exceeded Content-Length.",
      );
    }

    for (
      let chunkOffset = 0;
      chunkOffset < value.byteLength;
      chunkOffset += transferChunkSize
    ) {
      const chunk = value.subarray(
        chunkOffset,
        Math.min(
          value.byteLength,
          chunkOffset + transferChunkSize,
        ),
      );

      if (!started) {
        await sendProgressiveStartWithBackpressure(
          port,
          {
            type: "pdf-progressive-start",
            token,
            filename,
            contentType,
            totalBytes,
            initialData: bytesToBase64(chunk),
            sourceUrl,
          },
          chunk.byteLength,
        );
        started = true;
      } else {
        await sendProgressiveChunkWithBackpressure(
          port,
          token,
          offset,
          chunk,
        );
      }

      offset += chunk.byteLength;
    }
  }

  if (!started || offset !== totalBytes) {
    throw new Error(
      "Progressive PDF transfer length did not match Content-Length.",
    );
  }

  port.postMessage({
    type: "pdf-progressive-end",
    token,
  });
}

function sendProgressiveStartWithBackpressure(
  port,
  message,
  nextOffset,
) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      port.onMessage.removeListener(onMessage);
      reject(
        new Error(
          "Reader did not acknowledge progressive PDF start.",
        ),
      );
    }, 15000);

    const onMessage = (reply) => {
      if (
        reply?.type !== "pdf-progressive-ack" ||
        reply.token !== message.token ||
        reply.nextOffset !== nextOffset
      ) {
        return;
      }

      clearTimeout(timeout);
      port.onMessage.removeListener(onMessage);
      resolve();
    };

    port.onMessage.addListener(onMessage);
    port.postMessage(message);
  });
}

function sendProgressiveChunkWithBackpressure(
  port,
  token,
  offset,
  bytes,
) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      port.onMessage.removeListener(onMessage);
      reject(
        new Error(
          "Reader did not acknowledge progressive PDF data.",
        ),
      );
    }, 15000);

    const onMessage = (message) => {
      if (
        message?.type !== "pdf-progressive-ack" ||
        message.token !== token ||
        message.nextOffset !== offset + bytes.byteLength
      ) {
        return;
      }

      clearTimeout(timeout);
      port.onMessage.removeListener(onMessage);
      resolve();
    };

    port.onMessage.addListener(onMessage);
    port.postMessage({
      type: "pdf-progressive-chunk",
      token,
      offset,
      data: bytesToBase64(bytes),
    });
  });
}

async function claimFileTransfer(token, sender) {
  const transfer = pendingTransfers.get(token);

  if (
    !transfer ||
    !transfer.sourceUrl.startsWith("file://") ||
    sender.tab?.id !== transfer.tabId ||
    sender.url !== chrome.runtime.getURL("file-bridge.html")
  ) {
    return { ok: false };
  }

  const allowed = await chrome.extension.isAllowedFileSchemeAccess();

  if (!allowed) {
    return { ok: false };
  }

  const settings = await getSettings();
  const readerOrigin = new URL(settings.readerUrl).origin;

  pendingTransfers.delete(token);
  redirectingTabs.delete(transfer.tabId);
  earlyPdfSources.delete(transfer.tabId);

  return {
    ok: true,
    sourceUrl: transfer.sourceUrl,
    filename: filenameFromUrl(transfer.sourceUrl),
    readerOrigin,
  };
}

async function sendPdfRange(port, message) {
  const token = message?.token;
  const requestId = Number(message?.requestId);
  const begin = Number(message?.begin);
  const end = Number(message?.end);
  const transfer = rangeTransfers.get(token);

  if (
    !transfer ||
    transfer.port !== port ||
    !Number.isSafeInteger(requestId) ||
    !Number.isSafeInteger(begin) ||
    !Number.isSafeInteger(end) ||
    begin < 0 ||
    end <= begin ||
    end > transfer.totalBytes
  ) {
    try {
      port.postMessage({
        type: "pdf-range-error",
        token,
        requestId,
        message: "Invalid PDF range request.",
      });
    } catch {
      // The Reader may already have disconnected.
    }
    return;
  }

  try {
    const response = await fetch(transfer.sourceUrl, {
      credentials: "include",
      cache: "default",
      headers: {
        Range: `bytes=${begin}-${end - 1}`,
      },
    });
    const contentRange = parseContentRange(
      response.headers.get("content-range"),
    );
    const contentEncoding =
      response.headers.get("content-encoding");

    if (
      response.status !== 206 ||
      !contentRange ||
      contentRange.begin !== begin ||
      contentRange.end !== end - 1 ||
      contentRange.total !== transfer.totalBytes ||
      (contentEncoding &&
        contentEncoding.toLowerCase() !== "identity")
    ) {
      throw new Error(
        "The PDF server stopped honoring byte-range requests.",
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());

    if (bytes.byteLength !== end - begin) {
      throw new Error("The PDF server returned a short byte range.");
    }

    port.postMessage({
      type: "pdf-range-data",
      token,
      requestId,
      begin,
      data: bytesToBase64(bytes),
    });
  } catch (error) {
    try {
      port.postMessage({
        type: "pdf-range-error",
        token,
        requestId,
        message:
          error instanceof Error
            ? error.message
            : "PDF range request failed.",
      });
    } catch {
      // The Reader may already have disconnected.
    }
  }
}

function parseContentRange(value) {
  if (!value) {
    return null;
  }

  const match =
    /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(value.trim());

  if (!match) {
    return null;
  }

  const begin = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);

  if (
    !Number.isSafeInteger(begin) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    begin < 0 ||
    end < begin ||
    total <= end
  ) {
    return null;
  }

  return { begin, end, total };
}

async function openCurrentPdf(tabId) {
  const [active] = tabId
    ? [await chrome.tabs.get(tabId)]
    : await chrome.tabs.query({ active: true, currentWindow: true });
  const url = active?.url;

  if (!active?.id || !url || !looksLikePdfUrl(url)) {
    return {
      ok: false,
      message: "The current tab does not look like a PDF URL.",
    };
  }

  await redirectPdfWithPlatformSafety(
    active.id,
    url,
    true,
  );
  return { ok: true };
}

function headerValue(headers, name) {
  const header = headers?.find(
    (item) => item.name.toLowerCase() === name,
  );
  return header?.value ?? null;
}

function isSupportedPdfSource(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:", "file:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function looksLikePdfUrl(value) {
  try {
    const url = new URL(value);
    return /\.pdf$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function normalizeReaderUrl(value) {
  try {
    const url = new URL(value || DEFAULT_SETTINGS.readerUrl);

    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Reader URL must use HTTP or HTTPS.");
    }

    url.hash = "";
    return url.href;
  } catch {
    return DEFAULT_SETTINGS.readerUrl;
  }
}

function isReaderUrl(value, readerUrl) {
  try {
    const candidate = new URL(value);
    const reader = new URL(readerUrl);
    return candidate.origin === reader.origin;
  } catch {
    return false;
  }
}

function filenameFromUrl(value) {
  try {
    const url = new URL(value);
    const name = decodeURIComponent(
      url.pathname.split("/").filter(Boolean).at(-1) || "document.pdf",
    );
    return name.toLowerCase().endsWith(".pdf")
      ? name
      : `${name}.pdf`;
  } catch {
    return "document.pdf";
  }
}

function sendChunkWithBackpressure(
  port,
  token,
  offset,
  bytes,
) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      port.onMessage.removeListener(onMessage);
      reject(new Error("Reader did not acknowledge PDF data."));
    }, 15000);

    const onMessage = (message) => {
      if (
        message?.type !== "pdf-chunk-ack" ||
        message.token !== token ||
        message.nextOffset !== offset + bytes.byteLength
      ) {
        return;
      }

      clearTimeout(timeout);
      port.onMessage.removeListener(onMessage);
      resolve();
    };

    port.onMessage.addListener(onMessage);

    port.postMessage({
      type: "pdf-chunk",
      token,
      offset,
      data: bytesToBase64(bytes),
    });
  });
}

function bytesToBase64(bytes) {
  let binary = "";
  const sliceSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += sliceSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + sliceSize),
    );
  }

  return btoa(binary);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
