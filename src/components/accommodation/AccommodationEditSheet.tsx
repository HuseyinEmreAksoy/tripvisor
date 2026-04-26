/**
 * AccommodationEditSheet — bottom sheet for adding or editing a trip accommodation.
 *
 * Fields:
 *   - Google place autocomplete search (optional; debounced 250ms)
 *   - Name (required; auto-populated from Google selection, editable)
 *   - Address (manual fallback when no Google place is linked)
 *   - Check-in date
 *   - Check-out date (must be > check-in, validated client-side)
 *   - Optional notes
 *
 * Google place autocomplete:
 *   - Uses usePlacesAutocomplete + usePlaceDetails from src/api/places.ts.
 *   - One sessionToken per edit session (via useState initializer with crypto.randomUUID).
 *   - On selection, populates name/address/google_place_id/lat/lng from PlaceDetails.
 *   - A "Linked to Google place" chip with an "X" unlink button appears when
 *     google_place_id is set.
 *   - PlacesError (e.g. server_misconfigured) renders a graceful inline warning
 *     so the user can fall back to manual address entry — the sheet never crashes.
 *
 * Platform:
 *   - DateField.web.tsx / DateField.native.tsx resolve via Metro.
 *   - BottomSheet.web.tsx / BottomSheet.native.tsx resolve via Metro.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '@/components';
import { Button } from '@/components/Button';
import { DateField } from '@/components/DateField';
import { useTheme } from '@/theme';
import { useCreateTripAccommodation, useUpdateTripAccommodation } from '@/api';
import {
  PlacesError,
  usePlacesAutocomplete,
  usePlaceDetails,
} from '@/api/places';
import type { TripAccommodation } from '@/api/types';
import type { PlaceAutocompleteSuggestion } from '@/api/types';

// ─── Session token per edit session ──────────────────────────────────────────
// crypto.randomUUID() is available in Expo SDK 52+ (Hermes ships it via the
// global polyfill). We fall back to Math.random for any environment where
// it isn't yet available.
function makeSessionToken(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to fallback
  }
  // Fallback: Math.random-based UUID-ish token
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// Error codes that indicate a configuration problem (not a transient failure).
const MAPS_SETUP_ERROR_CODES = new Set([
  'server_misconfigured',
  'google_places_disabled',
  'google_key_restricted',
  'google_places_forbidden',
]);

function isMapsSetupError(err: unknown): err is PlacesError {
  return err instanceof PlacesError && MAPS_SETUP_ERROR_CODES.has(err.code);
}

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
  googlePlaceName: string | null; // display name from the Google result
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
    googlePlaceName: acc?.name ?? null,
    address: acc?.address ?? '',
    lat: acc?.lat ?? null,
    lng: acc?.lng ?? null,
    checkIn: acc?.check_in_date ?? null,
    checkOut: acc?.check_out_date ?? null,
    notes: acc?.notes ?? '',
  };
}

// Simple debounce hook (self-contained; no external dep)
function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
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

  // ── Google Places state ────────────────────────────────────────────────────
  // One session token per sheet open. Generated once via useState initializer
  // so it doesn't change on re-renders within the same editing session.
  const [sessionToken] = useState<string>(makeSessionToken);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQuery = useDebounced(searchQuery, 250);
  // placeId we've selected for detail fetch (separate from form.googlePlaceId
  // so the detail fetch triggers while the form state is still being populated).
  const [pendingPlaceId, setPendingPlaceId] = useState<string | null>(null);

  // Autocomplete suggestions
  const {
    data: suggestions = [],
    isFetching: suggestionsLoading,
    error: autocompleteError,
  } = usePlacesAutocomplete({
    input: debouncedQuery,
    sessionToken,
    // Only fetch when the search box is active (no place yet picked).
    enabled: visible && !form.googlePlaceId && debouncedQuery.length >= 2,
  });

  // Place details (triggered after user selects a suggestion)
  const {
    data: placeDetails,
    isLoading: detailsLoading,
    error: detailsError,
  } = usePlaceDetails({
    placeId: pendingPlaceId ?? undefined,
    sessionToken,
    // Narrow field mask — we only need location + address for accommodation.
    fields: ['displayName', 'formattedAddress', 'location', 'id'],
    enabled: Boolean(pendingPlaceId),
  });

  // When placeDetails resolves, populate form fields.
  useEffect(() => {
    if (!placeDetails || !pendingPlaceId) return;
    setForm((prev) => ({
      ...prev,
      name: placeDetails.displayName,
      googlePlaceId: placeDetails.placeId,
      googlePlaceName: placeDetails.displayName,
      address: placeDetails.formattedAddress,
      lat: placeDetails.location.latitude,
      lng: placeDetails.location.longitude,
    }));
    // Clear the search box and pending state.
    setSearchQuery('');
    setPendingPlaceId(null);
    setErrors((prev) => ({ ...prev, name: undefined, address: undefined }));
  }, [placeDetails, pendingPlaceId]);

  // Maps setup / transient error from autocomplete or details.
  const mapsError = isMapsSetupError(autocompleteError)
    ? autocompleteError
    : isMapsSetupError(detailsError)
      ? detailsError
      : null;

  // ── Form helpers ───────────────────────────────────────────────────────────
  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function handleUnlinkPlace() {
    setForm((prev) => ({
      ...prev,
      googlePlaceId: null,
      googlePlaceName: null,
      lat: null,
      lng: null,
      // Preserve name + address so the user doesn't lose typed content.
    }));
    setSearchQuery('');
    setPendingPlaceId(null);
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
    setSearchQuery('');
    setPendingPlaceId(null);
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

        {/* ── Google Place search ──────────────────────────────────────── */}
        {/* Only show the search UI when no Google place is already linked */}
        {!form.googlePlaceId ? (
          <View style={{ gap: t.spacing.xs }}>
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
              Search for hotel / address (Google)
            </Text>
            <View
              style={[
                styles.searchRow,
                {
                  borderColor: t.colors.border,
                  borderRadius: t.radius.md,
                  backgroundColor: t.colors.bgElevated,
                },
              ]}
            >
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search for hotel / address (Google)"
                placeholderTextColor={t.colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Search for a hotel or address using Google Places"
                style={[
                  styles.searchInput,
                  { color: t.colors.text, ...t.typography.body },
                ]}
              />
              {suggestionsLoading || detailsLoading ? (
                <ActivityIndicator
                  size="small"
                  color={t.colors.primary}
                  style={{ marginRight: t.spacing.md }}
                />
              ) : null}
            </View>

            {/* Maps setup error banner */}
            {mapsError ? (
              <View
                style={[
                  styles.warningBanner,
                  {
                    backgroundColor: t.colors.bgElevated,
                    borderLeftColor: t.colors.warning,
                    borderRadius: t.radius.md,
                    padding: t.spacing.sm,
                  },
                ]}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
              >
                <Text style={[t.typography.caption, { color: t.colors.text }]}>
                  Google Places not configured — see{' '}
                  <Text style={{ fontFamily: 'monospace' }}>docs/google-maps-setup.md</Text>.
                  Use the manual address field below.
                </Text>
              </View>
            ) : null}

            {/* Suggestions list */}
            {suggestions.length > 0 && !mapsError ? (
              <View
                style={[
                  styles.suggestionList,
                  {
                    backgroundColor: t.colors.bgElevated,
                    borderColor: t.colors.border,
                    borderRadius: t.radius.md,
                  },
                ]}
              >
                {suggestions.map((s: PlaceAutocompleteSuggestion, idx) => (
                  <Pressable
                    key={s.placeId}
                    accessibilityRole="button"
                    accessibilityLabel={`Choose ${s.mainText}`}
                    onPress={() => {
                      setSearchQuery('');
                      setPendingPlaceId(s.placeId);
                    }}
                    style={({ pressed }) => [
                      styles.suggestionItem,
                      {
                        backgroundColor: pressed ? t.colors.gradientSubtle : 'transparent',
                        padding: t.spacing.md,
                        borderBottomWidth: idx < suggestions.length - 1 ? 1 : 0,
                        borderBottomColor: t.colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[t.typography.caption, { color: t.colors.text, fontWeight: '600' }]}
                      numberOfLines={1}
                    >
                      {s.mainText}
                    </Text>
                    {s.secondaryText ? (
                      <Text
                        style={[t.typography.small, { color: t.colors.textMuted }]}
                        numberOfLines={1}
                      >
                        {s.secondaryText}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : (
          /* "Linked to Google place" chip with X to unlink */
          <View
            style={{
              backgroundColor: t.colors.infoLight,
              borderRadius: t.radius.md,
              padding: t.spacing.sm,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
            accessible
            accessibilityLabel={`Linked to Google place: ${form.googlePlaceName ?? form.name}`}
          >
            <Text style={[t.typography.caption, { color: t.colors.info, flex: 1 }]} numberOfLines={1}>
              Linked: {form.googlePlaceName ?? form.name}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Unlink Google Place"
              onPress={handleUnlinkPlace}
              style={({ pressed }) => [
                {
                  paddingHorizontal: t.spacing.sm,
                  paddingVertical: t.spacing.xs,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
              hitSlop={8}
            >
              <Text style={[t.typography.caption, { color: t.colors.info, fontWeight: '600' }]}>
                ✕
              </Text>
            </Pressable>
          </View>
        )}

        {/* ── Name ────────────────────────────────────────────────────── */}
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

        {/* ── Manual address fallback ──────────────────────────────────── */}
        {/* Shown always as a fallback; hidden when Google place is linked
            (the formattedAddress from Google is shown via the chip instead). */}
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
        ) : null}

        {/* ── Check-in ────────────────────────────────────────────────── */}
        <DateField
          label="Check-in date"
          value={form.checkIn}
          onChange={(v) => patch('checkIn', v)}
          error={errors.checkIn}
        />

        {/* ── Check-out ───────────────────────────────────────────────── */}
        <DateField
          label="Check-out date"
          value={form.checkOut}
          onChange={(v) => patch('checkOut', v)}
          error={errors.checkOut}
        />

        {/* ── Notes ───────────────────────────────────────────────────── */}
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
  searchRow: {
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    paddingLeft: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 0,
    paddingRight: 8,
  },
  suggestionList: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  suggestionItem: {},
  warningBanner: { borderLeftWidth: 3 },
});
