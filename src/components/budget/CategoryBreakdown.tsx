/**
 * CategoryBreakdown — per-category estimated vs. actual breakdown below the BudgetCard.
 *
 * Renders all six categories (zero rows show "—" placeholder values).
 * Each row has a small progress bar showing actual vs. estimated spend.
 *
 * Data comes from the `rollup.byCategory` map from `useTripExpenseRollup`.
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { formatCurrency } from '@/lib/formatCurrency';
import type { TripExpenseRollup } from '@/api/trip-expenses';
import type { TripExpenseCategory } from '@/api/types';

const CATEGORIES: Array<{ key: TripExpenseCategory; label: string; icon: string }> = [
  { key: 'accommodation', label: 'Accommodation', icon: '🏨' },
  { key: 'food', label: 'Food & Drink', icon: '🍽️' },
  { key: 'transport', label: 'Transport', icon: '🚆' },
  { key: 'shopping', label: 'Shopping', icon: '🛍️' },
  { key: 'activities', label: 'Activities', icon: '🎭' },
  { key: 'other', label: 'Other', icon: '📦' },
];

export interface CategoryBreakdownProps {
  rollup: TripExpenseRollup;
  /** Trip's currency code; null/undefined falls back to USD. */
  currency?: string | null;
}

export function CategoryBreakdown({ rollup, currency }: CategoryBreakdownProps) {
  const t = useTheme();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: t.colors.bgElevated,
          borderColor: t.colors.border,
          borderRadius: t.radius.lg,
          padding: t.spacing.lg,
          gap: t.spacing.sm,
          ...t.shadows.sm(t.colors.shadowColor),
        },
      ]}
    >
      <Text
        style={[t.typography.subtitle, { color: t.colors.text, marginBottom: t.spacing.xs }]}
        accessibilityRole="header"
        aria-level={4}
      >
        By category
      </Text>

      {CATEGORIES.map(({ key, label, icon }) => (
        <CategoryRow
          key={key}
          icon={icon}
          label={label}
          slot={rollup.byCategory[key]}
          currency={currency}
        />
      ))}
    </View>
  );
}

function CategoryRow({
  icon,
  label,
  slot,
  currency,
}: {
  icon: string;
  label: string;
  slot: TripExpenseRollup['byCategory'][TripExpenseCategory];
  currency?: string | null;
}) {
  const t = useTheme();

  const isEmpty = slot.estimated === 0 && slot.actual === 0;

  // Bar: actual as a fraction of estimated (capped at 1 for display).
  const barFraction = useMemo(() => {
    if (slot.estimated === 0) return 0;
    return Math.min(slot.actual / slot.estimated, 1);
  }, [slot.estimated, slot.actual]);

  const barColor =
    slot.actual > slot.estimated
      ? t.colors.budgetOverLimit
      : barFraction >= 0.8
        ? t.colors.budgetWarn
        : t.colors.budgetOk;

  const fmt = (n: number) => formatCurrency(n, currency);

  return (
    <View
      style={[
        styles.row,
        { paddingVertical: t.spacing.xs, gap: t.spacing.sm },
      ]}
      accessible
      accessibilityLabel={
        isEmpty
          ? `${label}: no expenses recorded`
          : `${label}: estimated ${fmt(slot.estimated)}, actual ${fmt(slot.actual)}`
      }
    >
      {/* Icon + label */}
      <Text
        style={{ fontSize: 16 }}
        accessibilityElementsHidden
        importantForAccessibility="no"
        aria-hidden
      >
        {icon}
      </Text>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={[t.typography.caption, { color: t.colors.text, fontWeight: '600' }]}>
            {label}
          </Text>
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
            {isEmpty
              ? '—'
              : `${fmt(slot.actual)} / ${fmt(slot.estimated)}`}
          </Text>
        </View>
        {!isEmpty && slot.estimated > 0 ? (
          <View
            style={[
              styles.barTrack,
              { backgroundColor: t.colors.bgMuted, borderRadius: t.radius.pill },
            ]}
          >
            <View
              style={[
                styles.barFill,
                {
                  width: `${Math.round(barFraction * 100)}%`,
                  backgroundColor: barColor,
                  borderRadius: t.radius.pill,
                },
              ]}
            />
          </View>
        ) : null}
        {/* X2.4: estimated-vs-actual variance, per category (never per-km). */}
        {!isEmpty && slot.estimated > 0 ? (
          <Text
            style={[
              t.typography.small,
              { color: slot.actual > slot.estimated ? t.colors.budgetOverLimit : t.colors.textMuted },
            ]}
          >
            {slot.actual > slot.estimated
              ? `${fmt(slot.actual - slot.estimated)} over estimate`
              : `${fmt(slot.estimated - slot.actual)} left of estimate`}
          </Text>
        ) : !isEmpty ? (
          <Text style={[t.typography.small, { color: t.colors.textMuted }]}>No estimate set</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  barTrack: { height: 4, width: '100%', overflow: 'hidden' },
  barFill: { height: '100%' },
});
