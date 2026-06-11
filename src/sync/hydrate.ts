/**
 * hydrate.ts — wires the Tier-1 store to Supabase, READ-ONLY (v2 S2.2).
 *
 * Wave-1 scope: hydration + realtime + (best-effort) persistence for the
 * eight synced roots. WRITES ARE DISABLED (`actions: ['read']`) — enabling
 * them per entity is S2.4. Nothing in the app calls initTier1Sync() yet;
 * Wave 2 wires it post-auth. With the flags.ts switch off (the default)
 * this module does nothing at all.
 *
 * ── Engine decision: syncedSupabase (plugin) over manual changesSince pulls
 * The beta plugin's contract maps 1:1 onto what migration 0027 built:
 * `changesSince: 'last-sync'` filters on our server-stamped `updated_at`
 * (fieldUpdatedAt), `fieldDeleted: 'deleted'` consumes our tombstones, and
 * per-row `transform.load` is exactly the C3 sanitize boundary. Hand-rolling
 * pulls would re-implement all of that plus persistence bookkeeping for no
 * extra control we currently need. The R6 fallback (hand-rolled
 * expo-sqlite sync) stays named-and-ready: everything Supabase-specific is
 * contained in this one file behind the plain tier1Store$ observables, so
 * swapping engines later touches hydrate.ts only.
 *
 * ── Per-user persistence + auth scoping
 * initTier1Sync REQUIRES a userId and namespaces every persisted table as
 * `tier1/<userId>/<table>`. Two failure modes this kills:
 *   1. last-sync watermark poisoning — an anonymous/foreign session syncing
 *      zero rows would advance the watermark, and the real user's later
 *      incremental pull would silently skip everything older;
 *   2. cross-account leakage on shared devices (user B reading user A's
 *      hydrated trips from disk).
 *
 * ── Reconnect = always pull (Legend-State issue #362)
 * Realtime alone cannot be trusted across a disconnect: events emitted
 * while the socket was down are GONE when it reconnects, and the channel
 * does not replay them. So any offline→online transition force-runs
 * `syncState(...).sync()` on every root — with `changesSince: 'last-sync'`
 * those re-pulls are cheap incremental queries against the 0027
 * `*_updated_at_idx` indexes.
 *
 * ── Known Wave-1 limitation (documented, accepted)
 * Hard DELETEs by other clients are invisible to incremental pulls (no row
 * left to carry the fact) and only semi-reliable via realtime DELETE
 * events. v1 paths still hard-delete (places, expenses, reaction-clear…) —
 * Wave 2 flips them to `deleted = true` tombstones, which is why 0027 added
 * the column everywhere first.
 */

import { syncObservable } from '@legendapp/state/sync';
import { syncState } from '@legendapp/state';
import { syncedSupabase } from '@legendapp/state/sync-plugins/supabase';
import { supabase } from '../api/supabase';
import { sanitizeForTier1, tier1SelectColumns, type Tier1Table } from './allowlist';
import { loadTier1SyncFlag } from './flags';
import { createSyncPersistence } from './persistence';
import type { SyncPersistenceResult } from './persistence.types';
import { TABLE_FOR_KEY, TIER1_STORE_KEYS, tier1Store$, type Tier1StoreKey } from './store';
import {
  markSyncDegraded,
  markSyncEnabled,
  recordDroppedField,
  recordEntityHydrated,
  recordHydrationFailure,
} from './telemetry';

export interface InitTier1SyncResult {
  /** false = flag off or already initialized for another user — no-op. */
  started: boolean;
  /** Persistence degraded to in-memory (see persistence.web/native). */
  degraded: boolean;
}

let initializedForUser: string | null = null;
let persistencePlugin: SyncPersistenceResult['plugin'];

/**
 * The C3 boundary: every row the sync engine loads passes through here.
 * First pass throws on restricted fields (loud in dev); the catch degrades
 * to strip-with-telemetry so a violation can never brick hydration.
 */
function sanitizeRow(table: Tier1Table, row: Record<string, unknown>): Record<string, unknown> {
  // The sanitized row IS a plain object — the cast back to Record bridges
  // the interface-vs-index-signature gap (Trip etc. have no index signature).
  try {
    return sanitizeForTier1(table, row, {
      onDrop: (field, restricted) => recordDroppedField(table, field, restricted),
    }) as unknown as Record<string, unknown>;
  } catch {
    return sanitizeForTier1(table, row, {
      mode: 'strip',
      onDrop: (field, restricted) => recordDroppedField(table, field, restricted),
    }) as unknown as Record<string, unknown>;
  }
}

/**
 * Attach read-only syncedSupabase to one store root.
 *
 * Typing note: our supabase client is untyped (no generated Database
 * generic — the project validates rows with Zod instead), so the plugin's
 * deep PostgREST generics cannot infer row shapes; the two targeted casts
 * below acknowledge that. Runtime safety comes from tier1SelectColumns
 * (only allowlisted columns are ever requested) + sanitizeRow.
 */
function attachEntity(key: Tier1StoreKey, userId: string): void {
  const table = TABLE_FOR_KEY[key];
  const obs$ = tier1Store$[key];

  syncObservable(
    obs$,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped supabase client vs the plugin's Database-generic inference (see note above)
    (syncedSupabase as any)({
      supabase,
      collection: table,
      // Network half of the C3 firewall: restricted columns are never
      // requested. RLS scopes rows to the JWT (owner + accepted
      // collaborators) — no client-side filter needed or wanted.
      select: (from: { select: (cols: string) => unknown }) => from.select(tier1SelectColumns(table)),
      as: 'object',
      // READ-ONLY (Wave 1). S2.4 widens this per entity, low-risk first.
      actions: ['read'],
      realtime: true,
      // Incremental pulls: WHERE updated_at > lastSync (server-stamped by
      // handle_times(), indexed by 0027's *_updated_at_idx).
      changesSince: 'last-sync',
      fieldCreatedAt: 'created_at',
      fieldUpdatedAt: 'updated_at',
      // trips has no tombstone — archive (archived_at) is its lifecycle and
      // account deletion cascades server-side (see 0027 header).
      ...(table === 'trips' ? {} : { fieldDeleted: 'deleted' }),
      transform: {
        load: (row: Record<string, unknown>) => sanitizeRow(table, row),
      },
      persist: {
        name: `tier1/${userId}/${table}`,
        plugin: persistencePlugin,
        // No pending-writes queue to retry in a read-only wave.
        retrySync: false,
      },
      onError: (error: Error) => recordHydrationFailure(table, error),
    }),
  );

  // Row-count + last-sync telemetry. A shallow listener is enough — any
  // hydration/realtime merge fires it; tables are small (per-user data).
  obs$.onChange(({ value }) => {
    recordEntityHydrated(table, value ? Object.keys(value).length : 0);
  });
}

/** Force an incremental pull on every root (reconnect / foreground). */
export function resyncTier1(): void {
  if (initializedForUser === null) return;
  for (const key of TIER1_STORE_KEYS) {
    // Fire-and-forget: per-root failures land in onError → telemetry.
    void syncState(tier1Store$[key]).sync();
  }
}

/**
 * Reconnect listener: NetInfo where available (native + web), DOM 'online'
 * as the web fallback. Lazy/guarded so neither path can throw at init.
 */
function attachReconnectResync(): void {
  let wasConnected: boolean | null = null;
  try {
    const NetInfo =
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      (require('@react-native-community/netinfo') as typeof import('@react-native-community/netinfo')).default;
    NetInfo.addEventListener((state) => {
      const connected = state.isConnected === true;
      if (connected && wasConnected === false) resyncTier1();
      wasConnected = connected;
    });
    return;
  } catch {
    // fall through to DOM events
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', () => resyncTier1());
  }
}

/**
 * Boot read-only Tier-1 hydration for the signed-in user. Idempotent per
 * process; call after auth resolves (Wave 2 wires this — nothing calls it
 * in Wave 1). Resolves fast: hydration continues in the background.
 */
export async function initTier1Sync(opts: { userId: string }): Promise<InitTier1SyncResult> {
  const enabled = await loadTier1SyncFlag();
  if (!enabled) return { started: false, degraded: false };

  if (initializedForUser !== null) {
    // Same user re-init is a resync; a DIFFERENT user requires an app
    // restart in Wave 1 (sign-out teardown/clearPersist is a Wave 2 task —
    // per-user persist names already prevent cross-account reads).
    if (initializedForUser === opts.userId) resyncTier1();
    return { started: false, degraded: false };
  }

  const persistence = createSyncPersistence();
  persistencePlugin = persistence.plugin;
  if (persistence.degraded) {
    markSyncDegraded(persistence.reason ?? 'unknown');
  }

  for (const key of TIER1_STORE_KEYS) {
    attachEntity(key, opts.userId);
  }
  attachReconnectResync();
  initializedForUser = opts.userId;
  markSyncEnabled();
  return { started: true, degraded: persistence.degraded };
}
