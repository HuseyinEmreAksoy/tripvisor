/**
 * add.tsx — Add a place to the trip.
 *
 * Phase 23 Step 23.7 (+ review fixes):
 *   - Day picker (`DayPicker`) above the search box. Chips come from the
 *     trip's start_date..end_date day count, plus "Ideas" (day_index NULL).
 *     Default comes from a `day` URL param (MapTab), else Day 1.
 *   - Create always lands in Ideas (day_index is server-domain, C1). When a
 *     day is chosen, the place is then moved there through the existing
 *     server path (`useMoveToDay`). The toast reports what actually happened.
 *   - After save the form clears the search but keeps the selected day so the
 *     user can add another place to the same day immediately.
 *   - Each search → details pair is one Google billing session: the token
 *     rotates after a place is confirmed.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { BackButton, Button, EmptyState, Heading, PoweredByGoogle, Screen, TextField } from '@/components';
import { DayPicker, dayLabel, tripDayCount } from '@/components/add-place/DayPicker';
import { noSearchResults, searchPrompt } from '@/components/emptyStates';
import { useTheme } from '@/theme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useSafeBack } from '@/hooks/useSafeBack';
import {
  PlacesError,
  useAutocompleteSession,
  useCreateTripPlace,
  useMoveToDay,
  usePlacesAutocomplete,
  usePlaceDetails,
  useTrip,
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

// Move-to-day retry delays. With Tier-1 sync on, the create is an optimistic
// local insert whose server INSERT is queued, so the first server-side move
// can race it and find no row; a couple of short retries cover that window.
const MOVE_RETRY_DELAYS_MS = [0, 800, 2000];

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

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export default function AddPlace() {
  const { id: tripId, day: dayParam } = useLocalSearchParams<{ id: string; day?: string }>();
  const goBack = useSafeBack(`/trip/${tripId}`);
  const t = useTheme();
  const bp = useBreakpoint();
  const isDesktop = bp === 'desktop';
  const { sessionToken, rotate: rotateSessionToken } = useAutocompleteSession();

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
  const { data: trip } = useTrip(tripId);

  // ── Day picker ────────────────────────────────────────────────────────────
  const dayCount = tripDayCount(
    trip?.start_date,
    trip?.end_date,
    existingPlaces.map((p) => p.day_index),
  );

  // null = Ideas bucket (day_index NULL). Seeded once from the URL param.
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(() => {
    const parsed = dayParam != null ? parseInt(dayParam, 10) : NaN;
    return !Number.isNaN(parsed) && parsed >= 0 ? parsed : 0;
  });
  // If the trip loads with fewer days than the seeded selection, clamp at
  // render time (no state→effect→state cycle).
  const effectiveDayIndex =
    selectedDayIndex !== null && selectedDayIndex >= dayCount ? dayCount - 1 : selectedDayIndex;

  // ── Toast state ───────────────────────────────────────────────────────────
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const createTripPlace = useCreateTripPlace();
  const moveToDay = useMoveToDay();
  const [addError, setAddError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ─── Recent places — local AsyncStorage state (not server state) ──────────
  const [recents, setRecents] = useState<RecentPlace[]>([]);

  useEffect(() => {
    getRecentPlaces().then(setRecents);
  }, []);

  const showRecents = debounced.length < 2 && recents.length > 0;

  async function scheduleOnDay(placeRowId: string, dayIndex: number): Promise<boolean> {
    for (const delay of MOVE_RETRY_DELAYS_MS) {
      if (delay) await wait(delay);
      try {
        await moveToDay.mutateAsync({ id: placeRowId, tripId, toDayIndex: dayIndex });
        return true;
      } catch {
        // retry below; final failure is reported via the toast
      }
    }
    return false;
  }

  async function handleConfirm() {
    if (!picked || !tripId || saving) return;
    const targetDay = effectiveDayIndex;
    const defaults = inferCategoryDefault(picked.types);
    setAddError(null);
    setSaving(true);
    try {
      let created;
      try {
        created = await createTripPlace.mutateAsync({
          trip_id: tripId,
          google_place_id: picked.placeId,
          user_title: picked.displayName,
          category: defaults.category,
          visit_duration_minutes: defaults.durationMinutes,
          lat: picked.location.latitude,
          lng: picked.location.longitude,
        });
      } catch (e) {
        setAddError(
          e instanceof Error && e.message
            ? `Couldn't add this place: ${e.message}`
            : "Couldn't add this place. Check your connection and try again.",
        );
        return;
      }

      // Session closed by the details call that preceded this confirm.
      rotateSessionToken();
      // Fire-and-forget recent places write.
      addRecentPlace({
        placeId: picked.placeId,
        mainText: picked.displayName,
        secondaryText: picked.formattedAddress,
      });
      setPickedId(null);
      setQuery('');

      if (targetDay === null) {
        setToastMessage('Added to Ideas');
        return;
      }
      const scheduled = await scheduleOnDay(created.id, targetDay);
      setToastMessage(
        scheduled
          ? `Added to ${dayLabel(targetDay)}`
          : `Added to Ideas — couldn't schedule on ${dayLabel(targetDay)}. Move it from the itinerary.`,
      );
    } finally {
      setSaving(false);
    }
  }

  function handleClearRecents() {
    clearRecentPlaces();
    setRecents([]);
  }

  // Derived from React Query cache — no extra useState needed.
  const isDuplicate =
    !!picked &&
    existingPlaces.some((p) => p.google_place_id === picked.placeId);

  const desktopWrap = isDesktop
    ? { maxWidth: ADD_DESKTOP_MAX_WIDTH, width: '100%' as const, alignSelf: 'center' as const }
    : undefined;

  return (
    <Screen padded={false}>
      <View style={[{ padding: t.spacing.lg, gap: t.spacing.sm }, desktopWrap]}>
        <BackButton onPress={goBack} />
        <View style={{ gap: t.spacing.xs }}>
          <Heading level={2}>Add a place</Heading>
          <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
            Search for restaurants, museums, viewpoints, or any destination to add to your itinerary.
          </Text>
        </View>

        <DayPicker
          dayCount={dayCount}
          selected={effectiveDayIndex}
          onSelect={setSelectedDayIndex}
        />

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
                loading={saving}
                onPress={handleConfirm}
              />
              {addError ? (
                <Text
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  style={[t.typography.caption, { color: t.colors.danger }]}
                >
                  {addError}
                </Text>
              ) : null}
              <Button
                variant="ghost"
                label="Pick a different place"
                onPress={() => {
                  setAddError(null);
                  setPickedId(null);
                }}
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
  // Toast
  toast: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
});
