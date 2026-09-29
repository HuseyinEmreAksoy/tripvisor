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
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { formatCurrency } from '@/lib/formatCurrency';
import { confirmDestructive } from '@/lib/confirm';
import type { TripExpense } from '@/api/types';
import { useTripMoneySummary } from '@/api/trip-expenses';
import type { RowMoney } from '@/lib/money/types';
import { useT } from '@/i18n';
import { categoryMeta, dailySpend, shortDayLabel, todayDayIndex } from './expenseMath';
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
          Expenses
        </Text>
        {canEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add expense"
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
              + Add
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
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
          {filter === null
            ? 'No expenses recorded yet.'
            : `Nothing recorded for ${filter === 'trip' ? 'the whole trip' : shortDayLabel(tripStartDate, filter)}.`}
        </Text>
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
              onDelete={() => void confirmDelete(expense, currency, onDelete)}
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
  // `amount` is in the ROW's currency (NULL = legacy home row), never the home.
  const rowCurrency = expense.currency ?? currency;
  const fmt = (n: number) => formatCurrency(n, rowCurrency);
  const isForeign =
    !!expense.currency && !!currency && expense.currency.toUpperCase() !== currency.toUpperCase();
  const converted =
    isForeign && money?.status === 'converted'
      ? `≈ ${formatCurrency(money.home.value, money.home.currency)}`
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
        accessibilityLabel={`${meta.label}, ${expense.kind}, ${fmt(expense.amount)}${converted ? `, ${converted}` : ''}${expense.label ? `, ${expense.label}` : ''}`}
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
                {meta.label}
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
                  {isActual ? 'actual' : 'estimated'}
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
                    Day {expense.day_index + 1}
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
            <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{converted}</Text>
          ) : null}
        </View>
      </View>

      {/* Actions */}
      {canEdit ? (
        <View style={[styles.row, { gap: t.spacing.sm, justifyContent: 'flex-end' }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit expense: ${meta.label}`}
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
            <Text style={[t.typography.caption, { color: t.colors.primaryInk }]}>Edit</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Delete expense: ${meta.label}`}
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
            <Text style={[t.typography.caption, { color: t.colors.danger }]}>Delete</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

async function confirmDelete(
  expense: TripExpense,
  currency: string | null | undefined,
  onDelete: (e: TripExpense) => void,
) {
  const meta = categoryMeta(expense.category);
  const confirmed = await confirmDestructive({
    title: 'Delete expense?',
    message: `Remove this ${meta.label} expense of ${formatCurrency(expense.amount, expense.currency ?? currency)}?`,
    confirmLabel: 'Delete',
  });
  if (confirmed) onDelete(expense);
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  addBtn: {},
  chip: {},
  expenseRow: { borderWidth: 1 },
  actionBtn: {},
});
