/**
 * app/share/[token].tsx — Public read-only trip view.
 *
 * This route requires NO authentication. It is reachable via:
 *   Web:    https://<domain>/share/<token>
 *   Native: tripvisor://share/<token>  (deep-link via Expo Router + scheme in app.json)
 *
 * Renders a read-only trip — no edit affordances anywhere:
 *   - No drag handles
 *   - No visit-duration steppers
 *   - No "Add a place" / "Delete" / "Settings" controls
 *
 * Google ToS compliance:
 *   - Only renders place names, lat/lng, and day assignments (safe to display publicly).
 *   - Reviews, photos, ratings, and opening hours are NEVER fetched by useSharedTrip.
 *   - PoweredByGoogle is rendered in the footer when any place data is present.
 *
 * API contract assumed (to verify against backend-specialist's src/api/share.ts):
 *   useSharedTrip(token) → UseQueryResult<SharedTrip | null, Error>
 *   where SharedTrip = {
 *     trip: { title, start_date, end_date, daily_hours_budget, transport_mode }
 *     places: Array<{ id, user_title, lat, lng, day_index, order_in_day, visit_duration_minutes }>
 *     legs:   Array<{ id, day_index, from_place_id, to_place_id, duration_seconds, distance_meters, polyline }>
 *   }
 */
import { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { EmptyState } from '@/components/EmptyState';
import { PoweredByGoogle } from '@/components/PoweredByGoogle';
import { Map } from '@/components/Map';
import { decodePolyline, dayColor, type MapMarker, type MapPolyline } from '@/components/Map';
import { useTheme } from '@/theme';
// Will resolve once backend-specialist lands src/api/share.ts
import { useSharedTrip } from '@/api/share';

export default function SharedTripView() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const t = useTheme();
  const { data: shared, isLoading, isError } = useSharedTrip(token ?? '');

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: t.colors.bg }]}>
        <ActivityIndicator size="large" color={t.colors.primary} />
        <Text style={[t.typography.body, { color: t.colors.textMuted, marginTop: t.spacing.md }]}>
          Loading trip…
        </Text>
      </View>
    );
  }

  // ── Error / not found (revoked or deleted) ───────────────────────────────
  if (isError || !shared) {
    return (
      <View style={[styles.centered, { backgroundColor: t.colors.bg, padding: t.spacing.xl }]}>
        <EmptyState
          title="Link not found"
          body="This trip has been deleted or the share link was revoked."
        />
      </View>
    );
  }

  const { trip, places, legs } = shared;

  return (
    <SharedTripContent
      trip={trip}
      places={places}
      legs={legs}
    />
  );
}

// ── Types inferred from expected API shape ───────────────────────────────────
interface SharedTripMeta {
  title: string;
  start_date: string | null;
  end_date: string | null;
  daily_hours_budget: number;
  transport_mode: string;
}

interface SharedPlace {
  id: string;
  user_title: string | null;
  lat: number;
  lng: number;
  day_index: number | null;
  order_in_day: number | null;
  visit_duration_minutes: number;
}

interface SharedLeg {
  id: string;
  day_index: number;
  from_place_id: string;
  to_place_id: string;
  duration_seconds: number;
  distance_meters: number;
  polyline: string | null;
}

// ── Read-only content ────────────────────────────────────────────────────────
function SharedTripContent({
  trip,
  places,
  legs,
}: {
  trip: SharedTripMeta;
  places: SharedPlace[];
  legs: SharedLeg[];
}) {
  const t = useTheme();

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

  const byDay = useMemo(() => groupByDay(places), [places]);

  const legIndex = useMemo(() => {
    const m = new Map<string, SharedLeg>();
    for (const l of legs) m.set(`${l.day_index}|${l.from_place_id}|${l.to_place_id}`, l);
    return m;
  }, [legs]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      contentContainerStyle={{ paddingBottom: t.spacing.huge }}
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View
        style={{
          padding: t.spacing.lg,
          gap: t.spacing.xs,
          borderBottomWidth: 1,
          borderBottomColor: t.colors.border,
        }}
      >
        <Text
          style={[t.typography.title, { color: t.colors.text }]}
          accessibilityRole="header"
          aria-level={1}
        >
          {trip.title}
        </Text>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
          {formatRange(trip.start_date, trip.end_date)} · {trip.daily_hours_budget}h/day ·{' '}
          {trip.transport_mode}
        </Text>
        {/* Read-only badge — accessibilityRole="text" + label so VoiceOver/TalkBack
            announce this status explicitly rather than merging it into surrounding text. */}
        <View
          style={[
            styles.readOnlyBadge,
            {
              backgroundColor: t.colors.bgMuted,
              borderRadius: t.radius.pill,
              borderColor: t.colors.border,
              paddingHorizontal: t.spacing.sm,
              paddingVertical: t.spacing.xs,
              alignSelf: 'flex-start',
              marginTop: t.spacing.xs,
            },
          ]}
          accessibilityRole="text"
          accessibilityLabel="This is a read-only view of someone else's trip"
        >
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
            Read-only view
          </Text>
        </View>
      </View>

      {/* ── Map (auto-degrades to MapUnavailable on web when key missing) ──── */}
      <View style={styles.mapContainer}>
        <Map markers={markers} polylines={polylines} />
      </View>

      {/* ── Itinerary list ────────────────────────────────────────────────── */}
      <View style={{ padding: t.spacing.lg, gap: t.spacing.lg }}>
        {byDay.map((section) => (
          <View key={`day-${section.dayIndex}`} style={{ gap: t.spacing.sm }}>
            {/* Day header */}
            <View style={[styles.dayHeader, { borderColor: dayColor(section.dayIndex) }]}>
              <Text
                style={[t.typography.subtitle, { color: t.colors.text }]}
                accessibilityRole="header"
                aria-level={2}
              >
                {section.dayIndex < 0 ? 'Unscheduled' : `Day ${section.dayIndex + 1}`}
              </Text>
            </View>

            {/* Place rows — no drag handles, no duration steppers, no delete */}
            {section.places.map((place, idx) => {
              const next = section.places[idx + 1];
              const leg = next
                ? legIndex.get(`${section.dayIndex}|${place.id}|${next.id}`)
                : undefined;
              return (
                <View key={place.id} style={{ gap: t.spacing.xs }}>
                  <View
                    style={[
                      styles.placeCard,
                      {
                        borderColor: t.colors.border,
                        borderRadius: t.radius.md,
                        backgroundColor: t.colors.bgElevated,
                        padding: t.spacing.md,
                      },
                    ]}
                    accessible
                    accessibilityLabel={`${place.user_title ?? 'Place'}, ${place.visit_duration_minutes} minutes`}
                  >
                    <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
                      {place.user_title ?? 'Place'}
                    </Text>
                    <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                      {place.visit_duration_minutes} min
                    </Text>
                  </View>
                  {next ? (
                    <Text
                      style={[t.typography.small, { color: t.colors.textMuted, paddingHorizontal: 12 }]}
                    >
                      ↓ {leg ? formatTravel(leg.duration_seconds, leg.distance_meters) : 'travel time unknown'}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}
      </View>

      {/* ── Footer: Google attribution required when place data is shown ───── */}
      {places.length > 0 ? (
        <View style={{ paddingHorizontal: t.spacing.lg }}>
          <PoweredByGoogle />
        </View>
      ) : null}
    </ScrollView>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function groupByDay(places: SharedPlace[]): Array<{ dayIndex: number; places: SharedPlace[] }> {
  const map = new Map<number, SharedPlace[]>();
  for (const p of places) {
    const key = p.day_index ?? -1;
    const arr = map.get(key) ?? [];
    arr.push(p);
    map.set(key, arr);
  }
  for (const [, arr] of map) {
    arr.sort((a: SharedPlace, b: SharedPlace) => (a.order_in_day ?? 0) - (b.order_in_day ?? 0));
  }
  return [...map.entries()]
    .sort(([a]: [number, SharedPlace[]], [b]: [number, SharedPlace[]]) => a - b)
    .map(([dayIndex, ps]) => ({ dayIndex, places: ps }));
}

function formatRange(start: string | null, end: string | null): string {
  if (start && end) return `${start} → ${end}`;
  return start ?? end ?? 'Dates not set';
}

function formatTravel(seconds: number, meters: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  const km = meters / 1000;
  return `${mins} min · ${km.toFixed(km < 10 ? 1 : 0)} km`;
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mapContainer: { height: 300 },
  readOnlyBadge: { borderWidth: 1 },
  dayHeader: { borderLeftWidth: 4, paddingLeft: 12 },
  placeCard: { borderWidth: 1 },
});
