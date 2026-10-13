# PDF handoff investigation summary

Earlier investigations identified macOS Chromium native-view timing as a potential contributor to crashes during early PDF navigation changes. Those reports were observational and did not establish a definitive native root cause.

The companion currently uses a new-tab handoff for local `file://` PDFs on macOS and avoids early main-frame redirect rules for web PDFs on that platform. A hidden extension bridge transfers local bytes to the ordinary reader page; web sources use Range or progressive streaming when available.

`tests/handoff-race-diagnostic.mjs` evaluates the actual service worker with simulated Chrome APIs. It examines handoff control flow, not the browser's native UI. Its results cannot prove a real macOS crash or recovery.

Original incident reports contain personal browser and device observations and are intentionally excluded from the public repository. They remain in the original local project directory. No personal browsing evidence is needed to build or run this project.
