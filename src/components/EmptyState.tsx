/**
 * EmptyState — v2 "Tide & Terracotta" primitive.
 *
 * The icon sits in a soft circular tile on a muted surface, the title uses
 * the bold display voice, and the CTA is the signature pill button. The
 * gentle float loop on the icon is skipped when the user prefers reduced
 * motion (web `prefers-reduced-motion` + native OS setting via
 * useReducedMotion).
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View, type ImageSourcePropType, type TextStyle } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '@/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export interface EmptyStateProps {
  title: string;
  body?: string;
  /** @deprecated Use body instead. */
  description?: string;
  ctaLabel?: string;
  onPress?: () => void;
  icon?: React.ReactNode;
  /** Brand illustration (assets/images/empty-*.png). Takes precedence over `icon`. */
  illustration?: ImageSourcePropType;
  /** @deprecated Pass ctaLabel + onPress instead */
  action?: React.ReactNode;
}

export function EmptyState({
  title,
  body,
  description,
  ctaLabel,
  onPress,
  icon,
  illustration,
  action,
}: EmptyStateProps) {
  const t = useTheme();
  const titleRef = useRef<Text>(null);
  const bodyText = body ?? description;
  const reducedMotion = useReducedMotion();

  // Gentle float loop for the icon — decorative, so reduced motion disables it.
  const floatAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reducedMotion) {
      floatAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: -8,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [floatAnim, reducedMotion]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (
      typeof document !== 'undefined' &&
      document.activeElement !== document.body
    ) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (titleRef.current as any)?.focus?.();
  }, []);

  return (
    <View
      style={[styles.root, { padding: t.spacing.xl, gap: t.spacing.lg }]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={bodyText ? `${title}. ${bodyText}` : title}
    >
      {illustration ? (
        <Animated.View style={{ transform: [{ translateY: floatAnim }] }}>
          <Image
            source={illustration}
            style={styles.illustration}
            contentFit="contain"
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </Animated.View>
      ) : icon ? (
        <Animated.View
          style={[
            styles.iconTile,
            {
              backgroundColor: t.colors.bgMuted,
              transform: [{ translateY: floatAnim }],
            },
          ]}
        >
          {icon}
        </Animated.View>
      ) : null}

      <Text
        ref={titleRef}
        style={[
          t.typography.title,
          { color: t.colors.text, textAlign: 'center' } as TextStyle,
        ]}
        accessibilityRole="header"
      >
        {title}
      </Text>

      {bodyText ? (
        <Text
          style={[
            t.typography.body,
            {
              color: t.colors.textMuted,
              textAlign: 'center',
              maxWidth: 340,
            },
          ]}
        >
          {bodyText}
        </Text>
      ) : null}

      {/* New-style CTA — signature pill */}
      {ctaLabel && onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: pressed ? t.colors.primaryDark : t.colors.primary,
              borderRadius: t.radius.pill,
              paddingHorizontal: t.spacing.xl,
              paddingVertical: t.spacing.md,
              ...t.shadows.md(t.colors.glowPrimary),
            },
          ]}
        >
          <Text style={[t.typography.bodyStrong, { color: t.colors.primaryText, letterSpacing: 0.2 }]}>
            {ctaLabel}
          </Text>
        </Pressable>
      ) : null}

      {/* Legacy action node */}
      {action ?? null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  iconTile: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  // 4:3 source art (640×480); capped so the CTA stays above the fold on 375×667.
  illustration: { width: 220, height: 165 },
  cta: { alignItems: 'center', justifyContent: 'center', minHeight: 48 },
});
