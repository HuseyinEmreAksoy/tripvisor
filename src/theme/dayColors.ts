/**
 * Day colours — the ONE source of truth (M5 Y2.4).
 *
 * Every surface that encodes "which day" uses these: map pins and route legs
 * (all three map providers), the itinerary rail, day chips and headers, the
 * Today timeline, analytics, the public share page, and (Wave 3) the memories
 * timeline. Import from `@/theme` (or `@/components/Map`, which re-exports
 * this module so map code stays theme-free).
 *
 * One palette serves both themes. Every colour sits at relative luminance
 * 0.16–0.18, which gives:
 *   - white label text on the fill ≥ 4.5:1 (pin numbers, day badges),
 *   - the fill against light surfaces (paper, white card, muted well) ≥ 3:1,
 *   - the fill against dark surfaces (ink bg and raised card) ≥ 3:1,
 * so rails, dots and pins clear WCAG 1.4.11 in both themes. The pairs are
 * asserted in `src/theme/__tests__/contrast.test.ts`.
 *
 * Rules for consumers:
 *   - Day colours are for fills, strokes, rails and dots. Never use a day
 *     colour as TEXT colour on a surface; label the day with `colors.text`
 *     next to a day-colour dot/badge instead.
 *   - Text on a day-colour fill uses `ON_DAY_COLOR`.
 *   - Soft backgrounds use `dayTint(i, theme.name)`.
 *
 * The hue order keeps neighbouring days far apart (blue, ochre, green,
 * magenta, violet, ocean, red); days past 7 wrap.
 */

/** Day 1..7 fills; later days wrap. */
export const DAY_COLORS = [
  '#2F6BDE', // blue
  '#B45F06', // ochre
  '#16875A', // green
  '#C93A82', // magenta
  '#7A55E0', // violet
  '#0E7FA8', // ocean
  '#D0393F', // red
] as const;

/** Unscheduled ("Ideas") places and neutral route connectors (walk steps). */
export const DAY_NEUTRAL = '#78716A';

/** Label / glyph colour on any `dayColor()` fill (≥ 4.5:1 on every entry). */
export const ON_DAY_COLOR = '#FFFFFF';

/** The fill colour for a 0-based day index; null / negative → neutral. */
export function dayColor(dayIndex: number | null | undefined): string {
  if (dayIndex == null || dayIndex < 0 || !Number.isFinite(dayIndex)) return DAY_NEUTRAL;
  return DAY_COLORS[Math.floor(dayIndex) % DAY_COLORS.length]!;
}

/**
 * A soft wash of the day colour for chip / header backgrounds. Dark surfaces
 * need a stronger wash to read as tinted at all.
 */
export function dayTint(dayIndex: number | null | undefined, scheme: 'light' | 'dark' = 'light'): string {
  return withAlpha(dayColor(dayIndex), scheme === 'dark' ? 0.24 : 0.12);
}

/** `#RRGGBB` + alpha → `rgba(r, g, b, a)`. Exported for tests. */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
