import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, EmptyState, Heading, PoweredByGoogle, Screen, TextField } from '@/components';
import { noSearchResults, searchPrompt } from '@/components/emptyStates';
import { useTheme } from '@/theme';
import {
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

export default function AddPlace() {
  const { id: tripId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useTheme();
  const sessionToken = useAutocompleteSessionToken();

  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 250);

  const { data: suggestions = [], isFetching } = usePlacesAutocomplete({
    input: debounced,
    sessionToken,
  });

  const [pickedId, setPickedId] = useState<string | null>(null);
  const { data: picked, isLoading: loadingDetails } = usePlaceDetails({
    placeId: pickedId ?? undefined,
    sessionToken,
  });

  const { data: existingPlaces = [] } = useTripPlaces(tripId);

  const createTripPlace = useCreateTripPlace();

  // ─── Recent places — local AsyncStorage state (not server state) ─────────────
  const [recents, setRecents] = useState<RecentPlace[]>([]);

  useEffect(() => {
    getRecentPlaces().then(setRecents);
  }, []);

  // True when the query is too short for autocomplete and recents are available.
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
    // Fire-and-forget: slow storage write must not block navigation.
    // addRecentPlace swallows its own errors internally.
    addRecentPlace({
      placeId: picked.placeId,
      mainText: picked.displayName,
      secondaryText: picked.formattedAddress,
    });
    router.back();
  }

  function handleClearRecents() {
    clearRecentPlaces();
    setRecents([]);
  }

  // Derived from React Query cache — no extra useState needed.
  // Guard on `picked` so we never access `picked.placeId` while still loading.
  const isDuplicate =
    !!picked &&
    existingPlaces.some((p) => p.google_place_id === picked.placeId);

  return (
    <Screen padded={false}>
      <View style={{ padding: t.spacing.lg, gap: t.spacing.sm }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()}>
          <Text style={[t.typography.body, { color: t.colors.primary }]}>← Back</Text>
        </Pressable>
        <Heading level={2}>Add a place</Heading>
        <TextField
          label="Search"
          autoFocus
          autoCapitalize="none"
          placeholder="Restaurant, museum, viewpoint…"
          value={query}
          onChangeText={setQuery}
        />
      </View>

      {pickedId ? (
        <View style={{ flex: 1, padding: t.spacing.lg, gap: t.spacing.md }}>
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
                // accessibilityRole="alert" + accessibilityLiveRegion="polite"
                // announces the banner to screen readers when it appears, matching
                // the pattern established in settings.tsx for inline error notices.
                <View
                  style={[
                    styles.duplicateWarning,
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
        // ── Search / Recents area ───────────────────────────────────────────────
        // Layout: Recents section (pinned, non-scrolling) sits above the
        // autocomplete FlatList. Both share the same horizontal padding so
        // visual alignment stays consistent. Using a sibling <View> rather than
        // ListHeaderComponent keeps the recents header visible while the user
        // scrolls a long autocomplete list.
        <View style={styles.searchArea}>
          {showRecents && (
            <View style={{ paddingHorizontal: t.spacing.lg }}>
              {/* Section header — non-interactive label, no role needed */}
              <Text
                style={[
                  t.typography.caption,
                  styles.recentsHeader,
                  { color: t.colors.textMuted, marginVertical: t.spacing.sm },
                ]}
              >
                Recent
              </Text>

              {recents.map((item, index) => (
                <View key={item.placeId}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Recent: ${item.mainText}`}
                    onPress={() => setPickedId(item.placeId)}
                    style={[styles.row, { paddingVertical: t.spacing.md }]}
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
                  {/* Separator between rows (not after the last one) */}
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

              {/* Divider between recents section and the empty-state below */}
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
                // Only show the search prompt when there are no recents to display.
                // When recents are shown above, the empty state would be redundant.
                !showRecents ? <EmptyState {...searchPrompt} /> : null
              )
            }
            ListFooterComponent={suggestions.length ? <PoweredByGoogle /> : null}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Choose ${item.mainText}`}
                onPress={() => setPickedId(item.placeId)}
                style={[styles.row, { paddingVertical: t.spacing.md }]}
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

const styles = StyleSheet.create({
  row: { flexDirection: 'column', gap: 2 },
  searchArea: { flex: 1 },
  recentsHeader: { textTransform: 'uppercase', letterSpacing: 0.5 },
  // Structural properties only; color-dependent tokens are applied inline
  // alongside this style so theme switching works correctly.
  duplicateWarning: { borderLeftWidth: 3 },
});
