import { adjustThemeColor } from "./colorMapping";
import {
  DEFAULT_PAGE_APPEARANCE,
  type PageAppearanceSettings,
} from "./pageAppearance";

export type PageTheme = "original" | "dark" | "sepia";

export interface PageThemeConfig {
  background: string;
  foreground: string;
  selection: string;
  usePerceptualCanvasMapping: boolean;
  saturation: number;
  temperature: number;
}

interface PageThemePreset {
  background: string;
  foreground: string;
  selection: string;
  usePerceptualCanvasMapping: boolean;
}

const PAGE_THEMES: Record<PageTheme, PageThemePreset> = {
  original: {
    background: "#ffffff",
    foreground: "#000000",
    selection: "rgba(26, 115, 232, 0.30)",
    usePerceptualCanvasMapping: false,
  },
  dark: {
    background: "#202124",
    foreground: "#e8eaed",
    selection: "rgba(138, 180, 248, 0.35)",
    usePerceptualCanvasMapping: true,
  },
  sepia: {
    background: "#f4ecd8",
    foreground: "#493e32",
    selection: "rgba(153, 102, 51, 0.30)",
    usePerceptualCanvasMapping: true,
  },
};

export function getPageThemeConfig(
  theme: PageTheme,
  appearance: PageAppearanceSettings = DEFAULT_PAGE_APPEARANCE,
): PageThemeConfig {
  const preset = PAGE_THEMES[theme];

  if (!preset.usePerceptualCanvasMapping) {
    return {
      ...preset,
      saturation: 100,
      temperature: 0,
    };
  }

  const backgroundSource =
    appearance.backgroundOverride ?? preset.background;
  const foregroundSource =
    appearance.foregroundOverride ?? preset.foreground;

  return {
    background: adjustThemeColor(backgroundSource, appearance),
    foreground: adjustThemeColor(foregroundSource, appearance),
    selection: preset.selection,
    usePerceptualCanvasMapping: true,
    saturation: appearance.saturation,
    temperature: appearance.temperature,
  };
}

export function getPageThemePreset(theme: PageTheme): PageThemePreset {
  return PAGE_THEMES[theme];
}
