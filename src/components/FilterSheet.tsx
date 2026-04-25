/**
 * FilterSheet
 *
 * A generic BottomSheet that presents a list of selectable options.
 * Each option shows a checkmark when selected.
 *
 * Usage:
 *   <FilterSheet
 *     visible={open}
 *     onClose={() => setOpen(false)}
 *     title="Filter trips"
 *     options={[
 *       { value: 'all', label: 'All' },
 *       { value: 'upcoming', label: 'Upcoming' },
 *       { value: 'past', label: 'Past' },
 *     ]}
 *     selected="all"
 *     onSelect={(value) => setFilter(value)}
 *   />
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { useTheme } from '@/theme';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FilterOption<T extends string = string> {
  value: T;
  label: string;
}

export interface FilterSheetProps<T extends string = string> {
  visible: boolean;
  onClose: () => void;
  /** Displayed as the sheet heading. */
  title: string;
  options: FilterOption<T>[];
  selected: T;
  /** Called with the new value and then the sheet closes automatically. */
  onSelect: (value: T) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function FilterSheet<T extends string = string>({
  visible,
  onClose,
  title,
  options,
  selected,
  onSelect,
}: FilterSheetProps<T>) {
  const t = useTheme();

  const handleSelect = (value: T) => {
    onSelect(value);
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel={title}
    >
      {/* ─── Sheet title ─────────────────────────────────────────────── */}
      <Text
        style={[
          t.typography.bodyStrong,
          { color: t.colors.textMuted, marginBottom: t.spacing.xs },
        ]}
        accessibilityRole="header"
      >
        {title}
      </Text>

      {/* ─── Option rows ─────────────────────────────────────────────── */}
      {/*
        accessibilityRole="radiogroup" wraps the option set so screen readers
        announce "1 of N" / "2 of N" relative to a meaningful group rather
        than treating each row as an isolated radio. RN-Web maps this to the
        ARIA `radiogroup` role; native a11y APIs ignore unknown roles
        gracefully (no warning), so it's safe across all three platforms.
      */}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={`${title} options`}
      >
        {options.map((opt) => {
          const isSelected = opt.value === selected;
          return (
            <Pressable
              key={opt.value}
              accessibilityRole="radio"
              accessibilityLabel={opt.label}
              // Announce selection state to screen readers.
              accessibilityState={{ checked: isSelected }}
              onPress={() => handleSelect(opt.value)}
              style={({ pressed }) => [
                styles.row,
                {
                  borderRadius: t.radius.md,
                  paddingVertical: t.spacing.md,
                  paddingHorizontal: t.spacing.lg,
                  backgroundColor: pressed ? t.colors.bgMuted : 'transparent',
                },
              ]}
            >
              <Text
                style={[
                  t.typography.body,
                  { color: isSelected ? t.colors.primary : t.colors.text, flex: 1 },
                ]}
              >
                {opt.label}
              </Text>
              {isSelected ? (
                <Text
                  style={{ color: t.colors.primary, fontSize: 16, lineHeight: 22 }}
                  // The checkmark is decorative — the accessibilityState above
                  // already communicates selection.
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                >
                  ✓
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {/* ─── Divider + Cancel ────────────────────────────────────────── */}
      <View style={[styles.divider, { backgroundColor: t.colors.border }]} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel"
        onPress={onClose}
        style={({ pressed }) => [
          styles.row,
          {
            borderRadius: t.radius.md,
            paddingVertical: t.spacing.md,
            paddingHorizontal: t.spacing.lg,
            backgroundColor: pressed ? t.colors.bgMuted : 'transparent',
          },
        ]}
      >
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>Cancel</Text>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 44, justifyContent: 'center', flexDirection: 'row', alignItems: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
});
