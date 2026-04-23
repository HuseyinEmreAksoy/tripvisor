import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps } from 'react-native';
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
  const { container, textColor } = getStyles(t, variant);
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      {...rest}
      style={({ pressed }) => [
        styles.base,
        { borderRadius: t.radius.md, paddingHorizontal: t.spacing.lg },
        container,
        fullWidth && styles.fullWidth,
        (pressed || isDisabled) && styles.dim,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={textColor} size="small" />
        ) : (
          <>
            {leftIcon}
            <Text style={[t.typography.bodyStrong, { color: textColor }]} numberOfLines={1}>
              {label}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

function getStyles(t: ReturnType<typeof useTheme>, variant: Variant) {
  switch (variant) {
    case 'primary':
      return {
        container: { backgroundColor: t.colors.primary },
        textColor: t.colors.primaryText,
      };
    case 'secondary':
      return {
        container: {
          backgroundColor: t.colors.bgElevated,
          borderWidth: 1,
          borderColor: t.colors.border,
        },
        textColor: t.colors.text,
      };
    case 'danger':
      return {
        container: { backgroundColor: t.colors.danger },
        textColor: '#FFFFFF',
      };
    case 'ghost':
      return {
        container: { backgroundColor: 'transparent' },
        textColor: t.colors.primary,
      };
  }
}

const styles = StyleSheet.create({
  base: { height: 48, justifyContent: 'center' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  fullWidth: { alignSelf: 'stretch' },
  dim: { opacity: 0.6 },
});
