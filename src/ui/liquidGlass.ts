/*
 * Liquid-glass refraction for floating chrome.
 *
 * Chromium can apply an SVG filter to an element's backdrop
 * (`backdrop-filter: url(#id)`). For every glass element we generate a
 * displacement map matching its size and corner radius: pixels inside a thin
 * bezel along the rounded edge sample the backdrop from further inside the
 * shape, which bends the document behind the edge like a convex lens. Other
 * browsers keep the plain CSS frosted fallback.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

interface GlassEntry {
  filter: SVGFilterElement;
  key: string;
  /** Displacement map for the current size; reused when only tuning changes. */
  mapKey: string;
  mapUrl: string;
}

export interface LiquidGlassTuning {
  /** 0–1: how far the rim bends the backdrop (0.5 = default). */
  refraction: number;
  /** 0–1: backdrop blur under the glass (0 = clear, 1 = heavily frosted). */
  frost: number;
}

export interface LiquidGlassController {
  readonly supported: boolean;
  /** Track additional elements (e.g. panels created later). */
  observe(element: HTMLElement): void;
  setEnabled(enabled: boolean): void;
  setTuning(tuning: LiquidGlassTuning): void;
}

function isChromium(): boolean {
  const brands = (
    navigator as Navigator & {
      userAgentData?: { brands?: Array<{ brand: string }> };
    }
  ).userAgentData?.brands;

  if (brands?.some((entry) => /Chromium|Google Chrome|Microsoft Edge/.test(entry.brand))) {
    return true;
  }

  return /Chrome\/\d+/.test(navigator.userAgent) && !/Firefox|FxiOS/.test(navigator.userAgent);
}

function smootherStep(value: number): number {
  const x = Math.min(1, Math.max(0, value));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Encodes per-pixel displacement into R (x) and G (y); 128 = no shift. */
function buildDisplacementMap(
  width: number,
  height: number,
  radius: number,
  bezel: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    return "";
  }

  const image = context.createImageData(width, height);
  const data = image.data;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const innerX = halfWidth - radius;
  const innerY = halfHeight - radius;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const px = x + 0.5 - halfWidth;
      const py = y + 0.5 - halfHeight;
      const qx = Math.abs(px) - innerX;
      const qy = Math.abs(py) - innerY;
      const outsideX = Math.max(qx, 0);
      const outsideY = Math.max(qy, 0);
      const cornerLength = Math.hypot(outsideX, outsideY);
      // Signed distance to the rounded-rectangle edge (negative inside).
      const distance = cornerLength + Math.min(Math.max(qx, qy), 0) - radius;
      const depth = -distance;

      let dx = 0;
      let dy = 0;

      if (depth > 0 && depth < bezel) {
        // Outward normal of the nearest edge.
        let nx: number;
        let ny: number;

        if (qx > 0 && qy > 0 && cornerLength > 0) {
          nx = (outsideX / cornerLength) * Math.sign(px);
          ny = (outsideY / cornerLength) * Math.sign(py);
        } else if (qx > qy) {
          nx = Math.sign(px);
          ny = 0;
        } else {
          nx = 0;
          ny = Math.sign(py);
        }

        // Strongest at the rim, fading to zero at the bezel's inner edge.
        const strength = smootherStep(1 - depth / bezel);
        // Sample inward: the rim magnifies content from inside the shape.
        dx = -nx * strength;
        dy = -ny * strength;
      }

      const offset = (y * width + x) * 4;
      data[offset] = Math.round(128 + dx * 127);
      data[offset + 1] = Math.round(128 + dy * 127);
      data[offset + 2] = 128;
      data[offset + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

function createFilter(
  defs: SVGDefsElement,
  id: string,
): SVGFilterElement {
  const filter = document.createElementNS(SVG_NS, "filter");
  filter.id = id;
  // Keep the default (bounding-box) filter region: Chromium resolves a
  // userSpaceOnUse region for backdrop filters elsewhere and renders nothing.
  // Primitive coordinates are user space with the origin at the element's
  // border-box corner, so the map below lines up with the element.
  filter.setAttribute("color-interpolation-filters", "sRGB");

  const blur = document.createElementNS(SVG_NS, "feGaussianBlur");
  blur.setAttribute("in", "SourceGraphic");
  blur.setAttribute("result", "frost");

  const map = document.createElementNS(SVG_NS, "feImage");
  map.setAttribute("x", "0");
  map.setAttribute("y", "0");
  map.setAttribute("preserveAspectRatio", "none");
  map.setAttribute("result", "map");

  const displace = document.createElementNS(SVG_NS, "feDisplacementMap");
  displace.setAttribute("in", "frost");
  displace.setAttribute("in2", "map");
  displace.setAttribute("xChannelSelector", "R");
  displace.setAttribute("yChannelSelector", "G");
  displace.setAttribute("result", "bent");

  const saturate = document.createElementNS(SVG_NS, "feColorMatrix");
  saturate.setAttribute("in", "bent");
  saturate.setAttribute("type", "saturate");
  saturate.setAttribute("values", "1.7");

  filter.append(blur, map, displace, saturate);
  defs.append(filter);
  return filter;
}

function bezelFor(width: number, height: number): number {
  return Math.max(6, Math.min(16, Math.min(width, height) * 0.38));
}

function updateFilter(
  filter: SVGFilterElement,
  width: number,
  height: number,
  url: string,
  tuning: LiquidGlassTuning,
): void {
  const shortSide = Math.min(width, height);
  const maxShift =
    Math.max(6, Math.min(18, shortSide * 0.36)) * tuning.refraction * 2;
  // Large panels need more frost than small capsules to keep text legible.
  const blur = shortSide > 80 ? 2 + 12 * tuning.frost : 0.3 + 4.2 * tuning.frost;

  const [blurNode, mapNode, displaceNode] = Array.from(filter.children);
  if (!blurNode || !mapNode || !displaceNode) {
    return;
  }
  blurNode.setAttribute("stdDeviation", String(blur));
  mapNode.setAttribute("width", String(width));
  mapNode.setAttribute("height", String(height));
  mapNode.setAttribute("href", url);
  // feDisplacementMap shifts by scale * (channel - 0.5); channels span ±0.5.
  displaceNode.setAttribute("scale", String(maxShift * 2));
}

export function installLiquidGlass(selector: string): LiquidGlassController {
  const reducedTransparency = window.matchMedia(
    "(prefers-reduced-transparency: reduce)",
  );
  const supported =
    isChromium() &&
    typeof ResizeObserver !== "undefined" &&
    CSS.supports("backdrop-filter", "url(#liquid-glass)");

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.style.pointerEvents = "none";
  const defs = document.createElementNS(SVG_NS, "defs");
  svg.append(defs);

  const entries = new Map<HTMLElement, GlassEntry>();
  const pending = new Set<HTMLElement>();
  let enabled = true;
  let tuning: LiquidGlassTuning = { refraction: 0.5, frost: 0.5 };
  let frame: number | null = null;
  let counter = 0;

  const active = (): boolean =>
    supported && enabled && !reducedTransparency.matches;

  const render = (element: HTMLElement): void => {
    const rect = element.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);

    if (!active() || width < 8 || height < 8) {
      return;
    }

    const radius = Math.min(
      parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0,
      width / 2,
      height / 2,
    );
    const mapKey = `${width}x${height}r${radius}`;
    const key = `${mapKey}/${tuning.refraction}/${tuning.frost}`;
    let entry = entries.get(element);

    // Chromium caches backdrop filter output per filter id, so any change
    // gets a fresh filter element instead of an in-place update. The costly
    // displacement map is only rebuilt when the element's geometry changes.
    if (!entry || entry.key !== key) {
      const mapUrl =
        entry && entry.mapKey === mapKey
          ? entry.mapUrl
          : buildDisplacementMap(width, height, radius, bezelFor(width, height));
      entry?.filter.remove();
      counter += 1;
      entry = {
        filter: createFilter(defs, `liquid-glass-${counter}`),
        key,
        mapKey,
        mapUrl,
      };
      updateFilter(entry.filter, width, height, mapUrl, tuning);
      entries.set(element, entry);
    }

    element.style.backdropFilter = `url(#${entry.filter.id})`;
    element.classList.add("liquid-glass");
  };

  const flush = (): void => {
    frame = null;
    for (const element of pending) {
      render(element);
    }
    pending.clear();
  };

  const schedule = (element: HTMLElement): void => {
    pending.add(element);
    frame ??= window.requestAnimationFrame(flush);
  };

  const resizeObserver = supported
    ? new ResizeObserver((records) => {
        for (const record of records) {
          schedule(record.target as HTMLElement);
        }
      })
    : null;

  const clear = (): void => {
    for (const element of entries.keys()) {
      element.style.backdropFilter = "";
      element.classList.remove("liquid-glass");
    }
  };

  const observe = (element: HTMLElement): void => {
    if (!resizeObserver) {
      return;
    }
    resizeObserver.observe(element);
    schedule(element);
  };

  if (supported) {
    document.body.append(svg);
    document.querySelectorAll<HTMLElement>(selector).forEach(observe);
    reducedTransparency.addEventListener("change", () => {
      if (active()) {
        entries.forEach((_entry, element) => schedule(element));
      } else {
        clear();
      }
    });
  }

  return {
    supported,
    observe,
    setTuning(next: LiquidGlassTuning) {
      tuning = {
        refraction: Math.min(1, Math.max(0, next.refraction)),
        frost: Math.min(1, Math.max(0, next.frost)),
      };
      if (active()) {
        entries.forEach((_entry, element) => schedule(element));
      }
    },
    setEnabled(next: boolean) {
      enabled = next;
      document.documentElement.dataset.liquidGlass = String(active());

      if (!supported) {
        return;
      }

      if (active()) {
        document.querySelectorAll<HTMLElement>(selector).forEach(schedule);
        entries.forEach((_entry, element) => schedule(element));
      } else {
        clear();
      }
    },
  };
}
