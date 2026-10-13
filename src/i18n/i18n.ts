/*
 * Minimal UI localisation. English source strings are the keys, so markup and
 * code stay readable and an untranslated string simply falls back to English.
 * Templates use `{name}` placeholders.
 */
import { zhCN } from "./zh-CN";

export type Locale = "en" | "zh-CN";
export type LanguagePreference = "system" | Locale;

const STORAGE_KEY = "gemini-pdf-reader.language";
const TRANSLATED_ATTRIBUTES = ["title", "aria-label", "placeholder"] as const;
const SKIP_SELECTOR = "[data-i18n-skip], script, style, svg";

const dictionaries: Record<Locale, Record<string, string> | null> = {
  en: null,
  "zh-CN": zhCN,
};

let currentLocale: Locale = "en";
const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const listeners = new Set<(locale: Locale) => void>();

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Translate an English source string (or `{placeholder}` template). */
export function t(
  source: string,
  params?: Record<string, string | number>,
): string {
  const dictionary = dictionaries[currentLocale];
  const translated = dictionary?.[source] ?? source;
  return interpolate(translated, params);
}

export function getLocale(): Locale {
  return currentLocale;
}

export function getStoredLanguage(): LanguagePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "en" || value === "zh-CN" ? value : "system";
  } catch {
    return "system";
  }
}

export function resolveLocale(preference: LanguagePreference): Locale {
  if (preference !== "system") {
    return preference;
  }
  const languages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  for (const language of languages) {
    const lower = language.toLowerCase();
    if (lower.startsWith("zh")) return "zh-CN";
    if (lower.startsWith("en")) return "en";
  }
  return "en";
}

function localizeTextNode(node: Text): void {
  const original = originalText.get(node) ?? node.data;
  originalText.set(node, original);
  const key = normalize(original);

  if (!key) {
    return;
  }

  const translated = t(key);
  const leading = original.match(/^\s*/)?.[0] ?? "";
  const trailing = original.match(/\s*$/)?.[0] ?? "";
  const next = translated === key ? original : leading + translated + trailing;

  if (node.data !== next) {
    node.data = next;
  }
}

function localizeAttributes(element: Element): void {
  let originals = originalAttributes.get(element);

  for (const name of TRANSLATED_ATTRIBUTES) {
    const stored = originals?.get(name);
    const value = stored ?? element.getAttribute(name);

    if (!value) {
      continue;
    }

    if (!originals) {
      originals = new Map();
      originalAttributes.set(element, originals);
    }
    originals.set(name, value);
    element.setAttribute(name, t(normalize(value)));
  }
}

/**
 * Translate static chrome in place. Subtrees marked `data-i18n-skip`
 * (document content, generated lists) are left alone; the code that fills
 * them uses `t()` directly.
 */
export function localizeDocument(root: Element = document.body): void {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node instanceof Element && node.matches(SKIP_SELECTOR)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  if (root.matches(SKIP_SELECTOR)) {
    return;
  }
  localizeAttributes(root);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text) {
      localizeTextNode(node);
    } else if (node instanceof Element) {
      localizeAttributes(node);
    }
  }
}

export function applyLanguage(preference: LanguagePreference): Locale {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Private mode: language still applies to this session.
  }
  currentLocale = resolveLocale(preference);
  document.documentElement.lang = currentLocale === "zh-CN" ? "zh-CN" : "en";
  localizeDocument();
  listeners.forEach((listener) => listener(currentLocale));
  return currentLocale;
}

export function onLocaleChange(listener: (locale: Locale) => void): void {
  listeners.add(listener);
}
