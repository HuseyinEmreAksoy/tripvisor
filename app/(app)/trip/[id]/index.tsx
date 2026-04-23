import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Button,
  Heading,
  Screen,
  SegmentedControl,
  Slider,
  StatusPill,
  TabBar,
} from '@/components';
import { Map, decodePolyline, dayColor, type MapMarker, type MapPolyline } from '@/components/Map';
import { useTheme } from '@/theme';
import {
  supabase,
  useDeleteTrip,
  useOptimizeTrip,
  useTrip,
  useTripLegs,
  useTripPlaces,
  type TransportMode,
  type TripLeg,
  type TripPlace,
} from '@/api';

type TabKey = 'map' | 'itinerary' | 'settings';

export default function TripDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useTheme();
  const [tab, setTab] = useState<TabKey>('map');

  const { data: trip, isLoading, error } = useTrip(id);
  const { data: places = [] } = useTripPlaces(id);
  const { data: legs = [] } = useTripLegs(id);
  const optimize = useOptimizeTrip();
  const optimizeMutate = optimize.mutate; // stable reference per TanStack Query v5
  const deleteTrip = useDeleteTrip();

  // Auto-optimize (debounced 500ms) when places or trip settings change meaningfully.
  const stateKey = useMemo(
    () =>
      JSON.stringify({
        placeIds: places.map((p) => p.id).sort(),
        budget: trip?.daily_hours_budget,
        mode: trip?.transport_mode,
      }),
    [places, trip?.daily_hours_budget, trip?.transport_mode],
  );
  const lastOptimizedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!id || places.length < 2 || !trip) return;
    if (lastOptimizedRef.current === stateKey) return;
    const timer = setTimeout(() => {
      lastOptimizedRef.current = stateKey;
      optimizeMutate({ tripId: id });
    }, 500);
    return () => clearTimeout(timer);
  }, [id, stateKey, places.length, trip, optimizeMutate]);

  if (isLoading) {
    return (
      <Screen>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>Loading…</Text>
      </Screen>
    );
  }

  if (error || !trip) {
    return (
      <Screen>
        <Heading level={2}>Trip not found</Heading>
        <Button label="Back to trips" onPress={() => router.replace('/trips')} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View style={{ padding: t.spacing.lg, gap: t.spacing.xs }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={[t.typography.body, { color: t.colors.primary }]}>← Back</Text>
        </Pressable>
        <Heading level={1}>{trip.title}</Heading>
        <View style={styles.metaRow}>
          <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
            {formatRange(trip.start_date, trip.end_date)} · {trip.daily_hours_budget}h/day ·{' '}
            {trip.transport_mode}
          </Text>
          {optimize.isPending ? (
            <StatusPill tone="info" label="Optimizing…" loading />
          ) : optimize.error ? (
            <StatusPill tone="danger" label="Optimize failed" />
          ) : places.length < 2 ? (
            <StatusPill tone="info" label="Add places to optimize" />
          ) : null}
        </View>
      </View>

      <TabBar<TabKey>
        activeKey={tab}
        onSelect={setTab}
        tabs={[
          { key: 'map', label: 'Map' },
          { key: 'itinerary', label: 'Itinerary' },
          { key: 'settings', label: 'Settings' },
        ]}
      />

      {tab === 'map' ? (
        <MapTab places={places} legs={legs} onMarker={(pid) => router.push(`/place/${pid}`)} />
      ) : tab === 'itinerary' ? (
        <ItineraryTab places={places} legs={legs} onOpen={(gid) => router.push(`/place/${gid}`)} />
      ) : (
        <SettingsTab
          tripId={trip.id}
          dailyHoursBudget={trip.daily_hours_budget}
          transportMode={trip.transport_mode}
          onDelete={async () => {
            await deleteTrip.mutateAsync(trip.id);
            router.replace('/trips');
          }}
          deleting={deleteTrip.isPending}
        />
      )}

      <View style={{ padding: t.spacing.lg }}>
        <Button label="Add a place" onPress={() => router.push(`/trip/${trip.id}/add`)} />
      </View>
    </Screen>
  );
}

function MapTab({
  places,
  legs,
  onMarker,
}: {
  places: TripPlace[];
  legs: TripLeg[];
  onMarker: (googlePlaceId: string) => void;
}) {
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const markers: MapMarker[] = places.map((p) => ({
    id: p.id,
    lat: p.lat,
    lng: p.lng,
    title: p.user_title ?? 'Place',
    dayIndex: p.day_index,
    orderInDay: p.order_in_day,
  }));

  const polylines: MapPolyline[] = legs
    .filter((l) => l.polyline && l.day_index >= 0)
    .map((l) => ({
      id: l.id,
      dayIndex: l.day_index,
      points: decodePolyline(l.polyline!),
    }));

  return (
    <View style={{ flex: 1 }}>
      <Map
        markers={markers}
        polylines={polylines}
        onMarkerPress={(markerId) => {
          const p = byId.get(markerId);
          if (p) onMarker(p.google_place_id);
        }}
      />
    </View>
  );
}

function ItineraryTab({
  places,
  legs,
  onOpen,
}: {
  places: TripPlace[];
  legs: TripLeg[];
  onOpen: (googlePlaceId: string) => void;
}) {
  const t = useTheme();
  const byDay = useMemo(() => groupByDay(places), [places]);

  if (places.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.spacing.xl }}>
        <Text style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center' }]}>
          No places yet. Add your first destination to start planning.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={byDay}
      keyExtractor={(section) => `day-${section.dayIndex}`}
      contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md }}
      renderItem={({ item: section }) => (
        <View style={{ gap: t.spacing.sm }}>
          <View style={[styles.dayHeader, { borderColor: dayColor(section.dayIndex) }]}>
            <Text style={[t.typography.subtitle, { color: t.colors.text }]}>
              {section.dayIndex < 0 ? 'Unscheduled' : `Day ${section.dayIndex + 1}`}
            </Text>
          </View>
          {section.places.map((place, idx) => {
            const next = section.places[idx + 1];
            const leg = next
              ? legs.find(
                  (l) =>
                    l.day_index === section.dayIndex &&
                    l.from_place_id === place.id &&
                    l.to_place_id === next.id,
                )
              : undefined;
            return (
              <View key={place.id} style={{ gap: t.spacing.xs }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${place.user_title ?? 'place'}`}
                  onPress={() => onOpen(place.google_place_id)}
                  style={[
                    styles.placeCard,
                    {
                      borderColor: t.colors.border,
                      borderRadius: t.radius.md,
                      backgroundColor: t.colors.bgElevated,
                      padding: t.spacing.md,
                    },
                  ]}
                >
                  <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
                    {place.user_title ?? 'Place'}
                  </Text>
                  <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                    {place.category ?? 'Unclassified'} · {place.visit_duration_minutes} min
                  </Text>
                </Pressable>
                {next ? (
                  <Text
                    style={[t.typography.small, { color: t.colors.textMuted, paddingHorizontal: 12 }]}
                  >
                    ↓ {leg ? formatTravel(leg.duration_seconds, leg.distance_meters) : 'travel time unknown'}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    />
  );
}

function SettingsTab({
  tripId,
  dailyHoursBudget,
  transportMode,
  onDelete,
  deleting,
}: {
  tripId: string;
  dailyHoursBudget: number;
  transportMode: TransportMode;
  onDelete: () => void;
  deleting: boolean;
}) {
  const t = useTheme();
  const [budget, setBudget] = useState(dailyHoursBudget);
  const [mode, setMode] = useState<TransportMode>(transportMode);

  async function commitBudget(v: number) {
    setBudget(v);
    await supabase.from('trips').update({ daily_hours_budget: v }).eq('id', tripId);
  }
  async function commitMode(v: TransportMode) {
    setMode(v);
    await supabase.from('trips').update({ transport_mode: v }).eq('id', tripId);
  }

  function confirmDelete() {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Delete this trip?')) onDelete();
      return;
    }
    Alert.alert('Delete trip?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.lg }}>
      <Slider
        label="Daily hours budget"
        unit="h"
        min={2}
        max={14}
        step={1}
        value={budget}
        onChange={commitBudget}
      />
      <SegmentedControl<TransportMode>
        label="Transport mode"
        value={mode}
        onChange={commitMode}
        options={[
          { value: 'driving', label: 'Drive' },
          { value: 'walking', label: 'Walk' },
          { value: 'transit', label: 'Transit' },
        ]}
      />
      <Button variant="danger" label="Delete trip" onPress={confirmDelete} loading={deleting} />
    </ScrollView>
  );
}

function formatRange(start: string | null, end: string | null): string {
  if (start && end) return `${start} → ${end}`;
  return start ?? end ?? 'No dates set';
}

function formatTravel(seconds: number, meters: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  const km = meters / 1000;
  return `${mins} min · ${km.toFixed(km < 10 ? 1 : 0)} km`;
}

function groupByDay(places: TripPlace[]): Array<{ dayIndex: number; places: TripPlace[] }> {
  const map = new Map<number, TripPlace[]>();
  for (const p of places) {
    const key = p.day_index ?? -1;
    const arr = map.get(key) ?? [];
    arr.push(p);
    map.set(key, arr);
  }
  for (const [, arr] of map) {
    arr.sort((a, b) => (a.order_in_day ?? 0) - (b.order_in_day ?? 0));
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dayIndex, ps]) => ({ dayIndex, places: ps }));
}

const styles = StyleSheet.create({
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  dayHeader: { borderLeftWidth: 4, paddingLeft: 12 },
  placeCard: { borderWidth: 1 },
});
