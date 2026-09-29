/**
 * BudgetEditSheet — bottom sheet for setting / editing the trip's total budget.
 *
 * - Numeric input with the trip's currency code as a read-only prefix label.
 * - "Clear budget" button if a budget is already set.
 * - Calls useUpdateTripBudget on save.
 * - Works identically on iOS, Android, and web via BottomSheet platform split.
 */
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '@/components';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme';
import { useUpdateTripBudget } from '@/api/trips';
import { appLanguage } from '@/i18n';
import { parseAmount } from './expenseMath';

export interface BudgetEditSheetProps {
  tripId: string;
  currentBudget: number | null;
  /** Trip's currency code; null/undefined falls back to USD display. */
  currency?: string | null;
  visible: boolean;
  onClose: () => void;
}

export function BudgetEditSheet({
  tripId,
  currentBudget,
  currency,
  visible,
  onClose,
}: BudgetEditSheetProps) {
  const t = useTheme();
  const updateBudget = useUpdateTripBudget(tripId);

  // Display a short currency prefix. For long codes (e.g. TRY, JPY) we use the
  // code directly; Intl.NumberFormat symbol extraction is not universally
  // available in all RN/Hermes builds, so we keep this simple.
  const currencyPrefix = (currency ?? 'USD').toUpperCase();

  const [inputText, setInputText] = useState(currentBudget != null ? String(currentBudget) : '');
  const [validationError, setValidationError] = useState<string | null>(null);

  function validate(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === '') return null; // allow clearing
    // Locale-aware: '5,000' (en) / '5.000' (tr) is five thousand, not 5.
    const n = parseAmount(trimmed, { language: appLanguage() });
    if (n === null) return undefined as unknown as null;
    return n;
  }

  async function handleSave() {
    const result = validate(inputText);
    if (result === undefined) {
      setValidationError('Enter a positive number or leave blank to remove the budget.');
      return;
    }
    setValidationError(null);
    try {
      await updateBudget.mutateAsync(result);
      onClose();
    } catch {
      setValidationError('Could not save budget. Please try again.');
    }
  }

  async function handleClear() {
    setValidationError(null);
    try {
      await updateBudget.mutateAsync(null);
      setInputText('');
      onClose();
    } catch {
      setValidationError('Could not clear budget. Please try again.');
    }
  }

  function handleClose() {
    // Reset local state on close so reopening shows current server value.
    setInputText(currentBudget != null ? String(currentBudget) : '');
    setValidationError(null);
    onClose();
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      accessibilityLabel="Set trip budget"
    >
      <Text
        style={[t.typography.subtitle, { color: t.colors.text }]}
        accessibilityRole="header"
        aria-level={3}
      >
        {currentBudget != null ? 'Edit budget' : 'Set budget'}
      </Text>
      <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
        Enter your total trip budget. Currency is determined by your trip settings.
      </Text>

      {/* Amount input */}
      <View style={{ gap: t.spacing.xs }}>
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
          Amount ({currencyPrefix})
        </Text>
        <View
          style={[
            styles.inputRow,
            {
              borderColor: validationError ? t.colors.danger : t.colors.border,
              borderRadius: t.radius.md,
              backgroundColor: t.colors.bgElevated,
            },
          ]}
        >
          {/* Read-only currency prefix label */}
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
            value={inputText}
            onChangeText={(text) => {
              setInputText(text);
              setValidationError(null);
            }}
            keyboardType="decimal-pad"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            inputMode={"decimal" as any}
            placeholder="0.00"
            placeholderTextColor={t.colors.textMuted}
            accessibilityLabel={`Budget amount in ${currencyPrefix}`}
            accessibilityHint="Enter your total trip budget as a number"
            style={[
              styles.input,
              {
                color: t.colors.text,
                ...t.typography.body,
              },
            ]}
            autoFocus
          />
        </View>
        {validationError ? (
          <Text
            style={[t.typography.caption, { color: t.colors.danger }]}
            accessibilityLiveRegion="polite"
          >
            {validationError}
          </Text>
        ) : null}
      </View>

      <Button
        label="Save budget"
        onPress={handleSave}
        loading={updateBudget.isPending}
        accessibilityLabel="Save trip budget"
      />
      {currentBudget != null ? (
        <Button
          label="Remove budget"
          variant="ghost"
          onPress={handleClear}
          loading={updateBudget.isPending}
          accessibilityLabel="Remove trip budget ceiling"
        />
      ) : null}
      <Button
        label="Cancel"
        variant="ghost"
        onPress={handleClose}
        accessibilityLabel="Cancel budget edit"
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  inputRow: {
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
  },
  input: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 0,
  },
});
