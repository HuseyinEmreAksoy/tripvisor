/**
 * PackingSuggestionChips — one-tap suggestion chips (v2 M4 X2.4).
 *
 * Shows the next few template suggestions not yet on the list as "+ Label"
 * chips; tapping one adds just that item (auto: true). "Add all N" keeps the
 * old bulk seed. Suggestions come from the pure `seedPackingList` (trip
 * month, length, rainy forecast) — no network here.
 */
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import type { PackingSeedItem } from '@/lib/packingSeed';

export interface PackingSuggestionChipsProps {
  /** Suggestions to show as chips (already filtered + capped by the caller). */
  chips: PackingSeedItem[];
  /** Total pending suggestions (for "Add all N"). */
  totalPending: number;
  onAddOne: (item: PackingSeedItem) => void;
  onAddAll: () => void;
  disabled?: boolean;
}

export function PackingSuggestionChips({ chips, totalPending, onAddOne, onAddAll, disabled }: PackingSuggestionChipsProps) {
  const t = useTheme();
  if (chips.length === 0) return null;

  return (
    <View style={{ gap: t.spacing.xs }}>
      <View style={styles.headRow}>
        <Text style={[t.typography.overline, { color: t.colors.textMuted }]}>✨ Suggested for this trip</Text>
        {totalPending > 1 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add all ${totalPending} suggested items`}
            onPress={onAddAll}
            disabled={disabled}
            hitSlop={8}
            style={({ pressed }) => [
              styles.addAll,
              { opacity: disabled ? 0.5 : pressed ? 0.6 : 1 },
              Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
            ]}
          >
            <Text style={[t.typography.caption, { color: t.colors.primary, fontWeight: '700' }]}>
              Add all {totalPending}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.chipRow, { gap: t.spacing.xs }]}>
        {chips.map((s) => (
          <Pressable
            key={s.label}
            accessibilityRole="button"
            accessibilityLabel={`Add ${s.label} to the packing list`}
            onPress={() => onAddOne(s)}
            disabled={disabled}
            style={({ pressed }) => [
              styles.chip,
              {
                borderColor: t.colors.primary,
                backgroundColor: pressed ? t.colors.gradientSubtle : t.colors.bgElevated,
                borderRadius: t.radius.pill,
                paddingHorizontal: t.spacing.md,
                opacity: disabled ? 0.5 : 1,
              },
              Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
            ]}
          >
            <Text style={[t.typography.caption, { color: t.colors.primary, fontWeight: '600' }]}>+ {s.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addAll: { minHeight: 32, justifyContent: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { borderWidth: 1.5, borderStyle: 'dashed', minHeight: 40, justifyContent: 'center' },
});
