# Reader guide

A local-first PDF reader for rendering a user-selected local PDF inside a normal HTTPS page while keeping PDF processing inside the browser.

## Purpose

The original workflow could not expose local `file://` PDFs or the tested `chrome-extension://` PDF viewer page to Gemini in Chrome.

This project instead renders a user-selected local PDF inside a normal HTTPS page. The PDF bytes move directly from the browser File API to PDF.js.

## Reading history and automatic recovery

The reader saves a recent-document list to **IndexedDB** with each PDF's name,
size, reading time, page, scroll offsets, zoom mode/scale, and PDF page theme.
**Restore previous session** is enabled by default. The reader restores the
last active document after a reload, a discarded tab, or a browser restart
provided its local file or cache is still available. It uses the Page Lifecycle
events `pagehide`, `visibilitychange`, `freeze`, `resume` and `pageshow`
rather than an unreliable `unload` handler.

Open **Recent Documents** with the clock icon, the empty-state link or More
Tools. Entries have **Open** and **Remove** actions. Deleting an entry also
deletes that document's cached copy.

Chrome's File System Access picker is used for **Open File** when available.
Its serializable handle is persisted so the same local file can be reopened
when permission exists. Drag/drop and native input remain supported but do
not provide reusable handles.

**Keep offline PDF copies (OPFS)** is enabled by default; unchecking this
setting clears local cached PDF bytes while preserving reading history.
**Clear Offline PDF Cache** clears copies without disabling future caching.
Local File/Blob copies are streamed to OPFS and capped at 256 MiB. Extension
transfers without a Blob are cached after first paint up to 32 MiB to avoid
allocating duplicate data for large PDFs. Without a valid file handle or local
cached copy, a PDF must be selected again; the Recent Documents entry retains
its reading position. Cached files are checked for integrity on reopening.
Quota and permission errors do not prevent normal reading.

History and PDF caches belong to the current **HTTPS origin and Chrome
profile**. Clearing site data, deleting that profile, private browsing, or
revoking file access can prevent recovery. PDFs never upload to the server.

Automated test:

```bash
npm run check
npm run test:history
```

The browser test checks restoration to page 20 at 150% with a dark PDF theme,
the recent-document actions, cache clearing and extension-message recovery.
Sleep/wake and full Chrome quit/restart should also be tested manually using
your persistent Chrome profile.

## Privacy

PDF files are processed entirely inside your browser.

The application does not upload PDF files to a server.

Current data flow:

```text
local PDF
→ browser File API
→ ArrayBuffer
→ PDF.js
→ Canvas + selectable Text Layer DOM
```

There is:

- no PDF upload endpoint
- no `FormData` upload
- no backend PDF API
- no analytics
- no telemetry
- no tracking
- no account
- no AI API
- no cloud PDF storage or sync

PDF.js and its worker are bundled with the application. No CDN is used.

## Development

```bash
npm install
npm run dev
```

Open the URL printed by Vite.

## Type check

```bash
npm run typecheck
```

TypeScript strict mode is enabled.

## Build and verification

```bash
npm run check
```

This runs the TypeScript strict-mode check and then the production build.

For the complete automated engineering acceptance suite:

```bash
npm run test:acceptance
```

This additionally runs the 500-page performance/compatibility suite and the built application's HTTPS/extension end-to-end suite. Each browser suite uses an ephemeral loopback HTTPS server and an isolated Chrome profile rather than the development port or your normal browser. The current harness targets macOS Chrome, supports a `CHROME_PATH` override, and requires OpenSSL. Its self-signed certificate bypass applies only to the disposable test browser.

See [verification.md](verification.md) for current checks and separate manual acceptance items.

To build only:

```bash
npm run build
```

The production build is written to `dist/`.

## HTTPS deployment

This is a static application. Deploy the contents of `dist/` to any ordinary static HTTPS origin.

The server only needs to serve the built HTML, CSS, JavaScript, bundled PDF.js worker, and static test fixture. No backend PDF endpoint is required.

Do not use `file://` for the Gemini compatibility test.

## Chrome Companion Extension

The `extension/` folder contains a Manifest V3 companion extension that automatically hands local Finder/`file://` PDFs to this Reader while keeping the actual viewer on an ordinary HTTP(S) page. Web PDF takeover is optional and disabled by default.

Current flow:

```text
Chrome opens a PDF
→ local file:// PDFs are automatically handed to the Reader
→ ordinary HTTP(S) PDFs remain in Chrome by default
→ web PDFs can be opened explicitly with the extension popup, or automatic web takeover can be enabled in Settings
→ HTTP(S) sources opened in the Reader are probed with the first 64 KB Range request when possible
→ if the source returns 206, PDF.js starts immediately through PDFDataRangeTransport and requests only needed byte ranges
→ if HTTP(S) Range is unavailable but Content-Length/ReadableStream are available, PDF.js starts from the first chunk and receives the rest progressively
→ on macOS, file:// PDFs use a new-tab handoff instead of replacing Chrome's native PDF tab in place
→ the Reader embeds a hidden authorized extension bridge that reads the local file directly and transfers its ArrayBuffer into the HTTPS page without Base64/runtime-message copies
→ while the handoff is in progress, the Reader shows an in-place loading shell with real local-file byte progress when Content-Length is available, then stages through PDF parsing and first-page rendering before fading into the document
→ unknown-length/non-streamable HTTP(S) sources fall back to the buffered acknowledged bridge
→ existing PDF.js Reader path opens the PDF
```

The extension does not upload PDF bytes to a Gemini PDF Reader backend. Remote PDFs are fetched from their original source URL by the extension. Local `file://` PDFs require Chrome's user-controlled **Allow access to file URLs** permission.

For local development:

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the repository's `extension/` folder.
5. Open the extension popup and keep **Local auto** enabled.
6. Leave **Auto-open web PDFs** off unless you explicitly want all direct web PDF navigations to be handed to the Reader.
7. In extension Settings, use `http://127.0.0.1:5173/` as the Reader URL.
8. For local PDFs, enable **Allow access to file URLs** in the extension Details page.

Chrome 137+ removed the `--load-extension` command-line path from normal Chrome-branded builds. The automated project smoke test uses the current Chrome DevTools `Extensions.loadUnpacked` API instead:

```bash
npm run test:extension
```

The smoke test installs the extension, verifies that web PDF automatic takeover is off by default, confirms a normal HTTP PDF stays out of the Reader, then explicitly enables web takeover and verifies the Reader/Text Layer path with `PDF-GEMINI-TEST-92841`.

See [extension guide](../extension/README.md) for extension-specific details.

## Gemini Test

### Static HTML Test

1. Deploy the build to a normal HTTPS origin.
2. Open `/test/`.
3. Open Gemini in Chrome.
4. Share the current tab.
5. Ask: `What is the secret test phrase on this page?`
6. Expected: `CRIMSON-ORBIT-7429`.

This test has been manually confirmed successful.

### PDF Text Layer Test

A small test fixture is included at:

```text
/gemini-text-layer-test.pdf
```

The app exposes a **Download Gemini test PDF** link so the fixture can first be saved as a local file. Opening it in the reader still uses the local File API path.

1. Download `gemini-text-layer-test.pdf`.
2. Open the downloaded file using **Choose PDF**, or drag it onto **Drop PDF here**.
3. Confirm the page renders.
4. Confirm `PDF-GEMINI-TEST-92841` can be selected with the mouse.
5. Confirm the app shows: `Gemini test phrase detected in the PDF.js Text Layer DOM.`
6. Open Gemini in Chrome and share the reader tab.
7. Ask: `What is the PDF test phrase?`
8. Expected: `PDF-GEMINI-TEST-92841`.

This test has been manually confirmed successful.

The expected phrase is not duplicated into a hidden textarea or hidden accessibility node. The indicator is shown only after the string is found in the actual rendered PDF.js Text Layer DOM.

## PDF Reader-style UI

The desktop UI follows the interaction model of Mozilla PDF.js and the PDF Reader extension at:

- https://webextension.org/listing/pdf-reader.html
- https://github.com/Emano-Waldeck/pdf-reader
- https://github.com/mozilla/pdf.js

The implementation is original code on top of this project's custom local-first viewer. It does not copy the extension's custom source or assets.

Implemented reader controls:

- full-screen desktop toolbar
- one-click **Exit Reader** control that returns extension-opened documents to the original PDF URL without immediately re-triggering takeover
- collapsible sidebar
- lazy page thumbnails
- PDF document outline / bookmarks
- previous / next page
- editable page number
- Automatic Zoom
- Page Fit
- Page Width
- Actual Size
- fixed zoom percentages and zoom +/- buttons
- full-document text search with match count, next/previous match, and Text Layer highlighting
- selectable local user highlights in four colors
- PDF links and AcroForm fields through the PDF.js Annotation Layer
- PDF attachments sidebar
- Optional Content / Layers sidebar
- Rotate clockwise / counter-clockwise
- Vertical / Horizontal / Wrapped / Page scrolling
- No / Odd / Even spreads
- Print
- Save original PDF or save PDF.js form changes when AcroForm fields were edited
- Presentation Mode
- First / Last Page
- Document Properties
- System / Light / Dark UI theme
- Original / Dark / Sepia PDF theme
- keyboard shortcuts for Open, Find, Save, Print, Zoom, First Page, and Last Page

Search indexes PDF text independently of the currently rendered pages, then applies Chrome's CSS Highlight API to the real PDF.js Text Layer when navigating to a match. User highlights use the same browser-native Highlight API but are stored separately per PDF fingerprint in localStorage and are restored after zoom/theme rerenders and after reopening the document. They do not modify the PDF file itself.

PDF links/forms use the PDF.js Annotation Layer. During native text selection, a browser `selectionchange` listener temporarily disables annotation hit-testing over the selected Text Layer without intercepting `mousedown`, `pointerdown`, or the native context menu.

## Multi-page and lazy rendering

The viewer creates lightweight page placeholders for the document, then uses `IntersectionObserver` to render pages near the viewport.

Behavior:

- the first page is rendered before non-critical document services are initialized
- pages near the viewport are rendered first
- expensive in-progress rendering is cancelled when a page moves away
- completed pages are kept in a small LRU cache
- older off-screen Canvas/Text Layer content is released
- zoom or page-theme changes rerender only the current/nearby pages
- current page is derived from throttled viewport geometry and displayed as `current / total`
- thumbnails are created only when the thumbnail sidebar is actually opened
- outline data is fetched only when the Outline tab is opened
- attachments/layers availability is pre-warmed only during a later true browser-idle period
- AcroForm field metadata is started asynchronously only after the first sharp page is complete, so it does not block first paint

This follows the same first-page-first principle as the stock PDF.js viewer and avoids immediately rendering or initializing a 300-page document's secondary UI.

## Zoom

The toolbar provides:

- Automatic Zoom
- Page Fit
- Page Width
- Actual Size
- 50%, 75%, 100%, 125%, 150%, 200%, 250%, 300%, and 400% presets
- Zoom out / Zoom in
- custom intermediate zoom created by the +/- buttons

Manual/custom zoom is clamped between 50% and 400%. Fit modes may go as low as 10% when necessary so very large-format pages can genuinely fit the viewer.

Zoom controls use finer steps for less sensitivity:

- 50–200%: 5 percentage points per step
- 200–300%: 10 percentage points per step
- 300–400%: 20 percentage points per step
- Ctrl/Cmd + wheel uses continuous delta-based preview scaling instead of discrete wheel ticks
- Wheel events received within the same animation frame are coalesced into one preview update, preserving the same accumulated zoom gain while avoiding repeated layout work
- Active zoom preview is transform-only: a single inherited `--preview-zoom` value scales page subtrees while their committed layout sizes stay unchanged
- the final page width/height and PDF scale are written only once when the gesture settles
- Canvas CSS size follows the page box at 100%, so Canvas does not receive per-frame style writes during preview
- Zoom Sensitivity is user-adjustable from 0.5× to 2.0× and is persisted locally
- PDF.js rasterization is debounced until zoom input has been idle for about 140 ms

Fit modes are recalculated when the viewer viewport or current page dimensions change, including sidebar open/close and window/fullscreen resize. The current page's scroll anchor is preserved during fit recalculation to avoid page/scale oscillation.

### Zoom rendering quality

Zoom is not implemented as a permanent CSS stretch of an old bitmap.

Zoom uses a two-stage pipeline:

1. while the user is actively zooming, the existing Canvas/Text/Annotation layers are scaled immediately with an inherited CSS zoom ratio, without rewriting every page's layout box;
2. repeated wheel/touchpad events in the same animation frame are coalesced, and PDF.js rendering is not repeatedly cancelled/restarted;
3. after roughly 140 ms without another zoom input, the preview ratio is folded into the committed layout scale once;
4. the current page is then queued ahead of thumbnail rendering and PDF.js rasterizes at the final viewport scale;
5. the render uses the device pixel ratio, with a minimum 1.5× supersampling factor on standard-DPI displays;
6. the new high-resolution bitmap is swapped in only after rendering is complete.

Canvas size is capped using PDF.js-like limits (about 33.5 million pixels and a 32767-pixel maximum dimension) to avoid unbounded memory use. Retina displays keep their native 2× output scale.

A Chrome regression test verified:

```text
DPR 1:
100% → 612 CSS px → 918 backing px
200% → 1224 CSS px → 1836 backing px

DPR 2:
100% → 612 CSS px → 1224 backing px
200% → 1224 CSS px → 2448 backing px
```

So increasing application zoom causes a genuine PDF.js rerasterization and increased Canvas backing resolution.

The stock PDF.js viewer supports still higher zoom levels and uses additional restricted-scaling/detail-canvas logic when full-page canvases reach size limits. This custom viewer currently caps manual zoom at 400%; normal page sizes still rerasterize at the new scale, while PDF.js-like Canvas pixel/dimension limits protect memory for unusually large pages.

## UI theme

The application UI supports:

- System
- Light
- Dark

The preference is stored in `localStorage`.

The UI theme is independent from the PDF page theme. For example:

```text
UI: Dark
PDF: Original
```

is supported.

## PDF page themes and reader appearance

The PDF toolbar supports:

- Original
- Dark
- Sepia

Dark/Sepia expose a collapsible **Reading Appearance** panel with:

- Brightness: 70–130%
- Contrast: 70–140%
- Temperature: Cool −100 through Warm +100
- Saturation: 0–150%
- Custom background color
- Custom text color
- Restore theme colors
- Reset adjustments

These preferences are persisted locally and restored when the reader is opened again.

The primary implementation does **not** use:

```css
canvas {
  filter: invert(1) hue-rotate(180deg);
}
```

Instead, themed pages are rerendered through a doq-inspired Canvas color-mapping layer:

- PDF.js still performs the PDF rendering.
- Text/vector `fillStyle`, `strokeStyle`, shadows, and gradient color stops are remapped during rendering.
- Neutral colors are interpolated between the selected foreground/background in CIELAB space.
- Brightness and contrast adjust the base Lab lightness distribution instead of applying a post-render CSS filter.
- Temperature shifts the Lab warm/cool axes; saturation scales chroma.
- Chromatic vector colors keep their hue/chroma as far as practical while their lightness is remapped and minimum contrast is enforced.
- Raster `drawImage` content is deliberately left untouched, so photos and colored bitmap charts are not globally inverted or desaturated.
- PDF.js Canvas rendering is serialized, which keeps the render-scoped color hooks isolated even during rapid theme changes.
- Pages containing PDF soft masks, shading operators, or complex `ColorN`/Pattern color paths automatically fall back to PDF.js `pageColors`, prioritizing correct transparency/shading/pattern semantics over raster-image color preservation on those specific pages.
- The PDF.js Text Layer remains independent, real selectable DOM and uses a theme-aware selection color.

No doq source is vendored; the implementation is a small independent adaptation of the same rendering-time/perceptual-color approach.

Current mappings:

```text
Dark:
  background #202124
  foreground #e8eaed
  selection  rgba(138, 180, 248, 0.35)

Sepia:
  background #f4ecd8
  foreground #493e32
  selection  rgba(153, 102, 51, 0.30)
```

### Dark-theme behavior and limitation

The themed Canvas path intentionally leaves raster images unchanged. A browser smoke test with a PDF containing a pure-red embedded raster image confirmed that the page background changed from white to `#202124` while the image remained `rgb(255, 0, 0)`.

This is preferable to whole-page inversion for normal documents with photos and charts. The trade-off is that scanned/image-only pages remain visually close to their original raster appearance rather than becoming a fully dark scan.

The render-scoped Canvas hooks apply to both the main PDF canvas and PDF.js internal/off-screen 2D canvases, so ordinary transparency groups and vector content composed through `drawImage` are themed before composition. A browser smoke test verified this off-screen-canvas path.

Luminosity soft masks, PDF shading, and Pattern/ColorN paths are special cases: recoloring their intermediate pixels can change alpha or leave rasterized mesh/pattern colors inconsistent. Those pages are detected from the PDF.js operator list and use the built-in `pageColors` fallback instead.

## macOS native behavior test

The application does not install custom handlers for:

- `mousedown`
- `pointerdown`
- `contextmenu`
- text selection
- copy
- Force Touch / pressure events

Native behavior should be checked using the steps below; keyboard and navigation controls also handle their own browser defaults.

Manual validation on macOS:

1. Open a text PDF.
2. Drag to select a word in the Text Layer.
3. Press **Cmd+C** and paste it somewhere.
4. Right-click the word and confirm the normal Chrome context menu appears.
5. Choose **Look Up** if available.
6. Try the configured trackpad Force Click / Look Up gesture.
7. Repeat while PDF theme is **Dark**.
8. Confirm selection highlighting remains visible and native behavior is unchanged.

Earlier testing confirmed native Force Click / Look Up / translation behavior manually. This is a historical compatibility result, not a new physical-device acceptance result for every revision. The September 21, 2026 optimization acceptance suite additionally verifies actual Chrome mouse-drag selection, text hit-testing after rotation, color-only text-node/selection preservation, and form focus. It does not synthesize physical Force Touch or verify that the macOS lookup/translation popup appears. See [historical acceptance](archive/ACCEPTANCE.md) for the final revision's automated results and remaining human checks.

## Privacy verification

1. Open Chrome DevTools → **Network**.
2. Clear existing requests.
3. Open a local PDF through the File Picker or drag/drop.
4. Confirm no request contains or uploads the PDF file body.

Normal static resource requests such as the JavaScript bundle, CSS, and bundled PDF.js worker are expected.

The automated Chrome smoke test also confirmed that opening the local test PDF did not add the local PDF filename to the browser's resource request list.

## Acknowledgements / Open Source References

### Mozilla PDF.js

https://github.com/mozilla/pdf.js

PDF parsing/rendering, Canvas output, worker support, and Text Layer primitives come from PDF.js. PDF.js is licensed under Apache-2.0.

The Text Layer CSS in this project is a minimal adaptation of PDF.js viewer CSS so generated spans retain PDF.js positioning and native text-selection behavior.

### doq

https://github.com/shivaprsd/doq

doq is an MIT-licensed PDF.js reader-mode project and is the primary design reference for treating PDF dark mode as a rendering/color-mapping problem rather than a CSS invert problem.

The current Dark/Sepia implementation follows doq's core design ideas: color transformation happens during PDF rendering rather than through a post-render CSS invert, and perceptual color calculations use CIELAB lightness/chroma handling. Raster images are intentionally preserved.

No doq source is vendored or copied into this repository. The implementation is independently written for this custom PDF.js viewer.

### Dark Reader

https://github.com/darkreader/darkreader

Dark Reader's user-facing brightness/contrast/sepia/saturation model was reviewed as a reference for making appearance controls understandable. This project does not use Dark Reader or its whole-page filter engine; PDF color changes remain inside the PDF rendering path.

### PDF Scholar

https://github.com/emilmsh/pdf-scholar

Its Tint/Night/Night+ reading-mode ideas and emphasis on preserving picture colors were reviewed as a UX reference. No source is copied.

### PDF Reader and Editor

https://github.com/Emano-Waldeck/pdf-reader

Its PDF.js + doq page-theme integration and viewer interaction model were reviewed as implementation references. No code from that integration is copied into this project.

## Known limitations

- Image-only/scanned PDFs intentionally keep their raster pixels largely unchanged in Dark/Sepia, so a bright scanned page will not become a fully dark scan.
- On ordinary pages, raw raster operations such as image-only scans, `drawImage`, and `putImageData` are intentionally not recolored; this preserves photos but means rasterized page content stays close to its source colors.
- Pages that require the soft-mask/shading safety fallback use PDF.js `pageColors`, so photos on those uncommon pages can be recolored/desaturated in exchange for correct composition semantics.
- Pages with very different dimensions initially use the first page's dimensions as a lazy placeholder and may shift slightly when first rendered.
- Text Layer DOM exists only for rendered/cached pages; distant never-visited pages are not eagerly rendered just for Gemini.
- Password-protected PDFs are not supported yet.
- Scanned/image-only PDFs have no selectable text unless the PDF itself contains a text layer; OCR is intentionally not implemented.
- Search currently performs literal case-insensitive matching. Advanced PDF.js find semantics such as diacritic matching, dehyphenation, whole-word mode, and regex are not implemented yet.
- Outline/internal-link navigation currently targets the destination page but does not yet reproduce destination coordinates/zoom modes such as XYZ/FitH.
- Print opens a browser-native PDF tab and invokes the browser print flow rather than using PDF.js's dedicated print service.
- User text highlights are reader-local annotations; they are not yet embedded into the PDF file.
- Full PDF.js editor modes such as FreeText, Ink, Stamp/Image, signatures, and comment editing are not integrated yet.
- No crop/cut, semantic reflow, cloud sync, login, analytics, or AI API.

## Scope

This remains an MVP focused on:

```text
Gemini compatibility
>
local-only privacy
>
Text Layer correctness
>
macOS native behavior
>
PDF rendering quality
>
dark mode
```
