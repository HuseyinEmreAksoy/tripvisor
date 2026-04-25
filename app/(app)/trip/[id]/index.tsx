import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Button,
  DraggableItinerary,
  EmptyState,
  Heading,
  PlaceActionsSheet,
  Screen,
  SegmentedControl,
  Slider,
  StatusPill,
  TabBar,
  TripCostRollup,
  DaySummaryCard,
  type DraggableItem,
} from '@/components';
import { noPlaces } from '@/components/emptyStates';
import { ShareLinkCard } from '@/components/ShareLinkCard';
import { Map, decodePolyline, dayColor, type MapMarker, type MapPolyline } from '@/components/Map';
import { useTheme } from '@/theme';
// Metro resolves ics.native.ts on native, ics.web.ts on web automatically.
import { useDownloadTripIcs } from '@/api/ics';
import {
  supabase,
  useDeleteTrip,
  useOptimizeTrip,
  useReorderDay,
  useTrip,
  useTripLegs,
  useTripPlaces,
  useUpdateTrip,
  type TransportMode,
  type TripCurrency,
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
  const optimizeMutate = optimize.mutate;
  const deleteTrip = useDeleteTrip();

  // Auto-optimize (debounced 500ms) when places or trip settings change meaningfully.
  // Includes visit_duration_minutes so duration edits trigger re-split.
  const stateKey = useMemo(
    () =>
      JSON.stringify({
        places: places
          .map((p) => `${p.id}:${p.visit_duration_minutes}`)
          .sort(),
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
        <View style={styles.titleRow}>
          <Heading level={1}>{trip.title}</Heading>
          {/* Print button — navigates to print route on all platforms */}
          <Button
            label="Print itinerary"
            variant="secondary"
            fullWidth={false}
            onPress={() => router.push(`/trip/${trip.id}/print` as never)}
            accessibilityLabel="Print itinerary"
          />
        </View>
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

        {/* ── Cost rollup card (Step 8.4) ───────────────────────────────── */}
        <TripCostRollup trip={trip} legs={legs} />
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
        <ItineraryTab
          tripId={trip.id}
          places={places}
          legs={legs}
          trip={trip}
          onOpen={(gid) => router.push(`/place/${gid}`)}
        />
      ) : (
        <SettingsTab
          tripId={trip.id}
          dailyHoursBudget={trip.daily_hours_budget}
          transportMode={trip.transport_mode}
          currency={trip.currency}
          costPerKm={trip.cost_per_km}
          hasPlaces={places.length > 0}
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
  tripId,
  places,
  legs,
  trip,
  onOpen,
}: {
  tripId: string;
  places: TripPlace[];
  legs: TripLeg[];
  trip: import('@/api').Trip;
  onOpen: (googlePlaceId: string) => void;
}) {
  const t = useTheme();
  const router = useRouter();
  const reorderDay = useReorderDay();
  const [activePlaceId, setActivePlaceId] = useState<string | null>(null);

  const byDay = useMemo(() => groupByDay(places), [places]);
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const availableDays = useMemo(
    () => byDay.filter((d) => d.dayIndex >= 0).map((d) => d.dayIndex),
    [byDay],
  );

  const legIndex = useMemo(() => {
    const m = new Map<string, TripLeg>();
    for (const l of legs) m.set(`${l.day_index}|${l.from_place_id}|${l.to_place_id}`, l);
    return m;
  }, [legs]);

  if (places.length === 0) {
    return (
      <EmptyState
        {...noPlaces}
        onPress={() => router.push(`/trip/${tripId}/add`)}
      />
    );
  }

  const activePlace = activePlaceId ? byId.get(activePlaceId) ?? null : null;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md }}>
        {byDay.map((section) => (
          <View key={`day-${section.dayIndex}`} style={{ gap: t.spacing.sm }}>
            <View style={[styles.dayHeader, { borderColor: dayColor(section.dayIndex) }]}>
              <Text style={[t.typography.subtitle, { color: t.colors.text }]}>
                {section.dayIndex < 0 ? 'Unscheduled' : `Day ${section.dayIndex + 1}`}
              </Text>
            </View>

            {/* ── Per-day summary strip (Step 8.4) — only for scheduled days */}
            {section.dayIndex >= 0 ? (
              <DaySummaryCard
                dayIndex={section.dayIndex}
                places={places}
                legs={legs}
                trip={trip}
              />
            ) : null}

            <DraggableItinerary
              groupLabel={section.dayIndex < 0 ? 'Unscheduled places' : `Day ${section.dayIndex + 1}`}
              items={section.places.map<DraggableItem>((place, idx) => {
                const next = section.places[idx + 1];
                const leg = next
                  ? legIndex.get(`${section.dayIndex}|${place.id}|${next.id}`)
                  : undefined;
                return {
                  id: place.id,
                  render: (dragging) => (
                    <PlaceRow
                      place={place}
                      dragging={dragging}
                      legAfter={leg}
                      hasNext={Boolean(next)}
                      onOpenDetails={() => onOpen(place.google_place_id)}
                    />
                  ),
                };
              })}
              onReorder={(newIds) => {
                if (section.dayIndex < 0) return; // unscheduled bucket is not orderable
                reorderDay.mutate({
                  tripId,
                  dayIndex: section.dayIndex,
                  orderedIds: newIds,
                });
              }}
              onLongPress={(id) => setActivePlaceId(id)}
            />
          </View>
        ))}
      </ScrollView>

      <PlaceActionsSheet
        visible={activePlaceId !== null}
        onClose={() => setActivePlaceId(null)}
        place={activePlace}
        availableDays={availableDays}
      />
    </View>
  );
}

function PlaceRow({
  place,
  dragging,
  legAfter,
  hasNext,
  onOpenDetails,
}: {
  place: TripPlace;
  dragging: boolean;
  legAfter: TripLeg | undefined;
  hasNext: boolean;
  onOpenDetails: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open details for ${place.user_title ?? 'place'}. Long-press to change day, duration, or delete.`}
        onPress={onOpenDetails}
        style={[
          styles.placeCard,
          {
            borderColor: t.colors.border,
            borderRadius: t.radius.md,
            backgroundColor: t.colors.bgElevated,
            padding: t.spacing.md,
            opacity: dragging ? 0.85 : 1,
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
      {hasNext ? (
        <Text
          style={[t.typography.small, { color: t.colors.textMuted, paddingHorizontal: 12 }]}
        >
          ↓ {legAfter ? formatTravel(legAfter.duration_seconds, legAfter.distance_meters) : 'travel time unknown'}
        </Text>
      ) : null}
    </View>
  );
}

// ── Settings tab ──────────────────────────────────────────────────────────────

const CURRENCIES: TripCurrency[] = ['USD', 'EUR', 'GBP', 'TRY', 'JPY'];

function SettingsTab({
  tripId,
  dailyHoursBudget,
  transportMode,
  currency,
  costPerKm,
  hasPlaces,
  onDelete,
  deleting,
}: {
  tripId: string;
  dailyHoursBudget: number;
  transportMode: TransportMode;
  currency: TripCurrency;
  costPerKm: number;
  hasPlaces: boolean;
  onDelete: () => void;
  deleting: boolean;
}) {
  const t = useTheme();
  const [budget, setBudget] = useState(dailyHoursBudget);
  const [mode, setMode] = useState<TransportMode>(transportMode);

  // ICS export state
  const downloadIcs = useDownloadTripIcs(tripId);
  const [icsStatus, setIcsStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  // ── Cost settings (Step 8.6) ──────────────────────────────────────────────
  const updateTrip = useUpdateTrip(tripId);
  // Local text value for the rate input so the user can type freely.
  const [rateText, setRateText] = useState(String(costPerKm));
  const [rateError, setRateError] = useState<string | null>(null);
  // Keep a stable timer ref to implement a simple 500ms debounce without
  // a library. A new ref on each render is fine; we only mutate .current.
  const rateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending debounce timer on unmount so a delayed setTimeout doesn't
  // fire a stealth mutation against a stale tripId after the user navigates
  // away (M1 from Phase 8 review).
  useEffect(() => {
    return () => {
      if (rateTimerRef.current) clearTimeout(rateTimerRef.current);
    };
  }, []);

  function handleRateChange(raw: string) {
    setRateText(raw);
    setRateError(null);
    if (rateTimerRef.current) clearTimeout(rateTimerRef.current);
    rateTimerRef.current = setTimeout(() => {
      const parsed = Number(raw.replace(',', '.'));
      if (!Number.isFinite(parsed) || parsed < 0) {
        setRateError('Enter a positive number, e.g. 0.20');
        return;
      }
      updateTrip.mutate({ cost_per_km: parsed });
    }, 500);
  }

  function handleCurrencyChange(value: TripCurrency) {
    updateTrip.mutate({ currency: value });
  }

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

  async function handleExportIcs() {
    if (!hasPlaces) return;
    setIcsStatus('loading');
    try {
      await downloadIcs.mutateAsync();
      setIcsStatus('success');
      setTimeout(() => setIcsStatus('idle'), 3000);
    } catch {
      setIcsStatus('error');
      setTimeout(() => setIcsStatus('idle'), 4000);
    }
  }

  function icsButtonLabel() {
    switch (icsStatus) {
      case 'loading': return 'Exporting…';
      case 'success': return 'Downloaded!';
      case 'error': return 'Export failed — retry';
      default: return 'Export to calendar (.ics)';
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.lg }}>
      {/* ── Trip settings ───────────────────────────────────────────────── */}
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

      {/* ── Cost settings (Step 8.6) ─────────────────────────────────────── */}
      <SectionHeading label="Cost settings" t={t} />
      <SegmentedControl<TripCurrency>
        label="Currency"
        value={currency}
        onChange={handleCurrencyChange}
        options={CURRENCIES.map((c) => ({ value: c, label: c }))}
      />
      <View style={{ gap: t.spacing.xs }}>
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
          Cost per km ({currency})
        </Text>
        <TextInput
          value={rateText}
          onChangeText={handleRateChange}
          keyboardType="decimal-pad"
          // inputMode is a web-standard hint; RN ≥ 0.72 honours it on web.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          inputMode={"decimal" as any}
          accessibilityLabel="Cost per kilometre"
          accessibilityHint="Enter the fuel or transport cost per kilometre"
          style={[
            styles.rateInput,
            {
              borderColor: rateError ? t.colors.danger : t.colors.border,
              borderRadius: t.radius.sm,
              color: t.colors.text,
              backgroundColor: t.colors.bgElevated,
              ...t.typography.body,
            },
          ]}
          placeholder="0.20"
          placeholderTextColor={t.colors.textMuted}
        />
        {rateError ? (
          <Text
            style={[t.typography.caption, { color: t.colors.danger }]}
            accessibilityLiveRegion="polite"
          >
            {rateError}
          </Text>
        ) : null}
      </View>

      {/* ── Share ───────────────────────────────────────────────────────── */}
      <SectionHeading label="Share" t={t} />
      <ShareLinkCard tripId={tripId} />

      {/* ── Calendar export ─────────────────────────────────────────────── */}
      <SectionHeading label="Export" t={t} />
      <View style={{ gap: t.spacing.sm }}>
        <Button
          label={icsButtonLabel()}
          variant="secondary"
          onPress={handleExportIcs}
          loading={icsStatus === 'loading'}
          disabled={!hasPlaces || icsStatus === 'loading'}
          accessibilityLabel={
            hasPlaces
              ? 'Export itinerary to calendar as ICS file'
              : 'Add places before exporting to calendar'
          }
          accessibilityState={{ disabled: !hasPlaces || icsStatus === 'loading' }}
        />
        {!hasPlaces ? (
          <Text
            style={[t.typography.caption, { color: t.colors.textMuted }]}
            accessibilityLiveRegion="polite"
          >
            Add at least one place to enable calendar export.
          </Text>
        ) : null}
        {icsStatus === 'error' ? (
          <Text
            style={[t.typography.caption, { color: t.colors.danger }]}
            accessibilityLiveRegion="assertive"
          >
            Export failed. Please try again.
          </Text>
        ) : null}
      </View>

      {/* ── Danger zone ─────────────────────────────────────────────────── */}
      <SectionHeading label="Danger zone" t={t} />
      <Button variant="danger" label="Delete trip" onPress={confirmDelete} loading={deleting} />
    </ScrollView>
  );
}

/** Small inline section heading used inside the Settings scroll view. */
function SectionHeading({ label, t }: { label: string; t: ReturnType<typeof useTheme> }) {
  return (
    <Text
      style={[t.typography.subtitle, { color: t.colors.text }]}
      accessibilityRole="header"
      aria-level={3}
    >
      {label}
    </Text>
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
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  dayHeader: { borderLeftWidth: 4, paddingLeft: 12 },
  placeCard: { borderWidth: 1 },
  rateInput: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    height: 44,
  },
});
