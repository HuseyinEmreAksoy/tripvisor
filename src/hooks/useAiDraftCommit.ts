/**
 * useAiDraftCommit — orchestrates "accept the AI draft" into real rows
 * (v2 Phase N3 step 3.5). UI-flow composition over EXISTING src/api hooks —
 * no direct Supabase access, no new endpoints.
 *
 * Sequence (all owner-authorized via the normal hooks/RLS):
 *   1. `useCreateTrip`        — title from the review footer, transport mode
 *      from stage 1, daily_hours_budget 8 + detected timezone (mirrors
 *      trip/new.tsx defaults), start_date today+7d with end_date derived
 *      from the draft's day count so day labels/countdown work immediately.
 *   2. per kept place, sequentially (progress = "Adding i of n"):
 *      a. `useCreateTripPlace` — NOTE: its Zod schema has NO `day_index`
 *         (it would be silently stripped), so we conform and…
 *      b. `useMoveToDay`       — persist the review screen's day assignment
 *         (0-based, clamped) with an explicit `positionInDay` so the hook
 *         skips its internal max-order SELECT. Best-effort: if this UPDATE
 *         fails the place simply stays unassigned and the optimizer places
 *         it. Persisting matters because if optimize ALSO fails, day-less
 *         places would otherwise all land in the Ideas bucket.
 *      A failed INSERT is recorded in `failures` and the loop continues —
 *      partial-failure honesty, the trip is still created.
 *   3. `useOptimizeTrip` once (mode 'optimized') — the optimizer is the
 *      source of truth for the final day split/order, and pre-warming legs
 *      here makes arrival on /trip/[id] instant (the trip-detail screen's
 *      debounced auto-optimize then hits the server-side state-hash cache).
 *      Best-effort: a failure is logged, not fatal — trip-detail retries.
 *
 * Error contract: only step 1 is fatal (`commit()` returns null and exposes
 * `error`; nothing was created, so re-running is safe). Steps 2b/3 degrade
 * gracefully by design.
 */
import { useCallback, useRef, useState } from 'react';
import {
  useCreateTrip,
  useCreateTripPlace,
  useMoveToDay,
  useOptimizeTrip,
  type Trip,
  type TransportMode,
  type Uuid,
} from '@/api';
import type { DraftCommitPlace } from '@/components/ai-plan/types';

export type AiCommitPhase = 'idle' | 'creating' | 'adding' | 'optimizing';

export interface AiCommitArgs {
  /** Trimmed, 1..120 chars (validated by DraftReview). */
  title: string;
  transportMode: TransportMode;
  /** Draft day count — bounds day_index clamping and derives end_date. */
  dayCount: number;
  places: DraftCommitPlace[];
}

export interface AiCommitOutcome {
  tripId: Uuid;
  /** Names of places whose INSERT failed (trip still created). */
  failures: string[];
}

/** Local YYYY-MM-DD for `days` days from now (trips store plain dates). */
function isoDatePlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

const detectedTz =
  (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || null;

export function useAiDraftCommit() {
  const { mutateAsync: createTripAsync } = useCreateTrip();
  const { mutateAsync: createPlaceAsync } = useCreateTripPlace();
  const { mutateAsync: moveToDayAsync } = useMoveToDay();
  const { mutateAsync: optimizeAsync } = useOptimizeTrip();

  const [phase, setPhase] = useState<AiCommitPhase>('idle');
  const [added, setAdded] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  // Re-entrancy guard via ref: state updates are async, a double-tap could
  // otherwise start two commits (= two trips) before the first render lands.
  const inFlightRef = useRef(false);

  const commit = useCallback(
    async (args: AiCommitArgs): Promise<AiCommitOutcome | null> => {
      if (inFlightRef.current) return null;
      inFlightRef.current = true;
      setError(null);
      setAdded(0);
      setTotal(args.places.length);
      setPhase('creating');

      // ── 1. Create the trip (the only fatal step) ────────────────────────
      let trip: Trip;
      try {
        trip = await createTripAsync({
          title: args.title,
          start_date: isoDatePlusDays(7),
          end_date: isoDatePlusDays(7 + Math.max(0, args.dayCount - 1)),
          daily_hours_budget: 8,
          transport_mode: args.transportMode,
          timezone: detectedTz,
        });
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setPhase('idle');
        inFlightRef.current = false;
        return null;
      }

      // ── 2. Insert kept places sequentially, day-assign best-effort ─────
      setPhase('adding');
      const failures: string[] = [];
      const perDayPosition = new Map<number, number>();
      for (const [i, p] of args.places.entries()) {
        try {
          const row = await createPlaceAsync({
            trip_id: trip.id,
            google_place_id: p.googlePlaceId,
            user_title: p.name,
            category: p.category,
            lat: p.lat,
            lng: p.lng,
            visit_duration_minutes: p.visitMinutes,
          });
          const dayIndex = clamp(p.dayHint - 1, 0, Math.max(0, args.dayCount - 1));
          try {
            const positionInDay = perDayPosition.get(dayIndex) ?? 0;
            await moveToDayAsync({
              id: row.id,
              tripId: trip.id,
              toDayIndex: dayIndex,
              positionInDay,
            });
            perDayPosition.set(dayIndex, positionInDay + 1);
          } catch (moveErr) {
            // Non-fatal: the place exists; the optimizer assigns a day next.
            console.warn(
              `[useAiDraftCommit] day assignment failed for "${p.name}" — optimizer will place it`,
              moveErr,
            );
          }
        } catch (createErr) {
          console.warn(`[useAiDraftCommit] failed to add "${p.name}"`, createErr);
          failures.push(p.name);
        }
        setAdded(i + 1);
      }

      // ── 3. One optimize pass — source of truth for the final day split ──
      setPhase('optimizing');
      if (args.places.length - failures.length >= 2) {
        try {
          await optimizeAsync({ tripId: trip.id, mode: 'optimized' });
        } catch (optimizeErr) {
          // Best-effort: trip-detail's debounced auto-optimize retries on
          // arrival, so we don't block or fail the commit on this.
          console.warn('[useAiDraftCommit] optimize failed — trip detail will retry', optimizeErr);
        }
      }

      // Phase intentionally left at 'optimizing': the caller switches stage
      // on resolve; resetting here would flash "Creating…" for one frame.
      inFlightRef.current = false;
      return { tripId: trip.id, failures };
    },
    [createTripAsync, createPlaceAsync, moveToDayAsync, optimizeAsync],
  );

  return { commit, phase, added, total, error };
}
