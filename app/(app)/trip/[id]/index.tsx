/**
 * Trip detail route — /trip/[id]
 *
 * v2 Phase N1 step 1.1: this file is the route OWNER only. It fetches the
 * trip-scoped server state (useTrip / useTripPlaces / useTripLegs /
 * useTripAccommodations / useTripRole), owns the tab state + the debounced
 * auto-optimize loop, and lays out the desktop split view vs the phone tab
 * view. All tab content lives in src/components/trip-detail/.
 *
 * v2 M4 X2.2 (phone rebuild):
 *   TripHeader        — compact on phones: back · title/dates · ⋯ menu, plus
 *                       a one-line route chip row. Full card on desktop.
 *   Plan · Map · Trip — phone tabs; the tab lives in `?tab=` so back nav and
 *                       deep links keep it (legacy `itinerary`/`settings`
 *                       values still resolve). Default: Plan when the trip
 *                       has places, else Map.
 *   TripHubTab        — the "Trip" tab: budget / stays / packing / docs /
 *                       people / share summary cards (+ reactions catalog).
 *   TripSettingsSheet — cover, hours, transport, currency, .ics, delete;
 *                       opened from the ⋯ menu.
 *   QuickAddFab/Sheet — replaces the full-width "Add a place" bar (editors).
 * Desktop keeps the map + itinerary split; the hub replaces the old
 * Settings panel behind the "Trip" tab.
 *
 * v1 parity (docs/v2/features.md §L): print + share + duplicate (⋯ menu),
 * .ics + delete (settings sheet), notes + reactions (itinerary / place
 * detail with trip context), account export (Profile tab).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeBack } from '@/hooks/useSafeBack';
import { BottomSheet, Button, Heading, Screen, TabBar } from '@/components';
import { ShareLinkCard } from '@/components/ShareLinkCard';
import { useTheme } from '@/theme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { haptics } from '@/lib/haptics';
import {
  orderPlacesForDisplay,
  useDeleteTrip,
  useDuplicateTrip,
  useOptimizeTrip,
  useTrip,
  useTripLegs,
  useTripPlaces,
  type TripPlace,
} from '@/api';
import { isTier1SyncActive } from '@/sync/mutations';
import { useTripAccommodations } from '@/api/trip-accommodations';
import { useTripRole } from '@/hooks/useTripRole';
import { TripHeader, TripMenuSheet } from '@/components/trip-detail/TripHeader';
import { MapTab } from '@/components/trip-detail/MapTab';
import { ItineraryTab } from '@/components/trip-detail/ItineraryTab';
import { TripHubTab } from '@/components/trip-detail/TripHubTab';
import {
  TripSettingsSheet,
  deleteTripErrorKey,
  type DeleteTripErrorKey,
} from '@/components/trip-detail/TripSettingsSheet';
import { QuickAddFab, QuickAddSheet } from '@/components/trip-detail/QuickAddSheet';
import { resolveTripTab, type TripTabKey } from '@/components/trip-detail/tripTabs';
import { ActionErrorBanner } from '@/components/trip-detail/ActionErrorBanner';
import { PlanSkeleton, TripDetailSkeleton } from '@/components/trip-detail/TripDetailSkeleton';
import { useT } from '@/i18n';

// FAB (56) + its bottom offset — the hub and the Plan list pad by this so the last row clears it.
const FAB_CLEARANCE = 88;
const MAP_ATTRIBUTION_CLEARANCE = 32;

export default function TripDetail() {
  const { id, tab: tabParam } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router = useRouter();
  const goBack = useSafeBack('/trips');
  const t = useTheme();
  const { t: tx } = useT('share');
  const bp = useBreakpoint();
  const isDesktop = bp === 'desktop';

  const { data: trip, isLoading, error, refetch } = useTrip(id);
  const { data: places = [], isLoading: placesLoading } = useTripPlaces(id);
  const { data: legs = [] } = useTripLegs(id);
  const optimize = useOptimizeTrip();
  const optimizeMutate = optimize.mutate;
  const deleteTrip = useDeleteTrip();
  const duplicateTrip = useDuplicateTrip();

  // Tab state lives in the URL (?tab=) so back navigation and deep links
  // keep it. Without a param: Plan when the trip has places, else Map.
  // While places load, assume Plan (its skeleton shows) so the tab does not
  // flash Map → Plan once they arrive.
  const tab: TripTabKey = resolveTripTab(tabParam, placesLoading ? 1 : places.length);
  const selectTab = (key: TripTabKey) => {
    if (key === tab) return;
    haptics.select();
    router.setParams({ tab: key });
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  // Visible failures for Duplicate (menu already closed) and Delete (shown in the settings sheet).
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<DeleteTripErrorKey | null>(null);

  // Phase 21 Step 21.10/21.11: Role-gating for budget + accommodation + collaborators.
  const { canEditTrip, role: tripRole } = useTripRole(id);
  const isOwner = tripRole === 'owner';

  // Accommodations at TripDetail level so ItineraryTab's StayingAtPill can consume them.
  // TripHubTab also calls useTripAccommodations internally; TanStack Query dedupes
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
    // Audit #6: optimize is editor-only (viewers get 403 `not_editor`). Also
    // waits out role loading — the ref stays unset, so it runs once it flips.
    if (!canEditTrip) return;
    if (!id || places.length < 2 || !trip) return;
    if (lastOptimizedRef.current === stateKey) return;
    const renderMode = trip.route_render_mode ?? 'optimized';
    const timer = setTimeout(() => {
      lastOptimizedRef.current = stateKey;
      optimizeMutate({ tripId: id, mode: renderMode });
    }, 500);
    return () => clearTimeout(timer);
  }, [canEditTrip, id, stateKey, places.length, trip, optimizeMutate]);

  if (isLoading) {
    return (
      <Screen padded={false}>
        <TripDetailSkeleton />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <Heading level={2}>{"Couldn't load this trip"}</Heading>
        <Text
          accessibilityLiveRegion="polite"
          style={[t.typography.body, { color: t.colors.textMuted, marginBottom: t.spacing.md }]}
        >
          {error.message || 'Something went wrong. Check your connection and try again.'}
        </Text>
        <View style={{ gap: t.spacing.sm }}>
          <Button label="Retry" onPress={() => refetch()} accessibilityLabel="Retry loading this trip" />
          <Button variant="secondary" label="Back to trips" onPress={() => router.replace('/trips')} />
        </View>
      </Screen>
    );
  }

  if (!trip) {
    return (
      <Screen>
        <Heading level={2}>Trip not found</Heading>
        <Button label="Back to trips" onPress={() => router.replace('/trips')} />
      </Screen>
    );
  }

  // ── Navigation helpers ───────────────────────────────────────────────────
  // Place detail WITH trip context (tripId + tripPlaceId) so reactions work.
  const openPlace = (googlePlaceId: string, tripPlaceId?: string) =>
    router.push({
      pathname: '/place/[placeId]',
      params: tripPlaceId
        ? { placeId: googlePlaceId, tripId: trip.id, tripPlaceId }
        : { placeId: googlePlaceId },
    });
  const openHubPlace = (p: TripPlace) => openPlace(p.google_place_id, p.id);
  const goToAdd = () => router.push(`/trip/${trip.id}/add`);

  const handleDelete = async () => {
    setDeleteError(null);
    try {
      await deleteTrip.mutateAsync(trip.id);
    } catch (err) {
      haptics.error();
      setDeleteError(deleteTripErrorKey(err));
      return;
    }
    setSettingsOpen(false);
    router.replace('/trips');
  };
  const handleDuplicate = async () => {
    setDuplicateError(null);
    try {
      const newTripId = await duplicateTrip.mutateAsync(trip.id);
      haptics.success();
      router.push(`/trip/${newTripId}`);
    } catch {
      haptics.error();
      // The menu has already closed, so surface the failure on the screen.
      setDuplicateError("Couldn't duplicate this trip. Check your connection and try again.");
    }
  };

  // ── Shared pieces ────────────────────────────────────────────────────────
  const pageHeader = (
    <TripHeader
      trip={trip}
      legs={legs}
      placesCount={places.length}
      canEdit={canEditTrip}
      optimizePending={optimize.isPending}
      optimizeError={optimize.error}
      onBack={goBack}
      onPrint={() => router.push(`/trip/${trip.id}/print`)}
      onOpenMenu={() => setMenuOpen(true)}
      compact={!isDesktop}
    />
  );
  const actionError = (
    <ActionErrorBanner message={duplicateError} onDismiss={() => setDuplicateError(null)} />
  );

  const mapTab = (
    <MapTab
      tripId={trip.id}
      places={places}
      legs={legs}
      trip={trip}
      canEdit={canEditTrip}
      onMarker={(gid, rowId) => openPlace(gid, rowId)}
    />
  );

  const itineraryTab = placesLoading ? (
    <PlanSkeleton />
  ) : (
    <ItineraryTab
      tripId={trip.id}
      places={places}
      legs={legs}
      trip={trip}
      accommodations={tripAccommodations}
      canEdit={canEditTrip}
      bottomInset={canEditTrip ? FAB_CLEARANCE : 0}
    />
  );

  const hubTab = (
    <TripHubTab
      tripId={trip.id}
      tripTitle={trip.title}
      tripStartDate={trip.start_date}
      currency={trip.currency}
      tripDayCount={tripDayCount}
      canEdit={canEditTrip}
      isOwner={isOwner}
      onOpenPlace={openHubPlace}
      initialExpanded={isDesktop ? ['budget', 'stays'] : []}
      bottomInset={canEditTrip ? FAB_CLEARANCE : 0}
    />
  );

  const overlays = (
    <>
      {canEditTrip ? (
        <>
          {/* On the phone Map tab the FAB sits higher so the map's bottom-right
              attribution control stays visible and tappable. */}
          <QuickAddFab
            onPress={() => setQuickAddOpen(true)}
            bottom={!isDesktop && tab === 'map' ? t.spacing.lg + MAP_ATTRIBUTION_CLEARANCE : t.spacing.lg}
          />
          <QuickAddSheet
            visible={quickAddOpen}
            onClose={() => setQuickAddOpen(false)}
            tripId={trip.id}
            places={places}
            routeRenderMode={trip.route_render_mode}
            currency={trip.currency}
            tripDayCount={tripDayCount}
            tripStartDate={trip.start_date}
            onSearch={goToAdd}
          />
        </>
      ) : null}
      <TripMenuSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onOpenSettings={() => setSettingsOpen(true)}
        onPrint={() => router.push(`/trip/${trip.id}/print`)}
        onShare={() => setShareOpen(true)}
        onOpenPeople={() => router.push(`/trip/${trip.id}/collaborators`)}
        onDuplicate={isOwner ? handleDuplicate : undefined}
        duplicating={duplicateTrip.isPending}
      />
      <TripSettingsSheet
        visible={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          setDeleteError(null);
        }}
        tripId={trip.id}
        startDate={trip.start_date}
        endDate={trip.end_date}
        dailyHoursBudget={trip.daily_hours_budget}
        transportMode={trip.transport_mode}
        currency={trip.currency}
        hasPlaces={places.length > 0}
        canEdit={canEditTrip}
        isOwner={isOwner}
        coverPhotoPlaceId={trip.cover_photo_google_place_id}
        onDelete={handleDelete}
        deleting={deleteTrip.isPending}
        deleteError={deleteError}
      />
      <BottomSheet visible={shareOpen} onClose={() => setShareOpen(false)} accessibilityLabel="Share trip">
        <Heading level={3}>Share this trip</Heading>
        {/* Audit #5: public links are owner-only (editors get 403 `not_owner`). */}
        {isOwner ? (
          <ShareLinkCard tripId={trip.id} tripTitle={trip.title} />
        ) : (
          <Text style={[t.typography.body, { color: t.colors.textMuted }]}>{tx('link.ownerOnly')}</Text>
        )}
        <Button variant="ghost" label="Close" onPress={() => setShareOpen(false)} />
      </BottomSheet>
    </>
  );

  // ── Desktop: map + itinerary side-by-side, the hub behind the Trip tab ───
  // The two content columns share the remaining screen height after the header.
  // Map (~60%) is sticky (doesn't scroll), itinerary (~40%) scrolls on its own.
  if (isDesktop) {
    const showHub = tab === 'trip';
    return (
      <Screen padded={false}>
        {pageHeader}
        {actionError}

        <TabBar<TripTabKey>
          activeKey={showHub ? 'trip' : 'plan'}
          onSelect={selectTab}
          tabs={[
            { key: 'plan', label: 'Map & Itinerary' },
            { key: 'trip', label: 'Trip' },
          ]}
        />

        {showHub ? (
          <View style={desktopDetailStyles.hubWrap}>{hubTab}</View>
        ) : (
          /*
           * Side-by-side panel: map (left, ~60%, sticky) + itinerary (right, ~40%, scrolling).
           * flex: 1 on the outer row ensures it fills the remaining Screen height.
           * The map column has `overflow: 'hidden'` so the Map component's fixed-
           * positioned elements don't escape its bounds on web.
           */
          <View style={desktopDetailStyles.splitRow}>
            <View style={desktopDetailStyles.mapColumn}>{mapTab}</View>
            <View style={[desktopDetailStyles.itineraryColumn, { borderLeftColor: t.colors.border }]}>
              {itineraryTab}
            </View>
          </View>
        )}
        {overlays}
      </Screen>
    );
  }

  // ── Phone / tablet: Plan · Map · Trip ────────────────────────────────────
  return (
    <Screen padded={false}>
      {pageHeader}
      {actionError}

      <TabBar<TripTabKey>
        activeKey={tab}
        onSelect={selectTab}
        tabs={[
          { key: 'plan', label: 'Plan' },
          { key: 'map', label: 'Map' },
          { key: 'trip', label: 'Trip' },
        ]}
      />

      <View style={{ flex: 1 }}>
        {tab === 'map' ? mapTab : tab === 'plan' ? itineraryTab : hubTab}
      </View>
      {overlays}
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
  // X2.2: the hub on desktop — a readable column, not a stretched phone.
  hubWrap: {
    flex: 1,
    width: '100%',
    maxWidth: 880,
    alignSelf: 'center',
  },
});
