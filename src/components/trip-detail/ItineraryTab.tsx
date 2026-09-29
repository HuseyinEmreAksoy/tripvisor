/**
 * ItineraryTab — the itinerary tab content for the trip detail route
 * (extracted from app/(app)/trip/[id]/index.tsx in v2 Phase N1 step 1.1 —
 * pure refactor).
 *
 * Renders day sections (header + StayingAtPill + DaySummaryCard +
 * DayNotesEditor) with a DraggableItinerary of PlaceRow cards per day, and
 * the PlaceActionsSheet opened by long-press (native + touch web) or the
 * per-row "Place actions" kebab (web — v2 S2.8.13 F4).
 *
 * Data flow: `places`, `legs`, `trip`, `accommodations` come from the route
 * shell. The hooks that v1 already had inside this block are kept here:
 * useReorderDay (drag commit), useTripDays (per-day notes), useTripReactions +
 * useSetTripPlaceReaction + useSession (reaction chips), useRouter (empty-state
 * navigation to /trip/[id]/add).
 *
 * v2 N1 additions:
 *  - 1.2 timeline: editable per-day start time (DayStartTimeControl in the day
 *    header) + computed arrival/departure chips per stop. Pure math lives in
 *    computeDayTimeline.ts; this tab owns the per-day session overrides so the
 *    control and the math always agree.
 *  - 1.4 Ideas: the `dayIndex < 0` bucket is the named "Ideas" wishlist with a
 *    one-tap "Add to Day N" chip row per idea (reuses useMoveToDay).
 *  - 1.7 comments: one useTripComments(tripId) batch read powers the per-place
 *    💬 badges (no per-place query fan-out); tapping opens PlaceCommentsSheet.
 *
 * v2 N4 additions (editors only — every surface below is canEdit-gated):
 *  - 4.1 AI edit: a compact "✨ AI edit" chip in the tab's header row opens
 *    AiEditSheet (instruction → previewable diff → apply with undo).
 *  - 4.2 gap-fill: when a day's computed timeline leaves ≥60 min of slack vs
 *    trip.daily_hours_budget, a subtle "~Nh free — fill this day" footer chip
 *    opens GapFillSheet (Ideas first, then AI suggestions).
 *  - 4.3 import: an "Import" chip (header row + the Ideas section header)
 *    opens ImportPlacesSheet (pasted list / Takeout CSV → Ideas bucket).
 *
 * v2 P2.1 weather: ONE useDayWeather call for the whole trip (centroid of all
 * places; range clamped to the ~16-day horizon — tripWeather.ts), mapped to
 * day headers BY DATE (never index — the forecast may have gaps). Rainy days
 * (isRainy) make the chip tappable → GapFillSheet, Ideas-first indoor fix.
 * Out-of-horizon trips and fetch errors hide all weather UI quietly. When any
 * chip renders, the CC-BY line "Weather data by Open-Meteo.com" closes the
 * list.
 *
 * v2 S2.8.7 (flag-flip): the Wave 3b dual-path drag is retired. Flag-on,
 * drags persist as manual_rank ONLY (no reorderDay RPC — order_in_day is
 * re-derived by the next manual-mode optimize, S2.8.2), display order comes
 * from orderPlacesForDisplay (the Edge-mirrored canonical rule), a drag in
 * "Best route" mode auto-switches the trip to "My order" with ONE composite
 * undo entry (D4), and move-to-day affordances disable while offline with
 * honest copy (D5 — the server mutation cannot run without a network).
 * Flag-off, every path below is byte-identical to v1.
 *
 * v2 M4 X2.3 (phone usability):
 *  - Day-jump chip strip (itinerary/DayJumpStrip) rendered OUTSIDE the
 *    scroll view — never a sticky list header — so it stays pinned without
 *    fighting the native DraggableFlatList. Each section reports its y via
 *    onLayout; a chip tap scrolls there (scrollTo on the measured offset —
 *    the list is a ScrollView of per-day draggable lists, so this is the
 *    scrollToIndex equivalent). While the trip is live, the list opens on
 *    today's day once and today's chip is highlighted.
 *  - Collapsible days (itinerary/useCollapsedDays): past days start
 *    collapsed while the trip is live; explicit choices are remembered per
 *    device. Jumping to a collapsed day expands it.
 *  - The AI tool chips (AI edit, Import, gap-fill) fold into one "✨ Assist"
 *    menu at the end of the strip. The per-day "~Nh free" footer chip stays
 *    (contextual to that day).
 *  - Pull-to-refresh re-reads places (Tier-1 facade refetch → resync) and
 *    legs; skeleton rows while the first places read is in flight.
 *  - Place rows open details WITH trip context (`/place/[gid]?tripId=…&
 *    tripPlaceId=…`) so the detail screen's reactions are reachable, and
 *    get the next stop's coordinates for the transit directions link.
 *  - The drag / manual_rank commit path below is unchanged; haptics fire in
 *    DraggableItinerary on pickup and drop.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  DraggableItinerary,
  EmptyState,
  PlaceActionsSheet,
  DaySummaryCard,
  themedRefresh,
  type DraggableItem,
} from '@/components';
import { noPlaces } from '@/components/emptyStates';
import { useTheme } from '@/theme';
import {
  countCommentsByPlace,
  isRainy,
  orderPlacesForDisplay,
  useDayWeather,
  useMoveToDay,
  useReorderDay,
  useTripComments,
  useTripDays,
  useTripLegs,
  useTripPlaces,
  useUpdateRouteRenderMode,
  type Trip,
  type TripDay,
  type TripLeg,
  type TripPlace,
} from '@/api';
// v2 S2.6 (flag-gated): offline-drag rank path. Metro resolves the platform
// implementation of '@/api/offline' (native NetInfo / web navigator.onLine).
import { useIsOnline } from '@/api/offline';
import { isTier1SyncActive, restoreRanks, snapshotRanks } from '@/sync/mutations';
import { useUndo } from '@/sync/undo';
import { commitDragRanks } from './dragRank';
import { useTripReactions, useSetTripPlaceReaction } from '@/api/trip-place-reactions';
import { useSession } from '@/api/auth';
import type { TripAccommodation } from '@/api/types';
import { StayingAtPill } from '@/components/accommodation/StayingAtPill';
import { AiEditSheet, GapFillSheet, ImportPlacesSheet } from '@/components/ai-edit';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { formatDuration } from '@/lib/formatDuration';
import { DayNotesEditor } from './NotesEditors';
import { PlaceRow } from './PlaceRow';
import { DayStartTimeControl } from './DayStartTimeControl';
import { PlaceCommentsSheet } from './PlaceCommentsSheet';
import { WeatherChip } from './WeatherChip';
import { addDaysToDateString, buildTripWeatherParams, indexWeatherByDate } from './tripWeather';
import {
  computeDayTimeline,
  formatClockTime,
  parseStartTime,
  type TimelineStop,
} from './computeDayTimeline';
import { AssistMenu, type AssistItem } from './itinerary/AssistMenu';
import { DayJumpStrip } from './itinerary/DayJumpStrip';
import { DaySectionHeader } from './itinerary/DaySectionHeader';
import { GapFillChip, IdeasAddToDayRow } from './itinerary/ItineraryChips';
import { ItinerarySkeleton } from './itinerary/ItinerarySkeleton';
import {
  buildConflictMessage,
  groupByDay,
  groupPlacesPreservingOrder,
  pickGapFillDay,
} from './itinerary/sections';
import {
  useActiveDay,
  useDayNavigation,
  type ActiveDayStore,
} from './itinerary/useDayNavigation';

// v2 N4 4.2: a day advertises gap-fill only when ≥1h of budget is left —
// below that, suggestions would mostly be unusable (server floor is 30m).
const GAP_FILL_MIN_SLACK_MINUTES = 60;
// useAiSuggest validates slackMinutes to 30..480.
const GAP_FILL_MAX_SLACK_MINUTES = 480;

// v2 0020: `trip_days.start_time` ships with migration 0020 (backend, in
// parallel). Local type-extension until the api TripDay type is widened —
// UI code must not edit src/api.
type TripDayV2 = TripDay & { start_time?: string | null };

export interface ItineraryTabProps {
  tripId: string;
  places: TripPlace[];
  legs: TripLeg[];
  trip: Trip;
  accommodations: TripAccommodation[];
  /** Phase 25 Step 25.10: role gate for notes. Viewers see notes read-only. */
  canEdit?: boolean;
  /**
   * Extra bottom padding for the scroll content so a floating control (the
   * quick-add FAB) never covers the last row. Rows open the place screen
   * themselves WITH trip context (v2 M4 X2.3), so there is no onOpen prop.
   */
  bottomInset?: number;
}

export function ItineraryTab({
  tripId,
  places,
  legs,
  trip,
  accommodations,
  canEdit = true,
  bottomInset = 0,
}: ItineraryTabProps) {
  const t = useTheme();
  const router = useRouter();
  const reorderDay = useReorderDay();
  const moveToDay = useMoveToDay();
  const compact = useBreakpoint() === 'mobile';
  const [activePlaceId, setActivePlaceId] = useState<string | null>(null);
  // v2 N1 1.7: which place's comment thread is open (null = closed).
  const [commentsPlaceId, setCommentsPlaceId] = useState<string | null>(null);
  // v2 N4: AI-edit / import / gap-fill sheet state. `gapFill` keeps the last
  // opened day's params even while hidden so the sheet's in-progress AI
  // results survive a close + same-day reopen (forgiving; the sheet resets
  // itself when dayIndex changes).
  const [aiEditOpen, setAiEditOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [gapFill, setGapFill] = useState<{ dayIndex: number; slackMinutes: number } | null>(null);
  const [gapFillVisible, setGapFillVisible] = useState(false);

  // ── v2 S2.6 → S2.8.7: flag-on drag persists manual_rank ONLY ────────────
  // EVERYTHING in this block is a strict no-op while the Tier-1 sync flag is
  // off: `tier1Active` stays false → the legs watcher below is disabled
  // (undefined tripId → enabled:false), the drag handler takes the v1
  // reorderDay path verbatim, and `pendingRecompute` never leaves its
  // initial empty set (its setter only runs inside flag-on branches).
  //
  // S2.8.7 retired the Wave 3b dual-path AND the `dayOrderOverrides`
  // session-visual mechanism: flag-on, rank writes land synchronously in the
  // Tier-1 store, the places facade re-renders reactively, and the
  // rank-aware `byDay` below puts the dragged order on screen — no transient
  // override needed, online or offline.
  const tier1Active = isTier1SyncActive();
  const undo = useUndo();
  const online = useIsOnline();
  // D4: a flag-on drag while in "Best route" mode switches the trip to
  // "My order" (a drag IS an assertion of manual order — C1). The repointed
  // hook writes route_render_mode through the sync store flag-on
  // (offline-safe) and best-effort re-runs optimize.
  const updateRenderMode = useUpdateRouteRenderMode(tripId);
  // D5: move-to-day stays a legacy server mutation flag-on (day_index is
  // server-domain), so offline it can only fail — the affordances below
  // disable with honest copy instead. Always false flag-off (no UI change).
  const moveLockedOffline = tier1Active && !online;
  // Rows whose offline reorder still awaits a route recompute — drives the
  // muted "route recompute pending" chip on the row (PlaceRow).
  const [pendingRecompute, setPendingRecompute] = useState<ReadonlySet<string>>(() => new Set());

  // Pending-clear heuristic (documented per the wave spec): the sync queue
  // depth is not observable (telemetry exposes no pendingWrites), so the
  // chips clear on ANY successful trip-legs refetch — the auto-optimize
  // recompute invalidates trip-legs, so a fresh legs payload is the closest
  // honest "travel times caught up" signal we have. Trade-off (accepted): a
  // focus-refetch that succeeds while the rank is still queued clears the
  // chip early; the synced rank is not lost — the next optimize still
  // applies it. The hook dedupes with the route shell's useTripLegs (same
  // query key), so flag-on adds no second network fetch.
  const legsWatcher = useTripLegs(tier1Active ? tripId : undefined);
  const legsUpdatedAt = legsWatcher.dataUpdatedAt;
  const lastLegsUpdatedAt = useRef(legsUpdatedAt);
  useEffect(() => {
    if (legsUpdatedAt === lastLegsUpdatedAt.current) return;
    lastLegsUpdatedAt.current = legsUpdatedAt;
    // Functional no-op update (same reference when already empty) so the
    // flag-off path never re-renders from this effect.
    setPendingRecompute((prev) => (prev.size === 0 ? prev : new Set()));
  }, [legsUpdatedAt]);

  // ── v2 M4 X2.3: pull-to-refresh + first-load skeleton ───────────────────
  // Same query keys as the route shell's reads (deduped — no extra fetch).
  // Flag-on, the places facade's refetch also triggers a Tier-1 resync.
  const placesQuery = useTripPlaces(tripId);
  const legsQuery = useTripLegs(tripId);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.allSettled([placesQuery.refetch(), legsQuery.refetch()]).finally(() =>
      setRefreshing(false),
    );
  }, [placesQuery, legsQuery]);
  const firstLoad = places.length === 0 && placesQuery.isLoading;

  // Phase 24: reaction data for the whole trip + current user id.
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const { data: tripReactions = [] } = useTripReactions(tripId);
  const setReaction = useSetTripPlaceReaction();
  // One pass instead of a tripReactions.find() per row per render.
  const myReactionByPlace = useMemo(() => {
    const m = new Map<string, (typeof tripReactions)[number]['reaction']>();
    if (!currentUserId) return m;
    for (const r of tripReactions) {
      if (r.user_id === currentUserId) m.set(r.trip_place_id, r.reaction);
    }
    return m;
  }, [tripReactions, currentUserId]);

  // v2 N1 1.7: ONE batch read for all comment-count badges (per spec — never
  // fan out a query per place). The thread sheet has its own per-place query.
  const { data: tripComments = [] } = useTripComments(tripId);
  const commentCounts = useMemo(() => countCommentsByPlace(tripComments), [tripComments]);

  // ── Per-day notes (Step 9.5) ─────────────────────────────────────────────
  const { data: tripDays = [] } = useTripDays(tripId);
  // Index by day_index for O(1) lookup in the render loop.
  const dayNotesIndex = useMemo(() => {
    const m = new Map<number, TripDay>();
    for (const d of tripDays) m.set(d.day_index, d);
    return m;
  }, [tripDays]);

  // v2 S2.8.7: flag-on display order comes from orderPlacesForDisplay — the
  // canonical rank-aware rule shared with the trip-places facade re-export
  // and optimize-trip's manual branch (src/sync/order.ts binding header).
  // A drag's rank write re-orders this list reactively (store → facade →
  // props), and because the Edge recompute persists order_in_day from the
  // SAME rule, the order can never "snap" when it lands. In 'optimized'
  // render mode the helper itself falls back to order_in_day, so the
  // optimizer's arrangement always wins there. Flag-off: groupByDay,
  // byte-identical to v1.
  const byDay = useMemo(
    () =>
      tier1Active
        ? groupPlacesPreservingOrder(orderPlacesForDisplay(places, trip.route_render_mode, true))
        : groupByDay(places),
    [places, tier1Active, trip.route_render_mode],
  );
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const availableDays = useMemo(
    () => byDay.filter((d) => d.dayIndex >= 0).map((d) => d.dayIndex),
    [byDay],
  );
  // v2 N4 4.2: the Ideas bucket feeds GapFillSheet's "Ideas first" list.
  const ideas = useMemo(() => places.filter((p) => p.day_index === null), [places]);

  const legIndex = useMemo(() => {
    const m = new Map<string, TripLeg>();
    for (const l of legs) m.set(`${l.day_index}|${l.from_place_id}|${l.to_place_id}`, l);
    return m;
  }, [legs]);

  // ── v2 M4 X2.3: day strip, collapse, scroll-to-day (itinerary/useDayNavigation)
  const {
    todayIndex,
    dayChips,
    chipByDay,
    collapsedDays,
    activeDayStore,
    scrollRef,
    onJump,
    onSectionLayout,
    onScroll,
  } = useDayNavigation(
    tripId,
    trip,
    byDay.map((s) => s.dayIndex),
    t.spacing.sm,
  );

  // v2 M4 X2.3: rows open details WITH trip context so the place screen can
  // show and set this trip's reaction (tripId + tripPlaceId params).
  const openPlace = (place: TripPlace) =>
    router.push({
      pathname: '/place/[placeId]',
      params: { placeId: place.google_place_id, tripId, tripPlaceId: place.id },
    });

  // ── v2 N1 1.2: per-day timeline ──────────────────────────────────────────
  // Session-local start-time overrides (dayIndex → minutes). Committed edits
  // land here instantly so the timeline updates without waiting for the
  // round-trip; the server value (trip_days.start_time, migration 0020) wins
  // on fresh loads. This is pending-edit UI state, not mirrored server data.
  const [startTimeOverrides, setStartTimeOverrides] = useState<ReadonlyMap<number, number>>(
    () => new Map(),
  );

  // One pass over the scheduled sections: effective start minutes + the
  // arrival/departure map per day. Pure math (computeDayTimeline) — legs are
  // keyed from→to, and a place belongs to one day, so passing all legs is safe.
  const timelinesByDay = useMemo(() => {
    const result = new Map<number, { startMinutes: number; stops: Map<string, TimelineStop> }>();
    for (const section of byDay) {
      if (section.dayIndex < 0) continue;
      const record = dayNotesIndex.get(section.dayIndex) as TripDayV2 | undefined;
      const startMinutes =
        startTimeOverrides.get(section.dayIndex) ?? parseStartTime(record?.start_time);
      result.set(section.dayIndex, {
        startMinutes,
        stops: computeDayTimeline({
          dayStartMinutes: startMinutes,
          places: section.places,
          legs,
        }),
      });
    }
    return result;
  }, [byDay, dayNotesIndex, startTimeOverrides, legs]);

  // ── v2 N4 4.2: spare minutes vs the daily time budget for one day ───────
  // Uses the same computed timeline as the arrival/departure chips, so the
  // chip and the times always agree (travel time included; unknown legs
  // contribute zero, matching computeDayTimeline's graceful degradation).
  const budgetMinutes = Math.round(trip.daily_hours_budget * 60);
  const slackForDay = (section: { dayIndex: number; places: TripPlace[] }): number | null => {
    if (section.dayIndex < 0 || section.places.length === 0) return null;
    const timeline = timelinesByDay.get(section.dayIndex);
    if (!timeline) return null;
    const last = section.places[section.places.length - 1];
    if (!last) return null;
    const stop = timeline.stops.get(last.id);
    if (!stop) return null;
    return budgetMinutes - (stop.departureMinutes - timeline.startMinutes);
  };

  const openGapFill = (dayIndex: number, slackMinutes: number) => {
    setGapFill({ dayIndex, slackMinutes });
    setGapFillVisible(true);
  };

  // ── v2 P2.1: per-day weather chips ───────────────────────────────────────
  // ONE query for the whole trip: centroid of ALL places, dates clamped to
  // the ~16-day horizon. buildTripWeatherParams returns undefined when the
  // trip is undated / out of horizon / empty, which holds the query — and a
  // fetch error simply leaves `weatherDays` unset. Either way the weather UI
  // disappears quietly (nice-to-have, never an error banner).
  const weatherParams = useMemo(
    () =>
      buildTripWeatherParams({
        tripStartDate: trip.start_date,
        places,
        maxDayIndex: availableDays.length > 0 ? Math.max(...availableDays) : -1,
      }),
    [trip.start_date, places, availableDays],
  );
  const { data: weatherDays } = useDayWeather(weatherParams);
  // Forecast rows keyed by DATE — trip days map by date, never array index.
  const weatherByDate = useMemo(() => indexWeatherByDate(weatherDays ?? []), [weatherDays]);
  /** This section's forecast, or undefined (no date / gap / out of horizon). */
  const weatherForSection = (dayIndex: number) => {
    if (dayIndex < 0 || !trip.start_date) return undefined;
    const date = addDaysToDateString(trip.start_date, dayIndex);
    return date ? weatherByDate.get(date) : undefined;
  };
  // CC-BY 4.0: the attribution line renders iff at least one chip does.
  const showWeatherAttribution = useMemo(
    () => byDay.some((s) => s.dayIndex >= 0 && weatherForSection(s.dayIndex) !== undefined),
    // weatherForSection is derived from these exact inputs:
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byDay, weatherByDate, trip.start_date],
  );

  // v2 N4: the AI sheets render in both branches (the empty state still
  // offers Import + AI edit — both can seed an empty trip).
  const aiSheets = canEdit ? (
    <>
      <AiEditSheet
        visible={aiEditOpen}
        onClose={() => setAiEditOpen(false)}
        tripId={tripId}
        places={places}
        routeRenderMode={trip.route_render_mode}
      />
      <ImportPlacesSheet
        visible={importOpen}
        onClose={() => setImportOpen(false)}
        tripId={tripId}
        places={places}
      />
      {gapFill ? (
        <GapFillSheet
          visible={gapFillVisible}
          onClose={() => setGapFillVisible(false)}
          tripId={tripId}
          dayIndex={gapFill.dayIndex}
          slackMinutes={gapFill.slackMinutes}
          ideas={ideas}
        />
      ) : null}
    </>
  ) : null;

  // v2 M4 X2.3: "✨ Assist" folds AI edit / import / gap-fill (editors only).
  const gapFillTarget = pickGapFillDay(
    byDay.map((s) => ({ dayIndex: s.dayIndex, slack: slackForDay(s) })),
    todayIndex,
    GAP_FILL_MIN_SLACK_MINUTES,
  );
  const assistItems: AssistItem[] = [
    {
      key: 'ai-edit',
      title: 'Edit with AI',
      icon: 'sparkles',
      description: 'Describe a change — preview every edit before it applies.',
      onPress: () => setAiEditOpen(true),
    },
    {
      key: 'import',
      title: 'Import a list',
      icon: 'download',
      description: 'Paste places or a Takeout CSV into your Ideas.',
      onPress: () => setImportOpen(true),
    },
    {
      key: 'gap-fill',
      title: 'Fill free time',
      icon: 'hourglass',
      description: gapFillTarget
        ? `Day ${gapFillTarget.dayIndex + 1} has ~${formatDuration(gapFillTarget.slack)} free — see ideas to fill it.`
        : 'No day has an hour or more free right now.',
      disabled: gapFillTarget === null,
      onPress: () => {
        if (!gapFillTarget) return;
        openGapFill(
          gapFillTarget.dayIndex,
          Math.min(GAP_FILL_MAX_SLACK_MINUTES, gapFillTarget.slack),
        );
      },
    },
  ];
  const assist = canEdit ? <AssistMenu items={assistItems} /> : null;

  if (firstLoad) {
    return (
      <View style={{ flex: 1 }}>
        <ItinerarySkeleton />
      </View>
    );
  }

  // aiSheets MUST sit at the same tree position in both branches: when an
  // import / AI edit lands the first place, places.length flips 0 → 1 and a
  // position change would remount the sheets mid-write (progress, summary
  // and the undo journal lost). Both branches are a Fragment in slot 0, the
  // sheets always in slot 1.
  if (places.length === 0) {
    return (
      <View style={{ flex: 1 }}>
        <>
          {assist ? <DayJumpStrip chips={[]} activeDayIndex={null} onJump={onJump} trailing={assist} /> : null}
          <EmptyState
            {...noPlaces}
            // Viewers can't add places (RLS: editor role) — no dead-end CTA.
            ctaLabel={canEdit ? noPlaces.ctaLabel : undefined}
            onPress={canEdit ? () => router.push(`/trip/${tripId}/add`) : undefined}
          />
        </>
        {aiSheets}
      </View>
    );
  }

  const activePlace = activePlaceId ? byId.get(activePlaceId) ?? null : null;

  return (
    <View style={{ flex: 1 }}>
      <>
      <ActiveDayJumpStrip
        store={activeDayStore}
        chips={dayChips}
        onJump={onJump}
        trailing={assist}
      />
      {/*
       * keyboardShouldPersistTaps="handled" is required so tapping outside a
       * focused TextInput inside the list correctly dismisses the keyboard on
       * native without eating the tap event (risk M from planner spec Step 9.4).
       */}
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={64}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} {...themedRefresh(t)} />}
        contentContainerStyle={{
          padding: compact ? t.spacing.md : t.spacing.lg,
          gap: compact ? t.spacing.sm : t.spacing.md,
          paddingBottom: (compact ? t.spacing.md : t.spacing.lg) + bottomInset,
        }}
      >
        {byDay.map((section) => {
          // v2 N4 4.2: spare time vs the daily budget (scheduled days only).
          const slack = canEdit ? slackForDay(section) : null;
          // v2 P2.1: this day's forecast (undefined hides the chip quietly).
          const dayWeather = weatherForSection(section.dayIndex);
          // v2 M4 X2.3: collapsed sections render the header only.
          const collapsed = collapsedDays.isCollapsed(section.dayIndex);
          const chip = chipByDay.get(section.dayIndex);
          return (
          <View
            key={`day-${section.dayIndex}`}
            onLayout={onSectionLayout(section.dayIndex)}
            style={{ gap: t.spacing.sm }}
          >
            <DaySectionHeader
              dayIndex={section.dayIndex}
              title={section.dayIndex < 0 ? '💡 Ideas' : `Day ${section.dayIndex + 1}`}
              dateLabel={chip?.dateLabel ?? null}
              isToday={chip?.isToday ?? false}
              collapsed={collapsed}
              onToggle={() => collapsedDays.toggle(section.dayIndex)}
              placeCount={section.places.length}
              subtitle={section.dayIndex < 0 ? 'Saved, not scheduled yet' : null}
            >
              {/* v2 P2.1: forecast chip; rainy days open GapFillSheet
                  (Ideas-first indoor fix) for editors. Passing the day's
                  real slack keeps the sheet header honest; GapFillSheet
                  clamps to its 30..480 input bounds itself. */}
              {dayWeather ? (
                <WeatherChip
                  day={dayWeather}
                  dayNumber={section.dayIndex + 1}
                  onPressRainy={
                    canEdit && isRainy(dayWeather)
                      ? () => {
                          const free = slackForDay(section);
                          openGapFill(
                            section.dayIndex,
                            Math.max(30, Math.min(GAP_FILL_MAX_SLACK_MINUTES, free ?? 30)),
                          );
                        }
                      : null
                  }
                />
              ) : null}
              {section.dayIndex >= 0 ? (
                <StayingAtPill
                  dayIndex={section.dayIndex}
                  tripStartDate={trip.start_date}
                  accommodations={accommodations}
                />
              ) : null}
              {/* v2 N1 1.2: editable day start time — drives the timeline */}
              {section.dayIndex >= 0 ? (
                <DayStartTimeControl
                  tripId={tripId}
                  dayIndex={section.dayIndex}
                  dayRecord={dayNotesIndex.get(section.dayIndex) ?? null}
                  valueMinutes={
                    timelinesByDay.get(section.dayIndex)?.startMinutes ??
                    parseStartTime(null)
                  }
                  onChangeMinutes={(minutes) =>
                    setStartTimeOverrides((prev) => {
                      const next = new Map(prev);
                      next.set(section.dayIndex, minutes);
                      return next;
                    })
                  }
                  canEdit={canEdit}
                />
              ) : null}
            </DaySectionHeader>

            {collapsed ? null : (
            <>
            {/* ── Per-day summary strip (Step 8.4) — only for scheduled days */}
            {section.dayIndex >= 0 ? (
              <DaySummaryCard
                dayIndex={section.dayIndex}
                places={places}
                legs={legs}
                compact={compact}
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
              groupLabel={section.dayIndex < 0 ? 'Ideas — saved places not scheduled yet' : `Day ${section.dayIndex + 1}`}
              items={section.places.map<DraggableItem>((place, idx) => {
                const next = section.places[idx + 1];
                const leg = next
                  ? legIndex.get(`${section.dayIndex}|${place.id}|${next.id}`)
                  : undefined;
                // v2 N1 1.2: this stop's computed clock times (scheduled days only).
                const stop = timelinesByDay.get(section.dayIndex)?.stops.get(place.id);
                return {
                  id: place.id,
                  render: (dragging, gesture) => {
                    const myReaction = myReactionByPlace.get(place.id) ?? null;
                    return (
                      <View style={{ gap: t.spacing.xs }}>
                        <PlaceRow
                          place={place}
                          dragging={dragging}
                          legAfter={leg}
                          hasNext={Boolean(next)}
                          transportMode={trip.transport_mode}
                          onOpenDetails={() => openPlace(place)}
                          // v2 M4 X2.3: the full-card target carries the
                          // drag long-press (see DraggableRowGesture).
                          onLongPress={canEdit ? gesture.onLongPress : undefined}
                          // v2 M4 X2.3: transit link destination = the
                          // next stop of this day (the leg's to-place).
                          nextStop={
                            next
                              ? {
                                  lat: next.lat,
                                  lng: next.lng,
                                  placeId: next.google_place_id,
                                  label: next.user_title,
                                }
                              : null
                          }
                          canEdit={canEdit}
                          reaction={myReaction}
                          onReactionChange={(next) =>
                            setReaction.mutate({
                              tripPlaceId: place.id,
                              reaction: next,
                              tripId,
                            })
                          }
                          timeline={
                            stop
                              ? {
                                  arrival: formatClockTime(stop.arrivalMinutes),
                                  departure: formatClockTime(stop.departureMinutes),
                                  // v2 P1.1b: window wait + conflict (prebuilt
                                  // strings — PlaceRow stays math-free).
                                  waitUntil:
                                    stop.waitUntilMinutes !== null
                                      ? formatClockTime(stop.waitUntilMinutes)
                                      : null,
                                  warning: buildConflictMessage(stop),
                                  // T1: pinned-arrival label — PlaceRow swaps
                                  // the arrival chip into its pinned styling.
                                  pinnedAt:
                                    stop.pinnedStartMinutes !== null
                                      ? formatClockTime(stop.pinnedStartMinutes)
                                      : null,
                                }
                              : null
                          }
                          commentCount={commentCounts.get(place.id) ?? 0}
                          onOpenComments={() => setCommentsPlaceId(place.id)}
                          // v2 S2.8.13 (F4): same sheet the long-press below
                          // opens — PlaceRow renders it as a web-only kebab
                          // (desktop/mobile web have no discoverable
                          // long-press; native rows never show it).
                          // Viewers: no actions sheet (edits/deletes are
                          // editor-only in RLS and would retry forever).
                          onOpenActions={canEdit ? () => setActivePlaceId(place.id) : undefined}
                          // v2 S2.6: muted chip while an offline reorder
                          // awaits its route recompute (always false flag-off).
                          pendingRecompute={pendingRecompute.has(place.id)}
                        />
                        {/* v2 N1 1.4: one-tap promote from Ideas to a day */}
                        {section.dayIndex < 0 && canEdit && !dragging ? (
                          <IdeasAddToDayRow
                            placeTitle={place.user_title ?? 'place'}
                            availableDays={availableDays}
                            disabled={moveToDay.isPending}
                            offlineLocked={moveLockedOffline}
                            onMove={(toDay) =>
                              moveToDay.mutate({
                                id: place.id,
                                tripId,
                                toDayIndex: toDay,
                              })
                            }
                          />
                        ) : null}
                      </View>
                    );
                  },
                };
              })}
              // Viewers get a read-only list: no drag pickup, no long-press.
              disabled={!canEdit}
              onReorder={(newIds: string[]) => {
                if (!canEdit) return; // belt-and-braces: viewers never reorder
                if (section.dayIndex < 0) return; // unscheduled bucket is not orderable
                // ── v2 S2.8.7: single-path drag commit ────────────────────
                // Flag ON (checked at CALL time so a mid-session flip is
                // honored): the drag persists as manual_rank ONLY — LWW,
                // offline-safe, rendered reactively via the rank-aware
                // `byDay` above. The legacy reorderDay RPC no longer fires
                // here (Wave 3b dual-path retired): order_in_day is
                // re-derived server-side by the next manual-mode optimize,
                // which the route shell's rank-derived stateKey triggers
                // (offline, that optimize mutation pauses and resumes on
                // reconnect — TanStack networkMode 'online').
                // Flag OFF: the v1 reorderDay path below, byte-identical.
                if (isTier1SyncActive()) {
                  const wasOptimized = trip.route_render_mode === 'optimized';
                  // D4: capture pre-drag ranks BEFORE any rank write
                  // (including commitDragRanks' silent backfill) so the
                  // composite inverse restores the exact prior order intent.
                  const preDragRanks = wasOptimized ? snapshotRanks(tripId) : null;
                  const { undoEntry, movedIds } = commitDragRanks(section.places, newIds);
                  if (undoEntry === null && movedIds.length > 0) {
                    // D2 hydration window: the places root isn't serving
                    // yet, so ZERO rank writes landed and the store-backed
                    // list cannot hold the drag — without persistence it
                    // would snap back. Fall back to the v1 server reorder
                    // once. This is NOT the dual-path: it fires only when
                    // no rank was written, so nothing is double-persisted
                    // (and reorderDay.onSuccess resyncs the store anyway).
                    reorderDay.mutate({
                      tripId,
                      dayIndex: section.dayIndex,
                      orderedIds: newIds,
                    });
                    return;
                  }
                  if (wasOptimized && preDragRanks && undoEntry) {
                    // D4 (approved): a drag in "Best route" IS an assertion
                    // of manual order — switch the trip to "My order"
                    // through the repointed hook (sync store write +
                    // best-effort optimize re-render). ONE composite undo
                    // entry, not two: the inverse restores the pre-drag
                    // ranks AND flips the mode back, which re-runs the
                    // optimizer so the screen returns to the pre-drag
                    // "Best route" arrangement. The per-move undoEntry is
                    // superseded (its rank restore is covered by the
                    // snapshot) and deliberately not pushed.
                    updateRenderMode.mutate('manual');
                    undo.push({
                      label: 'Switched to My order + reorder',
                      inverse: async () => {
                        restoreRanks(preDragRanks);
                        await updateRenderMode.mutateAsync('optimized');
                      },
                    });
                  } else if (undoEntry) {
                    undo.push(undoEntry);
                  }
                  if (!online && movedIds.length > 0) {
                    // OFFLINE: travel legs can't recompute yet — chip the
                    // moved rows until the next successful legs refetch
                    // (clear heuristic documented above). The dragged order
                    // itself is already on screen via the rank-aware byDay.
                    setPendingRecompute((prev) => {
                      const next = new Set(prev);
                      for (const id of movedIds) next.add(id);
                      return next;
                    });
                  }
                  return;
                }
                reorderDay.mutate({
                  tripId,
                  dayIndex: section.dayIndex,
                  orderedIds: newIds,
                });
              }}
              onLongPress={canEdit ? (id: string) => setActivePlaceId(id) : undefined}
            />

            {/* v2 N4 4.2: subtle footer chip when the day has ≥1h of slack */}
            {slack !== null && slack >= GAP_FILL_MIN_SLACK_MINUTES ? (
              <GapFillChip
                slackMinutes={slack}
                dayNumber={section.dayIndex + 1}
                onPress={() =>
                  openGapFill(section.dayIndex, Math.min(GAP_FILL_MAX_SLACK_MINUTES, slack))
                }
              />
            ) : null}
            </>
            )}
          </View>
          );
        })}

        {/* v2 P2.1: Open-Meteo CC-BY attribution — required whenever any
            weather chip renders; one muted line at the bottom of the list. */}
        {showWeatherAttribution ? (
          <Text
            style={[
              t.typography.small,
              { color: t.colors.attribution, textAlign: 'center', paddingTop: t.spacing.sm },
            ]}
          >
            Weather data by Open-Meteo.com
          </Text>
        ) : null}
      </ScrollView>

      {canEdit ? (
        <PlaceActionsSheet
          visible={activePlaceId !== null}
          onClose={() => setActivePlaceId(null)}
          place={activePlace}
          availableDays={availableDays}
        />
      ) : null}

      {/* v2 N1 1.7: per-place comment thread */}
      <PlaceCommentsSheet
        visible={commentsPlaceId !== null}
        onClose={() => setCommentsPlaceId(null)}
        place={commentsPlaceId ? byId.get(commentsPlaceId) ?? null : null}
        tripId={tripId}
        tripOwnerId={trip.user_id}
      />
      </>

      {/* v2 N4: AI edit / import / gap-fill sheets (editors only) — slot 1,
          same position as in the empty branch (see above). */}
      {aiSheets}
    </View>
  );
}

/**
 * The only subscriber to the scroll-tracked active day, so a day-boundary
 * crossing re-renders this strip — not the whole itinerary.
 */
function ActiveDayJumpStrip({
  store,
  ...rest
}: { store: ActiveDayStore } & Omit<React.ComponentProps<typeof DayJumpStrip>, 'activeDayIndex'>) {
  const activeDay = useActiveDay(store);
  return <DayJumpStrip {...rest} activeDayIndex={activeDay} />;
}
