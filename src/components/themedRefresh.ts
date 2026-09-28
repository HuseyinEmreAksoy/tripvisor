/**
 * themedRefresh — theme-aware RefreshControl colors (X3.1).
 *
 * The platform defaults (grey iOS spinner, a white Android puck) read as
 * foreign in dark mode. Spread into any RefreshControl:
 *
 *   <RefreshControl refreshing={r} onRefresh={f} {...themedRefresh(t)} />
 */
import type { Theme } from '@/theme';

export function themedRefresh(t: Theme) {
  return {
    tintColor: t.colors.primary, // iOS spinner
    colors: [t.colors.primary], // Android spinner arrow
    progressBackgroundColor: t.colors.bgElevated, // Android puck
  };
}
