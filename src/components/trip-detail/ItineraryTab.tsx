/**
 * ItineraryTab — the itinerary tab content for the trip detail route
 * (extracted from app/(app)/trip/[id]/index.tsx in v2 Phase N1 step 1.1 —
 * pure refactor).
 *
 * Renders day sections (header + StayingAtPill + DaySummaryCard +
 * DayNotesEditor) with a DraggableItinerary of PlaceRow cards per day, and
 * the PlaceActionsSheet opened by long-press.
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
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import {
  DraggableItinerary,
  EmptyState,
  PlaceActionsSheet,
  DaySummaryCard,
  type DraggableItem,
} from '@/components';
import { noPlaces } from '@/components/emptyStates';
import { dayColor } from '@/components/Map';
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
  onOpen: (googlePlaceId: string) => void;
}

export function ItineraryTab({
  tripId,
  places,
  legs,
  trip,
  accommodations,
  canEdit = true,
  onOpen,
}: ItineraryTabProps) {
  const t = useTheme();
  const router = useRouter();
  const reorderDay = useReorderDay();
  const moveToDay = useMoveToDay();
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

  // Phase 24: reaction data for the whole trip + current user id.
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const { data: tripReactions = [] } = useTripReactions(tripId);
  const setReaction = useSetTripPlaceReaction();

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

  // v2 N4: header row — compact AI affordances, pinned above the scroll.
  const aiToolbar = canEdit ? (
    <View
      style={[
        styles.aiToolbar,
        { paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.md, gap: t.spacing.sm },
      ]}
    >
      <ToolChip
        label="📥 Import"
        accessibilityLabel="Import a list of places into your Ideas"
        onPress={() => setImportOpen(true)}
      />
      <ToolChip
        label="✨ AI edit"
        accessibilityLabel="Edit this trip with AI — preview every change before it applies"
        onPress={() => setAiEditOpen(true)}
      />
    </View>
  ) : null;

  if (places.length === 0) {
    return (
      <View style={{ flex: 1 }}>
        {aiToolbar}
        <EmptyState
          {...noPlaces}
          onPress={() => router.push(`/trip/${tripId}/add`)}
        />
        {aiSheets}
      </View>
    );
  }

  const activePlace = activePlaceId ? byId.get(activePlaceId) ?? null : null;

  return (
    <View style={{ flex: 1 }}>
      {aiToolbar}
      {/*
       * keyboardShouldPersistTaps="handled" is required so tapping outside a
       * focused TextInput inside the list correctly dismisses the keyboard on
       * native without eating the tap event (risk M from planner spec Step 9.4).
       */}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md }}
      >
        {byDay.map((section) => {
          // v2 N4 4.2: spare time vs the daily budget (scheduled days only).
          const slack = canEdit ? slackForDay(section) : null;
          // v2 P2.1: this day's forecast (undefined hides the chip quietly).
          const dayWeather = weatherForSection(section.dayIndex);
          return (
          <View key={`day-${section.dayIndex}`} style={{ gap: t.spacing.sm }}>
            {/* v2 redesign: day header is a strong typographic group — colored
                day dot + bold heading + chips on whitespace (dividers out). */}
            <View style={[styles.dayHeader, { paddingTop: t.spacing.sm }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, flexWrap: 'wrap' }}>
                <View
                  style={[styles.dayDot, { backgroundColor: dayColor(section.dayIndex) }]}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <Text style={[t.typography.subtitle, { color: t.colors.text }]}>
                  {section.dayIndex < 0 ? '💡 Ideas' : `Day ${section.dayIndex + 1}`}
                </Text>
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
                            setGapFill({
                              dayIndex: section.dayIndex,
                              slackMinutes: Math.max(
                                30,
                                Math.min(GAP_FILL_MAX_SLACK_MINUTES, free ?? 30),
                              ),
                            });
                            setGapFillVisible(true);
                          }
                        : null
                    }
                  />
                ) : null}
                {/* v2 N4 4.3: import lands in Ideas — offer it right here */}
                {section.dayIndex < 0 && canEdit ? (
                  <ToolChip
                    label="📥 Import"
                    accessibilityLabel="Import a list of places into your Ideas"
                    onPress={() => setImportOpen(true)}
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
              </View>
              {/* v2 N1 1.4: Ideas subtitle */}
              {section.dayIndex < 0 ? (
                <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
                  Saved, not scheduled yet
                </Text>
              ) : null}
            </View>

            {/* ── Per-day summary strip (Step 8.4) — only for scheduled days */}
            {section.dayIndex >= 0 ? (
              <DaySummaryCard
                dayIndex={section.dayIndex}
                places={places}
                legs={legs}
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
                  render: (dragging) => {
                    const myReaction = currentUserId
                      ? (tripReactions.find(
                          (r) => r.trip_place_id === place.id && r.user_id === currentUserId,
                        )?.reaction ?? null)
                      : null;
                    return (
                      <View style={{ gap: t.spacing.xs }}>
                        <PlaceRow
                          place={place}
                          dragging={dragging}
                          legAfter={leg}
                          hasNext={Boolean(next)}
                          transportMode={trip.transport_mode}
                          onOpenDetails={() => onOpen(place.google_place_id)}
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
              onReorder={(newIds: string[]) => {
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
              onLongPress={(id: string) => setActivePlaceId(id)}
            />

            {/* v2 N4 4.2: subtle footer chip when the day has ≥1h of slack */}
            {slack !== null && slack >= GAP_FILL_MIN_SLACK_MINUTES ? (
              <GapFillChip
                slackMinutes={slack}
                dayNumber={section.dayIndex + 1}
                onPress={() => {
                  setGapFill({
                    dayIndex: section.dayIndex,
                    slackMinutes: Math.min(GAP_FILL_MAX_SLACK_MINUTES, slack),
                  });
                  setGapFillVisible(true);
                }}
              />
            ) : null}
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

      <PlaceActionsSheet
        visible={activePlaceId !== null}
        onClose={() => setActivePlaceId(null)}
        place={activePlace}
        availableDays={availableDays}
      />

      {/* v2 N1 1.7: per-place comment thread */}
      <PlaceCommentsSheet
        visible={commentsPlaceId !== null}
        onClose={() => setCommentsPlaceId(null)}
        place={commentsPlaceId ? byId.get(commentsPlaceId) ?? null : null}
        tripId={tripId}
        tripOwnerId={trip.user_id}
      />

      {/* v2 N4: AI edit / import / gap-fill sheets (editors only) */}
      {aiSheets}
    </View>
  );
}

/**
 * ToolChip (v2 N4) — compact pill action for the itinerary header row and
 * the Ideas section header ("📥 Import", "✨ AI edit").
 */
function ToolChip({
  label,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.toolChip,
        {
          borderColor: t.colors.border,
          backgroundColor: t.colors.bgElevated,
          borderRadius: t.radius.pill,
          opacity: pressed ? 0.6 : 1,
        },
        Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
      ]}
    >
      <Text style={[t.typography.small, { color: t.colors.text, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * GapFillChip (v2 N4 4.2) — subtle dashed footer chip under a day with ≥1h
 * of slack vs the daily time budget. Opens GapFillSheet (Ideas first).
 */
function GapFillChip({
  slackMinutes,
  dayNumber,
  onPress,
}: {
  slackMinutes: number;
  dayNumber: number;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`About ${formatDuration(slackMinutes)} free on Day ${dayNumber} — see ideas to fill it`}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.gapChip,
        {
          borderColor: t.colors.borderStrong,
          backgroundColor: t.colors.bgElevated,
          borderRadius: t.radius.pill,
          paddingHorizontal: t.spacing.md,
          opacity: pressed ? 0.6 : 1,
        },
        Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
      ]}
    >
      <Text style={[t.typography.small, { color: t.colors.textMuted, fontWeight: '600' }]}>
        ✨ ~{formatDuration(slackMinutes)} free — fill this day
      </Text>
    </Pressable>
  );
}

/**
 * IdeasAddToDayRow (v2 N1 1.4) — one-tap "Add to Day N" chips under each
 * Ideas card. Offers every existing day plus one new-day slot (capped at
 * Day 10, matching PlaceActionsSheet's MoveToDay).
 */
function IdeasAddToDayRow({
  placeTitle,
  availableDays,
  disabled,
  offlineLocked,
  onMove,
}: {
  placeTitle: string;
  availableDays: number[];
  disabled?: boolean;
  /** v2 S2.8.7 / D5: move-to-day is a legacy server mutation flag-on, so it
   * cannot work offline — the chips disable with honest copy instead of
   * letting the write silently fail. Always false flag-off. */
  offlineLocked?: boolean;
  onMove: (toDayIndex: number) => void;
}) {
  const t = useTheme();
  const targets = [...availableDays];
  const maxDay = targets.length > 0 ? Math.max(...targets) : -1;
  if (maxDay < 9) targets.push(maxDay + 1);
  const locked = Boolean(disabled) || Boolean(offlineLocked);

  return (
    <View style={[styles.ideasAddRow, { gap: t.spacing.xs }]}>
      <Text style={[t.typography.small, { color: t.colors.textMuted }]}>Add to:</Text>
      {targets.map((day) => {
        const isNew = day > maxDay || availableDays.length === 0;
        return (
          <Pressable
            key={day}
            accessibilityRole="button"
            // a11y: the disabled reason rides the label so screen-reader
            // users hear WHY the chip is inert, not just "dimmed".
            accessibilityLabel={`Add ${placeTitle} to Day ${day + 1}${isNew ? ', a new day' : ''}${offlineLocked ? '. Available when back online' : ''}`}
            disabled={locked}
            onPress={() => onMove(day)}
            hitSlop={4}
            style={({ pressed }) => [
              styles.ideasDayChip,
              {
                borderColor: dayColor(day),
                backgroundColor: t.colors.bgElevated,
                borderRadius: t.radius.pill,
                opacity: locked ? 0.5 : pressed ? 0.6 : 1,
              },
            ]}
          >
            <Text style={[t.typography.small, { color: t.colors.text, fontWeight: '600' }]}>
              {`Day ${day + 1}${isNew ? ' +' : ''}`}
            </Text>
          </Pressable>
        );
      })}
      {offlineLocked ? (
        <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
          Available when back online
        </Text>
      ) : null}
    </View>
  );
}

/**
 * v2 P1.1b: human copy for a stop's time-window conflict. Non-blocking by
 * design (ux-principles) — the chip informs; the user decides whether to
 * shorten the visit, reorder the day, or simply ignore it.
 */
function buildConflictMessage(stop: TimelineStop): string | null {
  if (!stop.conflict) return null;
  // T1: an unreachable pin — the day flow gets here after the pinned time.
  if (stop.conflict === 'pinned_tight') {
    return stop.pinnedStartMinutes !== null
      ? `arrives ${formatClockTime(stop.arrivalMinutes)} — pinned ${formatClockTime(stop.pinnedStartMinutes)}`
      : null;
  }
  if (stop.windowEndMinutes === null) return null;
  const windowEnd = formatClockTime(stop.windowEndMinutes);
  return stop.conflict === 'arrives_late'
    ? `arrives ${formatClockTime(stop.arrivalMinutes)} — window ends ${windowEnd}`
    : `leaves ${formatClockTime(stop.departureMinutes)} — window ends ${windowEnd}`;
}

/**
 * v2 S2.8.7: group an ALREADY display-ordered list (orderPlacesForDisplay's
 * output) into day sections WITHOUT re-sorting inside each day — the
 * helper's per-day order is canonical (rank-aware in manual mode), and
 * re-sorting by order_in_day here (as groupByDay does) would undo it.
 * Section order matches groupByDay's output: Ideas (-1) first, then days
 * ascending — which is also exactly the order orderPlacesForDisplay emits,
 * so the trailing sort is a determinism guarantee, not a reshuffle.
 */
function groupPlacesPreservingOrder(
  ordered: readonly TripPlace[],
): Array<{ dayIndex: number; places: TripPlace[] }> {
  const map = new Map<number, TripPlace[]>();
  for (const p of ordered) {
    const key = p.day_index ?? -1;
    const arr = map.get(key);
    if (arr) arr.push(p);
    else map.set(key, [p]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dayIndex, ps]) => ({ dayIndex, places: ps }));
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
  dayHeader: { gap: 2 },
  // Colored day marker — matches the map's per-day palette (dayColor).
  dayDot: { width: 10, height: 10, borderRadius: 5 },
  // v2 N1 1.4: "Add to Day N" chip row under Ideas cards
  ideasAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
  },
  ideasDayChip: {
    borderWidth: 1.5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minHeight: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // v2 N4: compact AI affordances row (right-aligned, above the scroll)
  aiToolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  toolChip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // v2 N4 4.2: dashed "empty space" affordance under under-budget days
  gapChip: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
});
