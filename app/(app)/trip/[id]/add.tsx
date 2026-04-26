/**
 * add.tsx — Add a place to the trip.
 *
 * Phase 23 Step 23.7:
 *   - Day picker horizontal chip row above the search box. Chips drive the
 *     `selectedDayIndex` for the place save. Default comes from a `day`
 *     URL param set by MapTab (if passed), else the first scheduled day.
 *   - Active chip is highlighted with the day color.
 *   - Stepper: "Switch to Day N+1" advances one day; at the last day it
 *     becomes "Add to Unscheduled" (day_index = null).
 *   - After save the form clears the search + query but stays on screen with
 *     the same selectedDayIndex so the user can add another place to the same
 *     day immediately.
 *   - Brief inline toast "Added to Day N" appears after a successful save.
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { BackButton, Button, EmptyState, Heading, PoweredByGoogle, Screen, TextField } from '@/components';
import { noSearchResults, searchPrompt } from '@/components/emptyStates';
import { useTheme } from '@/theme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { dayColor } from '@/components/Map';
import {
  PlacesError,
  useAutocompleteSessionToken,
  useCreateTripPlace,
  usePlacesAutocomplete,
  usePlaceDetails,
  useTripPlaces,
} from '@/api';
import { inferCategoryDefault } from '@/lib/categoryDurations';
import {
  addRecentPlace,
  clearRecentPlaces,
  getRecentPlaces,
  type RecentPlace,
} from '@/lib/recentPlaces';

function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

// Max content width for the desktop centred layout of the add-place screen.
const ADD_DESKTOP_MAX_WIDTH = 720;

// How many milliseconds the "Added to Day N" toast stays visible.
const TOAST_DURATION_MS = 2500;

const mapsSetupErrorCodes = new Set([
  'server_misconfigured',
  'google_places_disabled',
  'google_key_restricted',
  'google_places_forbidden',
]);

function getMapsSetupError(...errors: Array<PlacesError | Error | null | undefined>) {
  return (
    errors.find(
      (error): error is PlacesError =>
        error instanceof PlacesError && mapsSetupErrorCodes.has(error.code),
    ) ?? null
  );
}

export default function AddPlace() {
  const { id: tripId, day: dayParam } = useLocalSearchParams<{ id: string; day?: string }>();
  const router = useRouter();
  const t = useTheme();
  const bp = useBreakpoint();
  const isDesktop = bp === 'desktop';
  const sessionToken = useAutocompleteSessionToken();

  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 250);

  const {
    data: suggestions = [],
    isFetching,
    error: autocompleteError,
  } = usePlacesAutocomplete({
    input: debounced,
    sessionToken,
  });

  const [pickedId, setPickedId] = useState<string | null>(null);
  const {
    data: picked,
    isLoading: loadingDetails,
    error: detailsError,
  } = usePlaceDetails({
    placeId: pickedId ?? undefined,
    sessionToken,
  });

  // Setup failures can come from missing local secrets or from Google's API/billing
  // rejecting the server key. Surface them above the result list instead of
  // making them look like "no results".
  const mapsSetupError = getMapsSetupError(autocompleteError, detailsError);

  const { data: existingPlaces = [] } = useTripPlaces(tripId);

  // ── Day picker (Step 23.7) ────────────────────────────────────────────────
  // All day indexes that have at least one assigned place, plus any that exist
  // in the date range. We build a simple 0..max list for the picker chips.
  const availableDays = useMemo(() => {
    const seen = new Set<number>();
    for (const p of existingPlaces) {
      if (p.day_index !== null && p.day_index >= 0) seen.add(p.day_index);
    }
    // Always include at least Day 0 so the picker has something to show.
    seen.add(0);
    return [...seen].sort((a, b) => a - b);
  }, [existingPlaces]);

  // Default to the URL param if provided (MapTab may pass the selected day),
  // else the first available day.
  const initialDay = useMemo(() => {
    const parsed = dayParam != null ? parseInt(dayParam, 10) : NaN;
    if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
    return availableDays[0] ?? 0;
    // Only computed once at mount — intentionally not reactive to dayParam changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // null = unscheduled bucket (day_index = null)
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(initialDay);

  // ── Toast state ───────────────────────────────────────────────────────────
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const createTripPlace = useCreateTripPlace();

  // ─── Recent places — local AsyncStorage state (not server state) ──────────
  const [recents, setRecents] = useState<RecentPlace[]>([]);

  useEffect(() => {
    getRecentPlaces().then(setRecents);
  }, []);

  const showRecents = debounced.length < 2 && recents.length > 0;

  async function handleConfirm() {
    if (!picked || !tripId) return;
    const defaults = inferCategoryDefault(picked.types);
    await createTripPlace.mutateAsync({
      trip_id: tripId,
      google_place_id: picked.placeId,
      user_title: picked.displayName,
      category: defaults.category,
      visit_duration_minutes: defaults.durationMinutes,
      lat: picked.location.latitude,
      lng: picked.location.longitude,
    });
    // Fire-and-forget recent places write.
    addRecentPlace({
      placeId: picked.placeId,
      mainText: picked.displayName,
      secondaryText: picked.formattedAddress,
    });

    // Step 23.7: show toast + stay on screen (clear search only).
    const dayLabel =
      selectedDayIndex !== null ? `Day ${selectedDayIndex + 1}` : 'Unscheduled';
    setToastMessage(`Added to ${dayLabel}`);
    setPickedId(null);
    setQuery('');
  }

  function handleClearRecents() {
    clearRecentPlaces();
    setRecents([]);
  }

  // Derived from React Query cache — no extra useState needed.
  const isDuplicate =
    !!picked &&
    existingPlaces.some((p) => p.google_place_id === picked.placeId);

  // Step 23.7: stepper — advance to next day or switch to Unscheduled.
  const maxDayIndex = Math.max(...availableDays, selectedDayIndex ?? 0);
  const isLastDay =
    selectedDayIndex === null ||
    selectedDayIndex >= maxDayIndex;
  const isUnscheduled = selectedDayIndex === null;

  function handleStepNext() {
    if (isUnscheduled) return;
    if (selectedDayIndex !== null && selectedDayIndex >= maxDayIndex) {
      // At last scheduled day → switch to Unscheduled
      setSelectedDayIndex(null);
    } else if (selectedDayIndex !== null) {
      setSelectedDayIndex(selectedDayIndex + 1);
    }
  }

  const desktopWrap = isDesktop
    ? { maxWidth: ADD_DESKTOP_MAX_WIDTH, width: '100%' as const, alignSelf: 'center' as const }
    : undefined;

  // All chip values: day indexes + "Unscheduled"
  const chipValues: Array<number | 'unscheduled'> = [...availableDays, 'unscheduled'];

  return (
    <Screen padded={false}>
      <View style={[{ padding: t.spacing.lg, gap: t.spacing.sm }, desktopWrap]}>
        <BackButton onPress={() => router.back()} />
        <View style={{ gap: t.spacing.xs }}>
          <Heading level={2}>Add a place</Heading>
          <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
            Search for restaurants, museums, viewpoints, or any destination to add to your itinerary.
          </Text>
        </View>

        {/* ── Day picker chips (Step 23.7) ────────────────────────────── */}
        <View style={{ gap: t.spacing.xs }}>
          <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}>
            Add to
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: t.spacing.sm }}
            accessibilityRole="radiogroup"
            accessibilityLabel="Select day to add place"
          >
            {chipValues.map((value) => {
              const isUnsch = value === 'unscheduled';
              const dayIdx = isUnsch ? null : (value as number);
              const isSelected = isUnsch
                ? selectedDayIndex === null
                : selectedDayIndex === dayIdx;
              const chipColor = !isUnsch && dayIdx !== null ? dayColor(dayIdx) : undefined;
              const chipLabel = isUnsch ? 'Unscheduled' : `Day ${(dayIdx as number) + 1}`;

              return (
                <Pressable
                  key={String(value)}
                  accessibilityRole="radio"
                  accessibilityLabel={chipLabel}
                  accessibilityState={{ checked: isSelected }}
                  onPress={() => setSelectedDayIndex(dayIdx)}
                  style={[
                    addStyles.chip,
                    {
                      borderColor: isSelected
                        ? (chipColor ?? t.colors.primary)
                        : t.colors.border,
                      backgroundColor: isSelected
                        ? (chipColor ?? t.colors.primary)
                        : t.colors.bgElevated,
                      borderRadius: t.radius.md,
                    },
                  ]}
                >
                  {chipColor && !isUnsch ? (
                    <View
                      style={[addStyles.chipDot, { backgroundColor: isSelected ? '#fff' : chipColor }]}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                  ) : null}
                  <Text
                    style={[
                      t.typography.caption,
                      {
                        color: isSelected ? (chipColor ? '#fff' : t.colors.primaryText) : t.colors.text,
                        fontWeight: isSelected ? '600' : '400',
                      },
                    ]}
                  >
                    {chipLabel}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* ── Stepper (Step 23.7) — advance to next day ───────────────── */}
        {!isUnscheduled && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isLastDay
                ? 'Switch to Unscheduled'
                : `Switch to Day ${(selectedDayIndex ?? 0) + 2}`
            }
            onPress={handleStepNext}
            style={[
              addStyles.stepper,
              {
                borderColor: t.colors.border,
                borderRadius: t.radius.sm,
                backgroundColor: t.colors.bgElevated,
              },
            ]}
          >
            <Text style={[t.typography.caption, { color: t.colors.primary }]}>
              {isLastDay
                ? '→ Add to Unscheduled'
                : `→ Switch to Day ${(selectedDayIndex ?? 0) + 2}`}
            </Text>
          </Pressable>
        )}

        <TextField
          label="Search places"
          autoFocus
          autoCapitalize="none"
          placeholder="Restaurant, museum, viewpoint…"
          value={query}
          onChangeText={setQuery}
        />

        {/* ── Toast notification (Step 23.7) ───────────────────────────── */}
        {toastMessage ? (
          <View
            style={[
              addStyles.toast,
              {
                backgroundColor: t.colors.primary,
                borderRadius: t.radius.md,
                padding: t.spacing.sm,
              },
            ]}
            accessibilityLiveRegion="polite"
          >
            <Text style={[t.typography.caption, { color: t.colors.primaryText }]}>
              {toastMessage}
            </Text>
          </View>
        ) : null}

        {mapsSetupError ? (
          <View
            style={[
              addStyles.setupBanner,
              {
                backgroundColor: t.colors.bgElevated,
                borderLeftColor: t.colors.warning,
                borderRadius: t.radius.md,
                padding: t.spacing.md,
              },
            ]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
              Maps integration needs setup
            </Text>
            <Text
              style={[
                t.typography.caption,
                { color: t.colors.textMuted, marginTop: t.spacing.xs },
              ]}
            >
              {mapsSetupError.message}{' '}
              See{' '}
              <Text style={{ fontFamily: 'monospace', color: t.colors.text }}>
                docs/google-maps-setup.md
              </Text>{' '}
              to set up your Google Maps server key.
            </Text>
          </View>
        ) : null}
      </View>

      {pickedId ? (
        <View style={[{ flex: 1, padding: t.spacing.lg, gap: t.spacing.md }, desktopWrap]}>
          {loadingDetails || !picked ? (
            <ActivityIndicator />
          ) : (
            <>
              <Text style={[t.typography.title, { color: t.colors.text }]} numberOfLines={2}>
                {picked.displayName}
              </Text>
              <Text style={[t.typography.body, { color: t.colors.textMuted }]} numberOfLines={2}>
                {picked.formattedAddress}
              </Text>
              <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                Default visit duration:{' '}
                {inferCategoryDefault(picked.types).durationMinutes} min
              </Text>
              <PoweredByGoogle />
              {isDuplicate ? (
                <View
                  style={[
                    addStyles.duplicateWarning,
                    {
                      backgroundColor: t.colors.bgElevated,
                      borderLeftColor: t.colors.warning,
                      borderRadius: t.radius.md,
                      padding: t.spacing.md,
                    },
                  ]}
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                >
                  <Text style={[t.typography.caption, { color: t.colors.text }]}>
                    Already in this trip — confirm to add as a separate visit.
                  </Text>
                </View>
              ) : null}
              <Button
                label={isDuplicate ? 'Add anyway' : 'Add to trip'}
                accessibilityLabel={
                  isDuplicate
                    ? 'Add anyway, this place is already in your trip'
                    : undefined
                }
                loading={createTripPlace.isPending}
                onPress={handleConfirm}
              />
              <Button
                variant="ghost"
                label="Pick a different place"
                onPress={() => setPickedId(null)}
              />
            </>
          )}
        </View>
      ) : (
        // ── Search / Recents area ─────────────────────────────────────────────
        <View style={[addStyles.searchArea, desktopWrap]}>
          {showRecents && (
            <View style={{ paddingHorizontal: t.spacing.lg }}>
              <View style={[addStyles.recentsSectionHeader, { marginVertical: t.spacing.sm }]}>
                <Text
                  style={[
                    t.typography.caption,
                    addStyles.recentsHeader,
                    { color: t.colors.textMuted },
                  ]}
                >
                  Recent searches
                </Text>
              </View>

              {recents.map((item, index) => (
                <View key={item.placeId}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Recent: ${item.mainText}`}
                    onPress={() => setPickedId(item.placeId)}
                    style={[addStyles.row, { paddingVertical: t.spacing.md }]}
                  >
                    <Text
                      style={[t.typography.bodyStrong, { color: t.colors.text }]}
                      numberOfLines={1}
                    >
                      {item.mainText}
                    </Text>
                    {item.secondaryText ? (
                      <Text
                        style={[t.typography.small, { color: t.colors.textMuted }]}
                        numberOfLines={1}
                      >
                        {item.secondaryText}
                      </Text>
                    ) : null}
                  </Pressable>
                  {index < recents.length - 1 && (
                    <View style={{ height: 1, backgroundColor: t.colors.border }} />
                  )}
                </View>
              ))}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear recent searches"
                onPress={handleClearRecents}
                style={{ paddingVertical: t.spacing.md }}
              >
                <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
                  Clear recent searches
                </Text>
              </Pressable>

              <View style={{ height: 1, backgroundColor: t.colors.border }} />
            </View>
          )}

          <FlatList
            data={suggestions}
            keyExtractor={(s) => s.placeId}
            contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.lg }}
            ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: t.colors.border }} />}
            ListEmptyComponent={
              debounced.length >= 2 ? (
                isFetching ? (
                  <View style={{ padding: t.spacing.xl, alignItems: 'center' }}>
                    <ActivityIndicator />
                  </View>
                ) : (
                  <EmptyState {...noSearchResults} />
                )
              ) : (
                !showRecents ? <EmptyState {...searchPrompt} /> : null
              )
            }
            ListFooterComponent={suggestions.length ? <PoweredByGoogle /> : null}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Choose ${item.mainText}`}
                onPress={() => setPickedId(item.placeId)}
                style={[addStyles.row, { paddingVertical: t.spacing.md }]}
              >
                <Text style={[t.typography.bodyStrong, { color: t.colors.text }]} numberOfLines={1}>
                  {item.mainText}
                </Text>
                {item.secondaryText ? (
                  <Text style={[t.typography.small, { color: t.colors.textMuted }]} numberOfLines={1}>
                    {item.secondaryText}
                  </Text>
                ) : null}
              </Pressable>
            )}
          />
        </View>
      )}
    </Screen>
  );
}

const addStyles = StyleSheet.create({
  row: { flexDirection: 'column', gap: 2 },
  searchArea: { flex: 1 },
  recentsHeader: { textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '600' },
  recentsSectionHeader: { flexDirection: 'row', alignItems: 'center' },
  duplicateWarning: { borderLeftWidth: 3 },
  setupBanner: { borderLeftWidth: 3 },
  // Day picker chip styles
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    gap: 6,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  // Stepper affordance
  stepper: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
    minHeight: 36,
    justifyContent: 'center',
  },
  // Toast
  toast: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
});
