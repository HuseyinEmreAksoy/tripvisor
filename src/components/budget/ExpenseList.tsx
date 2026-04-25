/**
 * ExpenseList — flat list of trip_expenses rows with edit + delete affordances.
 *
 * Each row shows:
 *   - Category icon + label
 *   - Kind chip (estimated | actual)
 *   - Amount
 *   - Optional day_index chip
 *   - Optional label/notes (truncated to 1 line)
 *   - Edit + Delete buttons (hidden when canEdit = false)
 *
 * Props:
 *   expenses   — from useTripExpenses
 *   canEdit    — controls visibility of edit/delete affordances
 *   onAdd      — opens ExpenseEditSheet in "add" mode
 *   onEdit     — opens ExpenseEditSheet in "edit" mode with the selected row
 *   onDelete   — calls useDeleteTripExpense
 */
import { useMemo } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import type { TripExpense, TripExpenseCategory } from '@/api/types';

const CATEGORY_META: Record<TripExpenseCategory, { label: string; icon: string }> = {
  accommodation: { label: 'Accommodation', icon: '🏨' },
  food: { label: 'Food & Drink', icon: '🍽️' },
  transport: { label: 'Transport', icon: '🚆' },
  shopping: { label: 'Shopping', icon: '🛍️' },
  activities: { label: 'Activities', icon: '🎭' },
  other: { label: 'Other', icon: '📦' },
};

export interface ExpenseListProps {
  expenses: TripExpense[];
  tripId: string;
  canEdit: boolean;
  onAdd: () => void;
  onEdit: (expense: TripExpense) => void;
  onDelete: (expense: TripExpense) => void;
}

export function ExpenseList({
  expenses,
  canEdit,
  onAdd,
  onEdit,
  onDelete,
}: ExpenseListProps) {
  const t = useTheme();

  const sorted = useMemo(
    () => [...expenses].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [expenses],
  );

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

      {sorted.length === 0 ? (
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
          No expenses recorded yet.
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
              canEdit={canEdit}
              onEdit={() => onEdit(expense)}
              onDelete={() => confirmDelete(expense, onDelete)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function ExpenseRow({
  expense,
  canEdit,
  onEdit,
  onDelete,
}: {
  expense: TripExpense;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTheme();
  const meta = CATEGORY_META[expense.category] ?? { label: expense.category, icon: '📦' };
  const isActual = expense.kind === 'actual';

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
      accessible
      accessibilityLabel={`${meta.label}, ${expense.kind}, ${formatAmt(expense.amount)}${expense.label ? `, ${expense.label}` : ''}`}
    >
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
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

        {/* Amount */}
        <Text style={[t.typography.bodyStrong, { color: t.colors.text, marginLeft: t.spacing.sm }]}>
          {formatAmt(expense.amount)}
        </Text>
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
            <Text style={[t.typography.caption, { color: t.colors.primary }]}>Edit</Text>
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

function confirmDelete(expense: TripExpense, onDelete: (e: TripExpense) => void) {
  const meta = CATEGORY_META[expense.category] ?? { label: expense.category };
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`Delete this ${meta.label} expense?`)) {
      onDelete(expense);
    }
    return;
  }
  Alert.alert('Delete expense?', `Remove this ${meta.label} expense of ${formatAmt(expense.amount)}?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => onDelete(expense) },
  ]);
}

function formatAmt(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, '');
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  addBtn: {},
  chip: {},
  expenseRow: { borderWidth: 1 },
  actionBtn: {},
});
