/**
 * useAiEditApply — orchestrates "apply the AI edit diff" into real rows, plus
 * a one-shot in-memory UNDO (v2 Phase N4 step 4.1). UI-flow composition over
 * EXISTING src/api hooks — no direct Supabase access, no new endpoints.
 * Mirrors useAiDraftCommit (N3) in structure and failure posture.
 *
 * APPLY sequence (ops re-sorted defensively: creates → removes → moves →
 * duration changes; progress = "Applying i of n"):
 *   - add      → `useCreateTripPlace`, then best-effort `useMoveToDay` to
 *                `dayHint - 1` (dayHint is 1-BASED — the AI-surface
 *                convention; the optimizer re-places it if the move fails).
 *   - remove   → full `TripPlace` row is captured from the caller-supplied
 *                `places` snapshot BEFORE `useDeleteTripPlace` runs — undo
 *                re-creates from that snapshot.
 *   - move     → original `day_index` / `order_in_day` captured, then
 *                `useMoveToDay` to `toDay - 1` (toDay is 1-BASED).
 *   - duration → original `visit_duration_minutes` captured, then
 *                `useUpdateTripPlace`.
 *   Any single failed op is recorded in `failures` and the loop continues —
 *   partial-failure honesty (ux-principles: forgiving, never silent).
 *   Finally ONE `useOptimizeTrip` (mode = the trip's render mode), skipped
 *   when fewer than 2 places remain; best-effort — the trip-detail screen's
 *   debounced auto-optimize retries anyway because the place set changed.
 *
 * UNDO (first-class, one tap, local to the sheet session — no global system):
 *   Replays the in-memory journal of SUCCESSFUL ops in reverse:
 *   delete created ids → re-create captured removed rows (incl. their
 *   original day via moveToDay) → reverse moves → restore durations; then one
 *   re-optimize. The journal is one-shot: a new apply (or a completed undo)
 *   clears it. KNOWN LIMITS, surfaced honestly in `failures` rather than
 *   silently skipped:
 *     - a place that was in Ideas (day_index NULL) before an AI move cannot
 *       be returned to Ideas — no existing hook writes day_index = NULL;
 *     - re-created rows get new ids, so comments/reactions on the originals
 *       (cascade-deleted with them) do not come back.
 */
import { useCallback, useRef, useState } from 'react';
import {
  useCreateTripPlace,
  useDeleteTripPlace,
  useMoveToDay,
  useOptimizeTrip,
  useUpdateTripPlace,
  type RouteRenderMode,
  type TripPlace,
  type Uuid,
} from '@/api';
import type { AiEditOp } from '@/components/ai-edit/types';
import { scheduleOnDayWithRetry } from './useAiScheduleOnDay';

export type AiEditApplyPhase = 'idle' | 'applying' | 'optimizing' | 'undoing';

export interface AiEditFailure {
  /** Human description of the change ("Remove Musée d'Orsay"). */
  label: string;
  message: string;
}

export interface AiEditApplyArgs {
  tripId: Uuid;
  /**
   * The trip's CURRENT places (the route shell's useTripPlaces data). Undo
   * snapshots of pending removes and original day/duration values are
   * captured from here BEFORE anything is written.
   */
  places: TripPlace[];
  /** The user-included diff rows, as ops. */
  ops: AiEditOp[];
  /** Trip's render mode — passed to the final optimize so manual stays manual. */
  routeRenderMode: RouteRenderMode;
}

export interface AiEditApplyOutcome {
  /** Ops that landed (total - failures). */
  applied: number;
  failures: AiEditFailure[];
  /** True when at least one change landed — enables "Undo these changes". */
  canUndo: boolean;
}

export interface AiEditUndoOutcome {
  reverted: number;
  failures: AiEditFailure[];
}

/** Journal of successful ops, recorded during apply for the inverse replay. */
type UndoEntry =
  | { kind: 'delete-created'; id: Uuid; name: string }
  | { kind: 'recreate-removed'; row: TripPlace }
  | {
      kind: 'reverse-move';
      id: Uuid;
      name: string;
      fromDayIndex: number | null;
      fromOrder: number | null;
    }
  | { kind: 'restore-duration'; id: Uuid; name: string; minutes: number };

interface UndoJournal {
  tripId: Uuid;
  routeRenderMode: RouteRenderMode;
  /** Place count before apply — undo's optimize is skipped when it's < 2. */
  placeCountBefore: number;
  entries: UndoEntry[];
}

/** Spec order: creates, then removes, then moves, then duration changes. */
const KIND_ORDER: Record<AiEditOp['kind'], number> = {
  add: 0,
  remove: 1,
  move: 2,
  duration: 3,
};

/** The ai-edit function validates visit minutes to 15..480; keep that window. */
function clampMinutes(v: number): number {
  return Math.max(15, Math.min(480, Math.round(v)));
}

function opLabel(op: AiEditOp): string {
  switch (op.kind) {
    case 'add':
      return `Add ${op.place.name}`;
    case 'remove':
      return `Remove ${op.name}`;
    case 'move':
      return `Move ${op.name} to Day ${op.toDay}`;
    case 'duration':
      return `Change ${op.name} to ${op.visitMinutes} min`;
  }
}

function undoLabel(entry: UndoEntry): string {
  switch (entry.kind) {
    case 'delete-created':
      return `Remove ${entry.name} again`;
    case 'recreate-removed':
      return `Restore ${entry.row.user_title ?? 'removed place'}`;
    case 'reverse-move':
      return `Move ${entry.name} back`;
    case 'restore-duration':
      return `Restore ${entry.name} to ${entry.minutes} min`;
  }
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export function useAiEditApply() {
  const { mutateAsync: createPlaceAsync } = useCreateTripPlace();
  const { mutateAsync: deletePlaceAsync } = useDeleteTripPlace();
  const { mutateAsync: moveToDayAsync } = useMoveToDay();
  const { mutateAsync: updatePlaceAsync } = useUpdateTripPlace();
  const { mutateAsync: optimizeAsync } = useOptimizeTrip();

  const [phase, setPhase] = useState<AiEditApplyPhase>('idle');
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  // Re-entrancy guard via ref (state updates are async; a double-tap could
  // otherwise start two sequences) — same pattern as useAiDraftCommit.
  const inFlightRef = useRef(false);
  // One-shot in-memory undo journal — local to this hook instance (the sheet
  // session); deliberately NOT a global undo system.
  const journalRef = useRef<UndoJournal | null>(null);

  const apply = useCallback(
    async (args: AiEditApplyArgs): Promise<AiEditApplyOutcome | null> => {
      if (inFlightRef.current) return null;
      inFlightRef.current = true;
      journalRef.current = null; // a new apply invalidates any earlier undo window

      const ordered = [...args.ops].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
      setDone(0);
      setTotal(ordered.length);
      setPhase('applying');

      const byId = new Map(args.places.map((p) => [p.id, p]));
      const entries: UndoEntry[] = [];
      const failures: AiEditFailure[] = [];
      let createdOk = 0;
      let removedOk = 0;
      // Ops that landed but only partly (added, yet stuck in Ideas) — reported
      // in `failures` but still counted as applied.
      let softFailures = 0;

      for (const [i, op] of ordered.entries()) {
        try {
          if (op.kind === 'add') {
            const row = await createPlaceAsync({
              trip_id: args.tripId,
              google_place_id: op.place.googlePlaceId,
              user_title: op.place.name,
              category: op.place.category,
              lat: op.place.lat,
              lng: op.place.lng,
              visit_duration_minutes: clampMinutes(op.place.visitMinutes),
            });
            entries.push({ kind: 'delete-created', id: row.id, name: op.place.name });
            createdOk += 1;
            // dayHint is 1-based (AI-surface convention) → 0-based day_index.
            // Retried: with Tier-1 sync the create's server INSERT is queued,
            // so an immediate move can race it (see useAiScheduleOnDay).
            const scheduled = await scheduleOnDayWithRetry(moveToDayAsync, {
              id: row.id,
              tripId: args.tripId,
              toDayIndex: Math.max(0, op.place.dayHint - 1),
            });
            if (!scheduled) {
              // The place exists but sits in Ideas — say so (manual mode never
              // schedules day_index NULL places on its own).
              softFailures += 1;
              failures.push({
                label: opLabel(op),
                message: `added to Ideas — couldn't schedule it on Day ${op.place.dayHint}`,
              });
            }
          } else if (op.kind === 'remove') {
            const row = byId.get(op.tripPlaceId);
            if (!row) throw new Error('this place is no longer in the trip');
            // Snapshot captured BEFORE the delete — undo re-creates from it.
            await deletePlaceAsync({ id: op.tripPlaceId, trip_id: args.tripId });
            entries.push({ kind: 'recreate-removed', row });
            removedOk += 1;
          } else if (op.kind === 'move') {
            const row = byId.get(op.tripPlaceId);
            if (!row) throw new Error('this place is no longer in the trip');
            await moveToDayAsync({
              id: op.tripPlaceId,
              tripId: args.tripId,
              // toDay is 1-based (AI-surface convention) → 0-based day_index.
              toDayIndex: Math.max(0, op.toDay - 1),
            });
            entries.push({
              kind: 'reverse-move',
              id: op.tripPlaceId,
              name: op.name,
              fromDayIndex: row.day_index,
              fromOrder: row.order_in_day,
            });
          } else {
            const row = byId.get(op.tripPlaceId);
            if (!row) throw new Error('this place is no longer in the trip');
            await updatePlaceAsync({
              id: op.tripPlaceId,
              trip_id: args.tripId,
              visit_duration_minutes: clampMinutes(op.visitMinutes),
            });
            entries.push({
              kind: 'restore-duration',
              id: op.tripPlaceId,
              name: op.name,
              minutes: row.visit_duration_minutes,
            });
          }
        } catch (err) {
          failures.push({ label: opLabel(op), message: toError(err).message });
        }
        setDone(i + 1);
      }

      // ── ONE optimize pass — final say on day split/order ───────────────
      const remaining = args.places.length + createdOk - removedOk;
      if (remaining >= 2) {
        setPhase('optimizing');
        try {
          await optimizeAsync({ tripId: args.tripId, mode: args.routeRenderMode });
        } catch (optimizeErr) {
          // Best-effort: the place set changed, so the trip-detail screen's
          // debounced auto-optimize fires again on its own.
          console.warn('[useAiEditApply] optimize failed — trip detail will retry', optimizeErr);
        }
      }

      if (entries.length > 0) {
        journalRef.current = {
          tripId: args.tripId,
          routeRenderMode: args.routeRenderMode,
          placeCountBefore: args.places.length,
          entries,
        };
      }
      setPhase('idle');
      inFlightRef.current = false;
      return {
        applied: ordered.length - (failures.length - softFailures),
        failures,
        canUndo: entries.length > 0,
      };
    },
    [createPlaceAsync, deletePlaceAsync, moveToDayAsync, updatePlaceAsync, optimizeAsync],
  );

  const undo = useCallback(async (): Promise<AiEditUndoOutcome | null> => {
    const journal = journalRef.current;
    if (!journal || inFlightRef.current) return null;
    inFlightRef.current = true;
    journalRef.current = null; // one-shot: a second tap can't double-revert

    const reversed = [...journal.entries].reverse();
    setDone(0);
    setTotal(reversed.length);
    setPhase('undoing');

    const failures: AiEditFailure[] = [];
    let softFailures = 0;
    for (const [i, entry] of reversed.entries()) {
      try {
        if (entry.kind === 'delete-created') {
          await deletePlaceAsync({ id: entry.id, trip_id: journal.tripId });
        } else if (entry.kind === 'recreate-removed') {
          const row = entry.row;
          const created = await createPlaceAsync({
            trip_id: journal.tripId,
            google_place_id: row.google_place_id,
            user_title: row.user_title,
            category: row.category,
            lat: row.lat,
            lng: row.lng,
            visit_duration_minutes: row.visit_duration_minutes,
            notes: row.notes,
          });
          if (row.day_index !== null) {
            const scheduled = await scheduleOnDayWithRetry(moveToDayAsync, {
              id: created.id,
              tripId: journal.tripId,
              toDayIndex: row.day_index,
              positionInDay: row.order_in_day ?? undefined,
            });
            if (!scheduled) {
              // Restored, but into Ideas — report it rather than hide it.
              softFailures += 1;
              failures.push({
                label: undoLabel(entry),
                message: `restored to Ideas — couldn't put it back on Day ${row.day_index + 1}`,
              });
            }
          }
        } else if (entry.kind === 'reverse-move') {
          if (entry.fromDayIndex === null) {
            // useMoveToDay can't write day_index = NULL — honest failure
            // instead of a silent skip (see header comment).
            throw new Error('it was in Ideas before — move it back by hand');
          }
          await moveToDayAsync({
            id: entry.id,
            tripId: journal.tripId,
            toDayIndex: entry.fromDayIndex,
            positionInDay: entry.fromOrder ?? undefined,
          });
        } else {
          await updatePlaceAsync({
            id: entry.id,
            trip_id: journal.tripId,
            visit_duration_minutes: entry.minutes,
          });
        }
      } catch (err) {
        failures.push({ label: undoLabel(entry), message: toError(err).message });
      }
      setDone(i + 1);
    }

    if (journal.placeCountBefore >= 2) {
      setPhase('optimizing');
      try {
        await optimizeAsync({ tripId: journal.tripId, mode: journal.routeRenderMode });
      } catch (optimizeErr) {
        console.warn('[useAiEditApply] undo optimize failed — trip detail will retry', optimizeErr);
      }
    }

    setPhase('idle');
    inFlightRef.current = false;
    return { reverted: reversed.length - (failures.length - softFailures), failures };
  }, [createPlaceAsync, deletePlaceAsync, moveToDayAsync, updatePlaceAsync, optimizeAsync]);

  /**
   * Ends the undo window. The sheet calls this when its session ends (close
   * from done/undone, or "Start a new edit") so a stale Undo can never revert
   * manual changes made after the sheet was dismissed.
   */
  const clearUndo = useCallback(() => {
    journalRef.current = null;
  }, []);

  return { apply, undo, clearUndo, phase, done, total };
}
