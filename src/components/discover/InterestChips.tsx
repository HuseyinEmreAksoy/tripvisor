/**
 * InterestChips — the multi-select interest row (M5 Y3.4), shared by
 * Discover, the onboarding interests card and Profile → Travel preferences.
 * Each chip is a checkbox (role + checked state), 44 pt tall, wraps on
 * narrow screens.
 */
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { haptics } from '@/lib/haptics';
import { useT } from '@/i18n';
import { Icon } from '@/components/Icon';
import { INTERESTS, INTEREST_ICONS, interestLabelKey, toggleInterest, type Interest } from './discoverModel';

export interface InterestChipsProps {
  value: readonly Interest[];
  onChange: (next: Interest[]) => void;
  disabled?: boolean;
  /** Centre the chips (onboarding card). */
  centered?: boolean;
}

export function InterestChips({ value, onChange, disabled, centered }: InterestChipsProps) {
  const t = useTheme();
  const { t: tx } = useT(['discover']);
  const selected = new Set(value);
  return (
    <View
      style={[styles.wrap, { gap: t.spacing.sm }, centered && styles.centered]}
      accessibilityRole="none"
      accessibilityLabel={tx('interestsGroupA11y')}
      aria-label={tx('interestsGroupA11y')}
      role="group"
    >
      {INTERESTS.map((i) => {
        const on = selected.has(i);
        const color = on ? t.colors.primaryText : t.colors.text;
        const label = tx(interestLabelKey(i));
        return (
          <Pressable
            key={i}
            testID={`interest-${i}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: !!disabled }}
            accessibilityLabel={label}
            disabled={disabled}
            onPress={() => {
              haptics.select();
              onChange(toggleInterest(value, i));
            }}
            style={({ pressed }) => [
              styles.chip,
              {
                gap: t.spacing.xs,
                paddingHorizontal: t.spacing.md,
                borderRadius: t.radius.pill,
                backgroundColor: on ? t.colors.primary : t.colors.cardBgSolid,
                borderColor: on ? t.colors.primary : t.colors.border,
              },
              pressed && { opacity: 0.8 },
              disabled && { opacity: 0.5 },
              Platform.OS === 'web' && ({ cursor: disabled ? 'default' : 'pointer' } as ViewStyle),
            ]}
          >
            <Icon name={on ? 'check' : INTEREST_ICONS[i]} size={16} color={color} />
            <Text style={[t.typography.caption, { color, fontWeight: on ? '700' : '500' }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  centered: { justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderWidth: 1 },
});
