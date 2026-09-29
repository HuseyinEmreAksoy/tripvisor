/**
 * useLegModeActions — the write side of the per-leg transport UI (M5 Y3.3).
 *
 * C1 write path: a leg override touches ONLY `trip_places.arrival_mode` +
 * `arrival_minutes` (Tier-1, offline-safe, LWW); a day default touches ONLY
 * `trip_days.transport_mode` (online trip-days upsert — trip_days is a
 * read-only Tier-1 root). Legs themselves stay server-computed: after either
 * write we re-run optimize-trip with the trip's own `route_render_mode`
 * (never forcing 'optimized', which would re-cluster a hand-made order).
 *
 * The recompute is delayed a little so the Tier-1 place write can reach the
 * server first, and a 409 `already_optimizing` (the route shell's own run)
 * is retried after it settles. Offline, the optimize mutation pauses and
 * resumes on reconnect (TanStack networkMode 'online').
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useOptimizeTrip,
  useUpdateTripDay,
  useUpdateTripPlace,
  type LegTransportMode,
  type Trip,
  type TransportMode,
} from '@/api';
import { acceptsMinutes } from './legModes';

const RECOMPUTE_DELAY_MS = 1500;
const BUSY_RETRY_MS = 3000;
const MAX_BUSY_RETRIES = 2;

export type LegModeErrorKey = 'errors.saveFailed' | 'errors.dayOffline' | 'errors.recomputeFailed';

export interface LegModeActions {
  /** Set (or with `mode = null`, clear) the override of the leg arriving at `placeId`. */
  setLegMode: (placeId: string, mode: LegTransportMode | null, minutes: number | null) => Promise<boolean>;
  /** Set (or clear) a day's default mode. Online only. */
  setDayMode: (dayIndex: number, mode: TransportMode | null) => Promise<boolean>;
  saving: boolean;
  recomputing: boolean;
  /** `routes` namespace key of the last failure, or null. */
  errorKey: LegModeErrorKey | null;
  clearError: () => void;
}

export function useLegModeActions(
  trip: Pick<Trip, 'id' | 'route_render_mode'>,
  online: boolean,
): LegModeActions {
  const updatePlace = useUpdateTripPlace();
  const updateDay = useUpdateTripDay();
  const optimize = useOptimizeTrip();
  const [errorKey, setErrorKey] = useState<LegModeErrorKey | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tripRef = useRef(trip);
  tripRef.current = trip;
  const optimizeMutate = optimize.mutate;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const scheduleRecompute = useCallback(
    (delay: number, attempt = 0) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        const { id, route_render_mode } = tripRef.current;
        optimizeMutate(
          { tripId: id, mode: route_render_mode ?? 'optimized' },
          {
            onError: (err) => {
              const code = (err as { code?: unknown } | null)?.code;
              if (code === 'already_optimizing' && attempt < MAX_BUSY_RETRIES) {
                scheduleRecompute(BUSY_RETRY_MS, attempt + 1);
                return;
              }
              setErrorKey('errors.recomputeFailed');
            },
          },
        );
      }, delay);
    },
    [optimizeMutate],
  );

  const setLegMode = useCallback<LegModeActions['setLegMode']>(
    async (placeId, mode, minutes) => {
      setErrorKey(null);
      try {
        await updatePlace.mutateAsync({
          id: placeId,
          trip_id: tripRef.current.id,
          // Clearing the override clears both columns together.
          arrival_mode: mode,
          arrival_minutes: mode && acceptsMinutes(mode) ? minutes : null,
        });
      } catch {
        setErrorKey('errors.saveFailed');
        return false;
      }
      scheduleRecompute(RECOMPUTE_DELAY_MS);
      return true;
    },
    [updatePlace, scheduleRecompute],
  );

  const setDayMode = useCallback<LegModeActions['setDayMode']>(
    async (dayIndex, mode) => {
      setErrorKey(null);
      if (!online) {
        setErrorKey('errors.dayOffline');
        return false;
      }
      try {
        await updateDay.mutateAsync({
          trip_id: tripRef.current.id,
          day_index: dayIndex,
          transport_mode: mode,
        });
      } catch {
        setErrorKey('errors.saveFailed');
        return false;
      }
      // trip_days is server-written: no sync lag, recompute right away.
      scheduleRecompute(0);
      return true;
    },
    [online, updateDay, scheduleRecompute],
  );

  return {
    setLegMode,
    setDayMode,
    saving: updatePlace.isPending || updateDay.isPending,
    recomputing: optimize.isPending,
    errorKey,
    clearError: useCallback(() => setErrorKey(null), []),
  };
}
