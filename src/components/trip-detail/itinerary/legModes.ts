/**
 * legModes — pure helpers for the per-leg transport UI (M5 Y3.3).
 *
 * The rules mirror optimize-trip (Y2.3, restated in src/api/routes.types.ts):
 *   - A leg belongs to the place it ARRIVES at: its override lives on
 *     `to_place.arrival_mode` / `arrival_minutes`. The first stop of a day
 *     has no inbound leg, so no chip is ever drawn before it.
 *   - Effective mode = arrival_mode ?? day.transport_mode ?? trip.transport_mode.
 *   - flight / ferry are per-leg only and only between SCHEDULED stops.
 *   - Clearing an override clears arrival_mode AND arrival_minutes together.
 *   - A day holding a flight/ferry arrival keeps the user's order in
 *     'optimized' mode (the server's `keptOrderDays`).
 * No React, no i18n: callers translate `routes:mode.<mode>` themselves.
 */
import type { IconName } from '@/components/Icon';
// Pure modules only (no supabase client) so this file stays test-light.
import {
  effectiveLegMode,
  isEstimatedLeg,
  isKeptOrderLegMode,
  isUserTimedLeg,
} from '@/api/routes.types';
import type {
  LegTransportMode,
  RouteRenderMode,
  TransportMode,
  TripLeg,
  TripPlace,
} from '@/api/types';

export const DAY_MODES: readonly TransportMode[] = ['driving', 'walking', 'bicycling', 'transit'];
export const LEG_MODES: readonly LegTransportMode[] = [...DAY_MODES, 'flight', 'ferry'];

export const LEG_MODE_ICON: Record<LegTransportMode, IconName> = {
  driving: 'car',
  walking: 'footprints',
  bicycling: 'bike',
  transit: 'train-front',
  flight: 'plane',
  ferry: 'waves',
};

/** Modes whose duration the user may type in (flight, ferry, transit). */
export function acceptsMinutes(mode: LegTransportMode): boolean {
  return mode === 'flight' || mode === 'ferry' || mode === 'transit';
}

/** Mode choices for a leg: flight/ferry only between scheduled stops. */
export function legModeOptions(scheduled: boolean): readonly LegTransportMode[] {
  return scheduled ? LEG_MODES : DAY_MODES;
}

/** Valid `arrival_minutes`: an integer 1–1440 (the DB CHECK), else null. */
export function parseLegMinutes(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= 1 && n <= 24 * 60 ? n : null;
}

/** What the leg chip shows for the leg ARRIVING at `toPlace`. */
export interface LegChipModel {
  /** The mode the chip displays: the fresh leg's mode, else the optimistic effective mode. */
  mode: LegTransportMode;
  /** The user overrode this leg (arrival_mode set). */
  overridden: boolean;
  /** Duration in minutes, or null while no leg is computed yet. */
  minutes: number | null;
  distanceMeters: number | null;
  /** Show "≈": estimated leg, or a leg computed for a different mode than the one now chosen. */
  estimated: boolean;
  /** The duration is the user's own minutes. */
  userTimed: boolean;
  /** A recompute is due (the stored leg was computed for another mode). */
  stale: boolean;
}

export function buildLegChipModel(input: {
  leg: TripLeg | undefined;
  toPlace: Pick<TripPlace, 'arrival_mode' | 'arrival_minutes'>;
  dayMode: TransportMode | null | undefined;
  tripMode: TransportMode;
}): LegChipModel {
  const { leg, toPlace, dayMode, tripMode } = input;
  const mode = effectiveLegMode(toPlace.arrival_mode, dayMode, tripMode);
  const overridden = Boolean(toPlace.arrival_mode);
  const stale = leg !== undefined && leg.transport_mode !== mode;
  // While stale, a user-typed duration is already known; otherwise keep the
  // old leg's numbers but mark them approximate until the recompute lands.
  const userMinutes = overridden && toPlace.arrival_minutes ? toPlace.arrival_minutes : null;
  if (!leg) {
    return {
      mode,
      overridden,
      minutes: userMinutes,
      distanceMeters: null,
      estimated: false,
      userTimed: userMinutes !== null,
      stale: false,
    };
  }
  if (stale && userMinutes !== null) {
    return {
      mode,
      overridden,
      minutes: userMinutes,
      distanceMeters: leg.distance_meters,
      estimated: false,
      userTimed: true,
      stale,
    };
  }
  return {
    mode,
    overridden,
    minutes: Math.round(leg.duration_seconds / 60),
    distanceMeters: leg.distance_meters,
    estimated: isEstimatedLeg(leg) || stale,
    userTimed: !stale && isUserTimedLeg(leg),
    stale,
  };
}

/** A read-only chip straight from a stored leg (its own mode), for callers without place context. */
export function legChipFromLeg(leg: TripLeg | undefined, fallbackMode: TransportMode): LegChipModel {
  const mode: LegTransportMode = leg?.transport_mode ?? fallbackMode;
  return {
    mode,
    overridden: false,
    minutes: leg ? Math.round(leg.duration_seconds / 60) : null,
    distanceMeters: leg ? leg.distance_meters : null,
    estimated: leg ? isEstimatedLeg(leg) : false,
    userTimed: leg ? isUserTimedLeg(leg) : false,
    stale: false,
  };
}

/**
 * Days whose order the optimizer keeps (mirror of the server's
 * `keptOrderDayIndexes`): 'optimized' mode only — in 'manual' every day
 * keeps its order anyway, so the note would say nothing.
 */
export function keptOrderDays(
  places: ReadonlyArray<Pick<TripPlace, 'day_index' | 'arrival_mode'>>,
  renderMode: RouteRenderMode,
): Map<number, 'flight' | 'ferry'> {
  const out = new Map<number, 'flight' | 'ferry'>();
  if (renderMode !== 'optimized') return out;
  for (const p of places) {
    if (p.day_index === null || p.day_index < 0) continue;
    if (!isKeptOrderLegMode(p.arrival_mode)) continue;
    // A flight wins the label over a ferry on the same day.
    if (p.arrival_mode === 'flight' || !out.has(p.day_index)) {
      out.set(p.day_index, p.arrival_mode as 'flight' | 'ferry');
    }
  }
  return out;
}
