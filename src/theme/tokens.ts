/**
 * Tripvisor design tokens — v2 visual language: "Tide & Terracotta".
 *
 * One confident travel palette across both modes:
 *   - Light = warm off-white "paper" surfaces with deep warm-ink text.
 *   - Dark  = deep ink (warm charcoal) surfaces with soft bone text.
 *   - Primary accent = Aegean teal (sea). Secondary = sunset terracotta.
 *
 * This file is the SINGLE source of truth for color, type, radius, spacing
 * and elevation. Components consume tokens via useTheme() — never raw hex.
 *
 * Contrast: every text-on-surface pair used by components holds WCAG AA
 * (≥4.5:1 body, ≥3:1 large). The `warningText` precedent (readable amber
 * TEXT on warningLight surfaces) is preserved in both modes.
 */
import { Platform } from 'react-native';

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  huge: 64,
} as const;

/**
 * Layout scale (M5 Y2.4) — the semantic spacing every card and screen uses,
 * so stacked surfaces breathe the same way everywhere. Widths are the
 * centred desktop columns `Screen width="form" | "content"` applies.
 */
export const layout = {
  /** Screen side padding. */
  gutter: spacing.lg,
  /** Inner padding of a card on tablet/desktop. */
  cardPadding: spacing.lg,
  /** Inner padding of a card on phones. */
  cardPaddingCompact: spacing.md,
  /** Gap between stacked cards / list rows. */
  cardGap: spacing.md,
  /** Gap between sections of a screen. */
  sectionGap: spacing.xl,
  /** Desktop form column (≤ 720 px rule). */
  formWidth: 640,
  /** Desktop reading / content column. */
  contentWidth: 960,
} as const;

// Generous, soft geometry — cards live at lg/xl, chips are always `pill`.
export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 28,
  pill: 999,
} as const;

const WEB_FONT_STACK =
  Platform.OS === 'web'
    ? {
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
      }
    : {};

export const typography = {
  // Big, confident display headings — the "travel magazine" voice.
  display: {
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '800' as const,
    letterSpacing: -0.8,
    ...WEB_FONT_STACK,
  },
  title: {
    fontSize: 27,
    lineHeight: 34,
    fontWeight: '800' as const,
    letterSpacing: -0.5,
    ...WEB_FONT_STACK,
  },
  subtitle: {
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '700' as const,
    letterSpacing: -0.2,
    ...WEB_FONT_STACK,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
    ...WEB_FONT_STACK,
  },
  bodyStrong: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600' as const,
    ...WEB_FONT_STACK,
  },
  caption: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500' as const,
    ...WEB_FONT_STACK,
  },
  small: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600' as const,
    letterSpacing: 0.2,
    ...WEB_FONT_STACK,
  },
  // Muted uppercase kicker above bold section headings — a v2 signature.
  overline: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700' as const,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
    ...WEB_FONT_STACK,
  },
} as const;

// ─── Brand typeface — Hanken Grotesk (v3 design-system refresh) ───────────────
// The brand font loads at runtime via expo-font (ThemeProvider). RN needs a
// distinct family name per weight; the system stack above stays the deliberate
// fallback until (or if never) loaded — per the design handoff, native builds
// without the webfont should still feel right.

const HANKEN_BY_WEIGHT: Record<string, string> = {
  '400': 'HankenGrotesk_400Regular',
  '500': 'HankenGrotesk_500Medium',
  '600': 'HankenGrotesk_600SemiBold',
  '700': 'HankenGrotesk_700Bold',
  '800': 'HankenGrotesk_800ExtraBold',
};

function brandFamilyFor(weight: string): string {
  const family = HANKEN_BY_WEIGHT[weight] ?? 'HankenGrotesk_400Regular';
  // On web the expo-font-registered family gets the system stack appended so a
  // failed font fetch degrades to the same stack we ship pre-load.
  return Platform.OS === 'web'
    ? `${family}, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`
    : family;
}

/**
 * Returns the typography scale with the brand font families applied when the
 * webfont has loaded, or the system-stack scale otherwise. Consumers never
 * call this — ThemeProvider does, so `useTheme().typography` upgrades in
 * place once fonts are ready.
 */
export function brandTypography(fontsLoaded: boolean): typeof typography {
  if (!fontsLoaded) return typography;
  const out = {} as Record<keyof typeof typography, object>;
  for (const key of Object.keys(typography) as (keyof typeof typography)[]) {
    const style = typography[key];
    out[key] = { ...style, fontFamily: brandFamilyFor(style.fontWeight) };
  }
  // Same shape + an added fontFamily per style — structurally compatible with
  // the base scale; the cast keeps the public token type unchanged.
  return out as typeof typography;
}

// ─── Light Theme — "Paper" ────────────────────────────────────────────────────
export const lightColors = {
  // Backgrounds — warm off-white paper, white cards float on top.
  bg: '#FAF6F0',
  bgElevated: '#FFFFFF',
  // Y2.4: a lighter inset "well" (was #F1EAE0) — chips, notes, pressed rows.
  bgMuted: '#F3EDE5',
  // Glass effect backgrounds
  cardBg: 'rgba(255, 255, 255, 0.92)',
  cardBgSolid: '#FFFFFF',

  // Text — warm ink, never pure black.
  text: '#221E18',
  textMuted: '#6C6155',
  textInverse: '#FFFFFF',

  // Borders — warm and quiet; whitespace does the separating.
  border: 'rgba(108, 97, 85, 0.18)',
  borderStrong: 'rgba(108, 97, 85, 0.32)',

  // Primary — Aegean teal, v3 brightened (#0C8578 — 4.5:1 with white label text;
  // exact value from the design-system handoff tokens/colors.css)
  primary: '#0C8578',
  primaryLight: '#2BAD9E',
  primaryDark: '#0A6A5F',
  primaryText: '#FFFFFF',
  // primaryInk: teal for TEXT on page surfaces (links, text buttons, counts).
  // `primary` itself is 4.2:1 on the paper bg and 3.8:1 on bgMuted — fine for
  // fills/icons/large text, short of AA for body text (X3.1 audit). 6.0:1 on
  // bg, 5.4:1 on bgMuted, 6.5:1 on white.
  primaryInk: '#0A6A5F',

  // Accent — sunset terracotta (4.9:1 with white label text)
  accent: '#C8431D',
  accentLight: '#F07A52',
  accentText: '#FFFFFF',

  // Semantic
  danger: '#B73232',
  dangerLight: '#FAE6E1',
  // Label text on a solid `danger` fill (6.0:1).
  dangerText: '#FFFFFF',
  success: '#177A4C',
  successLight: '#DDF2E4',
  warning: '#B45309',
  warningLight: '#FCEFD9',
  // warningText: readable amber-toned TEXT on warningLight surfaces (v2 P1.1b
  // conflict chips). `warning` itself is for icons/borders; amber-800 hits
  // ≥4.5:1 on both warningLight and plain card backgrounds.
  warningText: '#92400E',
  info: '#2767C4',
  infoLight: '#E3EDFB',

  // Attribution — X3.1: darkened from #8E8478 (3.4:1) so the small photo /
  // review credits hold AA (4.8:1 on bg, 5.1:1 on white).
  attribution: '#766C60',

  // Modal scrim behind sheets and dialogs.
  scrim: 'rgba(18, 14, 10, 0.42)',

  // Chart category palette (X3.1). Each is ≥5:1 against bgElevated, so
  // slices and bars clear WCAG 1.4.11 (non-text 3:1) with margin. The keys
  // mirror TripExpenseCategory.
  chartAccommodation: '#5B5BD6',
  chartFood: '#B45309',
  chartTransport: '#2767C4',
  chartShopping: '#C0307A',
  chartActivities: '#177A4C',
  chartOther: '#6C6155',

  // Gradients (teal sea → terracotta sunset) — v3: wash strengthened to 0.10
  gradientStart: '#0C8578',
  gradientEnd: '#C8431D',
  gradientSubtle: 'rgba(12, 133, 120, 0.10)',

  // Shadows — warm-tinted, soft and layered. Y2.4: lighter (was 0.10/0.20)
  // so cards lift off the paper without reading as heavy slabs.
  shadowColor: 'rgba(46, 38, 28, 0.08)',
  shadowColorStrong: 'rgba(46, 38, 28, 0.16)',

  // Hero overlays
  heroOverlay: 'rgba(18, 14, 10, 0.46)',
  heroChipBg: 'rgba(255, 255, 255, 0.22)',
  heroChipText: '#FFFFFF',
  // Y2.4 trip hero: the bottom stop of the photo scrim (white text on it
  // holds ≥ 4.5:1 even over a pure-white pixel) and the dark "glass" behind
  // buttons and chips that sit on imagery.
  heroScrim: 'rgba(18, 14, 10, 0.74)',
  // The light top stop of a banner scrim (the photo still reads through).
  heroScrimSoft: 'rgba(18, 14, 10, 0.12)',
  heroGlass: 'rgba(18, 14, 10, 0.6)',

  // Glow (for focused/active elements)
  glowPrimary: 'rgba(12, 133, 120, 0.30)',
  glowAccent: 'rgba(200, 67, 29, 0.25)',

  // Budget semantic tokens (Phase 21 Step 21.10)
  // budgetOk: actual spend is within budget
  budgetOk: '#177A4C',
  budgetOkLight: '#DDF2E4',
  // budgetWarn: actual spend is between 80–100% of budget
  budgetWarn: '#B45309',
  budgetWarnLight: '#FCEFD9',
  // budgetOverLimit: actual spend exceeds budget
  budgetOverLimit: '#B73232',
  budgetOverLimitLight: '#FAE6E1',
} as const;

// ─── Dark Theme — "Ink" ───────────────────────────────────────────────────────
export const darkColors: Record<keyof typeof lightColors, string> = {
  // Backgrounds — deep warm ink, not blue-black.
  bg: '#14120E',
  // Y2.4: a lighter raised surface (was #1E1B15) so cards separate from the
  // page by tone — shadows barely register on ink.
  bgElevated: '#221F19',
  bgMuted: '#2E2A22',

  // Glass effect backgrounds
  cardBg: 'rgba(34, 31, 25, 0.94)',
  cardBgSolid: '#221F19',

  // Text — soft bone, muted warm sand.
  text: '#F1ECE2',
  textMuted: '#A89E8E',
  textInverse: '#14120E',

  // Borders — Y2.4: a touch stronger (was 0.16/0.30) to carry card edges on ink.
  border: 'rgba(168, 158, 142, 0.18)',
  borderStrong: 'rgba(168, 158, 142, 0.32)',

  // Primary — luminous lagoon teal (dark-ink label text, 8.5:1)
  primary: '#3ECCBB',
  primaryLight: '#7BE0D2',
  primaryDark: '#2AA193',
  primaryText: '#06231E',
  primaryInk: '#3ECCBB',

  // Accent — glowing sunset coral (dark-ink label text)
  accent: '#FF8B62',
  accentLight: '#FFAB8C',
  accentText: '#2B1109',

  // Semantic
  danger: '#F07A6A',
  dangerLight: 'rgba(240, 122, 106, 0.16)',
  // White on the light-coral dark `danger` is only 2.7:1; dark ink is 6.6:1.
  dangerText: '#2B0E0A',
  success: '#52CE8D',
  successLight: 'rgba(82, 206, 141, 0.16)',
  warning: '#F5B83D',
  warningLight: 'rgba(245, 184, 61, 0.16)',
  // Bright amber reads fine on the translucent dark warningLight surface.
  warningText: '#FCD34D',
  info: '#6FA8F5',
  infoLight: 'rgba(111, 168, 245, 0.16)',

  // Attribution — X3.1: lifted from #7D746A (3.7:1 on cards) to 5.5:1.
  attribution: '#9A9082',

  scrim: 'rgba(0, 0, 0, 0.6)',

  // Chart category palette — each ≥6:1 against the dark bgElevated.
  chartAccommodation: '#9B9BF5',
  chartFood: '#F5B83D',
  chartTransport: '#6FA8F5',
  chartShopping: '#F07AB8',
  chartActivities: '#52CE8D',
  chartOther: '#A89E8E',

  // Gradients
  gradientStart: '#3ECCBB',
  gradientEnd: '#FF8B62',
  gradientSubtle: 'rgba(62, 204, 187, 0.10)',

  // Shadows
  shadowColor: 'rgba(0, 0, 0, 0.40)',
  shadowColorStrong: 'rgba(0, 0, 0, 0.60)',

  // Hero overlays
  heroOverlay: 'rgba(10, 8, 5, 0.62)',
  heroChipBg: 'rgba(255, 255, 255, 0.14)',
  heroChipText: '#F1ECE2',
  heroScrim: 'rgba(10, 8, 5, 0.8)',
  heroScrimSoft: 'rgba(10, 8, 5, 0.22)',
  heroGlass: 'rgba(10, 8, 5, 0.6)',

  // Glow (for focused/active elements)
  glowPrimary: 'rgba(62, 204, 187, 0.28)',
  glowAccent: 'rgba(255, 139, 98, 0.24)',

  // Budget semantic tokens (Phase 21 Step 21.10) — dark variants
  budgetOk: '#52CE8D',
  budgetOkLight: 'rgba(82, 206, 141, 0.16)',
  budgetWarn: '#F5B83D',
  budgetWarnLight: 'rgba(245, 184, 61, 0.16)',
  budgetOverLimit: '#F07A6A',
  budgetOverLimitLight: 'rgba(240, 122, 106, 0.16)',
};

// ─── Shadow Presets ───────────────────────────────────────────────────────────
// React Native shadows work differently on iOS vs Android vs Web.
// Factory functions return platform-appropriate shadow objects.
// v2: softer, larger-radius, lower-alpha "layered" elevation — cards float on
// whitespace instead of sitting behind borders.

export const shadows = {
  // Y2.4: sm/md lightened (were 2/6/e2 and 6/14/e5) — list cards and hero
  // cards float on whitespace instead of casting slabs.
  sm: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 1,
  }),
  md: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 3,
  }),
  lg: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 9,
  }),
  xl: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 1,
    shadowRadius: 32,
    elevation: 13,
  }),
  glow: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 14,
    elevation: 6,
  }),
} as const;

/**
 * Elevation scale (M5 Y2.4) — the ONE vocabulary for surfaces. Components
 * pick a level and call `surfaceStyle(theme, level)` (src/theme/surfaces.ts)
 * instead of hand-mixing background + border + shadow:
 *   - flat:     sits in the page (hairline edge, no shadow) — nested cards;
 *   - raised:   list cards (place rows, trip cards, Today cards);
 *   - floating: heroes, the FAB, sticky bars;
 *   - overlay:  sheets and dialogs.
 */
export const elevation = {
  flat: { shadow: null, radius: 'lg' },
  raised: { shadow: 'sm', radius: 'lg' },
  floating: { shadow: 'md', radius: 'xl' },
  overlay: { shadow: 'lg', radius: 'xl' },
} as const satisfies Record<
  string,
  { shadow: keyof typeof shadows | null; radius: keyof typeof radius }
>;

export type ElevationLevel = keyof typeof elevation;

// Colors: a record with the same keys as lightColors but with string values,
// so both lightColors (literal types) and darkColors (string values) satisfy it.
export type Colors = Record<keyof typeof lightColors, string>;

export const themes = {
  light: lightColors,
  dark: darkColors,
} as const;

export type ThemeName = keyof typeof themes;
