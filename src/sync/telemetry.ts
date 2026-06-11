/**
 * telemetry.ts — sync-engine observability (v2 S2.2; full status UI is
 * S2.7, this is the data layer it will read).
 *
 * Plain module state + snapshot getter (no observables: nothing reactive
 * consumes this yet, and keeping it dependency-free means the allowlist
 * guard can report violations without importing Legend-State).
 *
 * Sentry: hydration failures and ToS-violation strips emit breadcrumbs (not
 * events — breadcrumbs are free context attached to whatever error surfaces
 * next; promoting to captured events is an S2.7 decision once volume is
 * known). All Sentry calls are wrapped — initSentry() is a no-op without a
 * DSN and telemetry must never be the thing that crashes sync.
 */

import { Sentry } from '../lib/sentry';
import type { Tier1Table } from './allowlist';
import { TIER1_TABLES } from './allowlist';

export interface SyncEntityTelemetry {
  /** Rows currently hydrated into the store for this table. */
  rowCount: number;
  /** Epoch ms of the last successful pull (null = never synced). */
  lastSyncAt: number | null;
  /** Consecutive load failures since the last success. */
  errorCount: number;
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
  entities: Record<Tier1Table, SyncEntityTelemetry>;
  /** Age of the OLDEST per-entity lastSyncAt (ms), or null if any entity has
   * never synced — the honest "how stale could the store be" number. */
  lastSyncAgeMs: number | null;
}

function emptyEntities(): Record<Tier1Table, SyncEntityTelemetry> {
  return Object.fromEntries(
    TIER1_TABLES.map((t) => [t, { rowCount: 0, lastSyncAt: null, errorCount: 0 }]),
  ) as Record<Tier1Table, SyncEntityTelemetry>;
}

const state = {
  enabled: false,
  degraded: false,
  degradedReason: null as string | null,
  droppedUnknownFields: 0,
  tosViolations: 0,
  entities: emptyEntities(),
};

function breadcrumb(message: string, data?: Record<string, unknown>): void {
  try {
    Sentry.addBreadcrumb({ category: 'sync', level: 'warning', message, data });
  } catch {
    // Sentry unavailable (no DSN / test env) — telemetry stays best-effort.
  }
}

export function markSyncEnabled(): void {
  state.enabled = true;
}

export function markSyncDegraded(reason: string): void {
  state.degraded = true;
  state.degradedReason = reason;
  breadcrumb('sync persistence degraded to in-memory', { reason });
}

export function recordEntityHydrated(table: Tier1Table, rowCount: number): void {
  const e = state.entities[table];
  e.rowCount = rowCount;
  e.lastSyncAt = Date.now();
  e.errorCount = 0;
}

export function recordHydrationFailure(table: Tier1Table, error: unknown): void {
  state.entities[table].errorCount += 1;
  breadcrumb('sync hydration failure', {
    table,
    message: error instanceof Error ? error.message : String(error),
    consecutiveFailures: state.entities[table].errorCount,
  });
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
    entities: Object.fromEntries(
      TIER1_TABLES.map((t) => [t, { ...state.entities[t] }]),
    ) as Record<Tier1Table, SyncEntityTelemetry>,
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
  state.entities = emptyEntities();
}
