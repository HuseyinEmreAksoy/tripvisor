/**
 * Shared card chrome for the Today tab (v2 M4 X2.1) — one place for the
 * surface/border/radius/shadow tokens so every Today card reads as one set.
 */
import { StyleSheet, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';

export function useTodayCardStyle(): ViewStyle {
  const t = useTheme();
  return {
    borderWidth: StyleSheet.hairlineWidth * 2,
    backgroundColor: t.colors.cardBgSolid,
    borderColor: t.colors.border,
    borderRadius: t.radius.xl,
    padding: t.spacing.lg,
    gap: t.spacing.md,
    ...t.shadows.md(t.colors.shadowColor),
  };
}

/** Min 44×44 pt touch target (WCAG 2.2 / platform HIG). */
export const MIN_TOUCH = 44;
