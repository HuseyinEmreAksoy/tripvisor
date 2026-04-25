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
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700' as const },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  subtitle: { fontSize: 18, lineHeight: 24, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  small: { fontSize: 11, lineHeight: 14, fontWeight: '400' as const },
} as const;

export const lightColors = {
  bg: '#FFFFFF',
  bgElevated: '#F7F7F8',
  bgMuted: '#EEEEF0',
  text: '#111115',
  textMuted: '#5A5A62',
  textInverse: '#FFFFFF',
  border: '#E2E2E6',
  borderStrong: '#CFCFD5',
  primary: '#2E6BE6',
  primaryText: '#FFFFFF',
  danger: '#D93B3B',
  success: '#1D9B5E',
  warning: '#E0A010',
  attribution: '#8B8B93',
  // Hero overlay: semi-transparent dark scrim over imagery on auth screens.
  // Kept at 55% opacity so text remains WCAG AA compliant on varied photos.
  heroOverlay: 'rgba(0, 0, 0, 0.55)',
  // Soft hero accent for value-prop chips on auth screens.
  heroChipBg: 'rgba(255,255,255,0.18)',
  heroChipText: '#FFFFFF',
} as const;

// `Record<keyof typeof lightColors, string>` enforces the same set of keys as
// lightColors but allows different string values (hex or rgba) in each theme.
// The original `typeof lightColors` annotation incorrectly required identical
// literal string values and was already producing TS errors before this file
// was touched. This annotation corrects that.
export const darkColors: Record<keyof typeof lightColors, string> = {
  bg: '#0E0E11',
  bgElevated: '#17171B',
  bgMuted: '#1F1F24',
  text: '#F2F2F5',
  textMuted: '#A4A4AD',
  textInverse: '#0E0E11',
  border: '#2A2A30',
  borderStrong: '#3A3A42',
  primary: '#5E8AFF',
  primaryText: '#0E0E11',
  danger: '#FF6B6B',
  success: '#4CD294',
  warning: '#F1C14B',
  attribution: '#7A7A82',
  // Dark mode hero overlay is slightly lighter so imagery still reads.
  heroOverlay: 'rgba(0, 0, 0, 0.62)',
  heroChipBg: 'rgba(255,255,255,0.14)',
  heroChipText: '#F2F2F5',
};

// Colors: a record with the same keys as lightColors but with string values,
// so both lightColors (literal types) and darkColors (string values) satisfy it.
export type Colors = Record<keyof typeof lightColors, string>;

export const themes = {
  light: lightColors,
  dark: darkColors,
} as const;

export type ThemeName = keyof typeof themes;
