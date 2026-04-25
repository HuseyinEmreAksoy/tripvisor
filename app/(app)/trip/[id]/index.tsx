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
import { useDebouncedCallback } from '@/lib/hooks/useDebouncedCallback';
// Metro resolves ics.native.ts on native, ics.web.ts on web automatically.
import { useDownloadTripIcs } from '@/api/ics';
import {
  OptimizeError,
  useDeleteTrip,
  useOptimizeTrip,
  useReorderDay,
  useTrip,
  useTripDays,
  useTripLegs,
  useTripPlaces,
  useUpdateTrip,
  useUpdateTripDay,
  useUpdateTripPlace,
  type TransportMode,
  type TripCurrency,
  type TripDay,
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
            (() => {
              const { tone, label } = pillForOptimizeError(optimize.error);
              return <StatusPill tone={tone} label={label} />;
            })()
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
  const t = useTheme();

  // ── Day filter state ───────────────────────────────────────────────────────
  // 'all' shows everything; a number filters to that day_index (0-indexed).
  // Resets on tab unmount — per-session, not persisted.
  const [selectedDay, setSelectedDay] = useState<'all' | number>('all');

  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);

  // All day indexes that have at least one assigned place, deduped and sorted.
  const availableDays = useMemo(() => {
    const seen = new Set<number>();
    for (const p of places) {
      if (p.day_index !== null && p.day_index >= 0) seen.add(p.day_index);
    }
    return [...seen].sort((a, b) => a - b);
  }, [places]);

  // If the previously-selected day is no longer valid (e.g. all its places
  // were deleted and the user returns to this tab), reset to 'all'.
  useEffect(() => {
    if (selectedDay !== 'all' && !availableDays.includes(selectedDay)) {
      setSelectedDay('all');
    }
  }, [availableDays, selectedDay]);

  // Build the full marker + polyline arrays once.
  const allMarkers: MapMarker[] = useMemo(
    () =>
      places.map((p) => ({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        title: p.user_title ?? 'Place',
        dayIndex: p.day_index,
        orderInDay: p.order_in_day,
      })),
    [places],
  );

  const allPolylines: MapPolyline[] = useMemo(
    () =>
      legs
        .filter((l) => l.polyline && l.day_index >= 0)
        .map((l) => ({
          id: l.id,
          dayIndex: l.day_index,
          points: decodePolyline(l.polyline!),
        })),
    [legs],
  );

  // Apply the day filter. When 'all', pass the full arrays (stable references
  // from the memos above so Map doesn't re-render unnecessarily).
  const filteredMarkers = useMemo(() => {
    if (selectedDay === 'all') return allMarkers;
    // Exclude unassigned (day_index === null) when filtering by a specific day.
    return allMarkers.filter((m) => m.dayIndex === selectedDay);
  }, [allMarkers, selectedDay]);

  const filteredPolylines = useMemo(() => {
    if (selectedDay === 'all') return allPolylines;
    return allPolylines.filter((p) => p.dayIndex === selectedDay);
  }, [allPolylines, selectedDay]);

  return (
    <View style={{ flex: 1 }}>
      {/* Chip row — only rendered once at least one place has been assigned to a day */}
      {availableDays.length > 0 ? (
        <View
          style={{
            paddingHorizontal: t.spacing.lg,
            paddingVertical: t.spacing.sm,
          }}
        >
          {/*
           * accessibilityRole="radiogroup" on the wrapping View groups all chips
           * for screen readers; each chip carries role="radio" + checked state.
           */}
          <View accessibilityRole="radiogroup" accessibilityLabel="Filter map by day">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: t.spacing.sm }}
            >
              {/* "All" chip */}
              {(['all', ...availableDays] as Array<'all' | number>).map((value) => {
                const isAll = value === 'all';
                const isSelected = selectedDay === value;
                const label = isAll ? 'All' : `Day ${(value as number) + 1}`;
                const dotColor = isAll ? undefined : dayColor(value as number);

                return (
                  <Pressable
                    key={String(value)}
                    accessibilityRole="radio"
                    accessibilityLabel={label}
                    accessibilityState={{ checked: isSelected }}
                    onPress={() => setSelectedDay(value)}
                    style={[
                      styles.dayChip,
                      {
                        backgroundColor: isSelected
                          ? t.colors.primary
                          : t.colors.bgElevated,
                        borderColor: isSelected ? t.colors.primary : t.colors.border,
                        borderRadius: t.radius.md,
                      },
                    ]}
                  >
                    {/* Color dot for day chips — kept compact (8×8) so it doesn't compete with the label */}
                    {!isAll && dotColor ? (
                      <View
                        style={[
                          styles.dayChipDot,
                          { backgroundColor: dotColor },
                        ]}
                        // Purely decorative; the label already conveys identity.
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    ) : null}
                    <Text
                      style={[
                        t.typography.caption,
                        {
                          color: isSelected ? t.colors.primaryText : t.colors.text,
                          fontWeight: isSelected ? '600' : '400',
                        },
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      ) : null}

      {/* Map fills the remaining space */}
      <View style={{ flex: 1 }}>
        <Map
          markers={filteredMarkers}
          polylines={filteredPolylines}
          onMarkerPress={(markerId) => {
            const p = byId.get(markerId);
            if (p) onMarker(p.google_place_id);
          }}
        />
      </View>
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

  // ── Per-day notes (Step 9.5) ─────────────────────────────────────────────
  const { data: tripDays = [] } = useTripDays(tripId);
  // Index by day_index for O(1) lookup in the render loop.
  const dayNotesIndex = useMemo(() => {
    const m = new Map<number, TripDay>();
    for (const d of tripDays) m.set(d.day_index, d);
    return m;
  }, [tripDays]);

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
      {/*
       * keyboardShouldPersistTaps="handled" is required so tapping outside a
       * focused TextInput inside the list correctly dismisses the keyboard on
       * native without eating the tap event (risk M from planner spec Step 9.4).
       */}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md }}
      >
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

            {/* ── Per-day notes editor (Step 9.5) — only for scheduled days */}
            {section.dayIndex >= 0 ? (
              <DayNotesEditor
                tripId={tripId}
                dayIndex={section.dayIndex}
                dayRecord={dayNotesIndex.get(section.dayIndex) ?? null}
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

// ── DayNotesEditor (Step 9.5) ────────────────────────────────────────────────
//
// Design: Option A inline — collapsed Pressable "Add notes for this day" when
// empty, or a truncated first line when populated. Tap to expand into a
// multi-line TextInput. 500ms debounced write via useUpdateTripDay().

function DayNotesEditor({
  tripId,
  dayIndex,
  dayRecord,
}: {
  tripId: string;
  dayIndex: number;
  dayRecord: TripDay | null;
}) {
  const t = useTheme();
  const updateDay = useUpdateTripDay();
  const persistedNotes = dayRecord?.notes ?? null;

  const [expanded, setExpanded] = useState(false);
  // Local text mirrors the persisted notes; synced when the persisted value
  // changes from the server (e.g. another device write / optimistic flush).
  const [localText, setLocalText] = useState(persistedNotes ?? '');

  // Keep local text in sync with server state when notes are updated externally.
  useEffect(() => {
    setLocalText(persistedNotes ?? '');
  }, [persistedNotes]);

  const debouncedSave = useDebouncedCallback((value: string) => {
    const trimmed = value.trim();
    updateDay.mutate({
      trip_id: tripId,
      day_index: dayIndex,
      notes: trimmed.length > 0 ? trimmed : null,
    });
  }, 500);

  function handleChange(text: string) {
    setLocalText(text);
    debouncedSave(text);
  }

  const hasNotes = Boolean(localText.trim());

  // The collapsed preview: first line of text, truncated to one line.
  const previewText = hasNotes
    ? (localText.split('\n')[0] ?? '').slice(0, 80)
    : null;

  if (!expanded) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          hasNotes
            ? `Day ${dayIndex + 1} notes: ${previewText}. Tap to edit.`
            : `Add notes for Day ${dayIndex + 1}`
        }
        onPress={() => setExpanded(true)}
        style={[
          styles.dayNotesCollapsed,
          {
            borderColor: t.colors.border,
            borderRadius: t.radius.sm,
            backgroundColor: t.colors.bgElevated,
            padding: t.spacing.sm,
          },
        ]}
      >
        <Text
          style={[
            t.typography.caption,
            { color: hasNotes ? t.colors.text : t.colors.textMuted },
          ]}
          numberOfLines={1}
        >
          {hasNotes ? previewText : 'Add notes for this day…'}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={{ gap: t.spacing.xs }}>
      <TextInput
        multiline
        numberOfLines={4}
        maxLength={2000}
        value={localText}
        onChangeText={handleChange}
        onBlur={() => debouncedSave.flush()}
        placeholder="Add notes for this day (up to 2000 characters)"
        placeholderTextColor={t.colors.textMuted}
        accessibilityLabel={`Notes for Day ${dayIndex + 1}`}
        style={[
          styles.notesInput,
          {
            borderColor: t.colors.border,
            borderRadius: t.radius.sm,
            backgroundColor: t.colors.bgElevated,
            color: t.colors.text,
            ...t.typography.caption,
          },
        ]}
        autoFocus
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Collapse day notes"
        onPress={() => setExpanded(false)}
        style={{ alignSelf: 'flex-end' }}
      >
        <Text style={[t.typography.caption, { color: t.colors.primary }]}>Done</Text>
      </Pressable>
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

      {/* ── Per-place notes editor (Step 9.4) — Option A inline ── */}
      {!dragging ? (
        <PlaceNotesEditor place={place} />
      ) : null}

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

// ── PlaceNotesEditor (Step 9.4) ───────────────────────────────────────────────
//
// Surface: Option A (inline, below the place card title row).
// Rationale: the place card already has a natural content area under the title
// and category line. Inlining here avoids opening an extra bottom sheet and
// gives the user immediate visual feedback without a tap-to-open gesture.
// On a 360px-wide viewport the notes field is comfortably within the card
// width; numberOfLines={4} keeps vertical growth bounded.
//
// Debounced 500ms write via useUpdateTripPlace(); empty string saved as null.

const NOTES_COLLAPSE_THRESHOLD = 120;

function PlaceNotesEditor({ place }: { place: TripPlace }) {
  const t = useTheme();
  const updatePlace = useUpdateTripPlace();
  const [focused, setFocused] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [localText, setLocalText] = useState(place.notes ?? '');

  // Sync from server when the notes prop changes (cache invalidation).
  useEffect(() => {
    setLocalText(place.notes ?? '');
  }, [place.notes]);

  const debouncedSave = useDebouncedCallback((value: string) => {
    const trimmed = value.trim();
    updatePlace.mutate({
      id: place.id,
      trip_id: place.trip_id,
      notes: trimmed.length > 0 ? trimmed : null,
    });
  }, 500);

  function handleChange(text: string) {
    setLocalText(text);
    debouncedSave(text);
  }

  // Show-more / show-less logic: only applies when NOT focused and text > 120 chars.
  const isLong = !focused && localText.length > NOTES_COLLAPSE_THRESHOLD;
  const displayText =
    isLong && !showMore
      ? localText.slice(0, NOTES_COLLAPSE_THRESHOLD) + '…'
      : localText;

  return (
    <View style={{ gap: t.spacing.xs, paddingHorizontal: t.spacing.xs }}>
      {focused ? (
        <TextInput
          multiline
          numberOfLines={4}
          maxLength={2000}
          value={localText}
          onChangeText={handleChange}
          onBlur={() => { debouncedSave.flush(); setFocused(false); }}
          placeholder="Add notes (up to 2000 characters)"
          placeholderTextColor={t.colors.textMuted}
          accessibilityLabel={`Notes for ${place.user_title ?? 'place'}`}
          style={[
            styles.notesInput,
            {
              borderColor: t.colors.border,
              borderRadius: t.radius.sm,
              backgroundColor: t.colors.bg,
              color: t.colors.text,
              ...t.typography.caption,
            },
          ]}
          autoFocus
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            localText
              ? `Notes for ${place.user_title ?? 'place'}: ${localText.slice(0, 60)}. Tap to edit.`
              : `Add notes for ${place.user_title ?? 'place'}`
          }
          onPress={() => setFocused(true)}
        >
          <Text
            accessibilityRole="text"
            style={[
              t.typography.caption,
              { color: localText ? t.colors.text : t.colors.textMuted },
            ]}
          >
            {localText ? displayText : 'Add notes…'}
          </Text>
        </Pressable>
      )}

      {/* Show more / show less toggle */}
      {isLong ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showMore ? 'Show less notes' : 'Show more notes'}
          onPress={() => setShowMore((v) => !v)}
        >
          <Text style={[t.typography.caption, { color: t.colors.primary }]}>
            {showMore ? 'Show less' : 'Show more'}
          </Text>
        </Pressable>
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

  // Web Slider's <input type="range"> fires onChange per-tick during drag, so
  // debounce 500ms to avoid spamming the API. Native Slider is a stepper
  // (one tap = one fire), so the debounce is harmless there.
  const debouncedSaveBudget = useDebouncedCallback((v: number) => {
    updateTrip.mutate({ daily_hours_budget: v });
  }, 500);

  function commitBudget(v: number) {
    setBudget(v);
    debouncedSaveBudget(v);
  }
  function commitMode(v: TransportMode) {
    setMode(v);
    updateTrip.mutate({ transport_mode: v });
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

/**
 * Map an optimize-trip error to a user-facing status pill.
 *
 * - `already_optimizing` (409) is a transient state, not a failure: another
 *   optimize is already running for the trip (typically a double-click or a
 *   rapid state-key change). Render as info tone — the auto-optimize effect
 *   above will re-run when the in-flight call settles, no user action needed.
 * - All other known codes map to danger tone with a code-specific label.
 * - Unknown codes / non-OptimizeError (network failures, parse fallthrough)
 *   fall back to the generic "Optimize failed" label.
 */
function pillForOptimizeError(
  err: unknown,
): { tone: 'info' | 'success' | 'danger'; label: string } {
  if (err instanceof OptimizeError) {
    switch (err.code) {
      case 'already_optimizing':
        return { tone: 'info', label: 'Optimizing in progress…' };
      case 'too_many_places':
        return { tone: 'danger', label: 'Trip is too large' };
      case 'matrix_failed':
        return { tone: 'danger', label: 'Routing service unavailable' };
      case 'not_found':
        return { tone: 'danger', label: 'Trip not found' };
      case 'rpc_failed':
      case 'db_error':
      case 'invalid_input':
      default:
        return { tone: 'danger', label: 'Optimize failed' };
    }
  }
  return { tone: 'danger', label: 'Optimize failed' };
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
  // Per-place and per-day notes inputs (Steps 9.4 + 9.5)
  notesInput: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 80,
    textAlignVertical: 'top', // Android: start text from the top of the multiline field
  },
  dayNotesCollapsed: {
    borderWidth: 1,
  },
  // Day-filter chips rendered above the Map in MapTab.
  dayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12, // t.spacing.md = 12
    minHeight: 36,
    gap: 6,
  },
  dayChipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
