import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  BackButton,
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
// Renamed to TripMap to avoid shadowing the built-in JS Map collection constructor.
// Every `new Map(...)` call in this file must resolve to the built-in; if the
// import were named `Map`, TypeScript/Metro would resolve those call sites to
// the React component and produce a runtime crash ("Cannot read properties of
// undefined (reading 'markers')") on first render.
import { Map as TripMap, decodePolyline, dayColor, type MapMarker, type MapPolyline } from '@/components/Map';
import { useTheme } from '@/theme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
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
  useUpdateRouteRenderMode,
  type RouteRenderMode,
  type TransportMode,
  type TripCurrency,
  type TripDay,
  type TripLeg,
  type TripPlace,
} from '@/api';
import { formatDuration, formatDurationSeconds } from '@/lib/formatDuration';
import { useTripExpenseRollup, useTripExpenses } from '@/api/trip-expenses';
import { useTripAccommodations, useDeleteTripAccommodation } from '@/api/trip-accommodations';
import { useTripRole } from '@/hooks/useTripRole';
// Budget components (Phase 21 Step 21.10)
import { BudgetCard } from '@/components/budget/BudgetCard';
import { BudgetEditSheet } from '@/components/budget/BudgetEditSheet';
import { CategoryBreakdown } from '@/components/budget/CategoryBreakdown';
import { ExpenseList } from '@/components/budget/ExpenseList';
import { ExpenseEditSheet } from '@/components/budget/ExpenseEditSheet';
// Accommodation components (Phase 21 Step 21.13)
import { AccommodationList } from '@/components/accommodation/AccommodationList';
import { AccommodationEditSheet } from '@/components/accommodation/AccommodationEditSheet';
import { StayingAtPill } from '@/components/accommodation/StayingAtPill';
import { useDeleteTripExpense } from '@/api';
import type { TripExpense } from '@/api/types';
import type { TripAccommodation } from '@/api/types';
// Phase 24: reactions
import { ReactionChip } from '@/components/ReactionChip';
import { useTripReactions, useSetTripPlaceReaction } from '@/api/trip-place-reactions';
import { useSession } from '@/api/auth';
// Phase 24: location
import { useCurrentLocation } from '@/hooks/useCurrentLocation';
import { useTripUseMyLocation } from '@/hooks/useTripUseMyLocation';

type TabKey = 'map' | 'itinerary' | 'settings';

export default function TripDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useTheme();
  const bp = useBreakpoint();
  const isDesktop = bp === 'desktop';
  // On desktop, the map + itinerary are shown side-by-side; the tab defaults
  // to 'settings' for the TabBar which only shows the Settings tab on desktop.
  // On mobile/tablet, the original tab behaviour (map | itinerary | settings) applies.
  const [tab, setTab] = useState<TabKey>('map');

  const { data: trip, isLoading, error } = useTrip(id);
  const { data: places = [] } = useTripPlaces(id);
  const { data: legs = [] } = useTripLegs(id);
  const optimize = useOptimizeTrip();
  const optimizeMutate = optimize.mutate;
  const deleteTrip = useDeleteTrip();

  // Phase 21 Step 21.10/21.11: Role-gating for budget + accommodation + collaborators.
  const { canEditTrip, role: tripRole } = useTripRole(id);
  const isOwner = tripRole === 'owner';

  // Accommodations at TripDetail level so ItineraryTab's StayingAtPill can consume them.
  // The SettingsTab also calls useTripAccommodations internally; TanStack Query dedupes
  // the request, so there's zero extra network cost for having it here too.
  const { data: tripAccommodations = [] } = useTripAccommodations(id);

  // Number of assigned days in the trip — used for the expense day picker.
  const tripDayCount = useMemo(() => {
    if (!trip?.start_date || !trip?.end_date) return 0;
    const start = new Date(trip.start_date);
    const end = new Date(trip.end_date);
    const diff = Math.round((end.getTime() - start.getTime()) / 86400000);
    return Math.max(0, diff + 1);
  }, [trip?.start_date, trip?.end_date]);

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

  // ── Shared page header (title, meta, cost rollup) ────────────────────────
  const pageHeader = (
    <View style={{ backgroundColor: t.colors.gradientSubtle }}>
      <View style={{ padding: t.spacing.lg, gap: t.spacing.sm }}>
        <BackButton onPress={() => router.back()} label="Trips" />
        <View style={styles.titleRow}>
          <Heading level={1}>{trip.title}</Heading>
          <Button
            label="🖨️ Print"
            variant="secondary"
            fullWidth={false}
            onPress={() => router.push(`/trip/${trip.id}/print` as never)}
            accessibilityLabel="Print itinerary"
          />
        </View>
        <View style={styles.metaRow}>
          <View style={{
            backgroundColor: t.colors.cardBgSolid,
            borderRadius: t.radius.pill,
            paddingHorizontal: t.spacing.md,
            paddingVertical: t.spacing.xs,
            ...t.shadows.sm(t.colors.shadowColor),
          }}>
            <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '500' }]}>
              📅 {formatRange(trip.start_date, trip.end_date)} · {trip.daily_hours_budget}h/day · {trip.transport_mode}
            </Text>
          </View>
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

        {/* Cost rollup card */}
        <TripCostRollup trip={trip} legs={legs} />
      </View>
    </View>
  );

  // ── Desktop: map + itinerary side-by-side, Settings behind a tab ──────────
  // The two content columns share the remaining screen height after the header.
  // Map (~60%) is sticky (doesn't scroll), itinerary (~40%) scrolls on its own.
  // The Settings tab is still accessible via the TabBar below the header.
  if (isDesktop) {
    return (
      <Screen padded={false}>
        {pageHeader}

        {/*
         * Desktop TabBar shows only the Settings tab — on desktop the map and
         * itinerary are always visible side-by-side rather than tab-switched.
         * We still use the TabBar component for visual consistency and keyboard
         * accessibility. When "settings" is the only tab it still receives focus
         * correctly.
         *
         * The `tab` state governs whether the side-by-side panel or the settings
         * panel is visible: any value !== 'settings' shows the split panel.
         */}
        <TabBar<TabKey>
          activeKey={tab === 'settings' ? 'settings' : 'map'}
          onSelect={(key) => setTab(key)}
          tabs={[
            { key: 'map', label: 'Map & Itinerary' },
            { key: 'settings', label: 'Settings' },
          ]}
        />

        {tab === 'settings' ? (
          <>
            <SettingsTab
              tripId={trip.id}
              tripStartDate={trip.start_date}
              dailyHoursBudget={trip.daily_hours_budget}
              transportMode={trip.transport_mode}
              currency={trip.currency}
              costPerKm={trip.cost_per_km}
              hasPlaces={places.length > 0}
              tripDayCount={tripDayCount}
              canEdit={canEditTrip}
              isOwner={isOwner}
              onDelete={async () => {
                await deleteTrip.mutateAsync(trip.id);
                router.replace('/trips');
              }}
              deleting={deleteTrip.isPending}
            />
            {canEditTrip ? (
              <View style={{ padding: t.spacing.lg }}>
                <Button label="Add a place" onPress={() => router.push(`/trip/${trip.id}/add`)} />
              </View>
            ) : null}
          </>
        ) : (
          /*
           * Side-by-side panel: map (left, ~60%, sticky) + itinerary (right, ~40%, scrolling).
           * flex: 1 on the outer row ensures it fills the remaining Screen height.
           * The map column has `overflow: 'hidden'` so the Map component's fixed-
           * positioned elements don't escape its bounds on web.
           */
          <View style={desktopDetailStyles.splitRow}>
            {/* Left: map column — sticky (no scroll) */}
            <View style={desktopDetailStyles.mapColumn}>
              <MapTab
                tripId={trip.id}
                places={places}
                legs={legs}
                trip={trip}
                canEdit={canEditTrip}
                onMarker={(pid) => router.push(`/place/${pid}`)}
              />
            </View>

            {/* Right: itinerary + add-place button */}
            <View style={[desktopDetailStyles.itineraryColumn, { borderLeftColor: t.colors.border }]}>
              <ItineraryTab
                tripId={trip.id}
                places={places}
                legs={legs}
                trip={trip}
                accommodations={tripAccommodations}
                onOpen={(gid) => router.push(`/place/${gid}`)}
              />
              {canEditTrip ? (
                <View style={{ padding: t.spacing.lg, borderTopWidth: 1, borderTopColor: t.colors.border }}>
                  <Button label="Add a place" onPress={() => router.push(`/trip/${trip.id}/add`)} />
                </View>
              ) : null}
            </View>
          </View>
        )}
      </Screen>
    );
  }

  // ── Mobile / tablet: original tab layout ─────────────────────────────────
  return (
    <Screen padded={false}>
      {pageHeader}

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
        <MapTab
          tripId={trip.id}
          places={places}
          legs={legs}
          trip={trip}
          canEdit={canEditTrip}
          onMarker={(pid) => router.push(`/place/${pid}`)}
        />
      ) : tab === 'itinerary' ? (
        <ItineraryTab
          tripId={trip.id}
          places={places}
          legs={legs}
          trip={trip}
          accommodations={tripAccommodations}
          onOpen={(gid) => router.push(`/place/${gid}`)}
        />
      ) : (
        <SettingsTab
          tripId={trip.id}
          tripStartDate={trip.start_date}
          dailyHoursBudget={trip.daily_hours_budget}
          transportMode={trip.transport_mode}
          currency={trip.currency}
          costPerKm={trip.cost_per_km}
          hasPlaces={places.length > 0}
          tripDayCount={tripDayCount}
          canEdit={canEditTrip}
          isOwner={isOwner}
          onDelete={async () => {
            await deleteTrip.mutateAsync(trip.id);
            router.replace('/trips');
          }}
          deleting={deleteTrip.isPending}
        />
      )}

      {canEditTrip ? (
        <View style={{ padding: t.spacing.lg }}>
          <Button label="Add a place" onPress={() => router.push(`/trip/${trip.id}/add`)} />
        </View>
      ) : null}
    </Screen>
  );
}

function MapTab({
  tripId,
  places,
  legs,
  trip,
  canEdit,
  onMarker,
}: {
  tripId: string;
  places: TripPlace[];
  legs: TripLeg[];
  trip: import('@/api').Trip;
  canEdit: boolean;
  onMarker: (googlePlaceId: string) => void;
}) {
  const t = useTheme();

  // ── Route render mode toggle (Step 23.4) ──────────────────────────────────
  const updateRenderMode = useUpdateRouteRenderMode(tripId);
  const currentMode: RouteRenderMode = trip.route_render_mode;

  // ── Phase 24: "From my location" toggle (Step 24.9) ───────────────────────
  const { location: userLocation, status: locationStatus, request: requestLocation } = useCurrentLocation();
  const { enabled: useMyLocation, setEnabled: setUseMyLocation } = useTripUseMyLocation(tripId);

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

  // Phase 20 Step 7 fix: render-time derivation instead of a state-resetting
  // useEffect. The previous design interleaved a useEffect between two
  // useMemo calls, which under React 18 concurrent rendering + Fast Refresh
  // + the parent's auto-optimize cascade caused hook-tape corruption and
  // crashed the entire trip detail route on first cold mount with
  // "Cannot read properties of undefined (reading 'length')" (issue #11).
  //
  // Computing `effectiveSelectedDay` at render time eliminates the
  // state→effect→state cycle. If `selectedDay` no longer points at a valid
  // day (e.g. user deleted all of Day 2's places and returns to the tab),
  // we silently treat it as 'all' for filtering. The setter is still wired
  // to chip taps; if the user taps a chip then deletes its places elsewhere,
  // the filter "softly" falls back to 'all' on next render. Keeping the raw
  // state in `selectedDay` lets the chip's checked-state visually still
  // point at the user's last intent if those places are restored (e.g. via
  // re-optimize) without an extra setState round-trip.
  const effectiveSelectedDay: 'all' | number =
    selectedDay !== 'all' && !availableDays.includes(selectedDay)
      ? 'all'
      : selectedDay;

  // Apply the day filter. When 'all', pass the full arrays (stable references
  // from the memos above so Map doesn't re-render unnecessarily).
  const filteredMarkers = useMemo(() => {
    if (effectiveSelectedDay === 'all') return allMarkers;
    // Exclude unassigned (day_index === null) when filtering by a specific day.
    return allMarkers.filter((m) => m.dayIndex === effectiveSelectedDay);
  }, [allMarkers, effectiveSelectedDay]);

  // ── Transit mode: build dashed polylines for null-polyline legs ──────────
  // Phase 23 Step 23.9: legs with polyline === null become dashed straight
  // lines from the from-place to the to-place using the MapPolyline.isDashed flag.
  const byPlaceId = useMemo(
    () => new Map(places.map((p) => [p.id, p])),
    [places],
  );

  const allPolylinesFull = useMemo(() => {
    const result: MapPolyline[] = [];
    for (const l of legs) {
      if (l.day_index < 0) continue;
      if (l.polyline) {
        result.push({
          id: l.id,
          dayIndex: l.day_index,
          points: decodePolyline(l.polyline),
        });
      } else {
        // Transit fallback: straight dashed line.
        const fromPlace = byPlaceId.get(l.from_place_id);
        const toPlace = byPlaceId.get(l.to_place_id);
        if (fromPlace && toPlace) {
          result.push({
            id: l.id,
            dayIndex: l.day_index,
            isDashed: true,
            points: [],
            from: { lat: fromPlace.lat, lng: fromPlace.lng },
            to: { lat: toPlace.lat, lng: toPlace.lng },
          });
        }
      }
    }
    return result;
  }, [legs, byPlaceId]);

  const filteredPolylinesFull = useMemo(() => {
    if (effectiveSelectedDay === 'all') return allPolylinesFull;
    return allPolylinesFull.filter((p) => p.dayIndex === effectiveSelectedDay);
  }, [allPolylinesFull, effectiveSelectedDay]);

  // ── Phase 24 Step 24.9: virtual "from my location" leg ───────────────────
  // When enabled + location granted, prepend a straight-line polyline from
  // the user's position to the first place in the active day. This is
  // render-only and is never written to trip_legs.
  const firstPlaceForActiveDay = useMemo(() => {
    const dayIndex = effectiveSelectedDay === 'all' ? (availableDays[0] ?? null) : effectiveSelectedDay;
    if (dayIndex === null) return null;
    const inDay = places
      .filter((p) => p.day_index === dayIndex)
      .sort((a, b) => (a.order_in_day ?? 0) - (b.order_in_day ?? 0));
    return inDay[0] ?? null;
  }, [places, effectiveSelectedDay, availableDays]);

  const virtualLegPolyline: MapPolyline | null = useMemo(() => {
    if (!useMyLocation || !userLocation || !firstPlaceForActiveDay) return null;
    return {
      id: '__my_location_virtual__',
      dayIndex:
        effectiveSelectedDay === 'all'
          ? (availableDays[0] ?? 0)
          : (effectiveSelectedDay as number),
      isDashed: false,
      points: [],
      from: { lat: userLocation.lat, lng: userLocation.lng },
      to: { lat: firstPlaceForActiveDay.lat, lng: firstPlaceForActiveDay.lng },
    };
  }, [useMyLocation, userLocation, firstPlaceForActiveDay, effectiveSelectedDay, availableDays]);

  const userMarker: MapMarker | null = useMemo(() => {
    if (!useMyLocation || !userLocation) return null;
    return {
      id: '__my_location__',
      lat: userLocation.lat,
      lng: userLocation.lng,
      title: 'My location',
      dayIndex: null,
      orderInDay: null,
    };
  }, [useMyLocation, userLocation]);

  const finalMarkers = useMemo(() => {
    if (!userMarker) return filteredMarkers;
    return [userMarker, ...filteredMarkers];
  }, [filteredMarkers, userMarker]);

  const finalPolylines = useMemo(() => {
    if (!virtualLegPolyline) return filteredPolylinesFull;
    return [virtualLegPolyline, ...filteredPolylinesFull];
  }, [filteredPolylinesFull, virtualLegPolyline]);

  // Handle the toggle button press.
  async function handleMyLocationToggle() {
    if (useMyLocation) {
      setUseMyLocation(false);
      return;
    }
    if (locationStatus === 'granted' && userLocation) {
      // Already have permission + location — just enable.
      setUseMyLocation(true);
      return;
    }
    // Need to request permission.
    await requestLocation();
    // After request(), `locationStatus` will update asynchronously.
    // We enable the toggle only if granted — checked in the effect below.
  }

  // Enable the toggle automatically once location is granted after a tap.
  useEffect(() => {
    if (locationStatus === 'granted' && !useMyLocation && userLocation) {
      setUseMyLocation(true);
    }
    // Only fire when status flips to 'granted'; ignore other transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationStatus]);

  return (
    <View style={{ flex: 1 }}>
      {/* ── Route render mode segmented control (Step 23.4) ──────────────────
       * When places.length === 0, the control sits inside the empty-state card
       * with descriptive copy. When places exist, it's a persistent toggle
       * above the day chip row. Owners + editors get the live control; viewers
       * see it read-only (taps are no-ops with a visual-only display).
       */}
      {places.length === 0 ? (
        <View
          style={{
            margin: t.spacing.lg,
            padding: t.spacing.md,
            backgroundColor: t.colors.bgElevated,
            borderRadius: t.radius.lg,
            borderWidth: 1,
            borderColor: t.colors.border,
            gap: t.spacing.sm,
          }}
        >
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
            {trip.transport_mode === 'transit'
              ? 'Transit mode: routes will use realistic times; tap each leg to view step-by-step on Google Maps'
              : 'Add places, then choose how to draw the route.'}
          </Text>
          <RouteRenderModeControl
            mode={currentMode}
            pending={updateRenderMode.isPending}
            canEdit={canEdit}
            onSelect={(m) => updateRenderMode.mutate(m)}
          />
        </View>
      ) : (
        <View style={{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm }}>
          <RouteRenderModeControl
            mode={currentMode}
            pending={updateRenderMode.isPending}
            canEdit={canEdit}
            onSelect={(m) => updateRenderMode.mutate(m)}
          />
        </View>
      )}

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
                const isSelected = effectiveSelectedDay === value;
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

      {/* ── Phase 24 Step 24.9: "From my location" toggle ─────────────────
       * Hidden when locationStatus === 'unavailable' (locked-down web env).
       * Shows a spinner while requesting, inline error on denied.
       */}
      {locationStatus !== 'unavailable' ? (
        <View style={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.sm, gap: t.spacing.xs }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={useMyLocation ? 'Disable route from my location' : 'Route from my location'}
            accessibilityState={{ selected: useMyLocation }}
            onPress={handleMyLocationToggle}
            style={({ pressed }) => [
              styles.myLocationBtn,
              {
                backgroundColor: useMyLocation ? t.colors.primary : t.colors.bgElevated,
                borderColor: useMyLocation ? t.colors.primary : t.colors.border,
                opacity: pressed ? 0.75 : 1,
                borderRadius: t.radius.md,
              },
            ]}
          >
            {locationStatus === 'requesting' ? (
              <ActivityIndicator
                size="small"
                color={useMyLocation ? t.colors.primaryText : t.colors.primary}
              />
            ) : (
              <Text
                style={{
                  fontSize: 14,
                  color: useMyLocation ? t.colors.primaryText : t.colors.textMuted,
                }}
                accessible={false}
              >
                {'📍'}
              </Text>
            )}
            <Text
              style={[
                t.typography.caption,
                {
                  color: useMyLocation ? t.colors.primaryText : t.colors.text,
                  fontWeight: useMyLocation ? '600' : '400',
                },
              ]}
            >
              {useMyLocation ? 'From my location' : 'From my location'}
            </Text>
          </Pressable>

          {locationStatus === 'denied' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <Text
                style={[t.typography.caption, { color: t.colors.danger, flex: 1 }]}
                accessibilityLiveRegion="polite"
              >
                {'Location permission denied — enable in browser/system settings.'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try requesting location again"
                onPress={handleMyLocationToggle}
              >
                <Text style={[t.typography.caption, { color: t.colors.primary }]}>
                  {'Try again'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Map fills the remaining space */}
      <View style={{ flex: 1 }}>
        <TripMap
          markers={finalMarkers}
          polylines={finalPolylines}
          onMarkerPress={(markerId: string) => {
            if (markerId === '__my_location__') return; // user marker — no action
            const p = byId.get(markerId);
            if (p) onMarker(p.google_place_id);
          }}
        />
      </View>
    </View>
  );
}

// ── RouteRenderModeControl ──────────────────────────────────────────────────
//
// Small inline segmented control for the "Best route" / "My order" toggle.
// Uses the same chip aesthetic as the day filter chips above the map.
// When `pending` is true (optimize in-flight) the inactive option shows
// a visual disabled state; the active option's label shows "…".
// When `canEdit` is false the control is display-only (no press handler).

function RouteRenderModeControl({
  mode,
  pending,
  canEdit,
  onSelect,
}: {
  mode: RouteRenderMode;
  pending: boolean;
  canEdit: boolean;
  onSelect: (m: RouteRenderMode) => void;
}) {
  const t = useTheme();

  const options: Array<{ value: RouteRenderMode; label: string; icon: string }> = [
    { value: 'optimized', label: 'Best route', icon: '✦' },
    { value: 'manual', label: 'My order', icon: '≡' },
  ];

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Route rendering mode"
      style={styles.renderModeRow}
    >
      {options.map((opt) => {
        const isActive = mode === opt.value;
        const isDisabled = pending && !isActive;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="radio"
            accessibilityLabel={
              pending && isActive
                ? `${opt.label}, applying…`
                : opt.label
            }
            accessibilityState={{ checked: isActive, disabled: isDisabled || !canEdit }}
            onPress={canEdit && !pending ? () => onSelect(opt.value) : undefined}
            style={[
              styles.renderModeChip,
              {
                backgroundColor: isActive ? t.colors.primary : t.colors.bgElevated,
                borderColor: isActive ? t.colors.primary : t.colors.border,
                borderRadius: t.radius.md,
                opacity: isDisabled ? 0.45 : 1,
              },
            ]}
          >
            <Text
              style={{
                fontSize: 13,
                color: isActive ? t.colors.primaryText : t.colors.text,
              }}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              {opt.icon}
            </Text>
            <Text
              style={[
                t.typography.caption,
                {
                  color: isActive ? t.colors.primaryText : t.colors.text,
                  fontWeight: isActive ? '600' : '400',
                },
              ]}
            >
              {pending && isActive ? 'Applying…' : opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ItineraryTab({
  tripId,
  places,
  legs,
  trip,
  accommodations,
  onOpen,
}: {
  tripId: string;
  places: TripPlace[];
  legs: TripLeg[];
  trip: import('@/api').Trip;
  accommodations: TripAccommodation[];
  onOpen: (googlePlaceId: string) => void;
}) {
  const t = useTheme();
  const router = useRouter();
  const reorderDay = useReorderDay();
  const [activePlaceId, setActivePlaceId] = useState<string | null>(null);

  // Phase 24: reaction data for the whole trip + current user id.
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const { data: tripReactions = [] } = useTripReactions(tripId);
  const setReaction = useSetTripPlaceReaction();

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
            <View style={[styles.dayHeader, { borderColor: dayColor(section.dayIndex), backgroundColor: t.colors.gradientSubtle, borderRadius: t.radius.md, paddingHorizontal: t.spacing.md, paddingVertical: t.spacing.sm }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, flexWrap: 'wrap' }}>
                <Text style={[t.typography.subtitle, { color: t.colors.text }]}>
                  {section.dayIndex < 0 ? 'Unscheduled' : `Day ${section.dayIndex + 1}`}
                </Text>
                {section.dayIndex >= 0 ? (
                  <StayingAtPill
                    dayIndex={section.dayIndex}
                    tripStartDate={trip.start_date}
                    accommodations={accommodations}
                  />
                ) : null}
              </View>
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
                  render: (dragging) => {
                    const myReaction = currentUserId
                      ? (tripReactions.find(
                          (r) => r.trip_place_id === place.id && r.user_id === currentUserId,
                        )?.reaction ?? null)
                      : null;
                    return (
                      <PlaceRow
                        place={place}
                        dragging={dragging}
                        legAfter={leg}
                        hasNext={Boolean(next)}
                        transportMode={trip.transport_mode}
                        onOpenDetails={() => onOpen(place.google_place_id)}
                        reaction={myReaction}
                        onReactionChange={(next) =>
                          setReaction.mutate({
                            tripPlaceId: place.id,
                            reaction: next,
                            tripId,
                          })
                        }
                      />
                    );
                  },
                };
              })}
              onReorder={(newIds: string[]) => {
                if (section.dayIndex < 0) return; // unscheduled bucket is not orderable
                reorderDay.mutate({
                  tripId,
                  dayIndex: section.dayIndex,
                  orderedIds: newIds,
                });
              }}
              onLongPress={(id: string) => setActivePlaceId(id)}
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

/**
 * PlaceRow — itinerary row card.
 *
 * Phase 23 Step 23.8: displays Visit and Travel as two distinct labeled values.
 * Phase 23 Step 23.9: when transportMode is 'transit' the travel connector
 * renders a "Plan transit" deep-link that opens Google Maps directions in the
 * external browser.
 */
function PlaceRow({
  place,
  dragging,
  legAfter,
  hasNext,
  transportMode,
  onOpenDetails,
  reaction,
  onReactionChange,
}: {
  place: TripPlace;
  dragging: boolean;
  legAfter: TripLeg | undefined;
  hasNext: boolean;
  transportMode: TransportMode;
  onOpenDetails: () => void;
  reaction?: import('@/api/trip-place-reactions').TripPlaceReactionType | null;
  onReactionChange?: (next: import('@/api/trip-place-reactions').TripPlaceReactionType | null) => void;
}) {
  const t = useTheme();

  const visitLabel = formatDuration(place.visit_duration_minutes);

  // Step 23.9: transit deep-link URL.
  function buildTransitDeepLink(leg: TripLeg, fromPlace: TripPlace): string {
    // We have `leg.from_place_id` and `leg.to_place_id` but those map back
    // to place coordinates via `place` (from-place) and the next place
    // (to-place). We have the from-place here; the to-place lat/lng comes
    // from the leg's distance/duration metadata (not directly from the leg).
    // For the deep-link we use from=place.lat,place.lng and destination via
    // the leg. Since `legAfter.to_place_id` resolves to the next row's place,
    // and we don't have it here, we use a generic Maps search fallback and
    // let the caller handle it. The simplest correct approach: we build the
    // link from the fromPlace's coords only, which opens Maps routing from
    // the current place. The spec only requires `origin` from this place.
    void fromPlace; // intentionally unused — included for future coord lookup
    const origin = `${place.lat},${place.lng}`;
    // leg doesn't carry to-place coords directly; we pass the leg id as a
    // reference. For now, open Maps directions from origin without a fixed
    // destination — the transit planner shows nearby transit options.
    // (Full to-place coords require a cross-reference from the places list,
    // which ItineraryTab does in the legIndex but not passed to PlaceRow.)
    void leg;
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&travelmode=transit`;
  }

  function openTransitLink() {
    if (!legAfter) return;
    const url = buildTransitDeepLink(legAfter, place);
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
    } else {
      Linking.openURL(url).catch((e) =>
        console.warn('[PlaceRow] Failed to open transit URL', e),
      );
    }
  }

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
            borderRadius: t.radius.lg,
            backgroundColor: t.colors.cardBgSolid,
            padding: t.spacing.md,
            opacity: dragging ? 0.85 : 1,
            borderLeftWidth: 4,
            borderLeftColor: dayColor(place.day_index ?? -1),
            ...t.shadows.sm(t.colors.shadowColor),
          },
        ]}
      >
        {/* Title row with reaction chip on the right */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
              {place.user_title ?? 'Place'}
            </Text>
            <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
              {place.category ?? 'Unclassified'}
            </Text>
            {/* Step 23.8: Visit duration label */}
            <Text
              style={[t.typography.caption, { color: t.colors.textMuted }]}
              accessibilityLabel={`Visit duration ${place.visit_duration_minutes} minutes`}
            >
              {'⏱ Visit ~'}{visitLabel}
            </Text>
          </View>
          {/* Phase 24 Step 24.3: Reaction chip — right side of row */}
          {onReactionChange ? (
            <ReactionChip
              reaction={reaction ?? null}
              onChange={onReactionChange}
              accentColor={dayColor(place.day_index ?? -1)}
              size="sm"
            />
          ) : null}
        </View>
      </Pressable>

      {/* ── Per-place notes editor (Step 9.4) — Option A inline ── */}
      {!dragging ? (
        <PlaceNotesEditor place={place} />
      ) : null}

      {/* Step 23.8: Travel connector — two distinct labeled time values */}
      {hasNext ? (
        <View style={[styles.travelConnector, { paddingHorizontal: 12 }]}>
          {transportMode === 'transit' && legAfter ? (
            // Step 23.9: transit mode — show duration + deep-link
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs }}>
              <Text
                style={[t.typography.small, { color: t.colors.textMuted }]}
                accessibilityLabel={
                  `Travel to next, approximately ${legAfter ? Math.round(legAfter.duration_seconds / 60) : 0} minutes`
                }
              >
                {'↓ Travel ~'}{legAfter ? formatDurationSeconds(legAfter.duration_seconds) : '—'}
              </Text>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Plan transit on Google Maps, opens external"
                onPress={openTransitLink}
              >
                <Text style={[t.typography.small, { color: t.colors.primary }]}>
                  {'· Plan transit ↗'}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text
              style={[t.typography.small, { color: t.colors.textMuted }]}
              accessibilityLabel={
                legAfter
                  ? `Travel to next, approximately ${Math.round(legAfter.duration_seconds / 60)} minutes`
                  : 'Travel time unknown'
              }
            >
              {'↓ Travel '}{legAfter ? `~${formatDurationSeconds(legAfter.duration_seconds)}` : '—'}
              {legAfter ? ` · ${(legAfter.distance_meters / 1000).toFixed(legAfter.distance_meters < 10000 ? 1 : 0)} km` : ''}
            </Text>
          )}
        </View>
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
  tripStartDate,
  dailyHoursBudget,
  transportMode,
  currency,
  costPerKm,
  hasPlaces,
  tripDayCount,
  canEdit,
  isOwner,
  onDelete,
  deleting,
}: {
  tripId: string;
  tripStartDate: string | null;
  dailyHoursBudget: number;
  transportMode: TransportMode;
  currency: TripCurrency;
  costPerKm: number;
  hasPlaces: boolean;
  tripDayCount: number;
  canEdit: boolean;
  isOwner: boolean;
  onDelete: () => void;
  deleting: boolean;
}) {
  const t = useTheme();
  const router = useRouter();
  const [budget, setBudget] = useState(dailyHoursBudget);
  const [mode, setMode] = useState<TransportMode>(transportMode);

  // Phase 24 Step 24.5: liked/disliked catalog in SettingsTab.
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const { data: tripReactions = [] } = useTripReactions(tripId);
  const { data: tripPlaces = [] } = useTripPlaces(tripId);

  const likedPlaces = useMemo(() => {
    if (!currentUserId) return [];
    const myLikes = new Set(
      tripReactions
        .filter((r) => r.user_id === currentUserId && r.reaction === 'liked')
        .map((r) => r.trip_place_id),
    );
    return tripPlaces
      .filter((p) => myLikes.has(p.id))
      .sort((a, b) => (a.day_index ?? 999) - (b.day_index ?? 999) || (a.order_in_day ?? 0) - (b.order_in_day ?? 0));
  }, [tripReactions, tripPlaces, currentUserId]);

  const dislikedPlaces = useMemo(() => {
    if (!currentUserId) return [];
    const myDislikes = new Set(
      tripReactions
        .filter((r) => r.user_id === currentUserId && r.reaction === 'disliked')
        .map((r) => r.trip_place_id),
    );
    return tripPlaces
      .filter((p) => myDislikes.has(p.id))
      .sort((a, b) => (a.day_index ?? 999) - (b.day_index ?? 999) || (a.order_in_day ?? 0) - (b.order_in_day ?? 0));
  }, [tripReactions, tripPlaces, currentUserId]);

  // ── Budget state (Phase 21 Step 21.10) ──────────────────────────────────────
  const rollup = useTripExpenseRollup(tripId);
  // useTripExpenses is already subscribed by useTripExpenseRollup; this picks
  // up from the same cache key — zero extra network requests.
  const { data: expenses = [] } = useTripExpenses(tripId);
  const [budgetSheetOpen, setBudgetSheetOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<TripExpense | null>(null);
  const [expenseSheetOpen, setExpenseSheetOpen] = useState(false);
  const deleteExpense = useDeleteTripExpense();

  // ── Accommodation state (Phase 21 Step 21.13) ───────────────────────────────
  const { data: accommodations = [] } = useTripAccommodations(tripId);
  const deleteAccommodation = useDeleteTripAccommodation();
  const [editingAccommodation, setEditingAccommodation] = useState<TripAccommodation | null>(null);
  const [accommodationSheetOpen, setAccommodationSheetOpen] = useState(false);

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
      {/* Step 5: "Daily plan time" is time-first language — it's hours of
          activities per day, not a financial budget. */}
      <Slider
        label="Daily plan time"
        unit="h"
        min={2}
        max={14}
        step={1}
        value={budget}
        onChange={commitBudget}
      />
      {/* Phase 23: bicycling added between walking and transit. */}
      <SegmentedControl<TransportMode>
        label="Transport mode"
        value={mode}
        onChange={commitMode}
        options={[
          { value: 'driving', label: 'Drive' },
          { value: 'walking', label: 'Walk' },
          { value: 'bicycling', label: 'Bike' },
          { value: 'transit', label: 'Transit' },
        ]}
      />

      {/* ── Travel cost settings (Step 8.6 + Step 5 label cleanup) ──────── */}
      {/* Step 5: renamed from "Cost settings" to "Estimated travel cost" so it
          reads as a derived, narrow metric (fuel / transport) rather than the
          full trip money budget. Step 6 (backend) will replace this model with
          category-based budgets. */}
      <SectionHeading label="Estimated travel cost" t={t} />
      <SegmentedControl<TripCurrency>
        label="Currency"
        value={currency}
        onChange={handleCurrencyChange}
        options={CURRENCIES.map((c) => ({ value: c, label: c }))}
      />
      <View style={{ gap: t.spacing.xs }}>
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
          Travel cost per km ({currency})
        </Text>
        <TextInput
          value={rateText}
          onChangeText={handleRateChange}
          keyboardType="decimal-pad"
          // inputMode is a web-standard hint; RN ≥ 0.72 honours it on web.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          inputMode={"decimal" as any}
          accessibilityLabel="Travel cost per kilometre"
          accessibilityHint="Enter the fuel or transport cost per kilometre for estimated travel cost"
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

      {/* ── Budget (Phase 21 Step 21.10) ────────────────────────────────── */}
      <SectionHeading label="Budget" t={t} />
      <BudgetCard
        rollup={rollup}
        currency={currency}
        onSetBudget={() => setBudgetSheetOpen(true)}
        canEdit={canEdit}
      />
      <CategoryBreakdown rollup={rollup} currency={currency} />
      <ExpenseList
        expenses={expenses}
        tripId={tripId}
        currency={currency}
        canEdit={canEdit}
        onAdd={() => {
          setEditingExpense(null);
          setExpenseSheetOpen(true);
        }}
        onEdit={(expense) => {
          setEditingExpense(expense);
          setExpenseSheetOpen(true);
        }}
        onDelete={(expense) => {
          deleteExpense.mutate({ id: expense.id, trip_id: tripId });
        }}
      />

      {/* ── Accommodation (Phase 21 Step 21.13) ─────────────────────────── */}
      <SectionHeading label="Accommodation" t={t} />
      <AccommodationList
        accommodations={accommodations}
        tripStartDate={tripStartDate}
        canEdit={canEdit}
        onAdd={() => {
          setEditingAccommodation(null);
          setAccommodationSheetOpen(true);
        }}
        onEdit={(acc) => {
          setEditingAccommodation(acc);
          setAccommodationSheetOpen(true);
        }}
        onDelete={(acc) => {
          deleteAccommodation.mutate({ id: acc.id, trip_id: tripId });
        }}
      />

      {/* ── Phase 24 Step 24.5: Liked / disliked catalog ────────────────── */}
      {likedPlaces.length > 0 ? (
        <>
          <SectionHeading label="You liked" t={t} />
          {likedPlaces.map((place) => (
            <Pressable
              key={place.id}
              accessibilityRole="button"
              accessibilityLabel={`View details for ${place.user_title ?? 'place'}`}
              onPress={() => router.push(`/place/${place.google_place_id}` as never)}
              style={({ pressed }) => [
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: pressed ? t.colors.gradientSubtle : t.colors.bgElevated,
                  borderColor: t.colors.border,
                  borderRadius: t.radius.md,
                  borderWidth: 1,
                  padding: t.spacing.md,
                  gap: t.spacing.sm,
                },
              ]}
            >
              <Text style={[t.typography.body, { color: t.colors.text, flex: 1 }]} numberOfLines={1}>
                {place.user_title ?? 'Unknown place'}
              </Text>
              {place.day_index !== null ? (
                <View
                  style={{
                    backgroundColor: dayColor(place.day_index),
                    borderRadius: t.radius.pill,
                    paddingHorizontal: t.spacing.sm,
                    paddingVertical: 2,
                  }}
                >
                  <Text style={[t.typography.small, { color: '#fff' }]}>
                    {`Day ${place.day_index + 1}`}
                  </Text>
                </View>
              ) : null}
              <Text style={{ fontSize: 14, color: t.colors.textMuted }}>›</Text>
            </Pressable>
          ))}
        </>
      ) : null}

      {dislikedPlaces.length > 0 ? (
        <>
          <SectionHeading label="You didn't like" t={t} />
          {dislikedPlaces.map((place) => (
            <Pressable
              key={place.id}
              accessibilityRole="button"
              accessibilityLabel={`View details for ${place.user_title ?? 'place'}`}
              onPress={() => router.push(`/place/${place.google_place_id}` as never)}
              style={({ pressed }) => [
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: pressed ? t.colors.gradientSubtle : t.colors.bgElevated,
                  borderColor: t.colors.border,
                  borderRadius: t.radius.md,
                  borderWidth: 1,
                  padding: t.spacing.md,
                  gap: t.spacing.sm,
                },
              ]}
            >
              <Text style={[t.typography.body, { color: t.colors.text, flex: 1 }]} numberOfLines={1}>
                {place.user_title ?? 'Unknown place'}
              </Text>
              {place.day_index !== null ? (
                <View
                  style={{
                    backgroundColor: dayColor(place.day_index),
                    borderRadius: t.radius.pill,
                    paddingHorizontal: t.spacing.sm,
                    paddingVertical: 2,
                  }}
                >
                  <Text style={[t.typography.small, { color: '#fff' }]}>
                    {`Day ${place.day_index + 1}`}
                  </Text>
                </View>
              ) : null}
              <Text style={{ fontSize: 14, color: t.colors.textMuted }}>›</Text>
            </Pressable>
          ))}
        </>
      ) : null}

      {/* ── Collaborators link ───────────────────────────────────────────── */}
      <SectionHeading label="Collaboration" t={t} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Manage collaborators"
        onPress={() => router.push(`/trip/${tripId}/collaborators` as never)}
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: pressed ? t.colors.gradientSubtle : t.colors.bgElevated,
            borderColor: t.colors.border,
            borderRadius: t.radius.md,
            borderWidth: 1,
            padding: t.spacing.md,
          },
        ]}
      >
        <View style={{ gap: 2 }}>
          <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
            Manage collaborators
          </Text>
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
            {isOwner ? 'Invite others to view or edit this trip' : 'View who has access to this trip'}
          </Text>
        </View>
        <Text style={{ fontSize: 18, color: t.colors.textMuted }}>›</Text>
      </Pressable>

      {/* ── Share ───────────────────────────────────────────────────────── */}
      <SectionHeading label="Share" t={t} />
      <ShareLinkCard tripId={tripId} />

      {/* Budget + Accommodation edit sheets */}
      <BudgetEditSheet
        tripId={tripId}
        currentBudget={rollup.budget}
        currency={currency}
        visible={budgetSheetOpen}
        onClose={() => setBudgetSheetOpen(false)}
      />
      <ExpenseEditSheet
        tripId={tripId}
        expense={editingExpense}
        currency={currency}
        visible={expenseSheetOpen}
        onClose={() => setExpenseSheetOpen(false)}
        tripDayCount={tripDayCount}
      />
      <AccommodationEditSheet
        tripId={tripId}
        accommodation={editingAccommodation}
        visible={accommodationSheetOpen}
        onClose={() => setAccommodationSheetOpen(false)}
      />

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

function groupByDay(places: TripPlace[]): Array<{ dayIndex: number; places: TripPlace[] }> {
  const map = new Map<number, TripPlace[]>();
  for (const p of places) {
    const key = p.day_index ?? -1;
    const arr = map.get(key) ?? [];
    arr.push(p);
    map.set(key, arr);
  }
  for (const [, arr] of map) {
    arr.sort((a: TripPlace, b: TripPlace) => (a.order_in_day ?? 0) - (b.order_in_day ?? 0));
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
  // "From my location" toggle button (Step 24.9)
  myLocationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    gap: 6,
    alignSelf: 'flex-start',
  },
  // Route render mode segmented control (Step 23.4)
  renderModeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  renderModeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    gap: 6,
    flex: 1,
    justifyContent: 'center',
  },
  // Travel connector between place cards (Step 23.8)
  travelConnector: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});

// ── Desktop side-by-side panel styles ────────────────────────────────────────
// These are static (no theme dependency) so they live outside the component.
const desktopDetailStyles = StyleSheet.create({
  // Row container that fills the remaining screen height after header + TabBar.
  splitRow: {
    flex: 1,
    flexDirection: 'row',
  },
  // Left: map fills ~60% of the split, stays sticky (no internal scroll).
  // `overflow: 'hidden'` is important on web: Map.web.tsx renders a Google
  // Maps div that uses absolute positioning internally; clipping it here
  // prevents it from overflowing the column boundary.
  mapColumn: {
    flex: 3, // 60% share (3 of 3+2 = 5 parts)
    overflow: 'hidden',
  },
  // Right: itinerary fills ~40%, scrolls inside ItineraryTab's own ScrollView.
  // borderLeftWidth: 1 provides a visible column separator; color is applied
  // inline where the theme is available.
  itineraryColumn: {
    flex: 2, // 40% share
    borderLeftWidth: 1,
  },
});
