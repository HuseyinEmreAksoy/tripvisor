/**
 * undo.ts — inverse-operations undo stack (v2 S2.5).
 *
 * WHY INVERSE OPS, NOT STATE SNAPSHOTS OF THE WHOLE STORE
 * -------------------------------------------------------
 * The Tier-1 store is sync-attached: rolling the whole store back would
 * fight the sync engine (remote merges land between do and undo). Instead,
 * every mutation helper in src/sync/mutations.ts CAPTURES the prior values
 * it is about to overwrite and RETURNS an {@link UndoEntry} whose `inverse`
 * closure re-applies them through the same mutation layer — so an undo is
 * just another LWW write that syncs like any other edit (offline included).
 *
 * Usage contract (Wave 3b):
 *   const undo = useUndo();
 *   undo.push(updateTrip(tripId, { title: 'Rome' }));   // do + capture
 *   …
 *   await undo.undoLast();                              // inverse write
 *
 * THE FIVE PRODUCT CASES this stack must express (S2.5) — all compose from
 * the primitives in mutations.ts; the product flows themselves are wired by
 * Wave 3b / the flag-flip repoint, NOT here:
 *   1. Place remove        → push(tombstonePlace(id)); inverse un-tombstones
 *      (deleted: false — the row still exists server-side).
 *   2. Day reassign        → push(setPlaceManualRank(id, newRank)); inverse
 *      restores the prior manual_rank (day membership re-derives from order).
 *   3. Reorder (drag)      → push(setPlaceManualRank(id, rankBetween(a, b)));
 *      inverse restores the prior rank.
 *   4. Optimize overwrote  → snap = snapshotRanks(tripId) BEFORE optimize;
 *      push({ label, inverse: () => restoreRanks(snap) }).
 *   5. AI-apply            → same bulk pattern as 4: snapshotRanks (plus the
 *      individual create entries' tombstone inverses) pushed as ONE entry
 *      whose inverse runs the collected inverses in reverse order.
 *
 * Design properties:
 *   - LIFO, capacity-bounded (default 20; oldest evicted — undo is a
 *     short-horizon affordance, not a history feature).
 *   - The core class is framework-free (no React import needed to use it —
 *     mutations.ts and tests consume it headlessly). `useUndo()` at the
 *     bottom is the only React-aware surface.
 *   - A failed `inverse()` propagates to the caller AND stays popped: we
 *     deliberately do not re-push, because a throwing inverse usually means
 *     the world changed underneath it (row tombstoned remotely, sync torn
 *     down) and retrying it blind would be worse than surfacing the error.
 *   - One stack per signed-in session: the auth bridge clears it on
 *     SIGNED_OUT (entries close over the previous user's data).
 */

import { useSyncExternalStore } from 'react';

export interface UndoEntry {
  /** Human-readable description for the status pill / toast ("Reorder", "Remove place"). */
  label: string;
  /** Re-applies the captured prior state through the mutation layer. */
  inverse: () => void | Promise<void>;
}

export const DEFAULT_UNDO_CAPACITY = 20;

export class UndoStack {
  readonly capacity: number;
  private entries: UndoEntry[] = [];
  private listeners = new Set<() => void>();
  /** Monotonic change counter — the useSyncExternalStore snapshot. */
  private version = 0;

  constructor(capacity: number = DEFAULT_UNDO_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`[sync.undo] capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = capacity;
  }

  /** Push an entry; evicts the OLDEST entry when at capacity. */
  push(entry: UndoEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.shift();
    this.notify();
  }

  /**
   * Pop the most recent entry and run its inverse. Resolves to the entry
   * (so callers can toast `Undid: ${entry.label}`) or null when empty.
   * The entry is popped BEFORE the inverse runs — see header for why a
   * throwing inverse is not re-pushed.
   */
  async undoLast(): Promise<UndoEntry | null> {
    const entry = this.entries.pop();
    if (!entry) return null;
    this.notify();
    await entry.inverse();
    return entry;
  }

  get canUndo(): boolean {
    return this.entries.length > 0;
  }

  /** Label of the entry `undoLast()` would run, or null when empty. */
  get peekLabel(): string | null {
    const last = this.entries[this.entries.length - 1];
    return last ? last.label : null;
  }

  get size(): number {
    return this.entries.length;
  }

  clear(): void {
    if (this.entries.length === 0) return;
    this.entries = [];
    this.notify();
  }

  /** Subscribe to any stack change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Stable change counter for useSyncExternalStore. */
  getVersion(): number {
    return this.version;
  }

  private notify(): void {
    this.version += 1;
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        // A broken listener must never break the stack (or another listener).
      }
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Session singleton + hook
// ───────────────────────────────────────────────────────────────────────────

let sessionStack: UndoStack | null = null;

/** The per-session singleton (lazy). Headless consumers (mutations, tests,
 * the auth bridge's sign-out clear) use this directly. */
export function getSessionUndoStack(): UndoStack {
  return (sessionStack ??= new UndoStack());
}

/** Test seam — drops the singleton so each test starts fresh. */
export function _resetSessionUndoStackForTests(): void {
  sessionStack = null;
}

/**
 * React binding for the session stack. Returns the stack itself (a stable
 * reference); the component re-renders on every push/undo/clear via the
 * stack's version counter, so reading `undo.canUndo` / `undo.peekLabel`
 * during render is always fresh.
 */
export function useUndo(): UndoStack {
  const stack = getSessionUndoStack();
  useSyncExternalStore(
    (cb) => stack.subscribe(cb),
    () => stack.getVersion(),
    () => stack.getVersion(),
  );
  return stack;
}
