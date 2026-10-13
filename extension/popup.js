import { localizePage, msg } from "./i18n.js";

localizePage();

const enabled = document.querySelector("#enabled");
const autoWebPdf = document.querySelector("#auto-web-pdf");
const statusLabel = document.querySelector("#status-label");
const readerUrl = document.querySelector("#reader-url");
const fileAccess = document.querySelector("#file-access");
const openCurrent = document.querySelector("#open-current");
const settings = document.querySelector("#settings");
const hint = document.querySelector("#hint");
const statusDot = document.querySelector("#status-dot");

function showEnabled(isEnabled) {
  statusLabel.textContent = isEnabled ? msg("statusLocalOn") : msg("statusLocalOff");
  statusDot.dataset.state = isEnabled ? "on" : "off";
}

async function refresh() {
  const status = await chrome.runtime.sendMessage({
    type: "get-status",
  });

  enabled.checked = status.enabled;
  autoWebPdf.checked = status.autoWebPdf;
  showEnabled(status.enabled);
  readerUrl.textContent = status.readerUrl;
  readerUrl.title = status.readerUrl;
  fileAccess.textContent = status.fileAccess
    ? msg("fileAllowed")
    : msg("fileNeedsPermission");
  if (status.startupError) statusDot.dataset.state = "warn";
  hint.textContent = status.startupError
    ? msg("startupWarning", [String(status.startupError)])
    : status.fileAccess
      ? ""
      : msg("fileAccessHint");
}

enabled.addEventListener("change", async () => {
  const status = await chrome.runtime.sendMessage({
    type: "set-enabled",
    enabled: enabled.checked,
  });
  showEnabled(status.enabled);
});

autoWebPdf.addEventListener("change", async () => {
  const status = await chrome.runtime.sendMessage({
    type: "set-auto-web-pdf",
    enabled: autoWebPdf.checked,
  });
  autoWebPdf.checked = status.autoWebPdf;
});

settings.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({
    type: "open-options",
  });
  window.close();
});

openCurrent.addEventListener("click", async () => {
  hint.textContent = msg("opening");

  const result = await chrome.runtime.sendMessage({
    type: "open-current-pdf",
  });

  if (!result?.ok) {
    hint.textContent =
      result?.message || msg("openFailed");
    return;
  }

  window.close();
});

void refresh();
