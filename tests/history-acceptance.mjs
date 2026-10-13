import assert from "node:assert/strict";
import { openBrowser, makePdf } from "./browser-harness.mjs";

const browser = await openBrowser({ production: true });
try {
  const bytes = makePdf(24).toString("base64");
  await browser.waitFor("document.documentElement.dataset.readerReady==='true' && document.querySelector('#pdf-file-input')");
  await browser.evaluate(`(() => {
    const bytes=Uint8Array.from(atob(${JSON.stringify(bytes)}), c=>c.charCodeAt(0));
    const transfer=new DataTransfer();
    transfer.items.add(new File([bytes], 'history-test.pdf', {type:'application/pdf'}));
    const input=document.querySelector('#pdf-file-input');
    input.files=transfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await browser.waitFor("document.querySelector('#total-pages').textContent==='24' && document.querySelector('#loading-shell').hidden");
  await browser.evaluate(`(() => {
    const page = document.querySelector('#page-number');
    page.value='20'; page.dispatchEvent(new Event('change', {bubbles:true}));
    const theme=document.querySelector('#page-theme');
    theme.value='dark'; theme.dispatchEvent(new Event('change',{bubbles:true}));
    const zoom=document.querySelector('#zoom-select');
    zoom.value='1.5'; zoom.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await browser.waitFor("document.querySelector('#page-number').value==='20' && document.querySelector('.pdf-page[data-current=true]')?.dataset.renderState==='sharp'");
  await browser.waitFor("new Promise(async r=>{const db=await new Promise((res,rej)=>{const q=indexedDB.open('gemini-pdf-reader.history');q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});const records=await new Promise(res=>{const q=db.transaction('documents').objectStore('documents').getAll();q.onsuccess=()=>res(q.result)});r(records.some(x=>x.page===20 && x.cacheKey))})",30000);
  console.log("history: persisted reading position and OPFS cache");
  await browser.call("Page.reload", {}, browser.sessionId);
  await browser.waitFor("document.querySelector('#total-pages')?.textContent==='24' && document.querySelector('#page-number')?.value==='20' && document.querySelector('#loading-shell')?.hidden",30000);
  const restored = await browser.evaluate("({page:document.querySelector('#page-number').value,zoom:document.querySelector('#zoom-select').value,theme:document.querySelector('#page-theme').value,title:document.title})");
  assert.equal(restored.page,"20");
  assert.equal(restored.zoom,"1.5");
  assert.equal(restored.theme,"dark");
  assert.ok(restored.title.includes("history-test.pdf"));
  console.log("history: automatic reload recovery at page 20", restored);
  await browser.evaluate("document.querySelector('#recent-documents').click()");
  await browser.waitFor("document.querySelector('.recent-item-name')?.textContent==='history-test.pdf'");
  await browser.evaluate("document.querySelector('#recent-clear-cache').click()");
  await browser.waitFor("document.querySelector('.recent-item-meta') && !document.querySelector('.recent-item-meta').textContent.includes('Offline copy')");
  await browser.evaluate("document.querySelector('.recent-item-actions button:last-child').click()");
  await browser.waitFor("document.querySelector('#recent-list')?.textContent.includes('No recent PDFs')");
  console.log("history: recent documents, clear cache and delete passed");
  await browser.evaluate("document.querySelector('#recent-done').click()");
  const bridgeBytes = makePdf(2).toString("base64");
  await browser.evaluate(`(() => {
    const bytes=Uint8Array.from(atob(${JSON.stringify(bridgeBytes)}), c=>c.charCodeAt(0));
    window.postMessage({
      source:'gemini-pdf-reader-extension',type:'pdf-direct-file-bytes',
      token:'history-bridge',filename:'bridge-history.pdf',size:bytes.length,
      contentType:'application/pdf',buffer:bytes.buffer
    },location.origin);
  })()`);
  await browser.waitFor("document.title.startsWith('bridge-history.pdf') && document.querySelector('#total-pages')?.textContent==='2' && document.querySelector('#loading-shell')?.hidden");
  await browser.waitFor("new Promise(async r=>{const db=await new Promise((res,rej)=>{const q=indexedDB.open('gemini-pdf-reader.history');q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});const records=await new Promise(res=>{const q=db.transaction('documents').objectStore('documents').getAll();q.onsuccess=()=>res(q.result)});r(records.some(x=>x.name==='bridge-history.pdf' && x.cacheKey))})",30000);
  await browser.call("Page.reload", {}, browser.sessionId);
  await browser.waitFor("document.title.startsWith('bridge-history.pdf') && document.querySelector('#total-pages')?.textContent==='2' && document.querySelector('#loading-shell')?.hidden");
  console.log("history: extension handoff cached and restored after reload");


  await browser.evaluate("document.querySelector('#restore-session').click()");
  await browser.waitFor("new Promise(async r=>{const db=await new Promise(res=>{const q=indexedDB.open('gemini-pdf-reader.history');q.onsuccess=()=>res(q.result)});const q=db.transaction('settings').objectStore('settings').get('preferences');q.onsuccess=()=>r(q.result.value.restorePreviousSession===false)})");
  await browser.call("Page.reload", {}, browser.sessionId);
  await browser.waitFor("document.documentElement.dataset.readerReady==='true' && document.querySelector('#empty-state')?.hidden===false && document.querySelector('#total-pages')?.textContent==='0'");
  await browser.evaluate("document.querySelector('#recent-documents').click()");
  await browser.waitFor("document.querySelector('.recent-item-name')?.textContent==='bridge-history.pdf'");
  await browser.evaluate("document.querySelector('.recent-item-actions button:first-child').click()");
  await browser.waitFor("document.title.startsWith('bridge-history.pdf') && document.querySelector('#total-pages')?.textContent==='2' && document.querySelector('#loading-shell')?.hidden");
  console.log("history: disabled auto restore, reopened cached PDF from Recent Documents");
  assert.equal(browser.errors.length,0,JSON.stringify(browser.errors));
} finally {
  await browser.close();
}
