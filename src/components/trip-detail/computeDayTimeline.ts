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
 * v2 P1.1b — user-set time windows (trip_places.arrive_after /
 * leave_before, migration 0023) overlay the same pass:
 *
 *   - arrival < arrive_after  → the stop WAITS: effective arrival is pushed
 *     to the window start (`waitUntilMinutes` set), and every downstream
 *     time shifts accordingly (the cursor advances through the wait).
 *   - arrival  > leave_before → `conflict: 'arrives_late'`
 *   - departure > leave_before → `conflict: 'overruns'`
 *
 * Windows are WARNING-ONLY (ux-principles: non-blocking, user can always
 * override/ignore) — nothing is clamped except the wait push, and the
 * optimizer does not consume them in P1. Window values are user-confirmed
 * input only, never Google opening hours (ToS invariant — see
 * src/api/types.ts TripPlace.arrive_after).
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
  /**
   * v2 P1.1b: optional user-set window bounds, in the Postgres `time` wire
   * shape ('HH:MM:SS' / 'HH:MM'). Field names intentionally match TripPlace
   * so callers can pass rows straight through. Absent/null/unparseable
   * values mean "no constraint".
   */
  arrive_after?: string | null;
  leave_before?: string | null;
  /**
   * T1 editable timeline (migration 0025): user-pinned arrival time, same
   * wire shape. The cursor JUMPS to the pin when it's reachable; an
   * unreachable pin (computed arrival already past it) flags
   * `conflict: 'pinned_tight'` without rewinding time.
   */
  pinned_start?: string | null;
}

/**
 * Why a stop's schedule is in tension: a user-set window violation
 * (v2 P1.1b) or an unreachable user-pinned arrival (T1).
 */
export type TimelineConflict = 'arrives_late' | 'overruns' | 'pinned_tight';

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
  /**
   * v2 P1.1b: when the raw arrival fell before the place's `arrive_after`
   * window, the effective arrival was pushed to the window start and this
   * holds that start (minutes since midnight). Null = no wait. UI renders
   * an info chip ("waits until 10:00"); downstream stops already include
   * the wait because the cursor advanced through it.
   */
  waitUntilMinutes: number | null;
  /**
   * v2 P1.1b: non-null when the stop violates its `leave_before` window —
   * 'arrives_late' (arrival is already past the window end) or 'overruns'
   * (arrives in time but the visit runs past the end). Warning-only; times
   * are NOT clamped.
   */
  conflict: TimelineConflict | null;
  /**
   * v2 P1.1b: parsed `leave_before` (minutes since midnight) so warning copy
   * ("window ends 18:00") needs no re-parse at render time. Null when the
   * place has no leave_before window.
   */
  windowEndMinutes: number | null;
  /**
   * T1: parsed `pinned_start` (minutes since midnight). Non-null whenever the
   * user pinned this stop — the UI renders the arrival as a pinned chip, and
   * `conflict === 'pinned_tight'` means the day flow can't reach the pin.
   */
  pinnedStartMinutes: number | null;
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
 * v2 P1.1b: strict variant of {@link parseStartTime} — parses a Postgres
 * `time` value ('HH:MM:SS', 'HH:MM:SS.ffffff') or bare 'HH:MM' into
 * minutes-since-midnight, returning NULL (instead of a fallback) for
 * null/undefined/malformed input. Used wherever "no value" must stay
 * distinguishable from "09:00" (time-window bounds, window chips).
 */
export function parseTimeOfDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = parseStartTime(value, -1);
  return parsed < 0 ? null : parsed;
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

    // ── T1: user-pinned arrival ("be here at 14:00") ─────────────────────
    // Applied before the window overlay — the pin is the user's explicit
    // schedule. Reachable pin = the cursor jumps forward to it (downstream
    // stops shift through the gap). Unreachable pin (flow already past it)
    // keeps the computed arrival and flags 'pinned_tight' — time is never
    // rewound, warnings never block (ux-principles).
    const pinnedStart = parseTimeOfDay(place.pinned_start);
    let pinnedTight = false;
    if (pinnedStart !== null) {
      if (cursor <= pinnedStart) cursor = pinnedStart;
      else pinnedTight = true;
    }

    // ── v2 P1.1b: user-set time window overlay ───────────────────────────
    const arriveAfter = parseTimeOfDay(place.arrive_after);
    const leaveBefore = parseTimeOfDay(place.leave_before);

    // Wait: arriving before the window opens pushes the effective arrival
    // to the window start; downstream stops shift via the advanced cursor.
    // (A pin that already advanced the cursor past the window start simply
    // produces no wait.)
    let waitUntilMinutes: number | null = null;
    if (arriveAfter !== null && cursor < arriveAfter) {
      waitUntilMinutes = arriveAfter;
      cursor = arriveAfter;
    }

    const arrivalMinutes = Math.round(cursor);
    const departureMinutes = Math.round(
      cursor + Math.max(0, place.visit_duration_minutes),
    );

    // Conflict: warning-only, nothing clamped (user can always ignore).
    // Window violations outrank the pin message — they mean the place may
    // literally be closed; the pin tension is schedule-internal.
    let conflict: TimelineConflict | null = null;
    if (leaveBefore !== null) {
      if (arrivalMinutes > leaveBefore) conflict = 'arrives_late';
      else if (departureMinutes > leaveBefore) conflict = 'overruns';
    }
    if (conflict === null && pinnedTight) conflict = 'pinned_tight';

    stops.set(place.id, {
      placeId: place.id,
      arrivalMinutes,
      departureMinutes,
      travelUnknown,
      waitUntilMinutes,
      conflict,
      windowEndMinutes: leaveBefore,
      pinnedStartMinutes: pinnedStart,
    });
    cursor = departureMinutes;
    previousId = place.id;
  }

  return stops;
}
