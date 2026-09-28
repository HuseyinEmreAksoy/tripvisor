/**
 * DiffRow — one reviewable change inside the AI edit diff preview
 * (v2 Phase N4 step 4.1).
 *
 * The WHOLE row is a single checkbox (include / exclude this change):
 * default included; excluded rows dim but stay in place so re-including is
 * one tap (forgiving, mirrors DraftPlaceCard's removed state). Nothing is
 * written until the sheet's "Apply" runs.
 *
 * Memoized: the preview list re-renders on every toggle; with the parent's
 * useCallback'd handler only the touched row re-renders.
 */
import { memo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { Icon } from '@/components/Icon';

export interface DiffRowProps {
  /** Stable row identity inside the diff (also handed back by onToggle). */
  rowKey: string;
  /** Place name (canonical Google name for adds — exposes wrong groundings). */
  title: string;
  /** Change detail, e.g. "Day 2 → Day 3" or "1h 30m → 45m". */
  detail?: string | null;
  /** Small trailing pill, e.g. "Day 2" for adds. */
  chip?: string | null;
  /** 'remove' tints the title red. */
  tone?: 'default' | 'remove';
  included: boolean;
  onToggle: (rowKey: string) => void;
  disabled?: boolean;
}

export const DiffRow = memo(function DiffRow({
  rowKey,
  title,
  detail,
  chip,
  tone = 'default',
  included,
  onToggle,
  disabled,
}: DiffRowProps) {
  const t = useTheme();

  const a11yLabel = [title, detail, chip].filter(Boolean).join(', ');

  return (
    <Pressable
      // The row itself is the checkbox — screen readers toggle it directly.
      accessibilityRole="checkbox"
      accessibilityState={{ checked: included, disabled: disabled === true }}
      accessibilityLabel={a11yLabel}
      accessibilityHint="Unchecked changes won't be applied"
      disabled={disabled}
      onPress={() => onToggle(rowKey)}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: t.colors.cardBgSolid,
          borderColor: t.colors.border,
          borderRadius: t.radius.md,
          padding: t.spacing.md,
          gap: t.spacing.sm,
          opacity: disabled ? 0.5 : included ? (pressed ? 0.8 : 1) : 0.45,
        },
        Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
      ]}
    >
      {/* Checkbox square (visual only — the row carries the a11y role). */}
      <View
        style={[
          styles.checkbox,
          {
            borderColor: included ? t.colors.primary : t.colors.borderStrong,
            backgroundColor: included ? t.colors.primary : 'transparent',
            borderRadius: t.radius.sm,
          },
        ]}
      >
        {included ? <Icon name="check" size={14} strokeWidth={3} color={t.colors.primaryText} /> : null}
      </View>

      <View style={styles.textBlock}>
        <Text
          style={[
            t.typography.bodyStrong,
            { color: tone === 'remove' ? t.colors.danger : t.colors.text },
          ]}
          numberOfLines={2}
        >
          {title}
        </Text>
        {detail ? (
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>

      {chip ? (
        <View
          style={[
            styles.chip,
            {
              backgroundColor: t.colors.bgMuted,
              borderRadius: t.radius.pill,
              paddingHorizontal: t.spacing.sm,
            },
          ]}
        >
          <Text style={[t.typography.small, { color: t.colors.textMuted, fontWeight: '600' }]}>
            {chip}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    minHeight: 56,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBlock: { flex: 1, gap: 2 },
  chip: { paddingVertical: 2 },
});
