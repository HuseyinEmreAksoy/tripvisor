/**
 * ExpenseList — flat list of trip_expenses rows with edit + delete affordances.
 *
 * Each row shows:
 *   - Category icon + label
 *   - Kind chip (estimated | actual)
 *   - Amount (formatted with trip currency)
 *   - Optional day_index chip
 *   - Optional label/notes (truncated to 1 line)
 *   - Edit + Delete buttons (hidden when canEdit = false)
 *
 * Props:
 *   expenses   — from useTripExpenses
 *   currency   — from trip.currency; drives Intl.NumberFormat formatting
 *   canEdit    — controls visibility of edit/delete affordances
 *   onAdd      — opens ExpenseEditSheet in "add" mode
 *   onEdit     — opens ExpenseEditSheet in "edit" mode with the selected row
 *   onDelete   — calls useDeleteTripExpense
 *
 * v2 M4 X2.4: newest first; a per-day spend strip (DailySpendStrip) sits on
 * top whenever there is actual spend, and tapping a day filters the list.
 * `tripDayCount` / `tripStartDate` are optional — without them the strip
 * spans the pinned days and labels them "D1…". Delete confirm goes through
 * the platform-split `confirmDestructive` (no `window` in shared code).
 *
 * M5 Y3.2: each row shows the amount in its OWN currency plus "≈ home" (or a
 * "rate pending" tag); the empty state uses the empty-expenses art.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '@/theme';
import { confirmDestructive } from '@/lib/confirm';
import type { TripExpense } from '@/api/types';
import { useTripMoneySummary } from '@/api/trip-expenses';
import type { RowMoney } from '@/lib/money/types';
import { formatDate, formatMoney, useT } from '@/i18n';
import { categoryMeta, dailySpend, parseLocalDate, todayDayIndex } from './expenseMath';

const EMPTY_ART = require('../../../assets/images/empty-expenses.png');

function fmtMoney(amount: number, code: string | null | undefined): string {
  return formatMoney(amount, (code ?? 'USD').toUpperCase());
}

/** Trip day `index` as "Tue 29 Sep" in the app language, or null without a start date. */
function datedDay(tripStartDate: string | null | undefined, index: number): string | null {
  const start = parseLocalDate(tripStartDate);
  if (!start) return null;
  return formatDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + index), 'weekday');
}
import { DailySpendStrip, type SpendFilter } from './DailySpendStrip';

export interface ExpenseListProps {
  expenses: TripExpense[];
  tripId: string;
  /** Trip's currency code; null/undefined falls back to USD. */
  currency?: string | null;
  canEdit: boolean;
  onAdd: () => void;
  onEdit: (expense: TripExpense) => void;
  onDelete: (expense: TripExpense) => void;
  /** X2.4: trip length in days — the spend strip shows every day, not just pinned ones. */
  tripDayCount?: number;
  /** X2.4: trip start ('YYYY-MM-DD') — dated strip labels + today highlight. */
  tripStartDate?: string | null;
}

export function ExpenseList({
  expenses,
  tripId,
  currency,
  canEdit,
  onAdd,
  onEdit,
  onDelete,
  tripDayCount,
  tripStartDate,
}: ExpenseListProps) {
  const t = useTheme();
  const { t: tx } = useT('money');
  const [filter, setFilter] = useState<SpendFilter>(null);

  // Per-row home-currency outcome (converted / rate pending). The strip sums
  // converted home values only — never raw amounts of mixed currencies.
  const moneyRows = useTripMoneySummary(tripId).data?.rows;
  const spend = useMemo(
    () => dailySpend(expenses, tripDayCount ?? 0, { rows: moneyRows, home: currency }),
    [expenses, tripDayCount, moneyRows, currency],
  );
  const hasActual = spend.max > 0 || spend.unassigned > 0;
  const todayIndex = todayDayIndex(tripStartDate, spend.days.length, new Date());

  const sorted = useMemo(() => {
    const visible = expenses.filter((e) =>
      filter === null ? true : filter === 'trip' ? e.day_index === null : e.day_index === filter,
    );
    return visible.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [expenses, filter]);

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
      {/* Header row */}
      <View style={[styles.row, { justifyContent: 'space-between', marginBottom: t.spacing.xs }]}>
        <Text
          style={[t.typography.subtitle, { color: t.colors.text }]}
          accessibilityRole="header"
          aria-level={4}
        >
          {tx('list.title')}
        </Text>
        {canEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tx('list.addA11y')}
            onPress={onAdd}
            style={({ pressed }) => [
              styles.addBtn,
              {
                backgroundColor: pressed ? t.colors.gradientSubtle : t.colors.primary,
                borderRadius: t.radius.md,
                paddingHorizontal: t.spacing.md,
                paddingVertical: t.spacing.xs,
              },
            ]}
          >
            <Text style={[t.typography.caption, { color: t.colors.primaryText, fontWeight: '600' }]}>
              {tx('list.add')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {hasActual ? (
        <DailySpendStrip
          spend={spend}
          currency={currency}
          tripStartDate={tripStartDate}
          todayIndex={todayIndex}
          selected={filter}
          onSelect={setFilter}
        />
      ) : null}

      {sorted.length === 0 ? (
        filter === null ? (
          <View style={[styles.empty, { gap: t.spacing.sm, paddingVertical: t.spacing.md }]}>
            <Image source={EMPTY_ART} style={styles.emptyArt} contentFit="contain" accessibilityIgnoresInvertColors />
            <Text style={[t.typography.bodyStrong, { color: t.colors.text, textAlign: 'center' }]}>{tx('list.emptyTitle')}</Text>
            <Text style={[t.typography.caption, { color: t.colors.textMuted, textAlign: 'center' }]}>{tx('list.emptyBody')}</Text>
          </View>
        ) : (
          <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
            {tx('list.emptyFiltered', {
              day:
                filter === 'trip'
                  ? tx('list.wholeTrip')
                  : (datedDay(tripStartDate, filter) ?? tx('list.dayN', { n: filter + 1 })),
            })}
          </Text>
        )
      ) : (
        <ScrollView
          scrollEnabled={false}
          contentContainerStyle={{ gap: t.spacing.sm }}
          // Using ScrollView as a container so this works inside a parent ScrollView
          // without fighting FlatList's VirtualizedList nesting warnings.
        >
          {sorted.map((expense) => (
            <ExpenseRow
              key={expense.id}
              expense={expense}
              currency={currency}
              money={moneyRows?.[expense.id]}
              canEdit={canEdit}
              onEdit={() => onEdit(expense)}
              onDelete={() => {
                const amount = fmtMoney(expense.amount, expense.currency ?? currency);
                const category = tx(`categories.${expense.category}`);
                void confirmDestructive({
                  title: tx('list.deleteTitle'),
                  message: tx('list.deleteMessage', { category, amount }),
                  confirmLabel: tx('list.delete'),
                  cancelLabel: tx('list.cancel'),
                }).then((ok) => {
                  if (ok) onDelete(expense);
                });
              }}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function ExpenseRow({
  expense,
  currency,
  money,
  canEdit,
  onEdit,
  onDelete,
}: {
  expense: TripExpense;
  currency?: string | null;
  /** This row's outcome from useTripMoneySummary (undefined while loading). */
  money?: RowMoney;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTheme();
  const meta = categoryMeta(expense.category);
  const isActual = expense.kind === 'actual';
  const { t: tx } = useT('money');
  const categoryLabel = tx(`categories.${meta.key}`);
  // `amount` is in the ROW's currency (NULL = legacy home row), never the home.
  const rowCurrency = expense.currency ?? currency;
  const fmt = (n: number) => fmtMoney(n, rowCurrency);
  const isForeign =
    !!expense.currency && !!currency && expense.currency.toUpperCase() !== currency.toUpperCase();
  const converted =
    isForeign && money?.status === 'converted'
      ? tx('preview.converted', { amount: formatMoney(money.home.value, money.home.currency) })
      : isForeign && money?.status === 'pending'
        ? tx('expenses.ratePending')
        : null;

  return (
    <View
      style={[
        styles.expenseRow,
        {
          backgroundColor: t.colors.bg,
          borderColor: t.colors.border,
          borderRadius: t.radius.md,
          padding: t.spacing.md,
          gap: t.spacing.sm,
        },
      ]}
    >
      {/* Only the read-only summary is `accessible`; the Edit/Delete buttons
          below stay siblings so screen readers can still focus them. */}
      <View
        style={[styles.row, { justifyContent: 'space-between' }]}
        accessible
        accessibilityLabel={[
          categoryLabel,
          isActual ? tx('list.kindActual') : tx('list.kindEstimated'),
          fmt(expense.amount),
          converted,
          expense.label,
        ]
          .filter(Boolean)
          .join(', ')}
      >
        <View style={[styles.row, { gap: t.spacing.sm, flex: 1 }]}>
          {/* Category icon */}
          <Text
            style={{ fontSize: 18 }}
            accessibilityElementsHidden
            importantForAccessibility="no"
            aria-hidden
          >
            {meta.icon}
          </Text>

          <View style={{ flex: 1, gap: 2 }}>
            {/* Label row: category + chips */}
            <View style={[styles.row, { gap: t.spacing.xs, flexWrap: 'wrap' }]}>
              <Text style={[t.typography.caption, { color: t.colors.text, fontWeight: '600' }]}>
                {categoryLabel}
              </Text>

              {/* Kind chip */}
              <View
                style={[
                  styles.chip,
                  {
                    backgroundColor: isActual ? t.colors.successLight : t.colors.infoLight,
                    borderRadius: t.radius.pill,
                    paddingHorizontal: t.spacing.sm,
                    paddingVertical: 2,
                  },
                ]}
              >
                <Text
                  style={[
                    t.typography.small,
                    {
                      color: isActual ? t.colors.success : t.colors.info,
                      fontWeight: '600',
                    },
                  ]}
                >
                  {isActual ? tx('list.kindActual') : tx('list.kindEstimated')}
                </Text>
              </View>

              {/* Day chip */}
              {expense.day_index !== null ? (
                <View
                  style={[
                    styles.chip,
                    {
                      backgroundColor: t.colors.bgMuted,
                      borderRadius: t.radius.pill,
                      paddingHorizontal: t.spacing.sm,
                      paddingVertical: 2,
                    },
                  ]}
                >
                  <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                    {tx('list.dayN', { n: expense.day_index + 1 })}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Optional label / notes */}
            {expense.label ? (
              <Text
                style={[t.typography.caption, { color: t.colors.textMuted }]}
                numberOfLines={1}
              >
                {expense.label}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Amount (original currency) + converted / rate-pending hint */}
        <View style={{ alignItems: 'flex-end', marginLeft: t.spacing.sm }}>
          <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>{fmt(expense.amount)}</Text>
          {converted ? (
            <Text
              style={[
                t.typography.small,
                { color: money?.status === 'pending' ? t.colors.warningText : t.colors.textMuted },
              ]}
            >
              {converted}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Actions */}
      {canEdit ? (
        <View style={[styles.row, { gap: t.spacing.sm, justifyContent: 'flex-end' }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tx('list.editA11y', { category: categoryLabel })}
            onPress={onEdit}
            style={({ pressed }) => [
              styles.actionBtn,
              {
                backgroundColor: pressed ? t.colors.gradientSubtle : 'transparent',
                borderRadius: t.radius.sm,
                paddingHorizontal: t.spacing.sm,
                paddingVertical: t.spacing.xs,
              },
            ]}
          >
            <Text style={[t.typography.caption, { color: t.colors.primaryInk }]}>{tx('list.edit')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tx('list.deleteA11y', { category: categoryLabel })}
            onPress={onDelete}
            style={({ pressed }) => [
              styles.actionBtn,
              {
                backgroundColor: pressed ? t.colors.dangerLight : 'transparent',
                borderRadius: t.radius.sm,
                paddingHorizontal: t.spacing.sm,
                paddingVertical: t.spacing.xs,
              },
            ]}
          >
            <Text style={[t.typography.caption, { color: t.colors.danger }]}>{tx('list.delete')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  addBtn: {},
  chip: {},
  expenseRow: { borderWidth: 1 },
  actionBtn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center' },
  emptyArt: { width: 140, height: 105 },
});
