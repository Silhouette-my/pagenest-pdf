import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer as createPortProbe } from "node:net";
import { join, resolve } from "node:path";
import { createServer, preview } from "vite";

/** Ephemeral HTTPS + isolated Chrome profile; never reuses a user's browser or port. */
export async function openBrowser({ production = false } = {}) {
  const temporary = await mkdtemp(join(tmpdir(), "gpr-acceptance-"));
  let server;
  let chrome;
  const pending = new Map();
  const errors = [];
  let stderr = "";
  let buffer = Buffer.alloc(0);
  let nextId = 0;
  const close = async () => {
    for (const handler of pending.values()) handler.reject(new Error("Browser closed"));
    pending.clear();
    if (chrome && chrome.exitCode === null) {
      const exited = new Promise((resolve) => chrome.once("exit", resolve));
      chrome.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
      if (chrome.exitCode === null) chrome.kill("SIGKILL");
    }
    if (server?.close) await server.close();
    else if (server?.httpServer) await new Promise((resolve) => server.httpServer.close(resolve));
    await rm(temporary, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  };
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(temporary, "key.pem"), "-out", join(temporary, "cert.pem"), "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
    const probe = createPortProbe();
    await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const network = { host: "127.0.0.1", port, strictPort: true, https: { key: await readFile(join(temporary, "key.pem")), cert: await readFile(join(temporary, "cert.pem")) } };
    const config = { root: resolve(import.meta.dirname, ".."), logLevel: "error" };
    if (production) server = await preview({ ...config, preview: network });
    else {
      server = await createServer({ ...config, server: network });
      await server.listen();
    }
    const origin = `https://127.0.0.1:${server.httpServer.address().port}`;
    chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
      "--headless=new", "--lang=en-US", "--accept-lang=en-US", "--no-first-run", "--no-default-browser-check",
      "--remote-debugging-pipe", "--enable-unsafe-extension-debugging",
      // A self-signed certificate is accepted only by this disposable test profile.
      "--ignore-certificate-errors", `--user-data-dir=${join(temporary, "profile")}`,
    ], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
    chrome.stderr.on("data", (data) => { stderr = (stderr + data).slice(-10000); });
    chrome.on("error", (error) => { for (const handler of pending.values()) handler.reject(error); });
    chrome.stdio[4].on("data", (data) => {
      buffer = Buffer.concat([buffer, data]);
      for (;;) {
        const separator = buffer.indexOf(0);
        if (separator < 0) break;
        const payload = buffer.subarray(0, separator).toString();
        buffer = buffer.subarray(separator + 1);
        if (!payload) continue;
        const message = JSON.parse(payload);
        if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails);
        const handler = pending.get(message.id);
        if (handler) {
          pending.delete(message.id);
          message.error ? handler.reject(new Error(JSON.stringify(message.error))) : handler.resolve(message.result);
        }
      }
    });
    function call(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out: ${stderr}`)); }, 30000);
        pending.set(id, { resolve(value) { clearTimeout(timeout); resolve(value); }, reject(error) { clearTimeout(timeout); reject(error); } });
        chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
      });
    }
    const target = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    await call("Runtime.enable", {}, sessionId);
    await call("Page.enable", {}, sessionId);
    await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false }, sessionId);
    async function evaluate(expression, session = sessionId) {
      const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, session);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    async function waitFor(expression, timeout = 20000, session = sessionId) {
      const deadline = Date.now() + timeout;
      let last;
      while (Date.now() < deadline) {
        try { last = await evaluate(expression, session); if (last) return last; } catch { /* Context replaced by navigation. */ }
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error(`Wait failed: ${expression}; last=${JSON.stringify(last)}`);
    }
    await call("Page.navigate", { url: origin }, sessionId);
    await waitFor("document.querySelector('#file-input') || document.querySelector('input[type=file]')");
    return { origin, call, evaluate, waitFor, sessionId, errors, close, temporary, browser: await call("Browser.getVersion") };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Deterministic multi-page PDF: text, unmodified red bitmap, link, form and shading. */
export function makePdf(pageCount = 300, paddingBytes = 0) {
  const objects = new Map();
  const pageIds = Array.from({ length: pageCount }, (_, i) => 8 + i * 2);
  objects.set(1, `<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R] /DA (/F1 12 Tf 0 g) /DR << /Font << /F1 3 0 R >> >> >> >>`);
  objects.set(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`);
  objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.set(4, Buffer.concat([Buffer.from("<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3 >>\nstream\n"), Buffer.from([255, 0, 0]), Buffer.from("\nendstream")]));
  objects.set(5, "<< /Type /Annot /Subtype /Link /Rect [72 615 230 635] /Border [0 0 0] /A << /S /URI /URI (https://example.com/) >> >>");
  objects.set(6, "<< /Type /Annot /Subtype /Widget /FT /Tx /T (reader-test) /V (Original) /Rect [72 550 230 575] /DA (/F1 12 Tf 0 g) /F 4 /P 8 0 R >>");
  objects.set(7, "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [72 400 300 400] /Function << /FunctionType 2 /Domain [0 1] /C0 [0 0 1] /C1 [0 1 0] /N 1 >> /Extend [true true] >>");
  for (let i = 0; i < pageCount; i++) {
    const id = pageIds[i];
    const lines = Array.from({ length: 12 }, (_, j) => `BT /F1 12 Tf 72 ${700 - j * 18} Td (Native selectable reading page ${i + 1} line ${j + 1} searchneedle) Tj ET`).join("\n");
    const shading = i === 1 ? "q 72 400 228 60 re W n /Shade sh Q\n" : "";
    const stream = `BT /F1 18 Tf 72 740 Td (PDF-GEMINI-TEST-92841 PAGE ${i + 1}) Tj ET\n${lines}\nq 70 0 0 70 400 600 cm /Im Do Q\n${shading}`;
    objects.set(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << /Im 4 0 R >> /Shading << /Shade 7 0 R >> >> /Contents ${id + 1} 0 R ${i === 0 ? "/Annots [5 0 R 6 0 R]" : ""} >>`);
    objects.set(id + 1, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  }
  if (paddingBytes > 0) {
    objects.set(objects.size + 1, Buffer.concat([
      Buffer.from(`<< /Length ${paddingBytes} >>\nstream\n`),
      Buffer.alloc(paddingBytes, 0x20), Buffer.from("\nendstream"),
    ]));
  }
  const chunks = [Buffer.from("%PDF-1.7\n")];
  const offsets = [0];
  let length = chunks[0].length;
  for (let id = 1; id <= objects.size; id++) {
    offsets[id] = length;
    const content = Buffer.concat([Buffer.from(`${id} 0 obj\n`), Buffer.from(objects.get(id)), Buffer.from("\nendobj\n")]);
    chunks.push(content); length += content.length;
  }
  const xref = length;
  chunks.push(Buffer.from(`xref\n0 ${objects.size + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.size + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return Buffer.concat(chunks);
}
