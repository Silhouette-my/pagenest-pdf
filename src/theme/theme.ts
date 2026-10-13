export type UiTheme = "system" | "light" | "dark";

const STORAGE_KEY = "gemini-pdf-reader.ui-theme";

export function getStoredUiTheme(): UiTheme {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

export function applyUiTheme(theme: UiTheme): void {
  document.documentElement.dataset.uiTheme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
}
