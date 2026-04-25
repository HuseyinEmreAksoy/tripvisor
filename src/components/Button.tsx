import { useRef, useEffect } from 'react';
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

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: Variant;
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
}

export function Button({
  label,
  variant = 'primary',
  loading = false,
  fullWidth = true,
  leftIcon,
  disabled,
  ...rest
}: ButtonProps) {
  const t = useTheme();
  const { container, textColor, pressedStyle } = getStyles(t, variant);
  const isDisabled = disabled || loading;

  // Animated scale for press feedback
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 6,
    }).start();
  };

  // Fade in on mount
  const opacityAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacityAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [opacityAnim]);

  return (
    <Animated.View
      style={[
        { transform: [{ scale: scaleAnim }], opacity: opacityAnim },
        fullWidth && styles.fullWidth,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        disabled={isDisabled}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        {...rest}
        style={({ pressed }) => [
          styles.base,
          {
            borderRadius: t.radius.lg,
            paddingHorizontal: t.spacing.xl,
          },
          container,
          fullWidth && styles.fullWidth,
          isDisabled && styles.disabled,
          pressed && pressedStyle,
          // Web hover effect
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
                    letterSpacing: 0.3,
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
          backgroundColor: t.colors.cardBg,
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
          ...t.shadows.md(t.colors.danger),
        } as ViewStyle,
        textColor: '#FFFFFF',
        pressedStyle: {
          opacity: 0.85,
        } as ViewStyle,
      };
    case 'ghost':
      return {
        container: {
          backgroundColor: 'transparent',
        } as ViewStyle,
        textColor: t.colors.primary,
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
