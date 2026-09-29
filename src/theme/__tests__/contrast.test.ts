/**
 * WCAG AA gate for the design tokens (M5 Y2.4): every text-on-surface pair
 * components use holds ≥ 4.5:1, and every day colour holds ≥ 3:1 (WCAG
 * 1.4.11 non-text) against the surfaces it is drawn on — in BOTH themes.
 * Translucent colours are composited onto the page colour underneath.
 */
import { describe, expect, it } from '@jest/globals';
import { darkColors, lightColors, type Colors } from '../tokens';
import { DAY_COLORS, DAY_NEUTRAL, ON_DAY_COLOR, dayColor, dayTint, withAlpha } from '../dayColors';
import { contrastRatio } from '../contrast';

const THEMES: Array<[string, Colors]> = [
  ['light', lightColors],
  ['dark', darkColors],
];

type Key = keyof Colors;

/** [foreground, background] pairs rendered as body text somewhere in the app. */
const TEXT_PAIRS: Array<[Key, Key]> = [
  ['text', 'bg'],
  ['text', 'bgElevated'],
  ['text', 'bgMuted'],
  ['text', 'cardBgSolid'],
  ['textMuted', 'bg'],
  ['textMuted', 'bgElevated'],
  ['textMuted', 'bgMuted'],
  ['textMuted', 'cardBgSolid'],
  ['primaryInk', 'bg'],
  ['primaryInk', 'bgElevated'],
  ['primaryInk', 'bgMuted'],
  ['primaryInk', 'gradientSubtle'],
  ['attribution', 'bg'],
  ['attribution', 'bgElevated'],
  ['warningText', 'warningLight'],
  ['warningText', 'cardBgSolid'],
  ['primaryText', 'primary'],
  ['accentText', 'accent'],
  ['dangerText', 'danger'],
];

describe('token contrast (WCAG AA)', () => {
  for (const [name, c] of THEMES) {
    describe(name, () => {
      it.each(TEXT_PAIRS)('%s on %s ≥ 4.5:1', (fg, bg) => {
        expect(contrastRatio(c[fg], c[bg], c.bg)).toBeGreaterThanOrEqual(4.5);
      });

      // Hero text sits on a photo under the scrim / glass. Worst case: the
      // photo pixel underneath is pure white.
      it('hero text on the scrim and the glass holds over a white pixel', () => {
        expect(contrastRatio(c.heroChipText, c.heroScrim, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(c.heroChipText, c.heroGlass, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
      });

      it('raised cards separate from the page (≥ 1.04:1 tone step)', () => {
        expect(contrastRatio(c.cardBgSolid, c.bg)).toBeGreaterThanOrEqual(1.04);
      });
    });
  }
});

describe('day colours', () => {
  const fills = [...DAY_COLORS, DAY_NEUTRAL];

  it.each(fills)('white label on %s ≥ 4.5:1', (fill) => {
    expect(contrastRatio(ON_DAY_COLOR, fill)).toBeGreaterThanOrEqual(4.5);
  });

  for (const [name, c] of THEMES) {
    it.each(fills)(`${name}: %s vs page, card and well ≥ 3:1`, (fill) => {
      for (const surface of [c.bg, c.bgElevated, c.cardBgSolid] as const) {
        expect(contrastRatio(fill, surface, c.bg)).toBeGreaterThanOrEqual(3);
      }
      if (name === 'light') {
        expect(contrastRatio(fill, c.bgMuted, c.bg)).toBeGreaterThanOrEqual(3);
      }
    });

    it(`${name}: body text stays AA on every day tint`, () => {
      for (let i = 0; i < DAY_COLORS.length; i += 1) {
        const tint = dayTint(i, name as 'light' | 'dark');
        expect(contrastRatio(c.text, tint, c.cardBgSolid)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it('dayColor wraps and falls back to neutral', () => {
    expect(dayColor(0)).toBe(DAY_COLORS[0]);
    expect(dayColor(DAY_COLORS.length)).toBe(DAY_COLORS[0]);
    expect(dayColor(null)).toBe(DAY_NEUTRAL);
    expect(dayColor(-1)).toBe(DAY_NEUTRAL);
    expect(withAlpha('#2F6BDE', 0.5)).toBe('rgba(47, 107, 222, 0.5)');
  });
});
