/**
 * dragRank.ts — S2.6 offline-drag rank commit (v2 S2 Wave 3b).
 *
 * The flag-on half of ItineraryTab's dual-path drag handler: given a day's
 * places in their PRE-drag visual order and the drag library's post-drag id
 * order, persist the user's intent as `trip_places.manual_rank` through the
 * Tier-1 mutation layer (src/sync/mutations.ts → LWW-synced, offline-safe)
 * and return the inverse-op {@link UndoEntry} for the move.
 *
 * Caller contract
 * ---------------
 * ONLY call when `isTier1SyncActive()` is true — the mutation layer throws
 * SyncWriteError('sync_inactive') otherwise. This module NEVER throws back
 * to the drag handler: every failure degrades to "no rank write" so the
 * user's drag is never blocked or reverted (ux-principles). The server
 * reorder path (reorderDay) still runs independently when online.
 *
 * Rank-backfill decision (per the wave spec, documented here)
 * -----------------------------------------------------------
 * `manual_rank` is null for every pre-S2 row. A dragged place's new rank
 * must sort strictly between its new neighbors IN THE DISPLAYED ORDER, so
 * existing ranks are only trusted when the whole day is rank-consistent:
 * every place has a rank AND the ranks strictly ascend in display order.
 * Anything less — nulls, or ranks that drifted from the optimizer-derived
 * display order (e.g. the user dragged, then optimized) — re-seeds the
 * ENTIRE day deterministically in the pre-drag display order via repeated
 * `rankBetween(tail, null)` appends. This is a one-time-per-day
 * normalization (it only re-runs if ranks drift again). Backfill writes are
 * deliberately NOT pushed to the undo stack: they encode the order the user
 * already sees on screen, so they are normalization, not a user action —
 * only the move itself is undoable, and undoing it restores the dragged
 * row's pre-drag-slot rank (visual order intent reverts with it).
 *
 * Moved-row detection: our drag libraries (react-native-draggable-flatlist,
 * @dnd-kit) move exactly ONE item per gesture, identified by
 * remove-and-compare ({@link classifyMove}). The 'multi' branch is a
 * defensive fallback (rewrites the whole day in the new order as one
 * undoable entry) and should be unreachable in practice.
 */

import type { TripPlace } from '@/api';
import { setPlaceManualRank } from '@/sync/mutations';
import { rankBetween } from '@/sync/rank';
import type { UndoEntry } from '@/sync/undo';

/** The two fields this module reads — keeps tests free of full TripPlace rows. */
export type RankablePlace = Pick<TripPlace, 'id' | 'manual_rank'>;

export interface DragRankResult {
  /** Inverse-op entry for the user's move (caller pushes via useUndo()), or
   * null when nothing moved / every write failed. */
  undoEntry: UndoEntry | null;
  /** Ids whose position changed — feeds the "route recompute pending" chips. */
  movedIds: string[];
}

export type MoveClassification =
  | { kind: 'none' }
  | { kind: 'single'; id: string }
  | { kind: 'multi' };

/**
 * Identify the single dragged item between two orderings of the same ids:
 * candidate ids at the first differing position are tested by removing them
 * from both sequences — if the remainders match, that id is the one move.
 * Pure; exported for unit tests.
 */
export function classifyMove(
  oldIds: readonly string[],
  newIds: readonly string[],
): MoveClassification {
  if (oldIds.length !== newIds.length) return { kind: 'multi' };
  let firstDiff = -1;
  for (let i = 0; i < oldIds.length; i++) {
    if (oldIds[i] !== newIds[i]) {
      firstDiff = i;
      break;
    }
  }
  if (firstDiff === -1) return { kind: 'none' };
  // A forward move of X leaves X at old[firstDiff]; a backward move leaves
  // X at new[firstDiff]. One of the two must reconcile for a single move.
  for (const candidate of [oldIds[firstDiff], newIds[firstDiff]]) {
    if (candidate !== undefined && isSingleMoveOf(oldIds, newIds, candidate)) {
      return { kind: 'single', id: candidate };
    }
  }
  return { kind: 'multi' };
}

function isSingleMoveOf(
  oldIds: readonly string[],
  newIds: readonly string[],
  id: string,
): boolean {
  const a = oldIds.filter((x) => x !== id);
  const b = newIds.filter((x) => x !== id);
  // `id` must appear exactly once in each ordering.
  if (a.length !== oldIds.length - 1 || b.length !== newIds.length - 1) return false;
  return a.every((x, i) => x === b[i]);
}

/** Ids sitting at a different position than before (chip targets). */
function changedIds(oldIds: readonly string[], newIds: readonly string[]): string[] {
  return newIds.filter((id, i) => oldIds[i] !== id);
}

/**
 * Commit the drag as a manual_rank write. See module header for the
 * backfill decision and the never-throws contract.
 */
export function commitDragRanks(
  places: readonly RankablePlace[],
  newIds: readonly string[],
): DragRankResult {
  const oldIds = places.map((p) => p.id);
  const move = classifyMove(oldIds, newIds);
  if (move.kind === 'none') return { undoEntry: null, movedIds: [] };
  const moved = move.kind === 'single' ? [move.id] : changedIds(oldIds, newIds);

  try {
    if (move.kind === 'single') {
      const ranks = ensureDayRanks(places);
      const idx = newIds.indexOf(move.id);
      const prevId = idx > 0 ? newIds[idx - 1] : undefined;
      const nextId = idx >= 0 && idx < newIds.length - 1 ? newIds[idx + 1] : undefined;
      const prevRank = prevId !== undefined ? (ranks.get(prevId) ?? null) : null;
      const nextRank = nextId !== undefined ? (ranks.get(nextId) ?? null) : null;
      return {
        undoEntry: setPlaceManualRank(move.id, rankBetween(prevRank, nextRank), 'Reorder'),
        movedIds: moved,
      };
    }
    return { undoEntry: rewriteDayRanks(newIds), movedIds: moved };
  } catch (error) {
    // RankError (a foreign '0'-suffixed key makes the neighbor gap empty) or
    // a SyncWriteError mid-flight: last resort is the same full-day rewrite
    // in the new order; if THAT fails too, give up quietly — the drag must
    // never be blocked, and the server path can still reorder when online.
    try {
      return { undoEntry: rewriteDayRanks(newIds), movedIds: moved };
    } catch (fallbackError) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[dragRank] rank write skipped:', error, fallbackError);
      }
      return { undoEntry: null, movedIds: moved };
    }
  }
}

/**
 * Existing ranks when the whole day is rank-consistent with the displayed
 * order; otherwise the one-time deterministic re-seed (module header).
 */
function ensureDayRanks(places: readonly RankablePlace[]): Map<string, string> {
  const ranks = new Map<string, string>();
  let consistent = true;
  let prev: string | null = null;
  for (const p of places) {
    const r = p.manual_rank ?? null;
    // Plain string comparison IS the rank order (rank.ts header).
    if (r === null || (prev !== null && r <= prev)) {
      consistent = false;
      break;
    }
    ranks.set(p.id, r);
    prev = r;
  }
  if (consistent) return ranks;

  ranks.clear();
  let tail: string | null = null;
  for (const p of places) {
    const rank = rankBetween(tail, null);
    try {
      // Backfill entries deliberately discarded — normalization, not a user
      // action (module header).
      setPlaceManualRank(p.id, rank, 'Reorder');
      ranks.set(p.id, rank);
      tail = rank;
    } catch {
      // Row not hydrated into the Tier-1 store (yet) — skip it; neighbors of
      // a skipped row fall back to a null bound in rankBetween.
    }
  }
  return ranks;
}

/**
 * Defensive full-day rewrite in the given order (repeated appends), folded
 * into ONE undo entry whose inverse replays the captured priors in reverse.
 */
function rewriteDayRanks(orderedIds: readonly string[]): UndoEntry | null {
  const entries: UndoEntry[] = [];
  let tail: string | null = null;
  for (const id of orderedIds) {
    const rank = rankBetween(tail, null);
    try {
      entries.push(setPlaceManualRank(id, rank, 'Reorder'));
      tail = rank;
    } catch {
      // Skip un-hydrated rows — same rationale as ensureDayRanks.
    }
  }
  if (entries.length === 0) return null;
  return {
    label: 'Reorder',
    inverse: async () => {
      for (const entry of [...entries].reverse()) {
        await entry.inverse();
      }
    },
  };
}
