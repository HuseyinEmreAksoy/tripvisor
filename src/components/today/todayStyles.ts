/**
 * Shared card chrome for the Today tab (v2 M4 X2.1) — one place for the
 * surface/radius/padding so every Today card reads as one set.
 * M5 Y2.4: built on the shared elevation scale (`surfaceStyle(t, 'raised')`):
 * lighter than the old border + md shadow, same in every card list.
 */
import type { ViewStyle } from 'react-native';
import { surfaceStyle, useTheme } from '@/theme';

export function useTodayCardStyle(): ViewStyle {
  const t = useTheme();
  return {
    ...surfaceStyle(t, 'raised'),
    borderRadius: t.radius.xl,
    padding: t.layout.cardPadding,
    gap: t.spacing.md,
  };
}

/** Min 44×44 pt touch target (WCAG 2.2 / platform HIG). */
export const MIN_TOUCH = 44;
