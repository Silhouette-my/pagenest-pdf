import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openBrowser, makePdf } from "./browser-harness.mjs";

const browser = await openBrowser({ production: true });
const sources = new Map();
const requests = [];
const server = createServer((request, response) => {
  const entry = sources.get(request.url);
  if (!entry) { response.writeHead(404); response.end(); return; }
  const { bytes, mode } = entry;
  const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
  const headers = { "Content-Type": "application/pdf", "Cache-Control": "no-store" };
  if (mode === "range" && match) {
    const begin = Number(match[1]), end = Math.min(Number(match[2] || bytes.length - 1), bytes.length - 1);
    if (begin >= bytes.length || end < begin) { response.writeHead(416); response.end(); return; }
    const part = bytes.subarray(begin, end + 1);
    requests.push({ path: request.url, type: "range", bytes: part.length });
    response.writeHead(206, { ...headers, "Accept-Ranges": "bytes", "Content-Range": `bytes ${begin}-${end}/${bytes.length}`, "Content-Length": part.length });
    response.end(part);
  } else {
    requests.push({ path: request.url, type: mode, bytes: bytes.length });
    response.writeHead(200, { ...headers, ...(mode !== "buffered" ? { "Content-Length": bytes.length } : {}) });
    // Exercise ReadableStream and unknown-length compatibility paths.
    response.write(bytes.subarray(0, Math.min(1024, bytes.length)));
    setTimeout(() => response.end(bytes.subarray(Math.min(1024, bytes.length))), 30);
  }
});
try {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const pdfOrigin = `http://127.0.0.1:${server.address().port}`;
  const fixture = makePdf(12).toString("base64");
  const ready = "document.readyState==='complete' && document.querySelector('#pdf-file-input')";
  const loaded = "document.querySelector('#loading-shell')?.hidden && document.querySelector('.pdf-page[data-current=true][data-render-state=sharp] .textLayer')?.textContent.includes('PDF-GEMINI-TEST-92841')";
  const upload = `(() => {
    const bytes=Uint8Array.from(atob(${JSON.stringify(fixture)}), c=>c.charCodeAt(0));
    const transfer=new DataTransfer();transfer.items.add(new File([bytes],'acceptance.pdf',{type:'application/pdf'}));
    const input=document.querySelector('#pdf-file-input');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`;
  console.log("production: opening local File in HTTPS app");
  await browser.waitFor(ready);
  await browser.evaluate(upload);
  await browser.waitFor(loaded);
  assert.equal(await browser.evaluate("document.querySelector('#total-pages').textContent"), "12");

  console.log("production: native drag, dark theme and form focus");
  // Native drag selection uses Chrome's input path, not an application selection API.
  const drag = await browser.evaluate(`(() => {
    const span=document.querySelector('.pdf-page[data-current=true] .textLayer span');const r=span.getBoundingClientRect();
    return {x:r.left+2,y:r.top+r.height/2,end:Math.min(r.right-2,r.left+130)};
  })()`);
  await browser.call("Input.dispatchMouseEvent", { type:"mousePressed",x:drag.x,y:drag.y,button:"left",clickCount:1 }, browser.sessionId);
  for (let i=1;i<=8;i++) await browser.call("Input.dispatchMouseEvent", { type:"mouseMoved",x:drag.x+(drag.end-drag.x)*i/8,y:drag.y,button:"left",buttons:1 }, browser.sessionId);
  await browser.call("Input.dispatchMouseEvent", { type:"mouseReleased",x:drag.end,y:drag.y,button:"left",clickCount:1 }, browser.sessionId);
  const selected = await browser.evaluate("getSelection().toString()");
  assert.ok(selected.length>0,"Real browser drag must select actual PDF text");
  await browser.evaluate(`window.selectedBeforeTheme=getSelection().toString();window.nodeBeforeTheme=document.querySelector('.pdf-page[data-current=true] .textLayer span').firstChild;const theme=document.querySelector('#page-theme');theme.value='dark';theme.dispatchEvent(new Event('change',{bubbles:true}));`);
  await browser.waitFor("document.querySelector('.pdf-page[data-current=true]')?.dataset.themeRenderer==='perceptual-canvas' && document.querySelector('.pdf-page[data-current=true]')?.dataset.renderState==='sharp'");
  const nativeTheme = await browser.evaluate("({selected:getSelection().toString()===selectedBeforeTheme,node:nodeBeforeTheme.isConnected,link:!!document.querySelector('.annotationLayer a[href=\"https://example.com/\"]')})");
  assert.ok(nativeTheme.selected && nativeTheme.node && nativeTheme.link);

  await browser.evaluate(`getSelection().removeAllRanges();const field=document.querySelector('.annotationLayer input');field.value='Persisted form';field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));field.focus();document.querySelector('#appearance-brightness').value='110';document.querySelector('#appearance-brightness').dispatchEvent(new Event('input',{bubbles:true}));`);
  await browser.evaluate("new Promise(r=>setTimeout(r,350))");
  const form = await browser.evaluate("({value:document.querySelector('.annotationLayer input')?.value,focused:document.activeElement===document.querySelector('.annotationLayer input')})");
  assert.equal(form.value,"Persisted form");
  assert.ok(form.focused);
  await browser.evaluate(`document.activeElement.blur();const zoom=document.querySelector('#zoom-select');zoom.value='1.5';zoom.dispatchEvent(new Event('change',{bubbles:true}));const page=document.querySelector('#page-number');page.value='7';page.dispatchEvent(new Event('change',{bubbles:true}));`);
  await browser.waitFor("document.querySelector('.pdf-page[data-page-number=\"7\"]')?.dataset.current==='true' && document.querySelector('.pdf-page[data-page-number=\"7\"]')?.dataset.renderState==='sharp'");
  await browser.evaluate("new Promise(r=>setTimeout(r,200))");
  console.log("production: restoring page 7 at 150%");
  await browser.call("Page.reload", {}, browser.sessionId);
  await browser.waitFor(ready);
  await browser.evaluate(`window.initialCommits=[];new MutationObserver(records=>{for(const record of records){const page=record.target;if(page.classList?.contains('pdf-page')&&page.dataset.renderState==='sharp'&&!initialCommits.some(p=>p.page===page.dataset.pageNumber)){initialCommits.push({page:page.dataset.pageNumber,scale:page.dataset.renderScale});}}}).observe(document.querySelector('#pages'),{subtree:true,attributes:true,attributeFilter:['data-render-state']});`);
  await browser.evaluate(upload);
  await browser.waitFor(loaded);
  const restoration = await browser.evaluate("({page:document.querySelector('#page-number').value,zoom:document.querySelector('#zoom-select').value,theme:document.querySelector('#page-theme').value,first:initialCommits[0],text:document.querySelector('.pdf-page[data-current=true] .textLayer').textContent.includes('PAGE 7'),https:location.protocol==='https:',topLevel:window===top})");
  assert.equal(restoration.page,"7");assert.equal(restoration.zoom,"1.5");assert.equal(restoration.theme,"dark");
  assert.deepEqual(restoration.first,{page:"7",scale:"1.5"});assert.ok(restoration.text&&restoration.https&&restoration.topLevel);

  console.log("production: configuring extension HTTPS handoff");
  // Install and configure only the disposable profile's extension.
  const extension = await browser.call("Extensions.loadUnpacked", { path: resolve(import.meta.dirname, "../extension") });
  // Configure through an extension page. Attaching DevTools to a suspending
  // MV3 worker is not a reliable settings API on macOS Chrome.
  const settingsTarget=await browser.call("Target.createTarget",{url:`chrome-extension://${extension.id}/options.html`});
  const attached=await browser.call("Target.attachToTarget",{targetId:settingsTarget.targetId,flatten:true});
  await browser.call("Runtime.enable",{},attached.sessionId);
  await browser.waitFor("document.readyState==='complete' && !!chrome.storage",10000,attached.sessionId);
  await browser.evaluate(`chrome.storage.local.set({readerUrl:${JSON.stringify(browser.origin+"/")},enabled:true,autoWebPdf:true})`,attached.sessionId);
  // macOS intentionally uses the safe asynchronous takeover, not a DNR
  // redirect rule. Confirm settings through the worker's normal message API.
  await browser.waitFor(`chrome.runtime.sendMessage({type:'get-status'}).then(status=>status.enabled && status.autoWebPdf && status.readerUrl===${JSON.stringify(browser.origin+"/")})`,10000,attached.sessionId);
  const fileAllowed=await browser.evaluate("chrome.extension.isAllowedFileSchemeAccess()",attached.sessionId);
  await browser.call("Target.closeTarget",{targetId:settingsTarget.targetId});
  await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: `window.__transferTypes=[];window.addEventListener('message',event=>{if(event.source===window&&event.data?.source==='gemini-pdf-reader-extension'&&typeof event.data.type==='string')window.__transferTypes.push(event.data.type);});` }, browser.sessionId);
  const transfers=[];
  for(const mode of ["range","progressive","buffered"]) {
    console.log(`production: extension ${mode} transfer`);
    const path=`/${mode}.pdf`;sources.set(path,{bytes:makePdf(1,mode==='range'?16*1024*1024:0),mode});
    await browser.call("Page.navigate",{url:pdfOrigin+path},browser.sessionId);
    await browser.waitFor(`location.origin===${JSON.stringify(browser.origin)} && document.title.startsWith(${JSON.stringify(mode+".pdf")}) && (${loaded})`);
    const state=await browser.evaluate("({protocol:location.protocol,topLevel:window===top,pages:document.querySelector('#total-pages').textContent,text:document.querySelector('.textLayer').textContent.includes('PDF-GEMINI-TEST-92841'),status:document.querySelector('#status').textContent,transferTypes:[...new Set(window.__transferTypes??[])]})");
    assert.equal(state.pages,"1");assert.ok(state.text&&state.topLevel&&state.protocol==='https:');
    const traffic=requests.filter(r=>r.path===path);
    const expectedType=mode==='range'?'pdf-range-start':mode==='progressive'?'pdf-progressive-start':'pdf-start';
    assert.ok(state.transferTypes.includes(expectedType),`Expected real ${mode} bridge messages`);
    if(mode==='range') assert.ok(state.transferTypes.includes('pdf-range-data'),'Large PDF must request additional byte ranges');
    transfers.push({mode,...state,requestCount:traffic.length,rangeRequests:traffic.filter(r=>r.type==='range').length,bytesServedIncludingNativeViewer:traffic.reduce((sum,r)=>sum+r.bytes,0)});
  }
  let localFile={status:"not-tested",reason:"File URL access not enabled in disposable profile"};
  console.log(`production: file URL handoff (access=${fileAllowed})`);
  if(fileAllowed) {
    const before=new Set((await browser.call("Target.getTargets")).targetInfos.map(t=>t.targetId));
    const fileUrl=pathToFileURL(resolve(import.meta.dirname,"../public/gemini-text-layer-test.pdf")).href;
    const target=await browser.call("Target.createTarget",{url:fileUrl});
    let readerTarget;
    for(let i=0;i<300&&!readerTarget;i++) {
      const targets=await browser.call("Target.getTargets");readerTarget=targets.targetInfos.find(t=>t.type==='page'&&t.url.startsWith(browser.origin)&&!before.has(t.targetId));
      if(!readerTarget) await new Promise(r=>setTimeout(r,50));
    }
    assert.ok(readerTarget,"Local PDF must hand off to HTTPS reader");
    const reader=await browser.call("Target.attachToTarget",{targetId:readerTarget.targetId,flatten:true});
    await browser.call("Runtime.enable",{},reader.sessionId);
    await browser.waitFor(loaded,20000,reader.sessionId);
    localFile=await browser.evaluate("({status:'passed',protocol:location.protocol,topLevel:window===top,text:document.querySelector('.textLayer').textContent.includes('PDF-GEMINI-TEST-92841')})",reader.sessionId);
    assert.ok(localFile.protocol==='https:'&&localFile.topLevel&&localFile.text);
  }
  console.log(JSON.stringify({mode:"production-acceptance",browser:browser.browser.product,nativeDragSelected:selected,nativeTheme,form,restoration,transfers,localFile,runtimeErrors:browser.errors},null,2));
  assert.equal(browser.errors.length,0);
} finally {
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  await browser.close();
}
