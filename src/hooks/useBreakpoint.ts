/**
 * useBreakpoint
 *
 * Returns the current layout breakpoint based on window width.
 *
 * Thresholds:
 *   - 'mobile'  : width < 768
 *   - 'tablet'  : 768 ≤ width < 1024
 *   - 'desktop' : width ≥ 1024
 *
 * Uses `useWindowDimensions` from React Native — no extra dependencies,
 * works identically on iOS, Android, and web. Updates automatically on
 * window resize (web) or orientation change (native).
 *
 * Usage:
 *   const bp = useBreakpoint();
 *   if (bp === 'desktop') { ... }
 */
import { useWindowDimensions } from 'react-native';
import { useIsHydrating } from './useIsHydrating';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

export const BREAKPOINTS = {
  tablet: 768,
  desktop: 1024,
  desktopWide: 1440,
} as const;

export function useBreakpoint(): Breakpoint {
  const { width: windowWidth } = useWindowDimensions();
  // Web static export: pages are prerendered with no window (width 0), so
  // hydrate with that layout and take the real width right after. Otherwise
  // a desktop visit throws React #418 and discards the prerendered HTML.
  const width = useIsHydrating() ? 0 : windowWidth;
  if (width >= BREAKPOINTS.desktop) return 'desktop';
  if (width >= BREAKPOINTS.tablet) return 'tablet';
  return 'mobile';
}
