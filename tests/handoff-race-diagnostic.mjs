import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

// Diagnostic only: evaluates the actual service worker in a fresh VM with
// simulated Chrome APIs. Does not open, navigate, close, or change real tabs.
// This records unsafe control-flow behavior, NOT a native crash reproduction.
const source = await readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8");
const fileUrl = "file:///diagnostic-fixture.pdf";
const readerUrl = "https://reader.example/";
function event() {
  const listeners = [];
  return {
    addListener(listener) { listeners.push(listener); },
    removeListener(listener) { const i = listeners.indexOf(listener); if (i >= 0) listeners.splice(i, 1); },
    emit(...args) { for (const listener of listeners.slice()) listener(...args); },
  };
}
function scenario({ changeSourceDuringInjection = false } = {}) {
  const operations = [];
  const tabs = new Map([[10, { id: 10, url: fileUrl, status: "complete", active: true, index: 0, windowId: 1 }]]);
  let nextTab = 100;
  const removed = event();
  const chrome = {
    runtime: {
      getPlatformInfo: async () => ({ os: "mac" }),
      getURL: path => `chrome-extension://diagnostic/${path}`,
      onInstalled: event(), onStartup: event(), onConnect: event(), onMessage: event(),
    },
    storage: {
      local: {
        get: async defaults => ({ ...(typeof defaults === "object" ? defaults : {}), enabled: true, readerUrl }),
        set: async () => {}, remove: async () => {},
      },
      onChanged: event(),
    },
    extension: { isAllowedFileSchemeAccess: async () => true },
    declarativeNetRequest: { updateDynamicRules: async () => {} },
    webRequest: { onBeforeRequest: event(), onHeadersReceived: event() },
    tabs: {
      onUpdated: event(), onRemoved: removed,
      get: async id => {
        const tab = tabs.get(id);
        if (!tab) throw new Error("No such tab");
        return { ...tab };
      },
      query: async () => [...tabs.values()].filter(tab => tab.active).map(tab => ({ ...tab })),
      create: async properties => {
        const tab = { ...properties, id: nextTab++, status: "complete" };
        tabs.set(tab.id, tab);
        operations.push({ action: "create", tabId: tab.id });
        return { ...tab };
      },
      update: async (id, properties) => {
        if (!tabs.has(id)) throw new Error("No such tab");
        Object.assign(tabs.get(id), properties);
        operations.push({ action: properties.url ? "navigate" : "activate", tabId: id });
        return { ...tabs.get(id) };
      },
      remove: async id => {
        const tab = tabs.get(id);
        if (!tab) throw new Error("No such tab");
        operations.push({ action: "close", tabId: id, sourceStillPdf: tab.url === fileUrl });
        tabs.delete(id);
        removed.emit(id);
      },
    },
    scripting: {
      executeScript: async ({ target }) => {
        operations.push({ action: "inject-only-no-pdf-ready-ack", tabId: target.tabId });
        if (changeSourceDuringInjection && tabs.has(10)) {
          tabs.get(10).url = "https://unrelated.example/";
          operations.push({ action: "user-navigated-source-away", tabId: 10 });
        }
        // Deliberately no PDF bytes or readiness acknowledgement. Injection
        // resolves, as it does before asynchronous file fetching has completed.
        return [];
      },
    },
  };
  const context = vm.createContext({ chrome, URL, crypto: webcrypto, console, setTimeout, clearTimeout });
  vm.runInContext(source, context, { filename: "extension/service-worker.js" });
  return { operations, run: expression => vm.runInContext(expression, context, { timeout: 1000 }) };
}

const manual = scenario();
await manual.run("openCurrentPdf(10)");
const manualBypassesSafeHandoff = manual.operations.some(op => op.action === "navigate" && op.tabId === 10);
assert.ok(manualBypassesSafeHandoff, "Observed behavior changed: review the manual path");

const parallel = scenario();
await parallel.run(`Promise.all([openLocalPdfInReaderTab(10, ${JSON.stringify(fileUrl)}), openLocalPdfInReaderTab(10, ${JSON.stringify(fileUrl)})])`);
const duplicateReaderTabs = parallel.operations.filter(op => op.action === "create").length;
assert.equal(duplicateReaderTabs, 2, "Observed behavior changed: review the duplicate handoff");

const noReady = scenario();
await noReady.run(`openLocalPdfInReaderTab(10, ${JSON.stringify(fileUrl)})`);
const closedWithoutPdfReady = noReady.operations.some(op => op.action === "close" && op.tabId === 10);
assert.ok(closedWithoutPdfReady, "Observed behavior changed: review source retention");

const staleSource = scenario({ changeSourceDuringInjection: true });
await staleSource.run(`openLocalPdfInReaderTab(10, ${JSON.stringify(fileUrl)})`);
const closedNavigatedAwayTab = staleSource.operations.some(op => op.action === "close" && !op.sourceStillPdf);
assert.ok(closedNavigatedAwayTab, "Observed behavior changed: review navigation generation checks");

console.log(JSON.stringify({
  kind: "control-flow-diagnostic-not-crash-reproduction",
  productionFilesChanged: false,
  realBrowserUsed: false,
  findings: { manualBypassesSafeHandoff, duplicateReaderTabs, closedWithoutPdfReady, closedNavigatedAwayTab },
  traces: { manual: manual.operations, parallel: parallel.operations, noReady: noReady.operations, staleSource: staleSource.operations },
}, null, 2));
