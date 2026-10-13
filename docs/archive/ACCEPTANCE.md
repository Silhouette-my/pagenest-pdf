# Optimization acceptance — 2026-09-21

## Decision and scope

**Automated engineering acceptance: PASS.** The final runtime source, including the last search-cache cleanup and the 6,000-match assertions, passed `npm run test:acceptance` twice consecutively during the final verification session. Both runs completed type checking, rebuilt `dist/`, and passed both browser suites. No runtime source was changed between these runs or after the second run; only acceptance documentation and recorded evidence were added afterward.

**Full human/product acceptance: NOT SIGNED OFF.** Actual Gemini in Chrome answers and the macOS physical Force Click / Look Up / translation popup were not exercised in this session. Browser-native selection and text hit-testing are supporting checks, not substitutes for those two product interactions. Earlier README manual confirmations describe earlier testing, not a new physical-device result for this revision.

This record does not claim a production deployment. The current `dist/` is ready to replace the static assets at the existing HTTPS deployment after the remaining product checks.

## Reproduction

```sh
npm run test:acceptance
```

This runs, in order:

```text
npm run check
  npm run typecheck
  npm run build
npm run test:performance
npm run test:production
```

The browser harness creates a separate HTTPS server on an ephemeral loopback port and a disposable Chrome profile for each suite. It does not reuse port 5173, the user's normal browser profile, or the user's extensions/settings. Tests use the installed macOS Chrome executable, overridable with `CHROME_PATH`, and require OpenSSL. DPR 2 is simulated through Chrome DevTools; physical Retina hardware is not inferred from it.

The certificate is self-signed and accepted only by the disposable test browser via its test-only certificate flag. These checks establish HTTPS top-level rendering and bridge operation in the test environment; they do not validate a public certificate, production hosting configuration, or Gemini account availability. The harness closes its browser/server and attempts to remove its temporary profile on completion.

## Build result

Both successful runs produced the same asset filenames and reported sizes:

| Asset | Build-reported size |
| --- | ---: |
| `dist/index.html` | 17.41 kB |
| `dist/assets/index-cLaSg9VH.js` | 521.56 kB; gzip 155.60 kB |
| `dist/assets/index-BiEEVi8m.css` | 20.86 kB; gzip 5.04 kB |
| `dist/assets/pdf.worker-TGcf_-kp.mjs` | 2,228.49 kB |

Vite's existing >500 kB JavaScript chunk warning remains visible. It is a warning, not a build/test failure; it was not suppressed. Matching Vite asset filenames are reported here, not represented as an independently computed whole-tree checksum.

## Final verification evidence

Browser: `Chrome/153.0.8010.48`. Performance fixture: a deterministic synthetic 500-page PDF. Production suite: actual built application, a 12-page fixture, a roughly 16 MiB range fixture, streaming fixtures, and the existing local-file fixture.

| Check | Run 1 | Run 2 |
| --- | --- | --- |
| Type checking and production build | PASS | PASS |
| First rendered target in 500-page fixture | page 250 at 1.25 scale | page 250 at 1.25 scale |
| Page geometry reads over 30 scroll frames | 240 | 240 |
| Color-only update: new text extraction requests | 0 | 0 |
| Color-only update: text node / selection preserved | yes / yes | yes / yes |
| End-of-stress main bitmaps / abandoned previews | 8 / 0 | 8 / 0 |
| End-of-stress bitmap-byte estimate | 92.449951171875 MiB | 92.449951171875 MiB |
| Cold query / warm query match count | 6000 / 6000 | 6000 / 6000 |
| First search result time | 1.199999988 ms | 1.399999976 ms |
| Full cold search time | 129.099999964 ms | 122.100000024 ms |
| Warm search time | 0.699999988 ms | 0.5 ms |
| Collected browser runtime exceptions | 0 | 0 |

These timings are individual test observations, not p50/p95 measurements or a general speed guarantee. Bitmap bytes use `width * height * 4` for the main page canvases present at the end of the scenario. They are not total process/GPU memory, peak memory, or proof of a hard eight-page maximum.

The prior pre-optimization capture reported 15,030 page geometry reads, 22 bitmaps with 14 abandoned previews, and a 259.962158203125 MiB bitmap estimate under the earlier comparison scenario. Against that recorded baseline, the final counts represent about 98.4% fewer geometry reads and 64.4% lower end-of-scenario bitmap-byte estimates. The final pass/fail decision uses functional assertions and bounded-work/resource assertions rather than timing ratios.

Detailed recorded values from this final session are in `acceptance-results.json`. They are transcribed from successful tool/test output; that JSON is a verification record, not an automatically refreshed output of future test runs.

## Compatibility checks that passed in both runs

### HTTPS and extension paths

The built reader remains a top-level `https:` document with actual PDF Text Layer text. Remote range, progressive, and buffered bridge message paths all completed, and the local `file://` handoff also passed with file access enabled in the disposable profile. The large range test received both `pdf-range-start` and subsequent `pdf-range-data` messages.

Range traffic includes Chrome's native PDF viewer traffic before takeover and PDF.js prefetch. The totals in the evidence must not be interpreted as reader-only first-paint transfer bytes or as proof that automatic prefetch is disabled.

### Native text interaction prerequisites

Chrome's actual mouse input path selected `PDF-GEMINI` from the built app. Switching to dark mode preserved the selected text and text node. Links remained present, and a form retained `Persisted form` and its focus after an appearance adjustment. Native caret hit-testing reached the Text Layer, including after a 90-degree rotation and text-layer rebuild. Selection remained connected during continuous scrolling and cache pressure.

Synthetic `mousedown`, `pointerdown`, and `contextmenu` events were not prevented in the tested text path. This is not a physical Force Touch test, nor a verification that an OS popup was displayed.

### Dark mode and layout

Original, Sepia, and Dark transitions retained text nodes where geometry did not change. An ordinary red raster image remained `[255, 0, 0]` in dark mode; the sampled dark background after the test appearance adjustment was `[36, 37, 40]`. A shading fixture selected the existing `pdfjs-page-colors` fallback. Output scale remained 2 in the simulated DPR-2 environment.

Vertical, horizontal, wrapped, and page modes resolved the expected current page with exactly one current-page marker. Odd/even spreads exposed `[3, 4]` / `[2, 3]` as expected. Queued cancellation returned `AbortError`, and high-priority work ran before normal-priority work after the active task completed.

The production reload test restored page 7, 150% zoom, and dark mode; its first sharp page commit was page 7 at scale 1.5.

## Human checks not performed in this session

| Requirement | Status | Required observation |
| --- | --- | --- |
| Gemini in Chrome reads the final revision | NOT RUN | On the actual trusted HTTPS deployment in the user's Gemini-enabled Chrome, share the reader tab and ask for a phrase from the actual rendered PDF text; repeat after a page/theme change. |
| macOS physical Force Click / native translation | NOT RUN | With the configured physical trackpad gesture, invoke the native lookup/translation UI on a PDF word; repeat in dark mode, after zoom, and after revisiting an evicted page. |
| Public HTTPS deployment / certificate validation | NOT RUN | Publish the current `dist/` through the normal deployment process and validate the deployed origin without certificate bypass. |

Use `public/gemini-text-layer-test.pdf` as the text fixture; expected phrase: `PDF-GEMINI-TEST-92841`. A visible DOM phrase, accessibility prerequisite, or successful native drag is not counted as a Gemini answer. Likewise, synthetic input is not counted as physical pressure.

Text remains lazy/cached rather than eagerly attached for every page. This acceptance does not assert that Gemini can read distant never-rendered pages, every page in a large document, or scanned/image-only PDFs.
