import assert from "node:assert/strict";
import { openBrowser, makePdf } from "./browser-harness.mjs";

// Measurement-only mode does not restore old source. The checked-in baseline
// was captured before the optimization edits, not by running this flag now.
const baseline = process.argv.includes("--baseline") || process.argv.includes("--record-only");
const browser = await openBrowser();
try {
  const pdf = makePdf(500);
  await browser.evaluate(`(async () => {
    const { loadPdf } = await import('/src/pdf/loadPdf.ts');
    const { PdfViewer } = await import('/src/pdf/viewer.ts');
    const { PdfSearchController } = await import('/src/pdf/search.ts');
    const bytes = Uint8Array.from(atob(${JSON.stringify(pdf.toString("base64"))}), c => c.charCodeAt(0));
    const loaded = await loadPdf(bytes.buffer);
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0 auto auto 0;width:1000px;height:800px;overflow:auto;background:#999;z-index:10000';
    const pages = document.createElement('div'); pages.className = 'pages'; root.append(pages); document.body.append(root);
    const metrics = { renders: [], textRequests: 0, geometryReads: 0, errors: [] };
    const seen = new WeakSet(); const originalGetPage = loaded.document.getPage.bind(loaded.document);
    loaded.document.getPage = async (number) => {
      const page = await originalGetPage(number);
      if (!seen.has(page)) {
        seen.add(page);
        const render = page.render.bind(page), text = page.getTextContent.bind(page);
        page.render = (options) => { metrics.renders.push({page:number, scale:options.viewport.scale}); return render(options); };
        page.getTextContent = (...args) => { metrics.textRequests++; return text(...args); };
      }
      return page;
    };
    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function() { if(this.classList.contains('pdf-page')) metrics.geometryReads++; return originalRect.call(this); };
    const viewer = new PdfViewer(loaded.document, pages, root, { initialPage:250, initialScale:1.25, initialZoomMode:'custom', initialTheme:'dark', onRenderError:m=>metrics.errors.push(m) });
    const start = performance.now(); await viewer.initialize();
    window.test = { viewer, root, pages, metrics, loaded, PdfSearchController, startupMs:performance.now()-start, startupRenders:metrics.renders.slice() };
  })()`);
  await browser.evaluate("new Promise(r=>setTimeout(r, 500))");
  const startup = await browser.evaluate("({page:test.viewer.currentPage, startupMs:test.startupMs, renders:test.startupRenders})");
  const scroll = await browser.evaluate(`(async () => {
    test.metrics.geometryReads=0;
    const start=performance.now();
    for(let i=0;i<30;i++){ test.root.scrollTop+=3; test.root.dispatchEvent(new Event('scroll')); await new Promise(requestAnimationFrame); }
    return { frames:30, geometryReads:test.metrics.geometryReads, elapsedMs:performance.now()-start };
  })()`);
  await browser.evaluate("test.viewer.goToPage(1)");
  await browser.evaluate("new Promise(r=>setTimeout(r, 300))");
  const theme = await browser.evaluate(`(async () => {
    const page = test.viewer.getPageElement(1), textLayer = test.viewer.getTextLayerElement(1);
    const node=textLayer.querySelector('span').firstChild;
    const range=document.createRange(); range.setStart(node,0); range.setEnd(node,Math.min(10,node.length));
    getSelection().removeAllRanges();getSelection().addRange(range);
    const selected=getSelection().toString();const before=test.metrics.textRequests;
    const start=performance.now();
    test.viewer.setPageAppearance({...test.viewer.pageAppearance,brightness:110});
    await test.viewer.ensurePageRendered(1);
    return {textRequests:test.metrics.textRequests-before, nodePreserved:node.isConnected && node===textLayer.querySelector('span').firstChild, selectionPreserved:getSelection().toString()===selected, elapsedMs:performance.now()-start, renderer:page.dataset.themeRenderer, text:textLayer.textContent.includes('PDF-GEMINI-TEST-92841')};
  })()`);
  const native = await browser.evaluate(`(() => {
    const layer=test.viewer.getTextLayerElement(1), span=layer.querySelector('span'), rect=span.getBoundingClientRect();
    const prevented={};
    for(const type of ['mousedown','pointerdown','contextmenu']){
      const event=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:rect.left+3,clientY:rect.top+3});span.dispatchEvent(event);prevented[type]=event.defaultPrevented;
    }
    const position=document.caretPositionFromPoint?.(rect.left+5, rect.top+rect.height/2);
    return {prevented,hitText:!!position && layer.contains(position.offsetNode),selectable:getComputedStyle(span).userSelect,protocol:location.protocol,topLevel:window===top};
  })()`);
  const dark = await browser.evaluate(`(() => {
    const page=test.viewer.getPageElement(1), canvas=page.querySelector('canvas'), context=canvas.getContext('2d');
    const at=(x,y)=>Array.from(context.getImageData(Math.floor(x*canvas.width/612),Math.floor(y*canvas.height/792),1,1).data).slice(0,3);
    return {renderer:page.dataset.themeRenderer,background:at(10,10),bitmap:at(435,157),outputScale:Number(page.dataset.outputScale)};
  })()`);
  await browser.evaluate("getSelection().removeAllRanges(); test.viewer.goToPage(2)");
  const fallback = await browser.evaluate("({renderer:test.viewer.getPageElement(2).dataset.themeRenderer,text:test.viewer.getTextLayerElement(2).textContent.includes('PAGE 2')})");
  const search = await browser.evaluate(`(async () => {
    let firstResultMs=null,lastState=null;const start=performance.now();
    const controller=new test.PdfSearchController(test.loaded.document,test.viewer,state=>{lastState=state;if(state.current>0&&firstResultMs===null)firstResultMs=performance.now()-start;});
    await controller.search('SEARCHNEEDLE'); const coldMs=performance.now()-start;const coldMatches=lastState.total;
    const warmStart=performance.now();await controller.search('reading');const warmMs=performance.now()-warmStart;const warmMatches=lastState.total;
    controller.dispose();return {coldMs,warmMs,firstResultMs,coldMatches,warmMatches};
  })()`);
  // Leave a selected text node alive while its bitmap becomes an off-screen preview.
  const memory = await browser.evaluate(`(async () => {
    getSelection().removeAllRanges();
    for(const number of [1,30,60,90,120,150,180,210,240,270]){
      await test.viewer.goToPage(number);
      test.viewer.setScale(test.viewer.scale===1.25?1.3:1.25);
      await new Promise(r=>setTimeout(r,30));
    }
    await test.viewer.goToPage(400);await new Promise(r=>setTimeout(r,700));
    const pages=[...test.pages.querySelectorAll('.pdf-page')];
    const bitmaps=pages.filter(p=>p.querySelector('canvas').width>0);
    return {bitmaps:bitmaps.length,previews:bitmaps.filter(p=>p.dataset.renderState==='preview').length,estimatedBitmapMiB:bitmaps.reduce((n,p)=>{const c=p.querySelector('canvas');return n+c.width*c.height*4},0)/2**20,textPages:pages.filter(p=>p.querySelector('.textLayer').childNodes.length>0).length,errors:test.metrics.errors};
  })()`);
  const compatibility = baseline ? null : await browser.evaluate(`(async () => {
    test.viewer.setScrollMode('page');
    test.viewer.setSpreadMode('odd');await test.viewer.goToPage(3);
    const odd=[...test.pages.querySelectorAll('[data-page-visible=true]')].map(p=>Number(p.dataset.pageNumber));
    test.viewer.setSpreadMode('even');await test.viewer.goToPage(3);
    const even=[...test.pages.querySelectorAll('[data-page-visible=true]')].map(p=>Number(p.dataset.pageNumber));
    test.viewer.setSpreadMode('none');
    const layer=test.viewer.getTextLayerElement(3), node=layer.querySelector('span').firstChild;
    const themes=[];
    for(const name of ['original','sepia','dark']){
      test.viewer.setPageTheme(name);await test.viewer.ensurePageRendered(3);
      const canvas=test.viewer.getPageElement(3).querySelector('canvas');
      themes.push({name,nodePreserved:node===layer.querySelector('span').firstChild,background:[...canvas.getContext('2d').getImageData(10,10,1,1).data].slice(0,3)});
    }
    const before=test.metrics.textRequests;
    test.viewer.setRotation(90);test.viewer.setZoomMode('page-fit');
    await new Promise(r=>setTimeout(r,200));await test.viewer.ensurePageRendered(3);
    const textNode=layer.querySelector('span').firstChild;
    const range=document.createRange();range.setStart(textNode,0);range.setEnd(textNode,1);
    const rect=range.getBoundingClientRect();
    const caret=document.caretPositionFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
    const rotated={rotation:test.viewer.getPageElement(3).dataset.rotation,rebuilt:before<test.metrics.textRequests,hitText:!!caret&&layer.contains(caret.offsetNode)};
    // Pinning is tested in continuous mode: display:none in single-page mode
    // changes the browser's own Selection.toString() semantics.
    test.viewer.setScrollMode('vertical');await test.viewer.goToPage(3);
    await new Promise(r=>setTimeout(r,180));
    const pinnedNode=layer.querySelector('span').firstChild;
    const pinnedRange=document.createRange();pinnedRange.setStart(pinnedNode,0);pinnedRange.setEnd(pinnedNode,1);
    getSelection().removeAllRanges();getSelection().addRange(pinnedRange);
    const selected=getSelection().toString();
    for(const page of [30,60,90,120,150,180,210,240,270,300,330,360,390,420,450,480,490]) await test.viewer.goToPage(page);
    const selectionPinned=pinnedNode.isConnected&&getSelection().toString()===selected;
    const selectionDetails={nodeConnected:pinnedNode.isConnected,expected:selected,actual:getSelection().toString(),collapsed:getSelection().isCollapsed};
    getSelection().removeAllRanges();
    test.viewer.setRotation(0);test.viewer.setZoomMode('page-fit');
    const modes=[];
    for(const mode of ['vertical','horizontal','wrapped','page']){
      test.viewer.setScrollMode(mode);await test.viewer.goToPage(20);await new Promise(r=>setTimeout(r,180));
      modes.push({mode,current:test.viewer.currentPage,currentMarkers:test.pages.querySelectorAll('[data-current=true]').length});
    }
    const { runCanvasRenderExclusive }=await import('/src/pdf/canvasRenderQueue.ts');
    let release,entered;const started=new Promise(r=>entered=r);const order=[];
    const block=runCanvasRenderExclusive(async()=>{order.push('block');entered();await new Promise(r=>release=r)},'high');
    await started;
    const cancel=new AbortController();
    const removed=runCanvasRenderExclusive(async()=>order.push('cancelled'),'low',cancel.signal).catch(e=>e.name);
    const normal=runCanvasRenderExclusive(async()=>order.push('normal'),'normal');
    const high=runCanvasRenderExclusive(async()=>order.push('high'),'high');
    cancel.abort();release();await Promise.all([block,normal,high]);
    return {odd,even,themes,rotated,selectionPinned,selectionDetails,modes,queue:{order,cancellation:await removed},errors:test.metrics.errors};
  })()`);
  const result = { mode:baseline?"baseline":"acceptance", browser:browser.browser.product, origin:browser.origin, startup, scroll, theme, native, dark, fallback, search, memory, compatibility, runtimeErrors:browser.errors };
  console.log(JSON.stringify(result,null,2));
  if (!baseline) {
    assert.equal(startup.page,250,"Restored page must be the first rendered page");
    assert.equal(startup.renders[0]?.page,250);
    assert.ok(scroll.geometryReads < 30*30,"Geometry work must be viewport-bounded, not 500 pages per frame");
    assert.ok(theme.nodePreserved && theme.selectionPreserved,"Color-only changes must preserve native text nodes and selection");
    assert.ok(theme.text && native.topLevel && native.protocol==="https:");
    assert.ok(Object.values(native.prevented).every(value=>!value));
    assert.ok(native.hitText,"Native text hit-testing must land in the Text Layer");
    assert.deepEqual(dark.bitmap,[255,0,0],"Ordinary dark rendering must preserve raster image colors");
    assert.ok(dark.background.every(value=>value<100));
    assert.ok(dark.outputScale>=2,"Retina output scale must not be downgraded");
    assert.equal(search.coldMatches,6000);
    assert.equal(search.warmMatches,6000);
    assert.ok(search.firstResultMs!==null && search.firstResultMs<search.coldMs);
    assert.equal(fallback.renderer,"pdfjs-page-colors");
    assert.ok(fallback.text);
    assert.ok(memory.bitmaps <= 12,"Abandoned preview bitmaps must not accumulate");
    assert.equal(memory.errors.length,0);
    assert.deepEqual(compatibility.odd,[3,4]);
    assert.deepEqual(compatibility.even,[2,3]);
    assert.ok(compatibility.themes.every(theme=>theme.nodePreserved));
    assert.deepEqual(compatibility.themes[0].background,[255,255,255]);
    assert.ok(compatibility.rotated.rebuilt&&compatibility.rotated.hitText);
    assert.equal(compatibility.rotated.rotation,'90');
    assert.ok(compatibility.selectionPinned);
    assert.ok(compatibility.modes.every(mode=>mode.currentMarkers===1 && mode.current===20));
    assert.deepEqual(compatibility.queue.order,['block','high','normal']);
    assert.equal(compatibility.queue.cancellation,'AbortError');
    assert.equal(compatibility.errors.length,0);
    assert.equal(browser.errors.length,0);
  }
  await browser.evaluate("test.viewer.dispose(); test.loaded.destroy()");
} finally { await browser.close(); }
