export type RgbColor = {
  r: number;
  g: number;
  b: number;
};

const AMBIENT_COLOR_INDEX_KEY = "literary-canvas-ambient-color-index";

const ambientFallbackPalette: RgbColor[] = [
  { r: 239, g: 68, b: 68 },
  { r: 234, g: 179, b: 8 },
  { r: 6, g: 182, b: 212 },
  { r: 59, g: 130, b: 246 },
  { r: 217, g: 70, b: 239 },
  { r: 244, g: 114, b: 182 },
  { r: 249, g: 115, b: 22 },
  { r: 34, g: 197, b: 94 },
];

function clampColor(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function colorToRgbValue(color: RgbColor) {
  return `${color.r}, ${color.g}, ${color.b}`;
}

function rgbToHsl(color: RgbColor) {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l: lightness };
  }

  const delta = max - min;
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue =
    max === r
      ? (g - b) / delta + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;

  return { h: hue / 6, s: saturation, l: lightness };
}

function hslToRgb(h: number, s: number, l: number): RgbColor {
  if (s === 0) {
    const value = clampColor(l * 255);
    return { r: value, g: value, b: value };
  }

  const hueToRgb = (p: number, q: number, t: number) => {
    let next = t;
    if (next < 0) next += 1;
    if (next > 1) next -= 1;
    if (next < 1 / 6) return p + (q - p) * 6 * next;
    if (next < 1 / 2) return q;
    if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: clampColor(hueToRgb(p, q, h + 1 / 3) * 255),
    g: clampColor(hueToRgb(p, q, h) * 255),
    b: clampColor(hueToRgb(p, q, h - 1 / 3) * 255),
  };
}

function getInterfaceAccent(color: RgbColor): RgbColor {
  const hsl = rgbToHsl(color);
  return hslToRgb(
    hsl.h,
    clampUnit(Math.max(hsl.s, 0.62)),
    clampUnit(Math.min(Math.max(hsl.l, 0.46), 0.58))
  );
}

export function applyAmbientColor(color: RgbColor) {
  if (typeof document === "undefined") return;
  const ambientValue = colorToRgbValue(color);
  const accentValue = colorToRgbValue(getInterfaceAccent(color));
  const foreground = "#FFFFFF";
  const root = document.documentElement.style;

  root.setProperty("--ambient-rgb", ambientValue);
  root.setProperty("--flare-rgb", ambientValue);
  root.setProperty("--accent", `rgb(${accentValue})`);
  root.setProperty("--primary", `rgb(${accentValue})`);
  root.setProperty("--ring", `rgb(${accentValue})`);
  root.setProperty("--sidebar-accent", `rgb(${accentValue})`);
  root.setProperty("--sidebar-ring", `rgb(${accentValue})`);
  root.setProperty("--accent-foreground", foreground);
  root.setProperty("--primary-foreground", foreground);
  root.setProperty("--sidebar-accent-foreground", foreground);
}

export function getAppliedAmbientColor(): RgbColor | null {
  if (typeof document === "undefined") return null;
  const value = document.documentElement.style
    .getPropertyValue("--flare-rgb")
    .trim();
  const [r, g, b] = value.split(",").map(part => Number(part.trim()));
  if (![r, g, b].every(Number.isFinite)) return null;
  return { r: clampColor(r), g: clampColor(g), b: clampColor(b) };
}

export function getNextFallbackAmbientColor() {
  if (typeof window === "undefined") {
    return (
      ambientFallbackPalette[
        Math.floor(Math.random() * ambientFallbackPalette.length)
      ] ?? ambientFallbackPalette[0]
    );
  }

  try {
    const stored = Number(window.localStorage.getItem(AMBIENT_COLOR_INDEX_KEY));
    const nextIndex = Number.isFinite(stored)
      ? (stored + 1) % ambientFallbackPalette.length
      : Math.floor(Math.random() * ambientFallbackPalette.length);

    window.localStorage.setItem(AMBIENT_COLOR_INDEX_KEY, String(nextIndex));
    return ambientFallbackPalette[nextIndex] ?? ambientFallbackPalette[0];
  } catch {
    return (
      ambientFallbackPalette[
        Math.floor(Math.random() * ambientFallbackPalette.length)
      ] ?? ambientFallbackPalette[0]
    );
  }
}

export function initializeFallbackAmbientColor() {
  const color = getNextFallbackAmbientColor();
  applyAmbientColor(color);
  return color;
}

export function extractDominantCoverColor(
  source: string
): Promise<RgbColor | null> {
  return new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const size = 48;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          resolve(null);
          return;
        }

        context.drawImage(image, 0, 0, size, size);
        const pixels = context.getImageData(0, 0, size, size).data;
        const buckets = new Map<
          string,
          { weight: number; r: number; g: number; b: number; count: number }
        >();
        const fallback = { r: 0, g: 0, b: 0, count: 0 };

        for (let i = 0; i < pixels.length; i += 16) {
          const alpha = pixels[i + 3];
          if (alpha < 128) continue;

          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const brightness = (r + g + b) / 3;
          const saturation = max - min;

          fallback.r += r;
          fallback.g += g;
          fallback.b += b;
          fallback.count += 1;

          if (brightness < 24 || brightness > 238 || saturation < 14) continue;

          const key = `${Math.round(r / 24) * 24}-${Math.round(g / 24) * 24}-${Math.round(b / 24) * 24}`;
          const weight = Math.max(
            1,
            saturation * 1.25 + Math.min(brightness, 190) * 0.08
          );
          const bucket = buckets.get(key) ?? {
            weight: 0,
            r: 0,
            g: 0,
            b: 0,
            count: 0,
          };
          bucket.weight += weight;
          bucket.r += r;
          bucket.g += g;
          bucket.b += b;
          bucket.count += 1;
          buckets.set(key, bucket);
        }

        const dominant = Array.from(buckets.values()).sort(
          (a, b) => b.weight - a.weight
        )[0];
        const sourceColor = dominant?.count
          ? dominant
          : fallback.count
            ? fallback
            : null;
        resolve(
          sourceColor
            ? {
                r: clampColor(sourceColor.r / sourceColor.count),
                g: clampColor(sourceColor.g / sourceColor.count),
                b: clampColor(sourceColor.b / sourceColor.count),
              }
            : null
        );
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = source;
  });
}
