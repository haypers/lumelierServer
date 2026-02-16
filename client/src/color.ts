export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function normalizeHex(input: string): string | null {
  const s = input.trim();
  if (!s.startsWith("#")) return null;
  const hex = s.slice(1);
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return (
      "#" +
      hex
        .split("")
        .map((c) => c + c)
        .join("")
        .toLowerCase()
    );
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return ("#" + hex).toLowerCase();
  return null;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const n = normalizeHex(hex);
  if (!n) return null;
  const raw = n.slice(1);
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return { r, g, b };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to2 = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = clamp(r, 0, 255) / 255;
  const gn = clamp(g, 0, 255) / 255;
  const bn = clamp(b, 0, 255) / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case rn:
        h = ((gn - bn) / d) % 6;
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s: s * 100, l: l * 100 };
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hn = ((h % 360) + 360) % 360;
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;

  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = ln - c / 2;

  let rp = 0,
    gp = 0,
    bp = 0;
  if (hn < 60) [rp, gp, bp] = [c, x, 0];
  else if (hn < 120) [rp, gp, bp] = [x, c, 0];
  else if (hn < 180) [rp, gp, bp] = [0, c, x];
  else if (hn < 240) [rp, gp, bp] = [0, x, c];
  else if (hn < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];

  return {
    r: (rp + m) * 255,
    g: (gp + m) * 255,
    b: (bp + m) * 255,
  };
}

/**
 * Brightness from 0..100 where 0=black, 100=white.
 * Uses a perceptual weighted sum so "super bright" colors tend toward ~90+.
 */
export function getBrightness0to100(hexColor: string): number {
  const rgb = hexToRgb(hexColor);
  if (!rgb) return 0;
  const { r, g, b } = rgb;
  const brightness01 = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return clamp(brightness01 * 100, 0, 100);
}

export function adjustHexLightness(hexColor: string, deltaLightness: number): string {
  const rgb = hexToRgb(hexColor);
  if (!rgb) return "#000000";
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const nextL = clamp(hsl.l + deltaLightness, 0, 100);
  const nextRgb = hslToRgb(hsl.h, hsl.s, nextL);
  return rgbToHex(nextRgb.r, nextRgb.g, nextRgb.b);
}

/**
 * Given a displayed hex color, returns a faint UI text color with similar hue,
 * shifted ±20 lightness steps for readability.
 */
export function getFaintUiTextColor(hexColor: string): string {
  const brightness = getBrightness0to100(hexColor);
  return brightness >= 40
    ? adjustHexLightness(hexColor, -20) // 20 steps darker
    : adjustHexLightness(hexColor, 20); // 20 steps brighter
}
