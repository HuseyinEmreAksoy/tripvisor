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

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  pill: 999,
} as const;

export const typography = {
  display: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800' as const,
    letterSpacing: -0.5,
    ...(Platform.OS === 'web'
      ? { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" }
      : {}),
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700' as const,
    letterSpacing: -0.3,
    ...(Platform.OS === 'web'
      ? { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" }
      : {}),
  },
  subtitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600' as const,
    letterSpacing: -0.1,
    ...(Platform.OS === 'web'
      ? { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" }
      : {}),
  },
  body: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400' as const,
    ...(Platform.OS === 'web'
      ? { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" }
      : {}),
  },
  bodyStrong: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600' as const,
    ...(Platform.OS === 'web'
      ? { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" }
      : {}),
  },
  caption: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400' as const,
    ...(Platform.OS === 'web'
      ? { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" }
      : {}),
  },
  small: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500' as const,
    letterSpacing: 0.2,
    ...(Platform.OS === 'web'
      ? { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" }
      : {}),
  },
} as const;

// ─── Light Theme ──────────────────────────────────────────────────────────────
export const lightColors = {
  // Backgrounds
  bg: '#F8F9FC',
  bgElevated: '#FFFFFF',
  bgMuted: '#EEF0F5',
  // Glass effect backgrounds
  cardBg: 'rgba(255, 255, 255, 0.85)',
  cardBgSolid: '#FFFFFF',

  // Text
  text: '#1A1D2E',
  textMuted: '#6B7194',
  textInverse: '#FFFFFF',

  // Borders
  border: 'rgba(107, 113, 148, 0.15)',
  borderStrong: 'rgba(107, 113, 148, 0.25)',

  // Primary — Indigo-Violet
  primary: '#4F6CF7',
  primaryLight: '#7B8CFF',
  primaryDark: '#3A53D9',
  primaryText: '#FFFFFF',

  // Accent — Warm Coral
  accent: '#FF6B4A',
  accentLight: '#FF8A6A',
  accentText: '#FFFFFF',

  // Semantic
  danger: '#EF4444',
  dangerLight: '#FEE2E2',
  success: '#10B981',
  successLight: '#D1FAE5',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  // warningText: readable amber-toned TEXT on warningLight surfaces (v2 P1.1b
  // conflict chips). `warning` itself fails WCAG AA on warningLight (~2:1);
  // amber-800 hits ≥4.5:1 on both warningLight and plain card backgrounds.
  warningText: '#92400E',
  info: '#3B82F6',
  infoLight: '#DBEAFE',

  // Attribution
  attribution: '#9CA3AF',

  // Gradients
  gradientStart: '#4F6CF7',
  gradientEnd: '#FF6B4A',
  gradientSubtle: 'rgba(79, 108, 247, 0.06)',

  // Shadows
  shadowColor: 'rgba(26, 29, 46, 0.08)',
  shadowColorStrong: 'rgba(26, 29, 46, 0.16)',

  // Hero overlays
  heroOverlay: 'rgba(26, 29, 46, 0.50)',
  heroChipBg: 'rgba(255, 255, 255, 0.20)',
  heroChipText: '#FFFFFF',

  // Glow (for focused/active elements)
  glowPrimary: 'rgba(79, 108, 247, 0.25)',
  glowAccent: 'rgba(255, 107, 74, 0.20)',

  // Budget semantic tokens (Phase 21 Step 21.10)
  // budgetOk: actual spend is within budget
  budgetOk: '#10B981',
  budgetOkLight: '#D1FAE5',
  // budgetWarn: actual spend is between 80–100% of budget
  budgetWarn: '#F59E0B',
  budgetWarnLight: '#FEF3C7',
  // budgetOverLimit: actual spend exceeds budget
  budgetOverLimit: '#EF4444',
  budgetOverLimitLight: '#FEE2E2',
} as const;

export const darkColors: Record<keyof typeof lightColors, string> = {
  // Backgrounds
  bg: '#0B0E1A',
  bgElevated: '#141829',
  bgMuted: '#1C2038',

  // Glass effect backgrounds
  cardBg: 'rgba(20, 24, 41, 0.90)',
  cardBgSolid: '#1C2038',

  // Text
  text: '#E8EAF6',
  textMuted: '#8B92B8',
  textInverse: '#0B0E1A',

  // Borders
  border: 'rgba(139, 146, 184, 0.15)',
  borderStrong: 'rgba(139, 146, 184, 0.25)',

  // Primary — Luminous Indigo
  primary: '#7B8CFF',
  primaryLight: '#A0ADFF',
  primaryDark: '#5C6BDB',
  primaryText: '#0B0E1A',

  // Accent — Soft Coral
  accent: '#FF8A65',
  accentLight: '#FFAB91',
  accentText: '#0B0E1A',

  // Semantic
  danger: '#F87171',
  dangerLight: 'rgba(248, 113, 113, 0.15)',
  success: '#34D399',
  successLight: 'rgba(52, 211, 153, 0.15)',
  warning: '#FBBF24',
  warningLight: 'rgba(251, 191, 36, 0.15)',
  // Bright amber reads fine on the translucent dark warningLight surface.
  warningText: '#FCD34D',
  info: '#60A5FA',
  infoLight: 'rgba(96, 165, 250, 0.15)',

  // Attribution
  attribution: '#6B7280',

  // Gradients
  gradientStart: '#7B8CFF',
  gradientEnd: '#FF8A65',
  gradientSubtle: 'rgba(123, 140, 255, 0.08)',

  // Shadows
  shadowColor: 'rgba(0, 0, 0, 0.30)',
  shadowColorStrong: 'rgba(0, 0, 0, 0.50)',

  // Hero overlays
  heroOverlay: 'rgba(11, 14, 26, 0.65)',
  heroChipBg: 'rgba(255, 255, 255, 0.12)',
  heroChipText: '#E8EAF6',

  // Glow (for focused/active elements)
  glowPrimary: 'rgba(123, 140, 255, 0.30)',
  glowAccent: 'rgba(255, 138, 101, 0.25)',

  // Budget semantic tokens (Phase 21 Step 21.10) — dark variants
  budgetOk: '#34D399',
  budgetOkLight: 'rgba(52, 211, 153, 0.15)',
  budgetWarn: '#FBBF24',
  budgetWarnLight: 'rgba(251, 191, 36, 0.15)',
  budgetOverLimit: '#F87171',
  budgetOverLimitLight: 'rgba(248, 113, 113, 0.15)',
};

// ─── Shadow Presets ───────────────────────────────────────────────────────────
// React Native shadows work differently on iOS vs Android vs Web.
// We define factory functions that return platform-appropriate shadow objects.

export const shadows = {
  sm: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 2,
  }),
  md: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 4,
  }),
  lg: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 8,
  }),
  xl: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 12,
  }),
  glow: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 12,
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
