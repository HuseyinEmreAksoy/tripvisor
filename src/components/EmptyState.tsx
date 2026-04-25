/**
 * EmptyState — Redesigned with animated icons, gradient CTA, refined layout.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { useTheme } from '@/theme';

export interface EmptyStateProps {
  title: string;
  body?: string;
  /** @deprecated Use body instead. */
  description?: string;
  ctaLabel?: string;
  onPress?: () => void;
  icon?: React.ReactNode;
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
  action,
}: EmptyStateProps) {
  const t = useTheme();
  const titleRef = useRef<Text>(null);
  const bodyText = body ?? description;

  // Float animation for the icon
  const floatAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
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
    ).start();
  }, [floatAnim]);

  // Fade in
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

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
    <Animated.View
      style={[
        styles.root,
        { padding: t.spacing.xl, gap: t.spacing.lg, opacity: fadeAnim },
      ]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={bodyText ? `${title}. ${bodyText}` : title}
    >
      {icon ? (
        <Animated.View
          style={[
            styles.iconWrapper,
            { transform: [{ translateY: floatAnim }] },
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
              maxWidth: 320,
              lineHeight: 24,
            },
          ]}
        >
          {bodyText}
        </Text>
      ) : null}

      {/* New-style CTA */}
      {ctaLabel && onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: t.colors.primary,
              borderRadius: t.radius.lg,
              paddingHorizontal: t.spacing.xl,
              paddingVertical: t.spacing.md,
              ...t.shadows.md(t.colors.glowPrimary),
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.97 : 1 }],
            },
          ]}
        >
          <Text style={[t.typography.bodyStrong, { color: t.colors.primaryText, letterSpacing: 0.3 }]}>
            {ctaLabel}
          </Text>
        </Pressable>
      ) : null}

      {/* Legacy action node */}
      {action ?? null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  iconWrapper: { alignItems: 'center', marginBottom: 4 },
  cta: { alignItems: 'center', justifyContent: 'center', minHeight: 48 },
});
