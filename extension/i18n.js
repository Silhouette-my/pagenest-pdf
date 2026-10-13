/* Fills [data-i18n] text and [data-i18n-placeholder] attributes from _locales. */
export function msg(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

export function localizePage() {
  document.documentElement.lang = chrome.i18n.getUILanguage();

  for (const element of document.querySelectorAll("[data-i18n]")) {
    const text = chrome.i18n.getMessage(element.dataset.i18n);
    if (text) element.textContent = text;
  }

  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
    const text = chrome.i18n.getMessage(element.dataset.i18nPlaceholder);
    if (text) element.setAttribute("placeholder", text);
  }
}
