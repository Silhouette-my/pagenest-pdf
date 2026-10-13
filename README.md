# PageNest PDF

**Your PDFs, your place, your browser.**

PageNest PDF is a local-first browser PDF reader with highlights, notes, bookmarks and reading-session recovery. Its selectable PDF.js text layer runs in an ordinary web page, designed for use with Gemini in Chrome.

## Features

- Read local PDFs with selectable text, search, outlines, thumbnails, links and forms.
- Highlight in four colors, add notes and export annotations as Markdown.
- Keep bookmarks, navigation history and local reading statistics.
- Resume documents and reading positions using IndexedDB, reusable file handles and optional OPFS copies.
- Choose light/dark interface themes, original/dark/sepia pages and adjustable reading appearance.
- Use the optional Chrome companion to open local or web PDFs in the reader.
- Switch between English and Simplified Chinese.

PDF processing stays in the browser. There is no PDF upload backend, account, cloud sync, analytics or AI API. Gemini is a separate browser feature: sharing a tab with Gemini is controlled by the user and subject to that service's behavior and terms. PageNest PDF is an independent project, not affiliated with Google or Mozilla.

## Start locally

Requires Node.js 20.19+ or 22.12+ and npm.

```sh
git clone https://github.com/Silhouette-my/pagenest-pdf.git
cd pagenest-pdf
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

Open the printed URL and choose or drop a PDF. For Gemini compatibility, use a deployed HTTPS reader page and share that tab in Gemini in Chrome; availability depends on your browser and account.

To install the optional companion, load `extension/` at `chrome://extensions` with Developer mode enabled, configure the Reader URL, and grant file-URL access if you want local PDF handoff. Automatic web PDF takeover is disabled by default. See the [extension guide](extension/README.md).

## Resume reading

**Restore previous session** and **Keep offline PDF copies (OPFS)** are enabled by default. **Recent Documents** lets you reopen or remove entries. **Clear Offline PDF Cache** removes local copies while retaining reading history.

Local File/Blob copies are capped at 256 MiB; extension transfers without a Blob use a 32 MiB cache cap. Recovery needs a readable original file handle or a valid cached copy. Browser storage belongs to the current origin and profile: clearing site data, changing origins or losing permissions can require selecting the file again. Physical sleep/wake and complete browser restart require manual verification.

## Build and documentation

```sh
npm run check
```

This checks TypeScript and builds the static site into `dist/`. GitHub hosts the source; deploy `dist/` separately to an HTTPS static host.

- [Reader guide](docs/reader-guide.md): controls, appearance, privacy and limitations.
- [Development](docs/development.md): structure, extension setup, tests and deployment.
- [Verification](docs/verification.md): current results, historical evidence and manual checks.
- [Handoff notes](docs/handoff-notes.md): public summary of earlier macOS investigations.

## Limits and attribution

Scanned PDFs need an existing text layer; OCR and password-protected PDFs are not supported. Highlights and notes stay in browser storage rather than being embedded in the PDF. Dark themes preserve most raster images, so scans can remain bright. Gemini can only inspect text available in rendered pages.

Rendering uses [Mozilla PDF.js](https://github.com/mozilla/pdf.js) (Apache-2.0). Reading appearance takes design inspiration from [doq](https://github.com/shivaprsd/doq); no doq source is vendored. See the [detailed acknowledgements](docs/reader-guide.md#acknowledgements--open-source-references). A license for this project's own code has not yet been selected.
