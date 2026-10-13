export interface PageAppearanceSettings {
  brightness: number;
  contrast: number;
  temperature: number;
  saturation: number;
  backgroundOverride: string | null;
  foregroundOverride: string | null;
}

export const DEFAULT_PAGE_APPEARANCE: PageAppearanceSettings = {
  brightness: 100,
  contrast: 100,
  temperature: 0,
  saturation: 100,
  backgroundOverride: null,
  foregroundOverride: null,
};

export function normalizePageAppearance(
  value: Partial<PageAppearanceSettings> | null | undefined,
): PageAppearanceSettings {
  return {
    brightness: clamp(value?.brightness ?? 100, 70, 130),
    contrast: clamp(value?.contrast ?? 100, 70, 140),
    temperature: clamp(value?.temperature ?? 0, -100, 100),
    saturation: clamp(value?.saturation ?? 100, 0, 150),
    backgroundOverride: normalizeHex(value?.backgroundOverride),
    foregroundOverride: normalizeHex(value?.foregroundOverride),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : Math.min(max, Math.max(min, 100));
}

function normalizeHex(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : null;
}
