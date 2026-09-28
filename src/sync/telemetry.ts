/**
 * telemetry.ts — sync-engine observability (v2 S2.2 data layer; S2.7 partial
 * adds the subscribable SyncStatus surface the status pill consumes).
 *
 * Plain module state + snapshot getter (no observables: keeping this module
 * dependency-free — no Legend-State, no React — means the allowlist guard
 * can report violations from anywhere, including the node validate script).
 * The React hook lives in status.ts; this module only exposes the
 * framework-free core: getSyncStatus / subscribeSyncStatus /
 * refreshSyncStatus.
 *
 * Sentry: degrade events, hydration failures, WRITE failures, and
 * ToS-violation strips all emit breadcrumbs (not events — breadcrumbs are
 * free context attached to whatever error surfaces next; promoting to
 * captured events is a later decision once volume is known). All Sentry
 * calls are wrapped — initSentry() is a no-op without a DSN
 * (src/lib/sentry.ts) and addBreadcrumb before/without init is itself a
 * no-op in @sentry/react-native, so telemetry can never crash sync.
 *
 * pendingWrites: the count comes from the sync engine
 * (syncState(...).getPendingChanges()), but importing hydrate.ts here would
 * create a cycle (hydrate → telemetry). hydrate.ts therefore REGISTERS a
 * provider callback at init and unregisters it at teardown; while no
 * provider is registered (engine off) pendingWrites is honestly `undefined`.
 */

import { useSyncExternalStore } from 'react';
import { Sentry } from '../lib/sentry';
import type { Tier1Table, Tier1WriteDropKind } from './allowlist';
import { TIER1_TABLES } from './allowlist';

export interface SyncEntityTelemetry {
  /** Rows currently hydrated into the store for this table. */
  rowCount: number;
  /** Epoch ms of the last successful pull (null = never synced). */
  lastSyncAt: number | null;
  /** Consecutive load failures since the last success. */
  errorCount: number;
  /** Failed outbound writes (create/update/tombstone) — S2.4. Retries are
   * counted per attempt; a healthy queue drains back to no new increments. */
  writeErrorCount: number;
}

export interface SyncTelemetrySnapshot {
  /** Did initTier1Sync actually attach the engine this session? */
  enabled: boolean;
  /**
   * Persistence degraded to in-memory (web OPFS/SharedArrayBuffer missing,
   * or the native module absent pre-dev-client-rebuild). Sync still works;
   * offline cold-start hydration doesn't. Surfaced per risk R5.
   */
  degraded: boolean;
  degradedReason: string | null;
  /** Fields dropped by the default-deny sanitize (unknown columns). */
  droppedUnknownFields: number;
  /** Restricted-field strips — every one of these is a C3 bug upstream. */
  tosViolations: number;
  /**
   * Server-only fields stripped from WRITE payloads (S2.4, C1: day_index,
   * order_in_day, created_at, updated_at, …). NOT a bug signal per se —
   * updatePartial:false means hydrated server fields ride along on every
   * full-row update — but a sudden spike on a field that should never be in
   * a patch (day_index on a fresh create) is worth investigating.
   */
  strippedServerOnlyWriteFields: number;
  entities: Record<Tier1Table, SyncEntityTelemetry>;
  /**
   * A DIFFERENT user signed in while the engine was already attached to
   * another account (the beta plugin cannot detach). Tier-1 stays OFF for
   * this session — every read/write facade serves the v1 TanStack path —
   * until the app restarts. Explicit so the status surface can say so
   * instead of silently looking "not synced".
   */
  restartRequired: boolean;
  /** Age of the OLDEST per-entity lastSyncAt (ms), or null if any entity has
   * never synced — the honest "how stale could the store be" number. */
  lastSyncAgeMs: number | null;
}

function emptyEntities(): Record<Tier1Table, SyncEntityTelemetry> {
  return Object.fromEntries(
    TIER1_TABLES.map((t) => [t, { rowCount: 0, lastSyncAt: null, errorCount: 0, writeErrorCount: 0 }]),
  ) as Record<Tier1Table, SyncEntityTelemetry>;
}

const state = {
  enabled: false,
  degraded: false,
  degradedReason: null as string | null,
  droppedUnknownFields: 0,
  tosViolations: 0,
  strippedServerOnlyWriteFields: 0,
  entities: emptyEntities(),
  restartRequired: false,
};

/** Dev-warn dedupe for routine server-only write strips — `table:field`.
 * Full-row updates strip day_index/updated_at/… EVERY time; warning once per
 * combination per session keeps it loud without drowning the console. */
const warnedWriteStrips = new Set<string>();

function breadcrumb(message: string, data?: Record<string, unknown>): void {
  try {
    Sentry.addBreadcrumb({ category: 'sync', level: 'warning', message, data });
  } catch {
    // Sentry unavailable (no DSN / test env) — telemetry stays best-effort.
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Reactive status surface (S2.7) — powers the sync-status pill.
// Same useSyncExternalStore shape as UndoStack: subscribers + a monotonic
// version counter as the (referentially stable) snapshot; components derive
// the actual data via getSyncTelemetry() per render.
// ───────────────────────────────────────────────────────────────────────────

const statusListeners = new Set<() => void>();
let statusVersion = 0;

function refreshSyncStatus(): void {
  statusVersion++;
  for (const listener of statusListeners) listener();
}

/** Subscribe to any telemetry change; returns the unsubscribe function. */
export function subscribeSyncStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

/** Monotonic change counter — the useSyncExternalStore snapshot. */
export function getSyncStatusVersion(): number {
  return statusVersion;
}

/**
 * React hook for the Wave-3b status pill: re-renders on every telemetry
 * change and returns a fresh snapshot. `pendingWrites` is NOT included —
 * the beta plugin does not expose its queue depth (documented limitation;
 * `writeErrorCount` per entity is the available proxy).
 */
export function useSyncStatus(): SyncTelemetrySnapshot {
  useSyncExternalStore(subscribeSyncStatus, getSyncStatusVersion, getSyncStatusVersion);
  return getSyncTelemetry();
}

export function markSyncEnabled(): void {
  state.enabled = true;
  refreshSyncStatus();
}

/** Teardown (sign-out) — the engine is no longer attached/active. */
export function markSyncStopped(): void {
  state.enabled = false;
  breadcrumb('tier-1 sync stopped (teardown)');
  refreshSyncStatus();
}

/**
 * A different user signed in while the engine is bound to another account
 * (hydrate.ts initTier1Sync) — Tier-1 is off until restart. `false` clears it
 * (the bound user signed back in).
 */
export function markSyncRestartRequired(required: boolean, data?: Record<string, unknown>): void {
  if (state.restartRequired === required) return;
  state.restartRequired = required;
  if (required) breadcrumb('tier-1 sync needs an app restart (account switch in-process)', data);
  refreshSyncStatus();
}

export function markSyncDegraded(reason: string): void {
  state.degraded = true;
  state.degradedReason = reason;
  breadcrumb('sync persistence degraded to in-memory', { reason });
  refreshSyncStatus();
}

export function recordEntityHydrated(table: Tier1Table, rowCount: number): void {
  const e = state.entities[table];
  e.rowCount = rowCount;
  e.lastSyncAt = Date.now();
  e.errorCount = 0;
  refreshSyncStatus();
}

/**
 * Row count only — NO lastSyncAt stamp (X1.3). For store changes that are
 * not server contact: the persisted cold-start load (OPFS/SQLite) and local
 * edits before the first remote load has completed.
 */
export function recordEntityRowCount(table: Tier1Table, rowCount: number): void {
  const e = state.entities[table];
  if (e.rowCount === rowCount) return;
  e.rowCount = rowCount;
  refreshSyncStatus();
}

export function recordHydrationFailure(table: Tier1Table, error: unknown): void {
  state.entities[table].errorCount += 1;
  breadcrumb('sync hydration failure', {
    table,
    message: error instanceof Error ? error.message : String(error),
    consecutiveFailures: state.entities[table].errorCount,
  });
  refreshSyncStatus();
}

export function recordWriteFailure(table: Tier1Table, error: unknown): void {
  state.entities[table].writeErrorCount += 1;
  breadcrumb('sync write failure', {
    table,
    message: error instanceof Error ? error.message : String(error),
    writeErrorCount: state.entities[table].writeErrorCount,
  });
  refreshSyncStatus();
}

/**
 * A field was dropped from an outbound WRITE payload (S2.4 — the
 * sanitizeForTier1Write boundary in hydrate.ts).
 *
 *  - 'restricted'  → C3 violation, same loud path as the read boundary.
 *  - 'server_only' → C1 strip (day_index/order_in_day/updated_at/…) —
 *    counted always, dev-warned once per table:field (expected riders on
 *    every full-row update; see strippedServerOnlyWriteFields docs).
 *  - 'unknown'     → default-deny, counted with the read-path counter.
 */
export function recordWriteSanitizedDrop(
  table: Tier1Table,
  field: string,
  kind: Tier1WriteDropKind,
): void {
  if (kind === 'restricted') {
    // Same severity as a read-side strip: Tier-2 data headed for Postgres.
    recordDroppedField(table, field, true);
    return;
  }
  if (kind === 'server_only') {
    state.strippedServerOnlyWriteFields += 1;
    const dedupeKey = `${table}:${field}`;
    if (!warnedWriteStrips.has(dedupeKey)) {
      warnedWriteStrips.add(dedupeKey);
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn(
          `[sync] C1: server-only field "${field}" stripped from ${table} write payload (expected for full-row updates; never client-sent)`,
        );
      }
    }
    return;
  }
  state.droppedUnknownFields += 1;
  refreshSyncStatus();
}

export function recordDroppedField(table: Tier1Table, field: string, restricted: boolean): void {
  if (restricted) {
    state.tosViolations += 1;
    // Loud: a restricted field reaching the boundary means some upstream
    // code is feeding Tier-2 data toward the persistent store (C3).
    breadcrumb('TOS-RESTRICTED field stripped at Tier-1 boundary', { table, field });
    // `typeof` guard: __DEV__ is set by Metro/jest-expo but not by bare node.
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.error(`[sync] C3 violation: restricted field "${field}" stripped from ${table} row`);
    }
  } else {
    state.droppedUnknownFields += 1;
  }
  refreshSyncStatus();
}

/** Immutable snapshot for debug surfaces / the future S2.7 status UI. */
export function getSyncTelemetry(): SyncTelemetrySnapshot {
  const stamps = TIER1_TABLES.map((t) => state.entities[t].lastSyncAt);
  const lastSyncAgeMs = stamps.every((s): s is number => s !== null)
    ? Date.now() - Math.min(...stamps)
    : null;
  return {
    enabled: state.enabled,
    degraded: state.degraded,
    degradedReason: state.degradedReason,
    droppedUnknownFields: state.droppedUnknownFields,
    tosViolations: state.tosViolations,
    strippedServerOnlyWriteFields: state.strippedServerOnlyWriteFields,
    entities: Object.fromEntries(
      TIER1_TABLES.map((t) => [t, { ...state.entities[t] }]),
    ) as Record<Tier1Table, SyncEntityTelemetry>,
    restartRequired: state.restartRequired,
    lastSyncAgeMs,
  };
}

/** Test seam. */
export function _resetSyncTelemetryForTests(): void {
  state.enabled = false;
  state.degraded = false;
  state.degradedReason = null;
  state.droppedUnknownFields = 0;
  state.tosViolations = 0;
  state.strippedServerOnlyWriteFields = 0;
  state.entities = emptyEntities();
  state.restartRequired = false;
  warnedWriteStrips.clear();
}
