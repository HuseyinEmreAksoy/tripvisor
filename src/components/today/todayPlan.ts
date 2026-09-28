/**
 * todayPlan — pure helpers behind the Today tab (v2 M4 X2.1).
 *
 * No React, no I/O, no network — everything here is unit-tested in
 * `__tests__/todayPlan.test.ts`:
 *   - selectNextStop: which stop is "next" given the clock, the computed
 *     day timeline and this device's check-offs,
 *   - haversine + approxTravelMinutes: the "≈ N min from you" estimate
 *     (straight-line distance at a typical speed for the trip's transport
 *     mode — NO routing call, NO Google, labeled approximate in the UI),
 *   - staysForNight: the accommodation(s) covering a given night (the same
 *     rule as StayingAtPill: check_in ≤ date < check_out),
 *   - small formatters (minutes-left copy, address directions URL).
 *
 * Clock values are minutes since the local midnight, matching
 * computeDayTimeline's `arrivalMinutes` / `departureMinutes`.
 */
import type { TransportMode } from '@/api/types';

// ---------------------------------------------------------------------------
// Next-stop selection
// ---------------------------------------------------------------------------

export type CheckoffStatus = 'done' | 'skipped';

/** One timeline stop, in visit order. */
export interface PlanStop {
  placeId: string;
  arrivalMinutes: number;
  departureMinutes: number;
}

export type NextStopResult =
  /** No stops scheduled today. */
  | { kind: 'empty' }
  /** Every stop is checked off (done or skipped) on this device. */
  | { kind: 'finished' }
  | {
      kind: 'next';
      stop: PlanStop;
      /** Index of the stop in the day's visit order. */
      index: number;
      /**
       * 'upcoming' = before planned arrival; 'now' = inside the planned visit
       * window; 'late' = the planned departure has passed but the stop was
       * never checked off (the traveller is running behind).
       */
      phase: 'now' | 'upcoming' | 'late';
      /** Minutes until planned arrival ('upcoming') or departure ('now'); 0 when 'late'. */
      minutesLeft: number;
      /** Minutes past the planned departure ('late'); 0 otherwise. */
      minutesLate: number;
      /** Unchecked stops left today, this one included. */
      remainingUnchecked: number;
    };

/**
 * The next stop for the traveller:
 *   1. checked-off stops (done or skipped on this device) never count,
 *   2. the earliest unchecked stop in visit order is next — even when its
 *      planned departure has already passed ('late'): a traveller who is
 *      behind schedule still gets Navigate to where they were heading, plus
 *      a running-late hint, instead of the clock silently skipping stops,
 *   3. nothing unchecked → 'finished'.
 */
export function selectNextStop(input: {
  stops: ReadonlyArray<PlanStop>;
  nowMinutes: number;
  checkoffs: Readonly<Record<string, CheckoffStatus | undefined>>;
}): NextStopResult {
  const { stops, nowMinutes, checkoffs } = input;
  if (stops.length === 0) return { kind: 'empty' };

  const index = stops.findIndex((s) => !checkoffs[s.placeId]);
  if (index < 0) return { kind: 'finished' };
  const stop = stops[index]!;
  const remainingUnchecked = stops.filter((s) => !checkoffs[s.placeId]).length;

  if (stop.departureMinutes <= nowMinutes) {
    return {
      kind: 'next',
      stop,
      index,
      phase: 'late',
      minutesLeft: 0,
      minutesLate: Math.round(nowMinutes - stop.departureMinutes),
      remainingUnchecked,
    };
  }
  const inWindow = stop.arrivalMinutes <= nowMinutes;
  return {
    kind: 'next',
    stop,
    index,
    phase: inWindow ? 'now' : 'upcoming',
    minutesLeft: Math.max(0, Math.round((inWindow ? stop.departureMinutes : stop.arrivalMinutes) - nowMinutes)),
    minutesLate: 0,
    remainingUnchecked,
  };
}

/** Minutes since local midnight for `date`. */
export function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** "now", "5 min", "1 h", "2 h 10 min". */
export function formatMinutesLeft(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m === 0) return 'now';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

// ---------------------------------------------------------------------------
// Approximate distance / travel time (no routing calls)
// ---------------------------------------------------------------------------

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Typical door-to-door urban speeds (km/h) — deliberately conservative. */
export const APPROX_SPEED_KMH: Record<TransportMode, number> = {
  walking: 4.5,
  bicycling: 14,
  transit: 18,
  driving: 28,
};

/** Streets aren't straight lines: inflate the crow-flies distance. */
export const DETOUR_FACTOR = 1.3;

/**
 * Rough travel minutes between two points at the mode's typical speed.
 * Always ≥ 1. The UI must label it approximate ("≈ 12 min from you").
 */
export function approxTravelMinutes(from: LatLng, to: LatLng, mode: TransportMode): number {
  const km = haversineKm(from, to) * DETOUR_FACTOR;
  const minutes = (km / APPROX_SPEED_KMH[mode]) * 60;
  return Math.max(1, Math.round(minutes));
}

// ---------------------------------------------------------------------------
// Stays
// ---------------------------------------------------------------------------

export interface NightStay {
  check_in_date: string;
  check_out_date: string;
  deleted?: boolean;
}

/**
 * Accommodations covering the night of `date` ('YYYY-MM-DD'):
 * check_in_date ≤ date < check_out_date — the StayingAtPill rule, applied to
 * a local calendar date string (plain string compare; the format is
 * fixed-width, so lexical order is calendar order).
 */
export function staysForNight<T extends NightStay>(stays: ReadonlyArray<T>, date: string): T[] {
  return stays.filter((s) => !s.deleted && s.check_in_date <= date && date < s.check_out_date);
}

/**
 * Inclusive day count of a trip from its 'YYYY-MM-DD' dates (a missing end
 * means a one-day trip). Null when the start date is missing/malformed.
 */
export function tripDayCount(start: string | null, end: string | null): number | null {
  const parse = (value: string | null): number | null => {
    const m = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : null;
  };
  const s = parse(start);
  if (s === null) return null;
  const e = parse(end) ?? s;
  return Math.max(1, Math.round(e - s) + 1);
}

/** Directions to a free-text address (stays without coordinates). */
export function buildAddressDirectionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}
