export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  a: number;
}

interface Lab {
  l: number;
  a: number;
  b: number;
}

const parsedColorCache = new Map<string, Rgba | null>();

const NAMED_COLORS: Record<string, Rgba> = {
  black: { r: 0, g: 0, b: 0, a: 1 },
  blue: { r: 0, g: 0, b: 255, a: 1 },
  gray: { r: 128, g: 128, b: 128, a: 1 },
  grey: { r: 128, g: 128, b: 128, a: 1 },
  green: { r: 0, g: 128, b: 0, a: 1 },
  red: { r: 255, g: 0, b: 0, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  white: { r: 255, g: 255, b: 255, a: 1 },
};

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function srgbToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const clamped = clampUnit(value);
  const normalized =
    clamped <= 0.0031308
      ? clamped * 12.92
      : 1.055 * clamped ** (1 / 2.4) - 0.055;

  return clampByte(normalized * 255);
}

function xyzPivot(value: number): number {
  const delta = 6 / 29;
  return value > delta ** 3
    ? Math.cbrt(value)
    : value / (3 * delta ** 2) + 4 / 29;
}

function inverseXyzPivot(value: number): number {
  const delta = 6 / 29;
  return value > delta
    ? value ** 3
    : 3 * delta ** 2 * (value - 4 / 29);
}

function rgbToLab(rgb: Rgb): Lab {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);

  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;

  const fx = xyzPivot(x);
  const fy = xyzPivot(y);
  const fz = xyzPivot(z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function labToRgb(lab: Lab): Rgb {
  const fy = (lab.l + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;

  const x = 0.95047 * inverseXyzPivot(fx);
  const y = inverseXyzPivot(fy);
  const z = 1.08883 * inverseXyzPivot(fz);

  const r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const g = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const b = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;

  return {
    r: linearToSrgb(r),
    g: linearToSrgb(g),
    b: linearToSrgb(b),
  };
}

function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * srgbToLinear(rgb.r) +
    0.7152 * srgbToLinear(rgb.g) +
    0.0722 * srgbToLinear(rgb.b)
  );
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseHex(value: string): Rgba | null {
  const hex = value.slice(1);

  if (hex.length === 3 || hex.length === 4) {
    const [r, g, b, a = "f"] = [...hex];

    if (r === undefined || g === undefined || b === undefined) {
      return null;
    }

    return {
      r: Number.parseInt(r + r, 16),
      g: Number.parseInt(g + g, 16),
      b: Number.parseInt(b + b, 16),
      a: Number.parseInt(a + a, 16) / 255,
    };
  }

  if (hex.length === 6 || hex.length === 8) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }

  return null;
}

function parseRgbComponent(value: string): number | null {
  if (value.endsWith("%")) {
    const percent = Number(value.slice(0, -1));
    return Number.isFinite(percent) ? clampByte((percent / 100) * 255) : null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? clampByte(numeric) : null;
}

function parseAlphaComponent(value: string | undefined): number | null {
  if (value === undefined) {
    return 1;
  }

  if (value.endsWith("%")) {
    const percent = Number(value.slice(0, -1));
    return Number.isFinite(percent) ? clampUnit(percent / 100) : null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? clampUnit(numeric) : null;
}

function parseRgbFunction(value: string): Rgba | null {
  const match = value.match(/^rgba?\((.*)\)$/);
  if (!match?.[1]) {
    return null;
  }

  const body = match[1].trim();
  let colorParts: string[];
  let alphaPart: string | undefined;

  if (body.includes(",")) {
    const parts = body.split(",").map((part) => part.trim());
    colorParts = parts.slice(0, 3);
    alphaPart = parts[3];
  } else {
    const [colors, alpha] = body.split("/").map((part) => part.trim());
    colorParts = colors?.split(/\s+/) ?? [];
    alphaPart = alpha;
  }

  if (colorParts.length !== 3) {
    return null;
  }

  const red = parseRgbComponent(colorParts[0] ?? "");
  const green = parseRgbComponent(colorParts[1] ?? "");
  const blue = parseRgbComponent(colorParts[2] ?? "");
  const alpha = parseAlphaComponent(alphaPart);

  if (red === null || green === null || blue === null || alpha === null) {
    return null;
  }

  return { r: red, g: green, b: blue, a: alpha };
}

export function parseCssColor(value: string): Rgba | null {
  const cacheKey = value.trim().toLowerCase();

  if (parsedColorCache.has(cacheKey)) {
    return parsedColorCache.get(cacheKey) ?? null;
  }

  const named = NAMED_COLORS[cacheKey];
  const parsed = named
    ? { ...named }
    : cacheKey.startsWith("#")
      ? parseHex(cacheKey)
      : parseRgbFunction(cacheKey);

  const valid =
    parsed &&
    Number.isFinite(parsed.r) &&
    Number.isFinite(parsed.g) &&
    Number.isFinite(parsed.b) &&
    Number.isFinite(parsed.a)
      ? parsed
      : null;

  parsedColorCache.set(cacheKey, valid);
  return valid;
}

export function parseHexColor(value: string): Rgb {
  const parsed = parseCssColor(value);

  if (!parsed) {
    throw new Error(`Invalid theme color: ${value}`);
  }

  return { r: parsed.r, g: parsed.g, b: parsed.b };
}

export interface ThemeColorAdjustments {
  brightness: number;
  contrast: number;
  temperature: number;
  saturation: number;
}

export function adjustThemeColor(
  value: string,
  adjustments: ThemeColorAdjustments,
): string {
  const source = parseCssColor(value);

  if (!source) {
    return value;
  }

  const lab = rgbToLab(source);
  const brightnessOffset = (adjustments.brightness - 100) * 0.18;
  const contrastScale = adjustments.contrast / 100;
  const saturationScale = adjustments.saturation / 100;
  const temperature = adjustments.temperature;

  const adjustedLab: Lab = {
    l: Math.max(
      0,
      Math.min(
        100,
        50 + (lab.l - 50) * contrastScale + brightnessOffset,
      ),
    ),
    a: lab.a * saturationScale + temperature * 0.035,
    b: lab.b * saturationScale + temperature * 0.11,
  };

  const rgb = labToRgb(adjustedLab);

  return formatRgba({
    ...rgb,
    a: source.a,
  });
}

function formatRgba(color: Rgba): string {
  if (color.a >= 0.999) {
    return `rgb(${color.r} ${color.g} ${color.b})`;
  }

  return `rgb(${color.r} ${color.g} ${color.b} / ${color.a.toFixed(3)})`;
}

export interface PerceptualColorMapperOptions {
  background: string;
  foreground: string;
  minimumChromaticContrast?: number;
  saturation?: number;
  temperature?: number;
}

export function createPerceptualColorMapper(
  options: PerceptualColorMapperOptions,
): (color: string) => string {
  const background = parseHexColor(options.background);
  const foreground = parseHexColor(options.foreground);
  const backgroundLab = rgbToLab(background);
  const foregroundLab = rgbToLab(foreground);
  const minimumContrast = options.minimumChromaticContrast ?? 3;
  const saturationScale = (options.saturation ?? 100) / 100;
  const temperature = options.temperature ?? 0;
  const cache = new Map<string, string>();

  return (value: string): string => {
    const cached = cache.get(value);
    if (cached !== undefined) {
      return cached;
    }

    const source = parseCssColor(value);

    if (!source || source.a === 0) {
      cache.set(value, value);
      return value;
    }

    const sourceLab = rgbToLab(source);
    const lightnessPosition = Math.max(0, Math.min(1, sourceLab.l / 100));
    const mappedLightness =
      foregroundLab.l +
      (backgroundLab.l - foregroundLab.l) * lightnessPosition;

    const chroma = Math.hypot(sourceLab.a, sourceLab.b);
    let mappedLab: Lab;

    if (chroma < 10) {
      mappedLab = {
        l: mappedLightness,
        a:
          foregroundLab.a +
          (backgroundLab.a - foregroundLab.a) * lightnessPosition,
        b:
          foregroundLab.b +
          (backgroundLab.b - foregroundLab.b) * lightnessPosition,
      };
    } else {
      const chromaScale = Math.min(1, 55 / chroma);
      mappedLab = {
        l: mappedLightness,
        a:
          sourceLab.a * chromaScale * saturationScale +
          temperature * 0.035,
        b:
          sourceLab.b * chromaScale * saturationScale +
          temperature * 0.11,
      };

      let mappedRgb = labToRgb(mappedLab);

      if (contrastRatio(mappedRgb, background) < minimumContrast) {
        for (let step = 1; step <= 8; step += 1) {
          const amount = step / 8;
          const candidateLab: Lab = {
            l: mappedLab.l + (foregroundLab.l - mappedLab.l) * amount,
            a: mappedLab.a,
            b: mappedLab.b,
          };
          const candidateRgb = labToRgb(candidateLab);

          if (contrastRatio(candidateRgb, background) >= minimumContrast) {
            mappedLab = candidateLab;
            mappedRgb = candidateRgb;
            break;
          }
        }
      }
    }

    const mappedRgb = labToRgb(mappedLab);
    const mapped = formatRgba({
      ...mappedRgb,
      a: source.a,
    });

    cache.set(value, mapped);
    return mapped;
  };
}
