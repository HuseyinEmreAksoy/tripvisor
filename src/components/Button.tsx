/**
 * Button — v2 "Tide & Terracotta" primitive.
 *
 * Pill silhouette (a v2 visual signature), soft layered shadow on the primary
 * variant, quiet bordered secondary, tinted ghost. Press feedback is a small
 * native-driven spring scale, disabled when the user prefers reduced motion.
 *
 * Usage:
 *   <Button label="New trip" onPress={...} />
 *   <Button variant="secondary" label="Retry" fullWidth={false} onPress={...} />
 */
import { useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '@/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { haptics } from '@/lib/haptics';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: Variant;
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  /**
   * Light haptic tick on press (native only; no-op on web and under reduced
   * motion). Defaults ON for the `primary` and `danger` variants — the
   * primary actions — and OFF for secondary/ghost (X3.1).
   */
  haptic?: boolean;
}

export function Button({
  label,
  variant = 'primary',
  loading = false,
  fullWidth = true,
  leftIcon,
  haptic,
  disabled,
  onPress,
  ...rest
}: ButtonProps) {
  const t = useTheme();
  const reducedMotion = useReducedMotion();
  const { container, textColor, pressedStyle } = getStyles(t, variant);
  const isDisabled = disabled || loading;
  const wantsHaptic = haptic ?? (variant === 'primary' || variant === 'danger');

  // Animated scale for press feedback (skipped under reduced motion).
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    if (reducedMotion) return;
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    if (reducedMotion) return;
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 6,
    }).start();
  };

  return (
    <Animated.View
      style={[{ transform: [{ scale: scaleAnim }] }, fullWidth && styles.fullWidth]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        disabled={isDisabled}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        {...rest}
        onPress={
          onPress
            ? (e) => {
                if (wantsHaptic) haptics.tap();
                onPress(e);
              }
            : undefined
        }
        style={({ pressed }) => [
          styles.base,
          {
            // Pill buttons — the v2 silhouette.
            borderRadius: t.radius.pill,
            paddingHorizontal: t.spacing.xl,
          },
          container,
          fullWidth && styles.fullWidth,
          isDisabled && styles.disabled,
          pressed && pressedStyle,
          // Web hover/press transition
          Platform.OS === 'web' && ({
            // @ts-expect-error — web-only CSS transition
            transition: 'all 0.2s ease',
          } as ViewStyle),
        ]}
      >
        <View style={styles.content}>
          {loading ? (
            <ActivityIndicator color={textColor} size="small" />
          ) : (
            <>
              {leftIcon}
              <Text
                style={[
                  t.typography.bodyStrong,
                  {
                    color: textColor,
                    letterSpacing: 0.2,
                  },
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

function getStyles(t: ReturnType<typeof useTheme>, variant: Variant) {
  switch (variant) {
    case 'primary':
      return {
        container: {
          backgroundColor: t.colors.primary,
          ...t.shadows.md(t.colors.glowPrimary),
        } as ViewStyle,
        textColor: t.colors.primaryText,
        pressedStyle: {
          backgroundColor: t.colors.primaryDark,
          ...t.shadows.sm(t.colors.glowPrimary),
        } as ViewStyle,
      };
    case 'secondary':
      return {
        container: {
          backgroundColor: t.colors.bgElevated,
          borderWidth: 1.5,
          borderColor: t.colors.border,
          ...t.shadows.sm(t.colors.shadowColor),
        } as ViewStyle,
        textColor: t.colors.text,
        pressedStyle: {
          backgroundColor: t.colors.bgMuted,
          borderColor: t.colors.primary,
        } as ViewStyle,
      };
    case 'danger':
      return {
        container: {
          backgroundColor: t.colors.danger,
          ...t.shadows.md(t.colors.shadowColor),
        } as ViewStyle,
        textColor: t.colors.dangerText,
        pressedStyle: {
          opacity: 0.85,
        } as ViewStyle,
      };
    case 'ghost':
      return {
        container: {
          backgroundColor: 'transparent',
        } as ViewStyle,
        // primaryInk: 16px label text needs 4.5:1 on the paper bg (X3.1).
        textColor: t.colors.primaryInk,
        pressedStyle: {
          backgroundColor: t.colors.gradientSubtle,
        } as ViewStyle,
      };
  }
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  fullWidth: { alignSelf: 'stretch' },
  disabled: { opacity: 0.5 },
});
