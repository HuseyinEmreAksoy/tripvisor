/**
 * ChoiceChip — single-select pill used by the quick-expense sheet (category
 * and day rows) and the per-day spend strip filter (v2 M4 X2.4).
 * Radio semantics; 40pt min height so rows stay one-thumb friendly.
 */
import { Platform, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { haptics } from '@/lib/haptics';

export interface ChoiceChipProps {
  label: string;
  /** Screen-reader label; defaults to `label`. */
  accessibilityLabel?: string;
  selected: boolean;
  onPress: () => void;
  /** Visual emphasis (e.g. "today") without selecting. */
  highlighted?: boolean;
}

export function ChoiceChip({ label, accessibilityLabel, selected, onPress, highlighted }: ChoiceChipProps) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked: selected }}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected
            ? t.colors.primary
            : pressed
              ? t.colors.gradientSubtle
              : t.colors.bgElevated,
          borderColor: selected || highlighted ? t.colors.primary : t.colors.border,
          borderRadius: t.radius.pill,
          paddingHorizontal: t.spacing.md,
        },
        Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
      ]}
    >
      <Text
        style={[
          t.typography.caption,
          { color: selected ? t.colors.primaryText : t.colors.text, fontWeight: '600' },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1.5, minHeight: 40, justifyContent: 'center', alignItems: 'center' },
});
