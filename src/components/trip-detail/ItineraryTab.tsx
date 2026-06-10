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
 * N1 extension points (not yet implemented):
 *  - 1.2 timeline: the editable per-day start_time control mounts in the day
 *    header row (next to StayingAtPill); computed arrival/departure chips are
 *    derived here (cumulative legs + visit minutes) and passed into PlaceRow.
 *  - 1.4 Ideas/wishlist: the `dayIndex < 0` ("Unscheduled") section below is
 *    the bucket that gets promoted to the named Ideas surface.
 *  - 1.7 comments: per-place comments mount inside PlaceRow.
 */
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
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
  useReorderDay,
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
                        canEdit={canEdit}
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
  dayHeader: { borderLeftWidth: 4, paddingLeft: 12 },
});
