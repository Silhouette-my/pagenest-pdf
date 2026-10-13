# PageNest PDF Companion Extension

This Manifest V3 extension makes Chrome hand PDF navigations to the HTTPS/local-development PageNest PDF.

## What it does

- Automatically detects local `file://...pdf` navigations when Chrome grants file access.
- Leaves normal HTTP(S) PDFs alone by default.
- Lets the user explicitly open the current PDF from the popup, or opt into automatic web-PDF takeover.
- Hands the selected PDF to the configured Reader URL.
- Re-fetches/reads the PDF inside the extension process.
- Probes HTTP(S) sources with an initial 64 KB Range request.
- When the source returns `206 Partial Content`, starts PDF.js immediately through a custom `PDFDataRangeTransport`; subsequent byte ranges are fetched only when PDF.js asks for them.
- When HTTP(S) Range is unavailable but the response exposes a known Content-Length and ReadableStream, starts PDF.js from the first chunk and continues with PDF.js progressive streaming.
- On macOS, `file://` PDFs use a new-tab handoff instead of replacing the native PDF tab in place. This avoids the Chromium/AppKit ViewBridge timing that previously caused browser-process crashes.
- Local bytes are read by a hidden, authorized web-accessible extension iframe. It validates the pending one-time transfer token with the service worker, checks the `%PDF-` header, then transfers the ArrayBuffer directly into the HTTPS Reader with `MessageChannel`/transferable ownership. This avoids Base64 and runtime-message copies while keeping PDF.js/Text Layer in the normal HTTP(S) Reader.
- During handoff the Reader itself acts as the loading surface: it shows Connecting → local-file read progress → Parsing PDF → Rendering first page, then fades the loading shell away only after the restored page is sharp. When `file://` does not expose Content-Length, it uses an indeterminate bar plus real bytes-read text instead of inventing a percentage.
- Only unknown-length/non-streamable HTTP(S) responses use the buffered full-stream fallback.
- Progressive/full-stream chunks use acknowledgements so the runtime message queue stays bounded.
- Avoids loading the entire remote PDF into the extension service worker before transfer.
- Applies a 512 MB transfer safety limit to prevent runaway memory use.
- Keeps the actual viewer on an ordinary HTTP(S) page so Gemini in Chrome can access the Reader tab.

The extension does not upload PDF bytes to a PageNest PDF backend.

## Development install

Chrome 137+ no longer honors `--load-extension` in the normal Chrome-branded binary.

For normal interactive development:

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this `extension/` folder.
5. Open the extension popup and confirm **Local auto** is enabled.
6. Keep **Auto-open web PDFs** disabled unless you want direct web PDF navigations to be taken over automatically.
7. Open **Settings** and set the Reader URL.

For this repository's Vite development server, use:

```text
http://127.0.0.1:5173/
```

Then run:

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

## Local PDF access

To let the companion handle local PDFs such as:

```text
file:///Users/me/Documents/paper.pdf
```

open the extension's Details page in `chrome://extensions` and enable:

**Allow access to file URLs**

Chrome controls this permission; the extension cannot silently enable it.

## Automated smoke test

The repository contains a Chrome DevTools Protocol smoke test:

```bash
npm run test:extension
```

It uses the current Chrome `Extensions.loadUnpacked` DevTools API, starts the local Reader and a local PDF origin, verifies that web auto-takeover is disabled by default, then explicitly enables it and verifies that the PDF reaches the Reader and the real PDF.js Text Layer contains:

```text
PDF-GEMINI-TEST-92841
```

## Current interception behavior

HTTP(S) PDFs are **not** automatically intercepted by default. The popup's **Open current PDF** action remains available, and Settings exposes an optional **Auto-open web PDFs** toggle.

When that optional toggle is enabled, HTTP(S) URLs ending in `.pdf` use the existing platform-specific takeover path. On Windows/Linux this can use a dynamic `declarativeNetRequest` main-frame redirect rule so the navigation can go straight to the Reader.

On macOS, the extension intentionally does **not** install that early DNR redirect. Recent Chromium/macOS builds can crash in the browser process around AppKit/ViewBridge native-view geometry synchronization during very early navigation changes. The macOS path therefore lets the PDF tab reach a stable/complete state, waits an additional short settle window, then performs the asynchronous tab takeover. This can allow a brief native PDF Viewer flash, but stability takes priority over zero-flash takeover.

The original PDF URL is captured per tab by `webRequest.onBeforeRequest`, then the Reader bridge asks the service worker to fetch and stream those bytes.

For HTTP(S) PDFs without a `.pdf` suffix, the extension still watches response headers for:

```text
Content-Type: application/pdf
```

Those MIME-only cases use the asynchronous tab-takeover fallback because the extension cannot know they are PDFs before response headers arrive.

Local `file://...pdf` files remain automatic after Chrome grants **Allow access to file URLs**. On macOS they use the new-tab handoff and zero-copy local-file bridge described above.

The Reader toolbar includes an **Exit Reader** button. For extension-opened PDFs it returns the current tab to the original PDF URL. A short tab-scoped bypass prevents that return navigation from immediately triggering automatic takeover again.

## Permissions

- `storage`: extension settings.
- `tabs`: observe PDF tab navigations and replace the current tab with the Reader.
- `webRequest`: observe PDF response Content-Type.
- `scripting`: install the Reader byte bridge after the Reader tab loads.
- `<all_urls>`: required for automatic PDF detection and extension-side fetching across arbitrary PDF origins.

The broad host permission should be reviewed again before Chrome Web Store publication; it is required by the current automatic-all-sites design.
