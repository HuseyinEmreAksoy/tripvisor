/**
 * Skeleton — loading placeholder blocks (v2 M4 X1.1).
 *
 *   <Skeleton width="60%" height={18} />
 *   <Skeleton height={120} radius="xl" />
 *   <SkeletonGroup label="Loading trips">…</SkeletonGroup>
 *
 * A muted block that gently pulses. The pulse is decorative, so it is
 * skipped under reduced motion (useReducedMotion covers web + native).
 * Individual blocks are hidden from the a11y tree; wrap a set of them in
 * `SkeletonGroup` so screen readers hear one polite "Loading …" instead.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme, type radius as radiusTokens } from '@/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  /** Theme radius token. Default `md`. */
  radius?: keyof typeof radiusTokens;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({ width = '100%', height = 16, radius = 'md', style }: SkeletonProps) {
  const t = useTheme();
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reducedMotion, opacity]);

  return (
    <Animated.View
      testID="skeleton-block"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={[
        { width, height, borderRadius: t.radius[radius], backgroundColor: t.colors.bgMuted, opacity },
        style,
      ]}
    />
  );
}

export interface SkeletonGroupProps {
  /** Announced once to assistive tech, e.g. "Loading trips". */
  label: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function SkeletonGroup({ label, children, style }: SkeletonGroupProps) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      accessibilityLiveRegion="polite"
      style={style}
    >
      {children}
    </View>
  );
}
