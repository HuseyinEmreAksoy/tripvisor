/**
 * BudgetCard — summary card showing `totalActual / budget` with a colour-coded
 * progress bar. Consumed by the Settings tab in trip detail.
 *
 * Bar colour:
 *   - Green  (budgetOk)   : actual ≤ 80% of budget
 *   - Amber  (budgetWarn) : actual is 80–100% of budget
 *   - Red    (budgetOverLimit) : actual > budget
 *   - No budget configured → "Set budget" CTA instead of a bar.
 *
 * Props:
 *   rollup     — from useTripExpenseRollup; never call the hook directly here
 *                so the parent controls re-render budgets.
 *   currency   — from trip.currency; drives Intl.NumberFormat formatting.
 *   onSetBudget — opens the BudgetEditSheet.
 *   canEdit    — whether the current user may set / edit the budget.
 */
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { formatCurrency } from '@/lib/formatCurrency';
import { haptics } from '@/lib/haptics';
import type { TripExpenseRollup } from '@/api/trip-expenses';

export interface BudgetCardProps {
  rollup: TripExpenseRollup;
  /** Trip's currency code; null/undefined falls back to USD. */
  currency?: string | null;
  onSetBudget: () => void;
  canEdit: boolean;
  /** X2.4: when set (and canEdit), shows a one-tap "Add expense" quick action. */
  onAddExpense?: () => void;
}

export function BudgetCard({ rollup, currency, onSetBudget, canEdit, onAddExpense }: BudgetCardProps) {
  const t = useTheme();

  const { hasBudget, budget, totalActual, totalEstimated, remaining } = rollup;

  // Determine progress bar width (0–1) and colour token.
  const { barFraction, barColor, barBg } = useMemo(() => {
    if (!hasBudget || !budget) {
      return { barFraction: 0, barColor: t.colors.budgetOk, barBg: t.colors.budgetOkLight };
    }
    const fraction = Math.min(totalActual / budget, 1.2); // cap visual at 120% so it doesn't break layout
    const displayFraction = Math.min(fraction, 1);
    if (totalActual > budget) {
      return { barFraction: 1, barColor: t.colors.budgetOverLimit, barBg: t.colors.budgetOverLimitLight };
    }
    if (fraction >= 0.8) {
      return { barFraction: displayFraction, barColor: t.colors.budgetWarn, barBg: t.colors.budgetWarnLight };
    }
    return { barFraction: displayFraction, barColor: t.colors.budgetOk, barBg: t.colors.budgetOkLight };
  }, [hasBudget, budget, totalActual, t.colors]);

  const pct = hasBudget && budget
    ? Math.round((totalActual / budget) * 100)
    : null;

  const fmt = (amount: number) => formatCurrency(amount, currency);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: t.colors.bgElevated,
          borderColor: t.colors.border,
          borderRadius: t.radius.lg,
          padding: t.spacing.lg,
          gap: t.spacing.md,
          ...t.shadows.sm(t.colors.shadowColor),
        },
      ]}
    >
      {/* Header row */}
      <View style={styles.row}>
        <Text
          style={[t.typography.subtitle, { color: t.colors.text }]}
          accessibilityRole="header"
          aria-level={4}
        >
          Budget
        </Text>
        {canEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hasBudget ? 'Edit budget' : 'Set budget'}
            onPress={onSetBudget}
            style={({ pressed }) => [
              styles.editBtn,
              {
                backgroundColor: pressed ? t.colors.gradientSubtle : 'transparent',
                borderRadius: t.radius.sm,
                paddingHorizontal: t.spacing.sm,
                paddingVertical: t.spacing.xs,
              },
            ]}
          >
            <Text style={[t.typography.caption, { color: t.colors.primary, fontWeight: '600' }]}>
              {hasBudget ? 'Edit' : 'Set budget'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {hasBudget && budget ? (
        <>
          {/* Amounts row — one screen-reader stop for the summary; the card
              itself is not `accessible` so its buttons stay reachable. */}
          <View
            style={styles.row}
            accessible
            accessibilityLabel={`Budget: ${fmt(totalActual)} spent of ${fmt(budget)}, ${pct}%`}
          >
            <View>
              <Text style={[t.typography.display, { color: t.colors.text, fontSize: 28, lineHeight: 34 }]}>
                {fmt(totalActual)}
              </Text>
              <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
                actual spend
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[t.typography.bodyStrong, { color: t.colors.textMuted }]}>
                of {fmt(budget)}
              </Text>
              {remaining !== null ? (
                <Text
                  style={[
                    t.typography.caption,
                    {
                      color: remaining >= 0 ? t.colors.budgetOk : t.colors.budgetOverLimit,
                      fontWeight: '600',
                    },
                  ]}
                >
                  {remaining >= 0
                    ? `${fmt(remaining)} remaining`
                    : `${fmt(Math.abs(remaining))} over budget`}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Progress bar */}
          <View
            style={[
              styles.barTrack,
              { backgroundColor: barBg, borderRadius: t.radius.pill },
            ]}
            accessibilityRole="progressbar"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {...({ 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 } as any)}
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

          {pct !== null ? (
            <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
              {pct}% of budget used · estimated {fmt(totalEstimated)}
            </Text>
          ) : null}
        </>
      ) : (
        <View style={{ gap: t.spacing.sm }}>
          <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
            No trip budget set. Add one to track your spending.
          </Text>
          {totalActual > 0 || totalEstimated > 0 ? (
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
              {totalEstimated > 0 ? `Estimated: ${fmt(totalEstimated)}` : ''}
              {totalEstimated > 0 && totalActual > 0 ? ' · ' : ''}
              {totalActual > 0 ? `Actual: ${fmt(totalActual)}` : ''}
            </Text>
          ) : null}
          {canEdit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Set trip budget"
              onPress={onSetBudget}
              style={({ pressed }) => [
                styles.ctaBtn,
                {
                  backgroundColor: pressed ? t.colors.primaryDark : t.colors.primary,
                  borderRadius: t.radius.md,
                  padding: t.spacing.sm,
                  alignItems: 'center',
                },
              ]}
            >
              <Text style={[t.typography.caption, { color: t.colors.primaryText, fontWeight: '600' }]}>
                Set budget
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {canEdit && onAddExpense ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add expense"
          onPress={() => {
            haptics.tap();
            onAddExpense();
          }}
          style={({ pressed }) => [
            styles.quickAdd,
            {
              borderColor: t.colors.primary,
              backgroundColor: pressed ? t.colors.gradientSubtle : 'transparent',
              borderRadius: t.radius.pill,
            },
          ]}
        >
          <Text style={[t.typography.caption, { color: t.colors.primary, fontWeight: '700' }]}>
            + Add expense
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  editBtn: { minHeight: 36, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  barTrack: { height: 8, width: '100%', overflow: 'hidden' },
  barFill: { height: '100%' },
  ctaBtn: {},
  quickAdd: { borderWidth: 1.5, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
