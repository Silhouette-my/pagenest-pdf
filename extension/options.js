import { localizePage, msg } from "./i18n.js";

localizePage();

const DEFAULT_SETTINGS = {
  enabled: true,
  autoWebPdf: false,
  readerUrl: "http://127.0.0.1:5173/",
};

const form = document.querySelector("#settings-form");
const readerUrl = document.querySelector("#reader-url");
const enabled = document.querySelector("#enabled");
const autoWebPdf = document.querySelector("#auto-web-pdf");
const saveStatus = document.querySelector("#save-status");
const fileAccess = document.querySelector("#file-access");
const fileAccessDot = document.querySelector("#file-access-dot");

async function initialize() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  readerUrl.value = settings.readerUrl;
  enabled.checked = Boolean(settings.enabled);
  autoWebPdf.checked = Boolean(settings.autoWebPdf);

  const allowed = await chrome.extension.isAllowedFileSchemeAccess();
  fileAccess.textContent = allowed ? msg("fileAccessOn") : msg("fileAccessOff");
  fileAccessDot.dataset.state = allowed ? "on" : "warn";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  let normalized;

  try {
    const url = new URL(readerUrl.value);

    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Reader URL must use HTTP or HTTPS.");
    }

    url.hash = "";
    normalized = url.href;
  } catch {
    saveStatus.value = msg("invalidUrl");
    saveStatus.dataset.state = "error";
    return;
  }

  await chrome.storage.local.set({
    enabled: enabled.checked,
    autoWebPdf: autoWebPdf.checked,
    readerUrl: normalized,
  });

  readerUrl.value = normalized;
  saveStatus.value = msg("saved");
  saveStatus.dataset.state = "ok";
});

void initialize();
