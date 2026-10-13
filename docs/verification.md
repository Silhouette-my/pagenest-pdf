# Verification — 2026-10-13

The PageNest PDF 0.1.0 publication candidate was checked with Chrome 155.0.8059.40 on macOS. These are local automated results, not live-hosting or full product acceptance.

| Check | Result | Coverage |
| --- | --- | --- |
| `npm ci` | PASS | Installation from the committed lockfile |
| `npm run check` | PASS | Strict TypeScript check and production build |
| `npm run test:history` | PASS | Page 20, 150% zoom, dark-theme reload recovery; OPFS, recent entries and cache controls |
| `npm run test:session` | PASS | Per-tab/window restoration, busy-window history and reading statistics |
| `npm run test:performance` | PASS | Synthetic 500-page rendering, selection, themes, search, rotation and bounded rendering work |
| `npm run test:extension` | PASS | Web takeover off by default, explicit opt-in and text-layer handoff |
| `npm run test:extension-file` | PASS | Local file bridge, loading stages and Exit Reader |
| `npm run test:extension-range` | PASS | Approximately 16 MiB fixture with partial byte requests |
| `npm run test:production` | PASS after harness correction | Built HTTPS app, forms, restoration, Range/progressive/buffered transfers and local-file handoff |

The session test's page-title expectations were updated for the new branding. The first production test timed out because its disposable extension profile did not opt into automatic web PDF takeover. The harness now explicitly sets `autoWebPdf: true` and waits for that setting before testing takeover; the complete production suite then passed. The extension's default remains false.

The performance scenario ended with eight main bitmaps, zero abandoned previews and an estimated 92.45 MiB of main bitmap pixels. It found 6,000 search matches and reported no runtime exceptions. These are individual synthetic observations, not peak browser memory or general performance guarantees. The production suite also reported no runtime exceptions.

Vite still reports a JavaScript chunk over 500 kB. This is a build warning, not a failed check.

## Manual acceptance still required

- Real macOS sleep/wake, discarded tabs and full Chrome quit/restart using a persistent profile.
- Gemini in Chrome answers on the final deployed HTTPS page.
- Physical Force Click / Look Up / translation behavior.
- Public HTTPS hosting and another user's browser/extension setup.

Earlier manual confirmations in the reader guide describe historical observations. GitHub publication does not establish these current product results.

## Historical records

[September 21 acceptance](archive/ACCEPTANCE.md) and its [recorded values](archive/acceptance-results.json) remain dated evidence for an earlier revision. They are not the current candidate's asset list or automatically updated output. Raw personal crash reports are excluded; see the [public handoff summary](handoff-notes.md).
