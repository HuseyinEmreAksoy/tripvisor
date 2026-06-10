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
 */
import { useMemo, useState } from 'react';
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
  useMoveToDay,
  useReorderDay,
  useTripComments,
  useTripDays,
  type Trip,
  type TripDay,
  type TripLeg,
  type TripPlace,
} from '@/api';
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

  const byDay = useMemo(() => groupByDay(places), [places]);
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
          return (
          <View key={`day-${section.dayIndex}`} style={{ gap: t.spacing.sm }}>
            <View style={[styles.dayHeader, { borderColor: dayColor(section.dayIndex), backgroundColor: t.colors.gradientSubtle, borderRadius: t.radius.md, paddingHorizontal: t.spacing.md, paddingVertical: t.spacing.sm }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, flexWrap: 'wrap' }}>
                <Text style={[t.typography.subtitle, { color: t.colors.text }]}>
                  {section.dayIndex < 0 ? '💡 Ideas' : `Day ${section.dayIndex + 1}`}
                </Text>
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
                                }
                              : null
                          }
                          commentCount={commentCounts.get(place.id) ?? 0}
                          onOpenComments={() => setCommentsPlaceId(place.id)}
                        />
                        {/* v2 N1 1.4: one-tap promote from Ideas to a day */}
                        {section.dayIndex < 0 && canEdit && !dragging ? (
                          <IdeasAddToDayRow
                            placeTitle={place.user_title ?? 'place'}
                            availableDays={availableDays}
                            disabled={moveToDay.isPending}
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
  onMove,
}: {
  placeTitle: string;
  availableDays: number[];
  disabled?: boolean;
  onMove: (toDayIndex: number) => void;
}) {
  const t = useTheme();
  const targets = [...availableDays];
  const maxDay = targets.length > 0 ? Math.max(...targets) : -1;
  if (maxDay < 9) targets.push(maxDay + 1);

  return (
    <View style={[styles.ideasAddRow, { gap: t.spacing.xs }]}>
      <Text style={[t.typography.small, { color: t.colors.textMuted }]}>Add to:</Text>
      {targets.map((day) => {
        const isNew = day > maxDay || availableDays.length === 0;
        return (
          <Pressable
            key={day}
            accessibilityRole="button"
            accessibilityLabel={`Add ${placeTitle} to Day ${day + 1}${isNew ? ', a new day' : ''}`}
            disabled={disabled}
            onPress={() => onMove(day)}
            hitSlop={4}
            style={({ pressed }) => [
              styles.ideasDayChip,
              {
                borderColor: dayColor(day),
                backgroundColor: t.colors.bgElevated,
                borderRadius: t.radius.pill,
                opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
              },
            ]}
          >
            <Text style={[t.typography.small, { color: t.colors.text, fontWeight: '600' }]}>
              {`Day ${day + 1}${isNew ? ' +' : ''}`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * v2 P1.1b: human copy for a stop's time-window conflict. Non-blocking by
 * design (ux-principles) — the chip informs; the user decides whether to
 * shorten the visit, reorder the day, or simply ignore it.
 */
function buildConflictMessage(stop: TimelineStop): string | null {
  if (!stop.conflict || stop.windowEndMinutes === null) return null;
  const windowEnd = formatClockTime(stop.windowEndMinutes);
  return stop.conflict === 'arrives_late'
    ? `arrives ${formatClockTime(stop.arrivalMinutes)} — window ends ${windowEnd}`
    : `leaves ${formatClockTime(stop.departureMinutes)} — window ends ${windowEnd}`;
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
  dayHeader: { borderLeftWidth: 4, paddingLeft: 12, gap: 2 },
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
    borderWidth: 1.5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minHeight: 28,
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
