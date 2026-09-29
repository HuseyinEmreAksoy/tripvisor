/**
 * ExpenseEditSheet — keypad-first quick expense (add) and full edit sheet.
 *
 * v2 M4 X2.4 reorders the sheet for the "just paid for lunch" moment:
 *   1. Amount first — big field in the trip's currency. On native an
 *      on-screen AmountKeypad is the input (no OS keyboard covering the sheet);
 *      web uses the real keyboard (inputMode="decimal"), autofocused.
 *   2. Category chips (one tap), category-based budgeting only — never per-km.
 *   3. Estimated | Actual. New expenses default to ACTUAL while the trip is
 *      running today, otherwise ESTIMATED (planning) — `defaultKind` overrides.
 *   4. Day chips, defaulting to TODAY's trip day when `tripStartDate` is known
 *      (`defaultDayIndex` overrides; null = whole trip).
 *   5. Optional note, then Save (success haptic).
 *
 * The form re-initializes every time the sheet opens, so reusing one mounted
 * sheet for "add" and for editing different rows never shows stale values.
 *
 * Backward compatible: every prop added in X2.4 is optional.
 * Calls useCreateTripExpense (add) or useUpdateTripExpense (edit mode = non-null `expense`).
 */
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '@/components';
import { Button } from '@/components/Button';
import { SegmentedControl } from '@/components/SegmentedControl';
import { useTheme } from '@/theme';
import { haptics } from '@/lib/haptics';
import { appLanguage } from '@/i18n';
import { useCreateTripExpense, useUpdateTripExpense } from '@/api';
import type { TripExpense, TripExpenseCategory, TripExpenseKind } from '@/api/types';
import { AmountKeypad } from './AmountKeypad';
import { ChoiceChip } from './ChoiceChip';
import {
  EXPENSE_CATEGORIES,
  applyAmountKey,
  parseAmount,
  shortDayLabel,
  todayDayIndex,
} from './expenseMath';

const KIND_OPTIONS: Array<{ value: TripExpenseKind; label: string }> = [
  { value: 'actual', label: 'Spent' },
  { value: 'estimated', label: 'Estimate' },
];

const USE_KEYPAD = Platform.OS !== 'web';

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
  /** X2.4: trip start ('YYYY-MM-DD') — enables "today" defaults and dated day chips. */
  tripStartDate?: string | null;
  /** X2.4: preselected day for a new expense (null = whole trip). Default: today's trip day. */
  defaultDayIndex?: number | null;
  /** X2.4: kind for a new expense. Default: actual while the trip is live, else estimated. */
  defaultKind?: TripExpenseKind;
  /** X2.4: category for a new expense. Default: food (the most common on-trip spend). */
  defaultCategory?: TripExpenseCategory;
}

interface FormState {
  category: TripExpenseCategory;
  kind: TripExpenseKind;
  amountText: string;
  dayIndex: number | null;
  label: string;
}

export function ExpenseEditSheet({
  tripId,
  expense,
  currency,
  visible,
  onClose,
  tripDayCount,
  tripStartDate,
  defaultDayIndex,
  defaultKind,
  defaultCategory,
}: ExpenseEditSheetProps) {
  const t = useTheme();
  const createExpense = useCreateTripExpense();
  const updateExpense = useUpdateTripExpense();
  // Edit mode shows the ROW's own currency (amount is stored in it, never the
  // trip home); a legacy NULL row is in the home currency.
  const currencyPrefix = (expense?.currency ?? currency ?? 'USD').toUpperCase();
  const isEdit = expense !== null;

  function initialForm(): FormState {
    if (expense) {
      return {
        category: expense.category,
        kind: expense.kind,
        amountText: expense.amount != null ? String(expense.amount) : '',
        dayIndex: expense.day_index ?? null,
        label: expense.label ?? '',
      };
    }
    const today = todayDayIndex(tripStartDate, tripDayCount, new Date());
    return {
      category: defaultCategory ?? 'food',
      kind: defaultKind ?? (today !== null ? 'actual' : 'estimated'),
      amountText: '',
      dayIndex: defaultDayIndex !== undefined ? defaultDayIndex : today,
      label: '',
    };
  }

  const [form, setForm] = useState<FormState>(initialForm);
  const [showNote, setShowNote] = useState(Boolean(expense?.label));
  const [error, setError] = useState<string | null>(null);

  // Re-initialize on every open (and when the edited row changes).
  useEffect(() => {
    if (!visible) return;
    setForm(initialForm());
    setShowNote(Boolean(expense?.label));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open / row change
  }, [visible, expense?.id]);

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    // The native keypad always emits '.' decimals; typed web input follows the app language.
    const amount = parseAmount(form.amountText, { language: USE_KEYPAD ? 'en' : appLanguage() });
    if (amount === null) {
      setError('Enter a valid amount (e.g. 42 or 9.99).');
      haptics.error();
      return;
    }
    setError(null);
    const fields = {
      category: form.category,
      kind: form.kind,
      amount,
      day_index: form.dayIndex,
      label: form.label.trim() || null,
    };
    try {
      if (isEdit && expense) {
        await updateExpense.mutateAsync({ id: expense.id, ...fields });
      } else {
        await createExpense.mutateAsync({ trip_id: tripId, ...fields });
      }
      haptics.success();
      onClose();
    } catch {
      setError('Could not save expense. Please try again.');
    }
  }

  const isPending = createExpense.isPending || updateExpense.isPending;
  const todayIdx = todayDayIndex(tripStartDate, tripDayCount, new Date());

  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={isEdit ? 'Edit expense' : 'Add expense'}>
      <ScrollView
        contentContainerStyle={{ gap: t.spacing.md }}
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
      >
        <Text style={[t.typography.subtitle, { color: t.colors.text }]} accessibilityRole="header" aria-level={3}>
          {isEdit ? 'Edit expense' : 'Add expense'}
        </Text>

        {/* 1. Amount */}
        <View style={{ gap: t.spacing.xs }}>
          <View
            style={[
              styles.amountRow,
              {
                borderColor: error ? t.colors.danger : t.colors.border,
                borderRadius: t.radius.lg,
                backgroundColor: t.colors.bgElevated,
                paddingHorizontal: t.spacing.md,
              },
            ]}
          >
            <Text
              style={[t.typography.bodyStrong, { color: t.colors.textMuted }]}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              {currencyPrefix}
            </Text>
            <TextInput
              value={form.amountText}
              onChangeText={(text) => {
                patch('amountText', text);
                setError(null);
              }}
              keyboardType="decimal-pad"
              inputMode="decimal"
              showSoftInputOnFocus={!USE_KEYPAD}
              autoFocus={!USE_KEYPAD && visible && !isEdit}
              placeholder="0.00"
              placeholderTextColor={t.colors.textMuted}
              accessibilityLabel={`Expense amount in ${currencyPrefix}`}
              onSubmitEditing={() => void handleSave()}
              style={[styles.amountInput, t.typography.display, { color: t.colors.text }]}
            />
          </View>
          {error ? (
            <Text style={[t.typography.caption, { color: t.colors.danger }]} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
        </View>

        {USE_KEYPAD ? (
          <AmountKeypad
            onKey={(key) => {
              setForm((f) => ({ ...f, amountText: applyAmountKey(f.amountText, key) }));
              setError(null);
            }}
          />
        ) : null}

        {/* 2. Category */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityRole="radiogroup"
          accessibilityLabel="Category"
          contentContainerStyle={{ gap: t.spacing.xs }}
        >
          {EXPENSE_CATEGORIES.map((c) => (
            <ChoiceChip
              key={c.key}
              label={`${c.icon} ${c.label}`}
              accessibilityLabel={c.label}
              selected={form.category === c.key}
              onPress={() => patch('category', c.key)}
            />
          ))}
        </ScrollView>

        {/* 3. Kind */}
        <SegmentedControl<TripExpenseKind> value={form.kind} onChange={(k) => patch('kind', k)} options={KIND_OPTIONS} />

        {/* 4. Day */}
        {tripDayCount > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            accessibilityRole="radiogroup"
            accessibilityLabel="Day"
            contentContainerStyle={{ gap: t.spacing.xs }}
          >
            <ChoiceChip label="Whole trip" selected={form.dayIndex === null} onPress={() => patch('dayIndex', null)} />
            {Array.from({ length: tripDayCount }, (_, i) => {
              const dated = shortDayLabel(tripStartDate, i);
              const isToday = i === todayIdx;
              return (
                <ChoiceChip
                  key={i}
                  label={isToday ? `Today · ${dated}` : dated}
                  accessibilityLabel={`Day ${i + 1}${tripStartDate ? `, ${dated}` : ''}${isToday ? ', today' : ''}`}
                  selected={form.dayIndex === i}
                  highlighted={isToday}
                  onPress={() => patch('dayIndex', i)}
                />
              );
            })}
          </ScrollView>
        ) : null}

        {/* 5. Note (collapsed by default to keep the quick path short) */}
        {showNote ? (
          <TextInput
            value={form.label}
            onChangeText={(v) => patch('label', v)}
            placeholder="e.g. Lunch at the market"
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
        ) : (
          <Button label="+ Add a note" variant="ghost" onPress={() => setShowNote(true)} accessibilityLabel="Add a note to this expense" />
        )}

        <View style={[styles.actions, { gap: t.spacing.sm }]}>
          <View style={styles.flex}>
            <Button label="Cancel" variant="ghost" onPress={onClose} />
          </View>
          <View style={styles.flex2}>
            <Button label={isEdit ? 'Save changes' : 'Add expense'} onPress={() => void handleSave()} loading={isPending} />
          </View>
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  amountRow: { borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', minHeight: 64, gap: 8 },
  amountInput: { flex: 1, paddingVertical: 0, fontSize: 32, lineHeight: 40 },
  textField: { borderWidth: 1 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  flex2: { flex: 2 },
});
