/**
 * BudgetCard — the trip budget summary: `spent / budget` with a colour-coded
 * progress bar, in the trip's HOME currency.
 *
 * Bar colour: green ≤ 80% · amber 80–100% · red > budget. No budget → a
 * "Set budget" CTA instead of the bar.
 *
 * M5 Y3.2 multi-currency: when the trip id is known (the `tripId` prop, or
 * the /trip/[id] route param), the card reads useTripMoneySummary itself and
 * adds:
 *   - "All totals in TRY" (every number is converted into the home currency),
 *   - an "At entry rate | At today's rate" toggle once foreign expenses exist,
 *   - a "N rates pending" chip (rows excluded from totals, listed per original
 *     currency — never counted 1:1),
 *   - a per-currency breakdown (original amount → ≈ home amount).
 * Without a trip id it renders the parent's `rollup` exactly as before.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/theme';
import { formatMoney, useT } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { Skeleton } from '@/components/Skeleton';
import { useTripMoneySummary, type TripExpenseRollup } from '@/api/trip-expenses';
import type { RateMode } from '@/lib/money/types';
import { CurrencyBreakdownList, PendingRatesChip, RateModeToggle } from './MoneyBreakdown';

export interface BudgetCardProps {
  rollup: TripExpenseRollup;
  /** Trip's HOME currency code; null/undefined falls back to the rollup's, then USD. */
  currency?: string | null;
  onSetBudget: () => void;
  canEdit: boolean;
  /** X2.4: when set (and canEdit), shows a one-tap "Add expense" quick action. */
  onAddExpense?: () => void;
  /** Y3.2: enables the multi-currency summary. Defaults to the /trip/[id] route param. */
  tripId?: string;
}

function useRouteTripId(): string | undefined {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = params?.id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

export function BudgetCard({ rollup, currency, onSetBudget, canEdit, onAddExpense, tripId }: BudgetCardProps) {
  const t = useTheme();
  const { t: tx } = useT('money');
  const routeTripId = useRouteTripId();
  const effectiveTripId = tripId ?? routeTripId;
  const [rateMode, setRateMode] = useState<RateMode>('entry');
  const money = useTripMoneySummary(effectiveTripId, { rateMode });
  const summary = money.data;

  const home = (summary?.home ?? currency ?? rollup.currency ?? 'USD').toUpperCase();
  const totalActual = summary ? summary.total.actual.value : rollup.totalActual;
  const totalEstimated = summary ? summary.total.estimated.value : rollup.totalEstimated;
  const budget = summary ? (summary.budget?.value ?? null) : rollup.budget;
  const hasBudget = summary ? summary.budget !== null && (summary.budget?.value ?? 0) > 0 : rollup.hasBudget;
  const remaining = summary ? (summary.remaining?.value ?? null) : rollup.remaining;
  const hasForeign = summary ? summary.byCurrency.some((c) => c.currency !== summary.home) : false;

  const { barFraction, barColor, barBg } = useMemo(() => {
    if (!hasBudget || !budget) {
      return { barFraction: 0, barColor: t.colors.budgetOk, barBg: t.colors.budgetOkLight };
    }
    const fraction = Math.min(totalActual / budget, 1.2);
    const displayFraction = Math.min(fraction, 1);
    if (totalActual > budget) {
      return { barFraction: 1, barColor: t.colors.budgetOverLimit, barBg: t.colors.budgetOverLimitLight };
    }
    if (fraction >= 0.8) {
      return { barFraction: displayFraction, barColor: t.colors.budgetWarn, barBg: t.colors.budgetWarnLight };
    }
    return { barFraction: displayFraction, barColor: t.colors.budgetOk, barBg: t.colors.budgetOkLight };
  }, [hasBudget, budget, totalActual, t.colors]);

  const pct = hasBudget && budget ? Math.round((totalActual / budget) * 100) : null;
  const fmt = (amount: number) => formatMoney(amount, home);
  const loading = Boolean(effectiveTripId) && money.isLoading && !summary;

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
        <View style={{ gap: 2 }}>
          <Text style={[t.typography.subtitle, { color: t.colors.text }]} accessibilityRole="header" aria-level={4}>
            {tx('budget.title')}
          </Text>
          <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{tx('budget.inHome', { code: home })}</Text>
        </View>
        {canEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hasBudget ? tx('budget.editA11y') : tx('budget.setBudget')}
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
            <Text style={[t.typography.caption, { color: t.colors.primaryInk, fontWeight: '600' }]}>
              {hasBudget ? tx('budget.edit') : tx('budget.setBudget')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={{ gap: t.spacing.sm }} accessibilityLabel={tx('budget.loading')}>
          <Skeleton width="55%" height={30} />
          <Skeleton width="100%" height={8} radius="pill" />
          <Skeleton width="40%" height={12} />
        </View>
      ) : hasBudget && budget ? (
        <>
          <View
            style={styles.row}
            accessible
            accessibilityLabel={tx('budget.summaryA11y', { spent: fmt(totalActual), budget: fmt(budget), pct })}
          >
            <View style={styles.shrink}>
              <Text style={[t.typography.display, { color: t.colors.text, fontSize: 28, lineHeight: 34 }]}>
                {fmt(totalActual)}
              </Text>
              <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{tx('budget.actualSpend')}</Text>
            </View>
            <View style={[styles.shrink, { alignItems: 'flex-end' }]}>
              <Text style={[t.typography.bodyStrong, { color: t.colors.textMuted }]}>
                {tx('budget.of', { budget: fmt(budget) })}
              </Text>
              {remaining !== null ? (
                <Text
                  style={[
                    t.typography.caption,
                    { color: remaining >= 0 ? t.colors.budgetOk : t.colors.budgetOverLimit, fontWeight: '600' },
                  ]}
                >
                  {remaining >= 0
                    ? tx('budget.remaining', { amount: fmt(remaining) })
                    : tx('budget.over', { amount: fmt(Math.abs(remaining)) })}
                </Text>
              ) : null}
            </View>
          </View>

          <View
            style={[styles.barTrack, { backgroundColor: barBg, borderRadius: t.radius.pill }]}
            accessibilityRole="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct ?? 0}
          >
            <View
              style={[
                styles.barFill,
                { width: `${Math.round(barFraction * 100)}%`, backgroundColor: barColor, borderRadius: t.radius.pill },
              ]}
            />
          </View>

          {pct !== null ? (
            <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
              {tx('budget.pctUsed', { pct, estimated: fmt(totalEstimated) })}
            </Text>
          ) : null}
        </>
      ) : (
        <View style={{ gap: t.spacing.sm }}>
          <Text style={[t.typography.body, { color: t.colors.textMuted }]}>{tx('budget.noBudget')}</Text>
          {totalActual > 0 || totalEstimated > 0 ? (
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
              {[
                totalEstimated > 0 ? tx('budget.estimatedTotal', { amount: fmt(totalEstimated) }) : null,
                totalActual > 0 ? tx('budget.actualTotal', { amount: fmt(totalActual) }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          ) : null}
          {canEdit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tx('budget.setBudgetA11y')}
              onPress={onSetBudget}
              style={({ pressed }) => [
                {
                  backgroundColor: pressed ? t.colors.primaryDark : t.colors.primary,
                  borderRadius: t.radius.md,
                  padding: t.spacing.sm,
                  alignItems: 'center',
                  minHeight: 44,
                  justifyContent: 'center',
                },
              ]}
            >
              <Text style={[t.typography.caption, { color: t.colors.primaryText, fontWeight: '600' }]}>
                {tx('budget.setBudget')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {/* Y3.2: multi-currency — pending chip, rate toggle, per-currency breakdown */}
      {summary ? <PendingRatesChip pending={summary.pending} /> : null}
      {summary && money.error ? (
        <Text style={[t.typography.small, { color: t.colors.danger }]} accessibilityRole="alert">
          {tx('budget.loadError')}
        </Text>
      ) : null}
      {summary && hasForeign ? (
        <View style={{ gap: t.spacing.sm }}>
          <RateModeToggle value={rateMode} onChange={setRateMode} />
          {rateMode === 'today' ? (
            <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{tx('rates.todayNote')}</Text>
          ) : null}
          {money.todayRatesUnavailable ? (
            <Text style={[t.typography.small, { color: t.colors.warningText }]} accessibilityLiveRegion="polite">
              {tx('rates.todayUnavailable')}
            </Text>
          ) : money.isFetchingRates ? (
            <Text style={[t.typography.small, { color: t.colors.textMuted }]} accessibilityLiveRegion="polite">
              {tx('rates.fetching')}
            </Text>
          ) : null}
          <CurrencyBreakdownList home={summary.home} slices={summary.byCurrency} />
        </View>
      ) : null}

      {canEdit && onAddExpense ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tx('budget.addExpenseA11y')}
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
          <Text style={[t.typography.caption, { color: t.colors.primaryInk, fontWeight: '700' }]}>
            {tx('budget.addExpense')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  shrink: { flexShrink: 1 },
  editBtn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  barTrack: { height: 8, width: '100%', overflow: 'hidden' },
  barFill: { height: '100%' },
  quickAdd: { borderWidth: 1.5, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
