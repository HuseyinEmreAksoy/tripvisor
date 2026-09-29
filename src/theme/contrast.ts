/**
 * WCAG 2.x contrast helpers (M5 Y2.4). Used by the token contrast test and
 * available to components that need to pick a readable label colour.
 * Pure functions; accepts `#RGB`, `#RRGGBB` and `rgba(r, g, b, a)`.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(input: string): Rgba {
  const s = input.trim();
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (!m) throw new Error(`Unsupported colour: ${input}`);
  const parts = m[1]!.split(',').map((p) => Number(p.trim()));
  return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 };
}

/** Source-over composite of `top` onto an opaque `bottom`. */
export function composite(top: string, bottom: string): Rgba {
  const t = parseColor(top);
  const b = parseColor(bottom);
  const a = t.a;
  return {
    r: t.r * a + b.r * (1 - a),
    g: t.g * a + b.g * (1 - a),
    b: t.b * a + b.b * (1 - a),
    a: 1,
  };
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(color: string | Rgba): number {
  const c = typeof color === 'string' ? parseColor(color) : color;
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/**
 * Contrast ratio of `fg` over `bg`. Translucent colours are composited:
 * `fg` onto `bg`, and `bg` onto `base` (the page colour underneath).
 */
export function contrastRatio(fg: string, bg: string, base = '#FFFFFF'): number {
  const bgSolid = composite(bg, base);
  const bgHex = toHex(bgSolid);
  const fgSolid = composite(fg, bgHex);
  const l1 = relativeLuminance(fgSolid);
  const l2 = relativeLuminance(bgSolid);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function toHex(c: Rgba): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}
