/**
 * Trip detail route — /trip/[id]
 *
 * v2 Phase N1 step 1.1: this file is the route OWNER only. It fetches the
 * trip-scoped server state (useTrip / useTripPlaces / useTripLegs /
 * useTripAccommodations / useTripRole), owns the tab state + the debounced
 * auto-optimize loop, and lays out the desktop split view vs the mobile tab
 * view. All tab content lives in src/components/trip-detail/:
 *
 *   TripHeader   — back + title + print + meta + optimize pill + route summary
 *   MapTab       — render-mode toggle + day chips + my-location + TripMap
 *   ItineraryTab — day sections, drag wiring, summaries, notes, reactions
 *   SettingsTab  — cover, meta form, budget, stays, collab, share, export, delete
 *
 * Behavior is identical to the pre-split 2442-line version (v1 parity
 * checklist, docs/v2/features.md §L).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Heading, Screen, TabBar } from '@/components';
import { useTheme } from '@/theme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import {
  orderPlacesForDisplay,
  useDeleteTrip,
  useOptimizeTrip,
  useTrip,
  useTripLegs,
  useTripPlaces,
  type TripPlace,
} from '@/api';
import { isTier1SyncActive } from '@/sync/mutations';
import { useTripAccommodations } from '@/api/trip-accommodations';
import { useTripRole } from '@/hooks/useTripRole';
import { TripHeader } from '@/components/trip-detail/TripHeader';
import { MapTab } from '@/components/trip-detail/MapTab';
import { ItineraryTab } from '@/components/trip-detail/ItineraryTab';
import { SettingsTab } from '@/components/trip-detail/SettingsTab';

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
  //
  // Bug fix (2026-06-11, user report): in "My order" mode the map's polylines
  // (trip_legs) must follow the user's arrangement, so two things change:
  //  1. `layout` joins the key ONLY in manual mode — a drag/move-to-day now
  //     re-triggers the recompute (entries encode day+position, so the
  //     sorted set still changes whenever the arrangement does). In
  //     optimized mode the key stays order-insensitive: the optimizer owns
  //     the layout there, and re-keying on it would loop after every run.
  //  2. `mode` is passed through to the Edge Function — previously omitted,
  //     which defaulted every auto-run to the 'optimized' branch and could
  //     silently re-cluster a manually arranged trip after a duration edit.
  //
  // v2 S2.8.7: flag-on, drags persist as manual_rank ONLY (the legacy
  // reorderDay RPC is retired), so order_in_day stops changing on drag —
  // keying manual-mode layout on it would never recompute legs after a
  // drag. Flag-on + manual, `layout` instead derives from the rank-ordered
  // per-day place-id SEQUENCE (manualRankLayout below). Loop safety (the
  // High risk this step flags): the manual-mode optimize writes derived
  // order_in_day back, but that write cannot re-change the key because the
  // key never reads order_in_day VALUES — only the sequence, which the Edge
  // function derives from the SAME canonical rule (src/sync/order.ts
  // binding header). So the key changes exactly once per user-visible
  // reorder and is stable across recomputes. Flag-off, the expression is
  // byte-identical to the v1 key above.
  const tier1Active = isTier1SyncActive();
  const stateKey = useMemo(
    () =>
      JSON.stringify({
        places: places
          .map((p) => `${p.id}:${p.visit_duration_minutes}`)
          .sort(),
        budget: trip?.daily_hours_budget,
        mode: trip?.transport_mode,
        layout:
          trip?.route_render_mode === 'manual'
            ? tier1Active
              ? manualRankLayout(places)
              : places
                  .map((p) => `${p.id}:${p.day_index ?? 'x'}:${p.order_in_day ?? 'x'}`)
                  .sort()
            : null,
      }),
    [places, trip?.daily_hours_budget, trip?.transport_mode, trip?.route_render_mode, tier1Active],
  );
  const lastOptimizedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!id || places.length < 2 || !trip) return;
    if (lastOptimizedRef.current === stateKey) return;
    const renderMode = trip.route_render_mode ?? 'optimized';
    const timer = setTimeout(() => {
      lastOptimizedRef.current = stateKey;
      optimizeMutate({ tripId: id, mode: renderMode });
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
    <TripHeader
      trip={trip}
      legs={legs}
      placesCount={places.length}
      optimizePending={optimize.isPending}
      optimizeError={optimize.error}
      onBack={() => router.back()}
      onPrint={() => router.push(`/trip/${trip.id}/print` as never)}
    />
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
              hasPlaces={places.length > 0}
              tripDayCount={tripDayCount}
              canEdit={canEditTrip}
              isOwner={isOwner}
              coverPhotoPlaceId={trip.cover_photo_google_place_id}
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
                canEdit={canEditTrip}
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
          canEdit={canEditTrip}
          onOpen={(gid) => router.push(`/place/${gid}`)}
        />
      ) : (
        <SettingsTab
          tripId={trip.id}
          tripStartDate={trip.start_date}
          dailyHoursBudget={trip.daily_hours_budget}
          transportMode={trip.transport_mode}
          currency={trip.currency}
          hasPlaces={places.length > 0}
          tripDayCount={tripDayCount}
          canEdit={canEditTrip}
          isOwner={isOwner}
          coverPhotoPlaceId={trip.cover_photo_google_place_id}
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

/**
 * v2 S2.8.7: the flag-on manual-mode layout key — per scheduled day, the
 * rank-ordered place-id chain (via orderPlacesForDisplay, the same canonical
 * rule ItineraryTab renders with and optimize-trip's manual branch persists
 * from). Ideas (day_index NULL) are excluded: the optimizer skips them, so
 * their internal order can never affect legs (entering/leaving Ideas still
 * changes a day's chain, which is what matters). Derived from the id
 * SEQUENCE only — never from order_in_day values — so the optimizer writing
 * derived order_in_day back cannot re-change the key (auto-optimize loop
 * guard). Output is deterministic: days ascending, ids joined in display
 * order.
 */
function manualRankLayout(places: TripPlace[]): string[] {
  const ordered = orderPlacesForDisplay(places, 'manual', true);
  const chains = new Map<number, string[]>();
  for (const p of ordered) {
    if (p.day_index === null) continue;
    const chain = chains.get(p.day_index);
    if (chain) chain.push(p.id);
    else chains.set(p.day_index, [p.id]);
  }
  return [...chains.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, ids]) => `${day}:${ids.join('>')}`);
}

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
