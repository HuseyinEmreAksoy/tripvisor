/**
 * ExpenseEditSheet — bottom sheet for adding or editing a trip expense.
 *
 * Fields:
 *   - Category select (all six categories)
 *   - Kind toggle (estimated | actual)
 *   - Amount input (numeric; read-only currency prefix shows trip currency)
 *   - Optional day picker (0-based index; shows "Day N" labels)
 *   - Optional label/notes text
 *
 * Calls useCreateTripExpense (add mode) or useUpdateTripExpense (edit mode).
 * "Edit mode" is signalled by passing a non-null `expense` prop.
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '@/components';
import { Button } from '@/components/Button';
import { SegmentedControl } from '@/components/SegmentedControl';
import { useTheme } from '@/theme';
import { useCreateTripExpense, useUpdateTripExpense } from '@/api';
import type { TripExpense, TripExpenseCategory, TripExpenseKind } from '@/api/types';
import { Pressable } from 'react-native';

const CATEGORY_OPTIONS: Array<{ value: TripExpenseCategory; label: string }> = [
  { value: 'accommodation', label: '🏨 Accommodation' },
  { value: 'food', label: '🍽️ Food & Drink' },
  { value: 'transport', label: '🚆 Transport' },
  { value: 'shopping', label: '🛍️ Shopping' },
  { value: 'activities', label: '🎭 Activities' },
  { value: 'other', label: '📦 Other' },
];

const KIND_OPTIONS: Array<{ value: TripExpenseKind; label: string }> = [
  { value: 'estimated', label: 'Estimated' },
  { value: 'actual', label: 'Actual' },
];

export interface ExpenseEditSheetProps {
  tripId: string;
  /** Non-null = edit mode; null = add mode. */
  expense: TripExpense | null;
  /** Trip's currency code; null/undefined falls back to USD display. */
  currency?: string | null;
  visible: boolean;
  onClose: () => void;
  /** How many days the trip spans — used to build the day picker options. */
  tripDayCount: number;
}

export function ExpenseEditSheet({
  tripId,
  expense,
  currency,
  visible,
  onClose,
  tripDayCount,
}: ExpenseEditSheetProps) {
  const t = useTheme();
  const createExpense = useCreateTripExpense();
  const updateExpense = useUpdateTripExpense();

  // Read-only currency prefix for the amount input affordance.
  const currencyPrefix = (currency ?? 'USD').toUpperCase();

  const isEdit = expense !== null;

  const [category, setCategory] = useState<TripExpenseCategory>(expense?.category ?? 'other');
  const [kind, setKind] = useState<TripExpenseKind>(expense?.kind ?? 'estimated');
  const [amountText, setAmountText] = useState(expense?.amount != null ? String(expense.amount) : '');
  const [dayIndex, setDayIndex] = useState<number | null>(expense?.day_index ?? null);
  const [label, setLabel] = useState(expense?.label ?? '');
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setCategory(expense?.category ?? 'other');
    setKind(expense?.kind ?? 'estimated');
    setAmountText(expense?.amount != null ? String(expense.amount) : '');
    setDayIndex(expense?.day_index ?? null);
    setLabel(expense?.label ?? '');
    setError(null);
    onClose();
  }

  async function handleSave() {
    const trimmed = amountText.trim();
    const amount = Number(trimmed.replace(',', '.'));
    if (!trimmed || !Number.isFinite(amount) || amount < 0) {
      setError('Enter a valid amount (e.g. 42 or 9.99).');
      return;
    }
    setError(null);
    try {
      if (isEdit && expense) {
        await updateExpense.mutateAsync({
          id: expense.id,
          category,
          kind,
          amount,
          day_index: dayIndex,
          label: label.trim() || null,
        });
      } else {
        await createExpense.mutateAsync({
          trip_id: tripId,
          category,
          kind,
          amount,
          day_index: dayIndex,
          label: label.trim() || null,
        });
      }
      handleClose();
    } catch {
      setError('Could not save expense. Please try again.');
    }
  }

  const isPending = createExpense.isPending || updateExpense.isPending;

  const dayOptions: Array<{ value: string; label: string }> = [
    { value: 'none', label: 'Whole trip' },
    ...Array.from({ length: tripDayCount }, (_, i) => ({
      value: String(i),
      label: `Day ${i + 1}`,
    })),
  ];

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      accessibilityLabel={isEdit ? 'Edit expense' : 'Add expense'}
    >
      <ScrollView
        scrollEnabled={false}
        contentContainerStyle={{ gap: t.spacing.md }}
        keyboardShouldPersistTaps="handled"
      >
        <Text
          style={[t.typography.subtitle, { color: t.colors.text }]}
          accessibilityRole="header"
          aria-level={3}
        >
          {isEdit ? 'Edit expense' : 'Add expense'}
        </Text>

        {/* Category picker */}
        <View style={{ gap: t.spacing.xs }}>
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>Category</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            {CATEGORY_OPTIONS.map((opt) => {
              const isSelected = category === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  accessibilityRole="radio"
                  accessibilityLabel={opt.label}
                  accessibilityState={{ checked: isSelected }}
                  onPress={() => setCategory(opt.value)}
                  style={({ pressed }) => [
                    styles.catChip,
                    {
                      backgroundColor: isSelected
                        ? t.colors.primary
                        : pressed
                          ? t.colors.gradientSubtle
                          : t.colors.bgElevated,
                      borderColor: isSelected ? t.colors.primary : t.colors.border,
                      borderRadius: t.radius.md,
                      paddingHorizontal: t.spacing.md,
                      paddingVertical: t.spacing.sm,
                    },
                  ]}
                >
                  <Text
                    style={[
                      t.typography.caption,
                      { color: isSelected ? t.colors.primaryText : t.colors.text },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Kind toggle */}
        <SegmentedControl<TripExpenseKind>
          label="Type"
          value={kind}
          onChange={setKind}
          options={KIND_OPTIONS}
        />

        {/* Amount */}
        <View style={{ gap: t.spacing.xs }}>
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
            Amount ({currencyPrefix})
          </Text>
          <View
            style={[
              styles.inputRow,
              {
                borderColor: error ? t.colors.danger : t.colors.border,
                borderRadius: t.radius.md,
                backgroundColor: t.colors.bgElevated,
              },
            ]}
          >
            {/* Read-only currency prefix */}
            <Text
              style={[
                t.typography.bodyStrong,
                { color: t.colors.textMuted, paddingLeft: t.spacing.md },
              ]}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              {currencyPrefix}
            </Text>
            <TextInput
              value={amountText}
              onChangeText={(text) => { setAmountText(text); setError(null); }}
              keyboardType="decimal-pad"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              inputMode={"decimal" as any}
              placeholder="0.00"
              placeholderTextColor={t.colors.textMuted}
              accessibilityLabel={`Expense amount in ${currencyPrefix}`}
              style={[styles.input, { color: t.colors.text, ...t.typography.body }]}
            />
          </View>
          {error ? (
            <Text
              style={[t.typography.caption, { color: t.colors.danger }]}
              accessibilityLiveRegion="polite"
            >
              {error}
            </Text>
          ) : null}
        </View>

        {/* Day picker — only rendered when the trip has days */}
        {tripDayCount > 0 ? (
          <View style={{ gap: t.spacing.xs }}>
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
              Day (optional)
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
              {dayOptions.map((opt) => {
                const optVal = opt.value === 'none' ? null : Number(opt.value);
                const isSelected =
                  opt.value === 'none' ? dayIndex === null : dayIndex === optVal;
                return (
                  <Pressable
                    key={opt.value}
                    accessibilityRole="radio"
                    accessibilityLabel={opt.label}
                    accessibilityState={{ checked: isSelected }}
                    onPress={() => setDayIndex(optVal)}
                    style={({ pressed }) => [
                      styles.catChip,
                      {
                        backgroundColor: isSelected
                          ? t.colors.primary
                          : pressed
                            ? t.colors.gradientSubtle
                            : t.colors.bgElevated,
                        borderColor: isSelected ? t.colors.primary : t.colors.border,
                        borderRadius: t.radius.md,
                        paddingHorizontal: t.spacing.md,
                        paddingVertical: t.spacing.sm,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        t.typography.caption,
                        { color: isSelected ? t.colors.primaryText : t.colors.text },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Optional label */}
        <View style={{ gap: t.spacing.xs }}>
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
            Label (optional)
          </Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="e.g. Hotel night 2"
            placeholderTextColor={t.colors.textMuted}
            maxLength={200}
            accessibilityLabel="Expense label"
            accessibilityHint="Optional short description for this expense"
            style={[
              styles.textField,
              {
                borderColor: t.colors.border,
                borderRadius: t.radius.md,
                backgroundColor: t.colors.bgElevated,
                color: t.colors.text,
                ...t.typography.body,
                padding: t.spacing.md,
              },
            ]}
          />
        </View>

        <Button
          label={isEdit ? 'Save changes' : 'Add expense'}
          onPress={handleSave}
          loading={isPending}
        />
        <Button label="Cancel" variant="ghost" onPress={handleClose} />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  inputRow: { borderWidth: 1, flexDirection: 'row', alignItems: 'center', height: 52 },
  input: { flex: 1, paddingHorizontal: 8, paddingVertical: 0 },
  catChip: { borderWidth: 1 },
  textField: { borderWidth: 1 },
});
