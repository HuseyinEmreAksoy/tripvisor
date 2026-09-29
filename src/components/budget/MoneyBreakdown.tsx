/**
 * Multi-currency pieces of the budget card (M5 Y3.2), presentational only:
 *
 *   RateModeToggle     — "At entry rate | At today's rate" (useTripMoneySummary rateMode).
 *   PendingRatesChip   — "2 rates pending": rows excluded from totals until a
 *                        rate arrives, with their amounts per ORIGINAL currency.
 *   CurrencyBreakdown  — one row per original currency: what was spent in it
 *                        and what that is in the home currency.
 *
 * Money rule: every amount renders with the currency of the value it came
 * from (MoneyValue.currency) — pending amounts in their original currency,
 * never converted 1:1.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { formatMoney, useT } from '@/i18n';
import { SegmentedControl } from '@/components/SegmentedControl';
import { add, moneyValue } from '@/lib/money';
import type { CurrencyBreakdown as CurrencySlice, MoneyValue, PendingReport, RateMode } from '@/lib/money/types';

function joinAmounts(values: Record<string, MoneyValue>): string {
  return Object.values(values)
    .filter((v) => v.value > 0)
    .map((v) => formatMoney(v.value, v.currency))
    .join(' · ');
}

/** Pending amounts (actual + estimated) per original currency, formatted. */
export function pendingAmountsText(pending: PendingReport): string {
  const merged: Record<string, MoneyValue> = {};
  for (const source of [pending.actualByCurrency, pending.estimatedByCurrency]) {
    for (const [code, v] of Object.entries(source)) {
      const prev = merged[code];
      merged[code] = prev ? moneyValue(add(prev.exact, v.exact), code) : v;
    }
  }
  return joinAmounts(merged);
}

export function RateModeToggle({ value, onChange }: { value: RateMode; onChange: (mode: RateMode) => void }) {
  const { t: tx } = useT('money');
  return (
    <SegmentedControl<RateMode>
      label={tx('rates.label')}
      value={value}
      onChange={onChange}
      options={[
        { value: 'entry', label: tx('rates.entry') },
        { value: 'today', label: tx('rates.today') },
      ]}
    />
  );
}

export function PendingRatesChip({ pending }: { pending: PendingReport }) {
  const t = useTheme();
  const { t: tx } = useT('money');
  if (pending.count <= 0) return null;
  const amounts = pendingAmountsText(pending);
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={tx('pending.a11y', { count: pending.count, amounts })}
      style={[
        styles.pending,
        {
          backgroundColor: t.colors.warningLight,
          borderRadius: t.radius.md,
          paddingHorizontal: t.spacing.sm,
          paddingVertical: t.spacing.xs,
          gap: 2,
        },
      ]}
    >
      <Text style={[t.typography.caption, { color: t.colors.warningText, fontWeight: '700' }]}>
        {tx('pending.chip', { count: pending.count })}
      </Text>
      {amounts ? (
        <Text style={[t.typography.small, { color: t.colors.warningText }]}>
          {tx('pending.detail', { amounts })}
        </Text>
      ) : null}
    </View>
  );
}

export interface CurrencyBreakdownProps {
  home: string;
  slices: readonly CurrencySlice[];
}

/** Rendered only when there is something foreign to break down. */
export function CurrencyBreakdownList({ home, slices }: CurrencyBreakdownProps) {
  const t = useTheme();
  const { t: tx } = useT('money');
  const foreign = slices.some((s) => s.currency !== home);
  if (!foreign) return null;
  return (
    <View style={{ gap: t.spacing.xs }}>
      <Text style={[t.typography.overline, { color: t.colors.textMuted }]} accessibilityRole="header" aria-level={5}>
        {tx('breakdown.title')}
      </Text>
      {slices.map((slice) => (
        <CurrencyRow key={slice.currency} slice={slice} isHome={slice.currency === home} />
      ))}
    </View>
  );
}

function CurrencyRow({ slice, isHome }: { slice: CurrencySlice; isHome: boolean }) {
  const t = useTheme();
  const { t: tx } = useT('money');
  // Spent (actual) is the headline; a currency with only estimates shows those.
  const useActual = slice.original.actual.value > 0 || slice.original.estimated.value === 0;
  const original = useActual ? slice.original.actual : slice.original.estimated;
  const converted = useActual ? slice.converted.actual : slice.converted.estimated;
  const pendingPart = useActual ? slice.pending.actual : slice.pending.estimated;
  const originalText = formatMoney(original.value, original.currency);
  const convertedText = formatMoney(converted.value, converted.currency);
  const pendingText = pendingPart.value > 0 ? formatMoney(pendingPart.value, pendingPart.currency) : null;
  const kindKey = useActual ? 'breakdown.spent' : 'breakdown.estimated';

  const a11y = [
    isHome
      ? tx('breakdown.rowHomeA11y', { code: slice.currency, amount: originalText, count: slice.count })
      : tx('breakdown.rowA11y', { code: slice.currency, amount: originalText, converted: convertedText, count: slice.count }),
    pendingText ? tx('breakdown.pendingPart', { amount: pendingText }) : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View
      accessible
      accessibilityLabel={a11y}
      style={[styles.row, { gap: t.spacing.sm, paddingVertical: t.spacing.xs }]}
    >
      <View
        style={[
          styles.codeBadge,
          {
            backgroundColor: isHome ? t.colors.gradientSubtle : t.colors.bgMuted,
            borderRadius: t.radius.sm,
            paddingHorizontal: t.spacing.xs,
          },
        ]}
      >
        <Text style={[t.typography.caption, { color: isHome ? t.colors.primaryInk : t.colors.text, fontWeight: '700' }]}>
          {slice.currency}
        </Text>
      </View>
      <View style={styles.flex}>
        <Text style={[t.typography.caption, { color: t.colors.text, fontWeight: '600' }]}>{originalText}</Text>
        <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
          {tx(kindKey, { count: slice.count })}
          {pendingText ? ` · ${tx('breakdown.pendingPart', { amount: pendingText })}` : ''}
        </Text>
      </View>
      {!isHome ? (
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
          {tx('preview.converted', { amount: convertedText })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pending: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center' },
  codeBadge: { minWidth: 44, minHeight: 24, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
});
