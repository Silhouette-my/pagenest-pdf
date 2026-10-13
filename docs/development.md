# Development and deployment

Use Node.js 20.19+ or 22.12+ (required by Vite 7), npm, and the committed lockfile.

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
npm run check
```

`check` runs strict TypeScript checking and a production build. `dist/` contains the deployable static website. Deploy its contents to an HTTPS host; no application backend is required. `npm run preview` serves a local build for inspection. GitHub source publication does not itself deploy the reader or install the extension.

The companion extension is loaded separately from `extension/` through Chrome's **Load unpacked** control. See the [extension guide](../extension/README.md). Configure its Reader URL to the deployed origin or the development URL above. Local PDFs require **Allow access to file URLs**. Web PDF takeover is off by default.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/pdf/` | PDF.js loading, rendering, search, links and forms |
| `src/history/` | IndexedDB history, local cache and tab/window recovery |
| `src/reader/` | Highlights, notes, bookmarks and reading statistics |
| `src/theme/`, `src/styles/`, `src/ui/` | Appearance and reader interface |
| `src/i18n/` | Reader translations |
| `extension/` | Manifest V3 companion and bridge tests |
| `tests/` | Browser acceptance harness and synthetic diagnostic |
| `public/` | Public test fixtures |
| `docs/archive/` | Dated historical verification evidence |

Run browser suites from the repository root. They require installed Chrome and OpenSSL; set `CHROME_PATH` for another Chrome executable. Suites launch disposable browser profiles and loopback servers. The HTTPS harness uses a self-signed certificate accepted only in its test browser.

```sh
npm run test:history
npm run test:session
npm run test:performance
npm run test:extension
npm run test:extension-file
npm run test:extension-range
npm run test:production
```

`test:acceptance` combines `check`, `test:performance` and `test:production`; it does not include every script listed above. The VM-based `node tests/handoff-race-diagnostic.mjs` is an investigation tool, not a native Chrome crash reproduction or a release acceptance gate.

## Maintenance

Keep source, lockfiles, fixtures and runnable tests. Do not commit dependencies, build output, local browser profiles, logs, editor settings or release ZIPs. Build releases from source rather than keeping numbered build copies. Preserve internal storage keys and extension message contracts when changing branding: existing browser data belongs to its origin and profile.

There is no project license declaration in this initial publication. Dependency licenses and design references are described in the [reader guide](reader-guide.md#acknowledgements--open-source-references); they do not establish a license for this project's own code.
