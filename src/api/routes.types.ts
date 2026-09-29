/**
 * M5 Y2.3: per-leg transport modes: client-side types and pure helpers for
 * the `optimize-trip` contract (meta.contractVersion 2) and `trip_legs` rows.
 *
 * Server: supabase/functions/optimize-trip/{index,legs}.ts. The column-level
 * types (`LegTransportMode`, `TripLegSource`, `TripLeg.source`,
 * `TripPlace.arrival_mode/arrival_minutes`, `TripDay.transport_mode`) live in
 * `./types` (Y1.1); this file only adds what the optimize contract and the
 * UI (Y3.3) need on top. Pure: no supabase / React imports, so it is safe to
 * import from tests and from render code alike.
 *
 * Rules the UI must mirror (all decided server-side, restated for display):
 *   - Effective mode of the leg ARRIVING at a place:
 *       place.arrival_mode ?? day.transport_mode ?? trip.transport_mode
 *     The FIRST place of a day has no inbound leg; its arrival_mode does
 *     nothing (don't draw a leg chip before the first stop).
 *   - `arrival_minutes` only counts while `arrival_mode` is set (clear both
 *     together). With minutes the leg is `source: 'user'` and never routed.
 *   - `source: 'estimate'` = no routing API answered (flight/ferry without
 *     minutes, transit over quota / kill switch, upstream failure). Show the
 *     duration with "≈". Its polyline is null: draw a straight (flight: arc)
 *     line between the two stops.
 *   - In 'optimized' mode, a day holding a place that arrives by flight or
 *     ferry keeps the user's order; the response lists it in `keptOrderDays`.
 */
import type { LegTransportMode, TransportMode, TripLeg, TripLegSource } from './types';

/** `meta.contractVersion` of the current optimize-trip. v1 servers send no `meta`. */
export const OPTIMIZE_CONTRACT_VERSION = 2;

/** Day legs written by one optimize run, counted by `trip_legs.source`. */
export type OptimizeLegSources = Record<TripLegSource, number>;

/**
 * Fields optimize-trip added in contractVersion 2 (M5 Y2.3). All optional on
 * the client type: a response from an older deployment omits them.
 */
export interface OptimizeResultLegFields {
  /**
   * Days whose order was KEPT because they hold a flight/ferry arrival
   * ('optimized' mode only; always [] in 'manual', where every day keeps
   * its order anyway). Drives the "Kept your order because this day has a
   * flight" note.
   */
  keptOrderDays?: number[];
  /** Counts of the day legs written, by source. */
  legSources?: OptimizeLegSources;
  meta?: { contractVersion: number };
}

/** Modes no routing API computes; a day containing one keeps its order when optimizing. */
export const KEPT_ORDER_LEG_MODES: readonly LegTransportMode[] = ['flight', 'ferry'];

const LEG_MODES: ReadonlySet<string> = new Set([
  'driving',
  'walking',
  'transit',
  'bicycling',
  'flight',
  'ferry',
]);
const DAY_MODES: ReadonlySet<string> = new Set(['driving', 'walking', 'transit', 'bicycling']);

/** True for flight/ferry: never routed, and they pin their day's order. */
export function isKeptOrderLegMode(mode: string | null | undefined): boolean {
  return mode === 'flight' || mode === 'ferry';
}

/**
 * Same rule as the server (optimize-trip/legs.ts effectiveLegMode):
 * `arrivalMode ?? dayMode ?? tripMode`, where unknown values inherit and
 * flight/ferry are never a day default. Use it for optimistic display
 * before the recompute lands (the server writes the effective mode to
 * `trip_legs.transport_mode`).
 */
export function effectiveLegMode(
  arrivalMode: string | null | undefined,
  dayMode: string | null | undefined,
  tripMode: TransportMode,
): LegTransportMode {
  if (arrivalMode && LEG_MODES.has(arrivalMode)) return arrivalMode as LegTransportMode;
  if (dayMode && DAY_MODES.has(dayMode)) return dayMode as TransportMode;
  return tripMode;
}

/** Duration came from a distance estimate: render it with "≈". */
export function isEstimatedLeg(leg: Pick<TripLeg, 'source'>): boolean {
  return leg.source === 'estimate';
}

/** Duration is the user's own `arrival_minutes`. */
export function isUserTimedLeg(leg: Pick<TripLeg, 'source'>): boolean {
  return leg.source === 'user';
}

/**
 * A day leg (drawn and timed), as opposed to an optimizer matrix-cache row
 * (`day_index = -1`), which is never rendered.
 */
export function isDayLeg(leg: Pick<TripLeg, 'day_index'>): boolean {
  return leg.day_index >= 0;
}

/**
 * Stable order for from→to lookups (computeDayTimeline, leg indexes built
 * with last-wins Map.set): matrix-cache rows first, day legs after, so a
 * day leg always wins over a cache row for the same pair (their modes can
 * differ once a leg overrides its day's mode). Returns a new array.
 */
export function orderLegsForHopLookup<T extends Pick<TripLeg, 'day_index'>>(legs: readonly T[]): T[] {
  return legs
    .map((leg, i) => ({ leg, i }))
    .sort((a, b) => (isDayLeg(a.leg) ? 1 : 0) - (isDayLeg(b.leg) ? 1 : 0) || a.i - b.i)
    .map(({ leg }) => leg);
}

/** The day legs of one day, in the order the server wrote them. */
export function dayLegsFor<T extends Pick<TripLeg, 'day_index'>>(legs: readonly T[], dayIndex: number): T[] {
  return legs.filter((leg) => leg.day_index === dayIndex && dayIndex >= 0);
}

/** `keptOrderDays` as a Set (empty for older servers / manual mode). */
export function keptOrderDaySet(result: OptimizeResultLegFields | null | undefined): Set<number> {
  return new Set(result?.keptOrderDays ?? []);
}
