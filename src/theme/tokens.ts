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
} as const;

export const darkColors: typeof lightColors = {
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
};

export type Colors = typeof lightColors;

export const themes = {
  light: lightColors,
  dark: darkColors,
} as const;

export type ThemeName = keyof typeof themes;
