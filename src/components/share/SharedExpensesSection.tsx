/**
 * SharedExpensesSection — the public page's expense SUMMARY (M5 Y3.5).
 * Rendered only when the owner turned "Expense summary" on (the payload then
 * carries `expenses`). Line items never reach the client.
 *
 *   Expenses                         12 expenses · totals in TRY
 *   Spent ₺18.450,00     Planned ₺20.000,00
 *   By category   ████████ Food & drink  ₺6.200,00 …
 *   Paid in       €240,00 · 4 expenses   ₺9.100,00 · 8 expenses
 *   ⓘ 1 expense is waiting for an exchange rate …
 *
 * Totals / categories are in `homeCurrency` (pending conversions excluded);
 * the currency breakdown shows ORIGINAL amounts per original currency.
 */
import { StyleSheet, Text, View } from 'react-native';
import { surfaceStyle, useTheme, type Theme } from '@/theme';
import { formatMoney, useAppLocale, useT } from '@/i18n';
import type { SharedExpenseSummary } from '@/api/share';
import { Icon } from '../Icon';

const CATEGORY_KEYS = {
  accommodation: 'expenses.category.accommodation',
  food: 'expenses.category.food',
  transport: 'expenses.category.transport',
  shopping: 'expenses.category.shopping',
  activities: 'expenses.category.activities',
  other: 'expenses.category.other',
} as const;

type KnownCategory = keyof typeof CATEGORY_KEYS;

function isKnownCategory(c: string): c is KnownCategory {
  return c in CATEGORY_KEYS;
}

function categoryColor(t: Theme, category: string): string {
  switch (category) {
    case 'accommodation':
      return t.colors.chartAccommodation;
    case 'food':
      return t.colors.chartFood;
    case 'transport':
      return t.colors.chartTransport;
    case 'shopping':
      return t.colors.chartShopping;
    case 'activities':
      return t.colors.chartActivities;
    default:
      return t.colors.chartOther;
  }
}

export function SharedExpensesSection({ summary }: { summary: SharedExpenseSummary }) {
  const t = useTheme();
  const { t: tx } = useT('share');
  const { language } = useAppLocale();
  const home = summary.homeCurrency;
  const money = (amount: number, currency: string) => formatMoney(amount, currency, {}, language);

  // Categories rank by what was spent; before the trip only plans exist.
  const basis: 'actual' | 'estimated' = summary.totals.actual > 0 || summary.totals.estimated <= 0 ? 'actual' : 'estimated';
  const categories = summary.byCategory
    .map((c) => ({ ...c, value: c[basis] }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value);
  const maxCategory = categories.reduce((m, c) => Math.max(m, c.value), 0);
  const currencies = summary.byCurrency.filter((c) => c.count > 0);

  return (
    <View style={[surfaceStyle(t, 'raised'), { padding: t.spacing.lg, gap: t.spacing.lg }]}>
      <View style={{ gap: 2 }}>
        <Text style={[t.typography.subtitle, { color: t.colors.text }]} accessibilityRole="header" aria-level={2}>
          {tx('expenses.title')}
        </Text>
        {summary.count > 0 ? (
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
            {tx('expenses.summary', { count: summary.count, currency: home })}
          </Text>
        ) : null}
      </View>

      {summary.count === 0 ? (
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>{tx('expenses.empty')}</Text>
      ) : (
        <>
          <View style={[styles.totals, { gap: t.spacing.md }]}>
            <Total label={tx('expenses.spent')} value={money(summary.totals.actual, home)} />
            {summary.totals.estimated > 0 ? (
              <Total label={tx('expenses.planned')} value={money(summary.totals.estimated, home)} muted />
            ) : null}
          </View>

          {categories.length > 0 ? (
            <View style={{ gap: t.spacing.sm }}>
              <Text style={[t.typography.caption, { color: t.colors.text, fontWeight: '700' }]}>
                {tx('expenses.byCategory')}
              </Text>
              {categories.map((c) => {
                const label = isKnownCategory(c.category) ? tx(CATEGORY_KEYS[c.category]) : c.category;
                const amount = money(c.value, home);
                const share = maxCategory > 0 ? c.value / maxCategory : 0;
                return (
                  <View key={c.category} style={{ gap: 4 }} accessible accessibilityLabel={tx('a11y.pair', { label, value: amount })}>
                    <View style={[styles.between, { gap: t.spacing.sm }]}>
                      <Text style={[t.typography.caption, { color: t.colors.text, flexShrink: 1 }]} numberOfLines={1}>
                        {label}
                      </Text>
                      <Text style={[t.typography.caption, { color: t.colors.text, fontWeight: '600' }]}>{amount}</Text>
                    </View>
                    <View style={[styles.track, { backgroundColor: t.colors.bgMuted, borderRadius: t.radius.pill }]}>
                      <View
                        style={[
                          styles.bar,
                          {
                            width: `${Math.max(4, Math.round(share * 100))}%`,
                            backgroundColor: categoryColor(t, c.category),
                            borderRadius: t.radius.pill,
                          },
                        ]}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {currencies.length > 0 ? (
            <View style={{ gap: t.spacing.sm }}>
              <Text style={[t.typography.caption, { color: t.colors.text, fontWeight: '700' }]}>
                {tx('expenses.byCurrency')}
              </Text>
              <View style={[styles.wrap, { gap: t.spacing.sm }]}>
                {currencies.map((c) => {
                  const amount = money(c.actual > 0 ? c.actual : c.estimated, c.currency);
                  const count = tx('expenses.currencyCount', { count: c.count });
                  return (
                    <View
                      key={c.currency}
                      accessible
                      accessibilityLabel={tx('a11y.list', { first: amount, second: count })}
                      style={[
                        styles.chip,
                        { backgroundColor: t.colors.bgMuted, borderRadius: t.radius.pill, paddingHorizontal: t.spacing.md },
                      ]}
                    >
                      <Text style={[t.typography.caption, { color: t.colors.text, fontWeight: '700' }]}>{amount}</Text>
                      <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{count}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          {summary.pending.count > 0 ? (
            <View style={[styles.row, { gap: t.spacing.sm }]}>
              <Icon name="hourglass" size={16} color={t.colors.warningText} />
              <Text style={[t.typography.small, { color: t.colors.warningText, flex: 1 }]}>
                {tx('expenses.pending', { count: summary.pending.count })}
              </Text>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function Total({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  const { t: tx } = useT('share');
  const t = useTheme();
  return (
    <View
      style={[styles.total, { backgroundColor: t.colors.bgMuted, borderRadius: t.radius.lg, padding: t.spacing.md }]}
      accessible
      accessibilityLabel={tx('a11y.pair', { label, value })}
    >
      <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{label}</Text>
      <Text style={[t.typography.title, { color: muted ? t.colors.textMuted : t.colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  totals: { flexDirection: 'row', flexWrap: 'wrap' },
  total: { flexGrow: 1, flexBasis: 140, gap: 2 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  track: { height: 8, overflow: 'hidden' },
  bar: { height: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { minHeight: 36, justifyContent: 'center', paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center' },
});
