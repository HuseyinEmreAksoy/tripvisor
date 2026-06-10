/**
 * computeDayTimeline — pure client math for the itinerary timeline
 * (v2 Phase N1 step 1.2 — "time-first finally shows times").
 *
 * Given a day's start time (minutes since midnight), the day's places in
 * visit order, and the computed trip legs, derives each stop's arrival and
 * departure clock times:
 *
 *   arrival[0]   = dayStart
 *   departure[i] = arrival[i] + visit_duration_minutes[i]
 *   arrival[i+1] = departure[i] + legMinutes(place[i] → place[i+1])
 *
 * Graceful degradation: when a leg between two consecutive places hasn't
 * been computed yet (optimizer hasn't run, routing failed, place just
 * moved), that hop contributes ZERO travel time and the stop is flagged
 * `travelUnknown` — the timeline stays useful instead of disappearing.
 *
 * Pure + framework-free + no imports, so it's trivially unit-testable.
 *
 * Usage (ItineraryTab):
 *   const stops = computeDayTimeline({
 *     dayStartMinutes: parseStartTime(day.start_time),
 *     places: section.places,            // already in order_in_day order
 *     legs: legsForThatDay,              // or all trip legs — keyed by from→to
 *   });
 *   const stop = stops.get(place.id);
 *   // formatClockTime(stop.arrivalMinutes) → "10:00"
 */

/** Default day start when no `trip_days.start_time` exists: 09:00. */
export const DEFAULT_DAY_START_MINUTES = 9 * 60;

/** Minimal shape needed from a TripPlace (keeps the helper decoupled from @/api). */
export interface TimelinePlaceInput {
  id: string;
  visit_duration_minutes: number;
}

/** Minimal shape needed from a TripLeg. */
export interface TimelineLegInput {
  from_place_id: string;
  to_place_id: string;
  duration_seconds: number;
}

export interface TimelineStop {
  placeId: string;
  /** Minutes since the day's midnight (may exceed 1440 for degenerate days). */
  arrivalMinutes: number;
  /** arrivalMinutes + visit_duration_minutes. */
  departureMinutes: number;
  /**
   * True when the hop INTO this stop had no computed leg, so travel time was
   * counted as 0. The first stop of a day is never marked (no inbound hop).
   */
  travelUnknown: boolean;
}

/**
 * Parse a Postgres `time` value ("HH:MM:SS" or "HH:MM:SS.ffffff") or a bare
 * "HH:MM" into minutes-since-midnight. Anything unparseable (null, undefined,
 * malformed) returns `fallback` — the timeline must never crash on bad data.
 */
export function parseStartTime(
  value: string | null | undefined,
  fallback: number = DEFAULT_DAY_START_MINUTES,
): number {
  if (!value) return fallback;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim());
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fallback;
  return hours * 60 + minutes;
}

/**
 * Format minutes-since-midnight as a compact 24h clock label: "09:00",
 * "14:05". A day that arithmetically rolls past midnight gets a brief "+1"
 * suffix ("01:30 +1") rather than silently wrapping — honest and short,
 * matching formatDuration-style brevity.
 */
export function formatClockTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.round(totalMinutes));
  const dayWraps = Math.floor(clamped / 1440);
  const inDay = clamped % 1440;
  const h = Math.floor(inDay / 60);
  const m = inDay % 60;
  const base = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return dayWraps > 0 ? `${base} +${dayWraps}` : base;
}

/**
 * Serialize minutes-since-midnight to the "HH:MM" wire format expected by
 * the `trip_days.start_time` upsert (v2 migration 0020). Values are wrapped
 * into a single day since a *start* time past midnight is meaningless.
 */
export function minutesToTimeValue(totalMinutes: number): string {
  const wrapped = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Compute the arrival/departure timeline for one day.
 *
 * `places` MUST already be in visit order (the caller sorts by
 * `order_in_day`, exactly as the itinerary renders them). `legs` may be the
 * whole trip's legs — lookups are keyed `from_place_id→to_place_id`, and a
 * place belongs to at most one day, so cross-day collisions are impossible.
 *
 * Returns a Map keyed by place id for O(1) per-row lookup in render loops.
 */
export function computeDayTimeline(input: {
  dayStartMinutes: number;
  places: ReadonlyArray<TimelinePlaceInput>;
  legs: ReadonlyArray<TimelineLegInput>;
}): Map<string, TimelineStop> {
  const { dayStartMinutes, places, legs } = input;

  const legMinutesByHop = new Map<string, number>();
  for (const leg of legs) {
    legMinutesByHop.set(
      `${leg.from_place_id}|${leg.to_place_id}`,
      leg.duration_seconds / 60,
    );
  }

  const stops = new Map<string, TimelineStop>();
  let cursor = Math.max(0, dayStartMinutes);
  let previousId: string | null = null;

  for (const place of places) {
    let travelUnknown = false;
    if (previousId !== null) {
      const travel = legMinutesByHop.get(`${previousId}|${place.id}`);
      if (travel === undefined) {
        travelUnknown = true; // graceful: missing leg = skip travel time
      } else {
        cursor += travel;
      }
    }
    const arrivalMinutes = Math.round(cursor);
    const departureMinutes = Math.round(
      cursor + Math.max(0, place.visit_duration_minutes),
    );
    stops.set(place.id, {
      placeId: place.id,
      arrivalMinutes,
      departureMinutes,
      travelUnknown,
    });
    cursor = departureMinutes;
    previousId = place.id;
  }

  return stops;
}
