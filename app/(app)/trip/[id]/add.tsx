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
} from '@/api';
import { inferCategoryDefault } from '@/lib/categoryDurations';

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

  const createTripPlace = useCreateTripPlace();

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
    router.back();
  }

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
              <Button
                label="Add to trip"
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
              <EmptyState {...searchPrompt} />
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
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'column', gap: 2 },
});
