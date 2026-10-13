import assert from "node:assert/strict";
import { openBrowser, makePdf } from "./browser-harness.mjs";

// Per-tab / per-window restore and reading-time accounting.
const browser = await openBrowser({ production: true });

/** Simulates the extension's window bridge for one tab. */
function windowBridgeSource(windowId) {
  return `(() => {
    const apply = () => {
      const root = document.documentElement;
      if (!root) return false;
      root.dataset.readerWindowBridge = "ready";
      root.dataset.readerWindowId = "${windowId}";
      return true;
    };
    if (!apply()) new MutationObserver((_, observer) => { if (apply()) observer.disconnect(); })
      .observe(document, { childList: true });
  })();`;
}

const targets = new Map();

async function openTab(windowId) {
  const target = await browser.call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.call("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  targets.set(sessionId, target.targetId);
  await browser.call("Runtime.enable", {}, sessionId);
  await browser.call("Page.enable", {}, sessionId);
  if (windowId !== undefined) {
    await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: windowBridgeSource(windowId) }, sessionId);
  }
  await browser.call("Page.navigate", { url: browser.origin }, sessionId);
  await browser.waitFor("document.documentElement.dataset.readerReady==='true'", 20000, sessionId);
  return sessionId;
}

async function openPdf(sessionId, name, pages) {
  const bytes = makePdf(pages).toString("base64");
  await browser.evaluate(`(() => {
    const bytes=Uint8Array.from(atob(${JSON.stringify(bytes)}), c=>c.charCodeAt(0));
    const transfer=new DataTransfer();
    transfer.items.add(new File([bytes], ${JSON.stringify(name)}, {type:'application/pdf'}));
    const input=document.querySelector('#pdf-file-input');
    input.files=transfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
  })()`, sessionId);
  await waitForDocument(sessionId, name);
  // Let the history record (and window memory) be written.
  await browser.waitFor(`new Promise(r=>{const q=indexedDB.open('gemini-pdf-reader.history');q.onsuccess=()=>{const t=q.result.transaction('settings').objectStore('settings').get('activeDocument');t.onsuccess=()=>r(!!t.result?.value)}})`, 10000, sessionId);
}

/** Background tabs are throttled; bring the tab to the front first. */
async function focusTab(sessionId) {
  await browser.call("Target.activateTarget", { targetId: targets.get(sessionId) });
}

async function waitForDocument(sessionId, name) {
  await focusTab(sessionId);
  return browser.waitFor(
    `document.title.startsWith(${JSON.stringify(name)}) && document.querySelector('#loading-shell')?.hidden`,
    30000,
    sessionId,
  );
}

const title = (sessionId) => browser.evaluate("document.title", sessionId);

try {
  // The harness's own tab is not part of this scenario; park it so it cannot
  // restore a document in the background and answer presence queries.
  await browser.call("Page.navigate", { url: "about:blank" }, browser.sessionId);

  // Window 1 reads alpha, window 2 reads beta.
  const tabA = await openTab(1);
  await openPdf(tabA, "alpha.pdf", 3);
  const tabB = await openTab(2);
  await openPdf(tabB, "beta.pdf", 4);

  // Reloading tab A restores its own document, not the global latest (beta).
  await browser.call("Page.reload", {}, tabA);
  await waitForDocument(tabA, "alpha.pdf");
  console.log("session: reloaded tab keeps its own document", await title(tabA));

  // Reading time: ~12 s of interaction is credited to alpha.pdf.
  const readingSeconds = `new Promise(r=>{const q=indexedDB.open('gemini-pdf-reader.history');q.onsuccess=()=>{const t=q.result.transaction('readingTime').objectStore('readingTime').getAll();t.onsuccess=()=>r(t.result.filter(x=>x.name==='alpha.pdf').reduce((s,x)=>s+x.seconds,0))}})`;
  await focusTab(tabA);
  const before = await browser.evaluate(readingSeconds, tabA);
  await browser.evaluate(`new Promise(resolve => {
    let n = 0;
    const timer = setInterval(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 200 + n, clientY: 300 }));
      if (++n >= 12) { clearInterval(timer); resolve(); }
    }, 1000);
  })`, tabA);
  await browser.evaluate("document.dispatchEvent(new Event('freeze')); true", tabA);
  const after = await browser.waitFor(`${readingSeconds}.then(s => s >= ${before + 5} ? s : 0)`, 10000, tabA);
  assert.ok(after - before >= 5 && after - before <= 25, `credited ${after - before}s`);
  console.log("session: active reading time recorded", { seconds: after - before });

  const stats = await browser.evaluate(`(async () => {
    document.querySelector('#secondary-stats').click();
    await new Promise(r => setTimeout(r, 500));
    const result = {
      open: document.querySelector('#stats-dialog').open,
      bars: document.querySelectorAll('.stats-column').length,
      documents: [...document.querySelectorAll('.stats-document-name')].map(n => n.textContent),
    };
    document.querySelector('#stats-done').click();
    return result;
  })()`, tabA);
  assert.equal(stats.open, true);
  assert.equal(stats.bars, 14);
  assert.ok(stats.documents.includes("alpha.pdf"));
  console.log("session: statistics dialog lists the document", stats);

  // A new tab in window 1, which is already reading alpha: no auto-open,
  // the history is offered instead and alpha is marked as open elsewhere.
  const busyTab = await openTab(1);
  await focusTab(busyTab);
  const offered = await browser.waitFor(`(() => {
    const dialog = document.querySelector('#recent-dialog');
    const badges = Object.fromEntries([...document.querySelectorAll('.recent-item')].map(row => [
      row.querySelector('.recent-item-name').textContent,
      row.querySelector('.recent-item-badge')?.textContent ?? null,
    ]));
    return dialog.open && badges['alpha.pdf'] && badges['beta.pdf'] && !document.querySelector('#empty-state').hidden
      ? { title: document.title, badges, openFile: !!document.querySelector('#recent-open-file') }
      : false;
  })()`, 10000, busyTab);
  assert.equal(offered.title, "PageNest PDF");
  assert.equal(offered.badges["alpha.pdf"], "Open in another tab");
  assert.equal(offered.badges["beta.pdf"], "Open in another window");
  console.log("session: busy window offers history instead of reopening", offered);
  await browser.call("Target.closeTarget", { targetId: targets.get(busyTab) });

  // Window 2 moves on to gamma (now the global latest).
  await focusTab(tabB);
  await openPdf(tabB, "gamma.pdf", 5);

  // Once tab A is closed, a new tab in window 1 reopens window 1's document.
  await browser.call("Target.closeTarget", { targetId: targets.get(tabA) });
  const tabWindow1 = await openTab(1);
  await waitForDocument(tabWindow1, "alpha.pdf");
  console.log("session: new tab restores its window's document", await title(tabWindow1));

  // Without a window id, any open reader tab counts as busy…
  const unknownBusy = await openTab();
  await focusTab(unknownBusy);
  await browser.waitFor("document.querySelector('#recent-dialog').open && document.title === 'PageNest PDF'", 10000, unknownBusy);
  console.log("session: unknown window with other open tabs offers history");
  await browser.call("Target.closeTarget", { targetId: targets.get(unknownBusy) });

  // …and with nothing open it falls back to the latest document (alpha, since
  // the window-1 tab just reopened it).
  await browser.call("Target.closeTarget", { targetId: targets.get(tabWindow1) });
  await browser.call("Target.closeTarget", { targetId: targets.get(tabB) });
  const tabUnknown = await openTab();
  await waitForDocument(tabUnknown, "alpha.pdf");
  console.log("session: new tab with nothing open restores the latest document", await title(tabUnknown));

  if (browser.errors.length) {
    throw new Error("Runtime errors: " + JSON.stringify(browser.errors.slice(0, 3)));
  }
  console.log("session: passed");
} finally {
  await browser.close();
}
