/**
 * AccommodationEditSheet — bottom sheet for adding or editing a trip accommodation.
 *
 * Fields:
 *   - Name (required)
 *   - Google place autocomplete (optional)
 *   - Manual address (shown only when no Google place is selected)
 *   - Check-in date
 *   - Check-out date (must be > check-in, validated client-side)
 *   - Optional notes
 *
 * Platform:
 *   - DateField.web.tsx / DateField.native.tsx resolve via Metro.
 *   - BottomSheet.web.tsx / BottomSheet.native.tsx resolve via Metro.
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '@/components';
import { Button } from '@/components/Button';
import { DateField } from '@/components/DateField';
import { useTheme } from '@/theme';
import { useCreateTripAccommodation, useUpdateTripAccommodation } from '@/api';
import type { TripAccommodation } from '@/api/types';

export interface AccommodationEditSheetProps {
  tripId: string;
  /** Non-null = edit mode; null = add mode. */
  accommodation: TripAccommodation | null;
  visible: boolean;
  onClose: () => void;
}

interface FormState {
  name: string;
  googlePlaceId: string | null;
  address: string;
  lat: number | null;
  lng: number | null;
  checkIn: string | null;
  checkOut: string | null;
  notes: string;
}

function initialState(acc: TripAccommodation | null): FormState {
  return {
    name: acc?.name ?? '',
    googlePlaceId: acc?.google_place_id ?? null,
    address: acc?.address ?? '',
    lat: acc?.lat ?? null,
    lng: acc?.lng ?? null,
    checkIn: acc?.check_in_date ?? null,
    checkOut: acc?.check_out_date ?? null,
    notes: acc?.notes ?? '',
  };
}

export function AccommodationEditSheet({
  tripId,
  accommodation,
  visible,
  onClose,
}: AccommodationEditSheetProps) {
  const t = useTheme();
  const createAccommodation = useCreateTripAccommodation();
  const updateAccommodation = useUpdateTripAccommodation();

  const isEdit = accommodation !== null;
  const [form, setForm] = useState<FormState>(initialState(accommodation));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validate(): boolean {
    const newErrors: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) newErrors.name = 'Name is required.';
    if (!form.checkIn) newErrors.checkIn = 'Check-in date is required.';
    if (!form.checkOut) newErrors.checkOut = 'Check-out date is required.';
    if (form.checkIn && form.checkOut && form.checkOut <= form.checkIn) {
      newErrors.checkOut = 'Check-out must be after check-in.';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    // TypeScript narrow — validate() ensures these are non-null
    const checkIn = form.checkIn!;
    const checkOut = form.checkOut!;
    try {
      if (isEdit && accommodation) {
        await updateAccommodation.mutateAsync({
          id: accommodation.id,
          name: form.name.trim(),
          google_place_id: form.googlePlaceId ?? null,
          address: form.address.trim() || null,
          lat: form.lat,
          lng: form.lng,
          check_in_date: checkIn,
          check_out_date: checkOut,
          notes: form.notes.trim() || null,
        });
      } else {
        await createAccommodation.mutateAsync({
          trip_id: tripId,
          name: form.name.trim(),
          google_place_id: form.googlePlaceId ?? null,
          address: form.address.trim() || null,
          lat: form.lat,
          lng: form.lng,
          check_in_date: checkIn,
          check_out_date: checkOut,
          notes: form.notes.trim() || null,
        });
      }
      handleClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save accommodation. Please try again.';
      setErrors({ name: msg });
    }
  }

  function handleClose() {
    setForm(initialState(accommodation));
    setErrors({});
    onClose();
  }

  const isPending = createAccommodation.isPending || updateAccommodation.isPending;

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      accessibilityLabel={isEdit ? 'Edit accommodation' : 'Add accommodation'}
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
          {isEdit ? 'Edit accommodation' : 'Add accommodation'}
        </Text>

        {/* Name */}
        <FormField label="Name" error={errors.name}>
          <TextInput
            value={form.name}
            onChangeText={(v) => patch('name', v)}
            placeholder="Hotel name or description"
            placeholderTextColor={t.colors.textMuted}
            maxLength={200}
            accessibilityLabel="Accommodation name"
            style={[
              styles.textField,
              {
                borderColor: errors.name ? t.colors.danger : t.colors.border,
                borderRadius: t.radius.md,
                backgroundColor: t.colors.bgElevated,
                color: t.colors.text,
                ...t.typography.body,
                padding: t.spacing.md,
              },
            ]}
          />
        </FormField>

        {/* Manual address — shown when no Google place is linked */}
        {!form.googlePlaceId ? (
          <FormField label="Address (optional)" error={errors.address}>
            <TextInput
              value={form.address}
              onChangeText={(v) => patch('address', v)}
              placeholder="Street address"
              placeholderTextColor={t.colors.textMuted}
              accessibilityLabel="Accommodation address"
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
          </FormField>
        ) : (
          <View
            style={{
              backgroundColor: t.colors.infoLight,
              borderRadius: t.radius.md,
              padding: t.spacing.sm,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Text style={[t.typography.caption, { color: t.colors.info }]}>
              Google Place linked
            </Text>
            <Button
              label="Remove"
              variant="ghost"
              fullWidth={false}
              onPress={() => {
                patch('googlePlaceId', null);
                patch('lat', null);
                patch('lng', null);
              }}
              accessibilityLabel="Remove Google Place link"
            />
          </View>
        )}

        {/* Check-in */}
        <DateField
          label="Check-in date"
          value={form.checkIn}
          onChange={(v) => patch('checkIn', v)}
          error={errors.checkIn}
        />

        {/* Check-out */}
        <DateField
          label="Check-out date"
          value={form.checkOut}
          onChange={(v) => patch('checkOut', v)}
          error={errors.checkOut}
        />

        {/* Notes */}
        <FormField label="Notes (optional)">
          <TextInput
            value={form.notes}
            onChangeText={(v) => patch('notes', v)}
            placeholder="Any additional details"
            placeholderTextColor={t.colors.textMuted}
            multiline
            numberOfLines={3}
            maxLength={2000}
            accessibilityLabel="Accommodation notes"
            style={[
              styles.textField,
              {
                borderColor: t.colors.border,
                borderRadius: t.radius.md,
                backgroundColor: t.colors.bgElevated,
                color: t.colors.text,
                ...t.typography.body,
                padding: t.spacing.md,
                minHeight: 72,
                textAlignVertical: 'top',
              },
            ]}
          />
        </FormField>

        <Button
          label={isEdit ? 'Save changes' : 'Add accommodation'}
          onPress={handleSave}
          loading={isPending}
        />
        <Button label="Cancel" variant="ghost" onPress={handleClose} />
      </ScrollView>
    </BottomSheet>
  );
}

function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.xs }}>
      <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{label}</Text>
      {children}
      {error ? (
        <Text
          style={[t.typography.caption, { color: t.colors.danger }]}
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  textField: { borderWidth: 1 },
});
