/**
 * ExpenseEditSheet — keypad-first quick expense (add) and full edit sheet.
 *
 * v2 M4 X2.4 order for the "just paid for lunch" moment:
 *   1. Amount first — big field. On native an on-screen AmountKeypad is the
 *      input (no OS keyboard covering the sheet); web uses the real keyboard
 *      (inputMode="decimal"), autofocused.
 *   2. Category chips, 3. Estimated | Actual, 4. Day chips, 5. Note, Save.
 *
 * M5 Y3.2 multi-currency:
 *   - A currency chip row under the amount: the trip's home currency, then the
 *     currencies recently used on this trip, then "More…" (searchable list).
 *     A new expense starts in the trip's most recently used currency (the
 *     "another coffee in EUR" case), else the home currency.
 *   - The amount is typed in the APP LANGUAGE ("12,50" in Turkish): the keypad's
 *     decimal key writes the language's separator and parseAmount reads it,
 *     enforcing the currency's minor units (JPY has none).
 *   - A live "≈ ₺1.234,50" preview in the home currency (useExpenseFxPreview).
 *   - Save passes `currency`; the facade freezes the rate (or saves "rate
 *     pending" offline). Editing keeps the frozen rate unless the currency changes.
 *
 * The form re-initializes every time the sheet opens.
 */
import { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '@/components';
import { Button } from '@/components/Button';
import { SegmentedControl } from '@/components/SegmentedControl';
import { useTheme } from '@/theme';
import { haptics } from '@/lib/haptics';
import { appLanguage, formatDate, useT } from '@/i18n';
import { useCreateTripExpense, useUpdateTripExpense } from '@/api';
import { useTripExpenses } from '@/api/trip-expenses';
import type { TripExpense, TripExpenseCategory, TripExpenseKind } from '@/api/types';
import { currencyMinorUnits, decimalSeparatorFor, normalizeCurrency, parseAmount } from '@/lib/money';
import { AmountKeypad } from './AmountKeypad';
import { ChoiceChip } from './ChoiceChip';
import { CurrencyPicker } from './CurrencyPicker';
import { FxPreviewLine } from './FxPreviewLine';
import { recentCurrencies, suggestedCurrencies } from './currencies';
import { EXPENSE_CATEGORIES, amountToInputText, applyAmountKey, parseLocalDate, todayDayIndex } from './expenseMath';

const USE_KEYPAD = Platform.OS !== 'web';
/** Popular picks that fill the chip row while the trip has little currency history. */
const SHEET_EXTRA = ['EUR', 'USD', 'GBP'];

type AmountErrorKey =
  | 'sheet.errors.invalidAmount'
  | 'sheet.errors.noDecimals'
  | 'sheet.errors.tooManyDecimals'
  | 'sheet.errors.tooLarge'
  | 'sheet.errors.saveFailed';

export interface ExpenseEditSheetProps {
  tripId: string;
  /** Non-null = edit mode; null = add mode. */
  expense: TripExpense | null;
  /** The trip's HOME currency (`trips.currency`); null/undefined → USD. */
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
  currency: string;
  dayIndex: number | null;
  label: string;
}

/** The amount-parse error → message key (+ interpolation). */
function amountErrorKey(error: string, currency: string): AmountErrorKey {
  if (error === 'too_many_decimals') {
    return currencyMinorUnits(currency) === 0 ? 'sheet.errors.noDecimals' : 'sheet.errors.tooManyDecimals';
  }
  if (error === 'too_large') return 'sheet.errors.tooLarge';
  return 'sheet.errors.invalidAmount';
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
  const { t: tx } = useT(['money', 'common']);
  const createExpense = useCreateTripExpense();
  const updateExpense = useUpdateTripExpense();
  const { data: tripExpenses } = useTripExpenses(visible ? tripId : undefined);
  const home = normalizeCurrency(currency) ?? 'USD';
  const language = appLanguage();
  const sep = decimalSeparatorFor(language);
  const isEdit = expense !== null;

  const recent = useMemo(() => recentCurrencies(tripExpenses, home), [tripExpenses, home]);

  function initialForm(): FormState {
    if (expense) {
      return {
        category: expense.category,
        kind: expense.kind,
        amountText: amountToInputText(expense.amount, sep),
        // A legacy NULL row is in the home currency.
        currency: normalizeCurrency(expense.currency) ?? home,
        dayIndex: expense.day_index ?? null,
        label: expense.label ?? '',
      };
    }
    const today = todayDayIndex(tripStartDate, tripDayCount, new Date());
    return {
      category: defaultCategory ?? 'food',
      kind: defaultKind ?? (today !== null ? 'actual' : 'estimated'),
      amountText: '',
      currency: recent[0] ?? home,
      dayIndex: defaultDayIndex !== undefined ? defaultDayIndex : today,
      label: '',
    };
  }

  const [form, setForm] = useState<FormState>(initialForm);
  const [showNote, setShowNote] = useState(Boolean(expense?.label));
  const [errorKey, setErrorKey] = useState<AmountErrorKey | null>(null);

  // Re-initialize on every open (and when the edited row changes).
  useEffect(() => {
    if (!visible) return;
    setForm(initialForm());
    setShowNote(Boolean(expense?.label));
    setErrorKey(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open / row change
  }, [visible, expense?.id]);

  // The recent list can land after the sheet opened (cold cache): adopt it for
  // an untouched new expense only.
  useEffect(() => {
    if (!visible || isEdit || form.amountText !== '' || !recent[0]) return;
    setForm((f) => (f.currency === home ? { ...f, currency: recent[0] ?? home } : f));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the recent list first resolves
  }, [recent[0]]);

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const parsed = useMemo(
    () => parseAmount(form.amountText, { language, currency: form.currency }),
    [form.amountText, form.currency, language],
  );
  const minor = currencyMinorUnits(form.currency);
  const suggestions = useMemo(
    () => suggestedCurrencies({ home, recent, extra: SHEET_EXTRA, selected: form.currency, max: 5 }),
    [home, recent, form.currency],
  );

  async function handleSave() {
    if (!parsed.ok) {
      setErrorKey(amountErrorKey(parsed.error, form.currency));
      haptics.error();
      return;
    }
    setErrorKey(null);
    const fields = {
      category: form.category,
      kind: form.kind,
      amount: parsed.value,
      day_index: form.dayIndex,
      label: form.label.trim() || null,
    };
    try {
      if (isEdit && expense) {
        const original = normalizeCurrency(expense.currency) ?? home;
        // Only a currency CHANGE re-freezes the rate; otherwise the frozen rate stays.
        await updateExpense.mutateAsync({
          id: expense.id,
          ...fields,
          ...(form.currency !== original ? { currency: form.currency } : {}),
        });
      } else {
        await createExpense.mutateAsync({ trip_id: tripId, ...fields, currency: form.currency });
      }
      haptics.success();
      onClose();
    } catch {
      setErrorKey('sheet.errors.saveFailed');
    }
  }

  const isPending = createExpense.isPending || updateExpense.isPending;
  const todayIdx = todayDayIndex(tripStartDate, tripDayCount, new Date());
  const errorText =
    errorKey === null
      ? null
      : tx(errorKey, {
          code: form.currency,
          digits: minor,
          example: sep === ',' ? '42 · 9,99' : '42 · 9.99',
        });
  const start = parseLocalDate(tripStartDate);
  const dayDate = (i: number): string | null =>
    start ? formatDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), 'weekday') : null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel={isEdit ? tx('sheet.editTitle') : tx('sheet.addTitle')}
    >
      <ScrollView contentContainerStyle={{ gap: t.spacing.md }} keyboardShouldPersistTaps="handled" style={styles.scroll}>
        <Text style={[t.typography.subtitle, { color: t.colors.text }]} accessibilityRole="header" aria-level={3}>
          {isEdit ? tx('sheet.editTitle') : tx('sheet.addTitle')}
        </Text>

        {/* 1. Amount + live conversion */}
        <View style={{ gap: t.spacing.xs }}>
          <View
            style={[
              styles.amountRow,
              {
                borderColor: errorKey ? t.colors.danger : t.colors.border,
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
              {form.currency}
            </Text>
            <TextInput
              value={form.amountText}
              onChangeText={(text) => {
                patch('amountText', text);
                setErrorKey(null);
              }}
              keyboardType="decimal-pad"
              inputMode="decimal"
              showSoftInputOnFocus={!USE_KEYPAD}
              autoFocus={!USE_KEYPAD && visible && !isEdit}
              placeholder={minor === 0 ? '0' : `0${sep}${'0'.repeat(minor)}`}
              placeholderTextColor={t.colors.textMuted}
              accessibilityLabel={tx('sheet.amountA11y', { code: form.currency })}
              onSubmitEditing={() => void handleSave()}
              style={[styles.amountInput, t.typography.display, { color: t.colors.text }]}
            />
          </View>
          {errorText ? (
            <Text style={[t.typography.caption, { color: t.colors.danger }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
              {errorText}
            </Text>
          ) : null}
          <FxPreviewLine
            amount={parsed.ok ? parsed.exact : null}
            currency={form.currency}
            home={home}
            tripStartDate={tripStartDate}
            dayIndex={form.dayIndex}
          />
        </View>

        {/* 1b. Currency */}
        <CurrencyPicker
          label={tx('currency.label')}
          value={form.currency}
          home={home}
          suggestions={suggestions}
          onChange={(code) => {
            setForm((f) => ({ ...f, currency: code }));
            setErrorKey(null);
          }}
        />

        {USE_KEYPAD ? (
          <AmountKeypad
            decimalSeparator={sep}
            allowDecimal={minor > 0}
            onKey={(key) => {
              setForm((f) => ({
                ...f,
                amountText: applyAmountKey(f.amountText, key, { decimalSeparator: sep, maxDecimals: currencyMinorUnits(f.currency) }),
              }));
              setErrorKey(null);
            }}
          />
        ) : null}

        {/* 2. Category */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityRole="radiogroup"
          accessibilityLabel={tx('sheet.category')}
          contentContainerStyle={{ gap: t.spacing.xs }}
        >
          {EXPENSE_CATEGORIES.map((c) => {
            const name = tx(`categories.${c.key}`);
            const chipLabel = [c.icon, name].join(' ');
            return (
              <ChoiceChip
                key={c.key}
                label={chipLabel}
                accessibilityLabel={name}
                selected={form.category === c.key}
                onPress={() => patch('category', c.key)}
              />
            );
          })}
        </ScrollView>

        {/* 3. Kind */}
        <SegmentedControl<TripExpenseKind>
          value={form.kind}
          onChange={(k) => patch('kind', k)}
          options={[
            { value: 'actual', label: tx('sheet.kind.actual') },
            { value: 'estimated', label: tx('sheet.kind.estimated') },
          ]}
        />

        {/* 4. Day */}
        {tripDayCount > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            accessibilityRole="radiogroup"
            accessibilityLabel={tx('sheet.day')}
            contentContainerStyle={{ gap: t.spacing.xs }}
          >
            <ChoiceChip label={tx('sheet.wholeTrip')} selected={form.dayIndex === null} onPress={() => patch('dayIndex', null)} />
            {Array.from({ length: tripDayCount }, (_, i) => {
              const dated = dayDate(i);
              const short = dated ?? tx('sheet.dayN', { n: i + 1 });
              const isToday = i === todayIdx;
              const a11y = isToday
                ? tx('sheet.dayA11yToday', { n: i + 1, date: dated ?? '' })
                : dated
                  ? tx('sheet.dayA11yDated', { n: i + 1, date: dated })
                  : tx('sheet.dayN', { n: i + 1 });
              return (
                <ChoiceChip
                  key={i}
                  label={isToday ? tx('sheet.todayChip', { day: short }) : short}
                  accessibilityLabel={a11y}
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
            placeholder={tx('sheet.notePlaceholder')}
            placeholderTextColor={t.colors.textMuted}
            maxLength={200}
            accessibilityLabel={tx('sheet.noteA11y')}
            accessibilityHint={tx('sheet.noteHint')}
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
          <Button
            label={tx('sheet.addNote')}
            variant="ghost"
            onPress={() => setShowNote(true)}
            accessibilityLabel={tx('sheet.addNoteA11y')}
          />
        )}

        <View style={[styles.actions, { gap: t.spacing.sm }]}>
          <View style={styles.flex}>
            <Button label={tx('common:actions.cancel')} variant="ghost" onPress={onClose} />
          </View>
          <View style={styles.flex2}>
            <Button
              label={isEdit ? tx('sheet.save') : tx('sheet.add')}
              onPress={() => void handleSave()}
              loading={isPending}
            />
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
