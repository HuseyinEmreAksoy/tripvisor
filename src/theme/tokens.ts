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

// ─── Light Theme — "Paper" ────────────────────────────────────────────────────
export const lightColors = {
  // Backgrounds — warm off-white paper, white cards float on top.
  bg: '#FAF6F0',
  bgElevated: '#FFFFFF',
  bgMuted: '#F1EAE0',
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

  // Primary — Aegean teal (5.0:1 with white label text)
  primary: '#0E7C72',
  primaryLight: '#27A294',
  primaryDark: '#0A5F57',
  primaryText: '#FFFFFF',

  // Accent — sunset terracotta (4.9:1 with white label text)
  accent: '#C8431D',
  accentLight: '#F07A52',
  accentText: '#FFFFFF',

  // Semantic
  danger: '#B73232',
  dangerLight: '#FAE6E1',
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

  // Attribution
  attribution: '#8E8478',

  // Gradients (teal sea → terracotta sunset)
  gradientStart: '#0E7C72',
  gradientEnd: '#C8431D',
  gradientSubtle: 'rgba(14, 124, 114, 0.08)',

  // Shadows — warm-tinted, soft and layered.
  shadowColor: 'rgba(46, 38, 28, 0.10)',
  shadowColorStrong: 'rgba(46, 38, 28, 0.20)',

  // Hero overlays
  heroOverlay: 'rgba(18, 14, 10, 0.46)',
  heroChipBg: 'rgba(255, 255, 255, 0.22)',
  heroChipText: '#FFFFFF',

  // Glow (for focused/active elements)
  glowPrimary: 'rgba(14, 124, 114, 0.30)',
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
  bgElevated: '#1E1B15',
  bgMuted: '#2A261E',

  // Glass effect backgrounds
  cardBg: 'rgba(30, 27, 21, 0.92)',
  cardBgSolid: '#1E1B15',

  // Text — soft bone, muted warm sand.
  text: '#F1ECE2',
  textMuted: '#A89E8E',
  textInverse: '#14120E',

  // Borders
  border: 'rgba(168, 158, 142, 0.16)',
  borderStrong: 'rgba(168, 158, 142, 0.30)',

  // Primary — luminous lagoon teal (dark-ink label text, 8.5:1)
  primary: '#3ECCBB',
  primaryLight: '#7BE0D2',
  primaryDark: '#2AA193',
  primaryText: '#06231E',

  // Accent — glowing sunset coral (dark-ink label text)
  accent: '#FF8B62',
  accentLight: '#FFAB8C',
  accentText: '#2B1109',

  // Semantic
  danger: '#F07A6A',
  dangerLight: 'rgba(240, 122, 106, 0.16)',
  success: '#52CE8D',
  successLight: 'rgba(82, 206, 141, 0.16)',
  warning: '#F5B83D',
  warningLight: 'rgba(245, 184, 61, 0.16)',
  // Bright amber reads fine on the translucent dark warningLight surface.
  warningText: '#FCD34D',
  info: '#6FA8F5',
  infoLight: 'rgba(111, 168, 245, 0.16)',

  // Attribution
  attribution: '#7D746A',

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
  sm: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 2,
  }),
  md: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 14,
    elevation: 5,
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

// Colors: a record with the same keys as lightColors but with string values,
// so both lightColors (literal types) and darkColors (string values) satisfy it.
export type Colors = Record<keyof typeof lightColors, string>;

export const themes = {
  light: lightColors,
  dark: darkColors,
} as const;

export type ThemeName = keyof typeof themes;
