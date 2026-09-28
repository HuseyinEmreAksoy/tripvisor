/**
 * TodayAction — compact pill action used across the Today cards
 * (Navigate, Done, Skip, Open on map, …). 44pt min target, icon optional.
 */
import { Platform, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { useTheme } from '@/theme';
import { MIN_TOUCH } from './todayStyles';

export interface TodayActionProps {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'ghost';
  accessibilityLabel?: string;
  accessibilityHint?: string;
  disabled?: boolean;
  /** Stretch to fill the row (phones). */
  grow?: boolean;
}

export function TodayAction({
  label,
  onPress,
  icon,
  variant = 'secondary',
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
  grow = false,
}: TodayActionProps) {
  const t = useTheme();
  const fg =
    variant === 'primary' ? t.colors.primaryText : variant === 'ghost' ? t.colors.primary : t.colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        {
          borderRadius: t.radius.pill,
          paddingHorizontal: t.spacing.lg,
          gap: t.spacing.xs,
          opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
        },
        variant === 'primary' && { backgroundColor: pressed ? t.colors.primaryDark : t.colors.primary },
        variant === 'secondary' && {
          backgroundColor: t.colors.bgElevated,
          borderWidth: 1.5,
          borderColor: t.colors.border,
        },
        grow && styles.grow,
        Platform.OS === 'web' && ({ cursor: disabled ? 'default' : 'pointer' } as ViewStyle),
      ]}
    >
      {icon ? <Icon name={icon} size={18} color={fg} /> : null}
      <Text style={[t.typography.bodyStrong, { color: fg, fontSize: 15 }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flexGrow: 1, flexBasis: 0 },
});
