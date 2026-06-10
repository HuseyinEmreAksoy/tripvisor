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
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
                  {section.dayIndex < 0 ? '💡 Ideas' : `Day ${section.dayIndex + 1}`}
                </Text>
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
          </View>
        ))}
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
    </View>
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
});
