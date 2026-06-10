/**
 * useReducedMotion — cross-platform "reduce motion" preference.
 *
 * One code path for all three platforms: React Native Web implements
 * AccessibilityInfo.isReduceMotionEnabled via the CSS
 * `(prefers-reduced-motion: reduce)` media query, and native reads the OS
 * accessibility setting. Components gate decorative animation (loops,
 * mount fades, springs) on this — content is always rendered immediately.
 *
 * Usage:
 *   const reducedMotion = useReducedMotion();
 *   if (!reducedMotion) startFloatLoop();
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted) setReduced(value);
      })
      .catch(() => {
        // Preference unavailable (older browsers / test env) — animate.
      });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      setReduced(value);
    });
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  return reduced;
}
