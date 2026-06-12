/**
 * hydrate.ts — wires the Tier-1 store to Supabase (v2 S2.2 reads; S2.4
 * writes for the trips + trip_places slice).
 *
 * Wave-2 scope: trips + trip_places are READ-WRITE
 * (`actions: ['read','create','update']`); the other six roots stay
 * read-only until a later slice widens them. Nothing in the app writes the
 * store yet — Wave 3 repoints the UI hooks. With the flags.ts switch off
 * (the default) this module does nothing at all.
 *
 * ── Write path (S2.4)
 * Local store writes flow: observable change → syncedCrud diff →
 * `transform.save` = sanitizeForTier1Write (the C1/C3 WRITE firewall:
 * server-only fields like day_index/order_in_day/updated_at are stripped,
 * restricted Google names throw→strip with telemetry) → PostgREST
 * insert/update under the user's JWT (RLS re-checks every row).
 *
 *   - The plugin hard-codes updatePartial:false, so UPDATEs send the full
 *     store row; the write sanitize is what keeps hydrated server-only
 *     fields from echoing back (a stale day_index replay is the C1 bug).
 *   - DELETE = TOMBSTONE: `fieldDeleted: 'deleted'` means the plugin never
 *     issues a hard DELETE — `tier1Store$.tripPlaces[id].delete()` (or
 *     setting `deleted: true`) becomes UPDATE … SET deleted = true, which
 *     replicates through incremental pulls (a hard DELETE leaves no row to
 *     carry the fact; see 0027 §3). The plugin builds the tombstone payload
 *     as exactly { id, deleted: true } (bypassing transform.save — both
 *     fields are write-allowlisted anyway). v1's legacy hard-delete hooks
 *     are a Wave-3 concern (they don't touch this store).
 *   - trips creates: `user_id` is NOT client-writable — this module stamps
 *     it from the authenticated session at the boundary (sanitize strips
 *     any app-supplied value first), and RLS WITH CHECK
 *     (auth.uid() = user_id) verifies it server-side. Create detection
 *     mirrors the plugin's own: created_at absence (hydrated rows always
 *     carry it; app code must never set created_at on a new row).
 *   - Retries: write-enabled roots get `retry: { infinite: true }`
 *     (exponential backoff, 30s cap). Caveat (documented honestly): the
 *     plugin retries SERVER rejections (RLS denials) as well as network
 *     failures — dead-lettering permanently-rejected writes is an S2.7
 *     status-UI concern. Failures land in telemetry per attempt.
 *   - Queue durability is PLATFORM-DEPENDENT (R5): pending writes are
 *     persisted across restarts (`retrySync: true`) ONLY when the SQLite
 *     persistence plugin attached (native with the S1 dev client; web only
 *     once COOP/COEP lands). On the in-memory degrade path (today's web,
 *     node) offline writes retry within the session but DIE WITH THE
 *     PROCESS. Surfaced via the existing `degraded` telemetry.
 *   - id generation: callers must supply row ids (client UUIDs) — the
 *     engine is not configured with generateId. Wave 3's mutation layer
 *     owns id minting.
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
 * ── Known limitation (documented, accepted)
 * Hard DELETEs by other clients are invisible to incremental pulls (no row
 * left to carry the fact) and only semi-reliable via realtime DELETE
 * events. v1 paths still hard-delete (places, expenses, reaction-clear…) —
 * Wave 3 flips them to `deleted = true` tombstones, which is why 0027 added
 * the column everywhere first.
 */

import { syncObservable } from '@legendapp/state/sync';
import { syncState } from '@legendapp/state';
import { syncedSupabase } from '@legendapp/state/sync-plugins/supabase';
import { supabase } from '../api/supabase';
import {
  isTier1WriteTable,
  sanitizeForTier1,
  sanitizeForTier1Write,
  tier1SelectColumns,
  type Tier1Table,
  type Tier1WriteTable,
} from './allowlist';
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
  recordWriteFailure,
  recordWriteSanitizedDrop,
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
 * The C1 boundary, write direction: every create/update payload the sync
 * engine emits passes through here (syncedCrud's transformOut) before
 * PostgREST. Same throw→strip degrade as sanitizeRow: a restricted-name
 * violation is loud in dev but can never wedge the write queue.
 *
 * trips creates additionally get `user_id` stamped from the authenticated
 * session — it is not client-writable (the sanitize strips any app-supplied
 * value), the column has no DB default, and RLS WITH CHECK
 * (auth.uid() = user_id) verifies whatever we send. Updates are left alone:
 * a hydrated row's user_id was stripped above, and injecting the SESSION
 * user into an update would break editor-collaborator writes (the 0015/0026
 * trips trigger raises 42501 if NEW.user_id differs from OLD.user_id).
 */
function sanitizeWriteRow(
  table: Tier1WriteTable,
  row: Record<string, unknown>,
  userId: string,
): Record<string, unknown> {
  const onDrop = (field: string, kind: 'restricted' | 'server_only' | 'unknown') =>
    recordWriteSanitizedDrop(table, field, kind);
  let out: Record<string, unknown>;
  try {
    out = sanitizeForTier1Write(table, row, { onDrop }) as Record<string, unknown>;
  } catch {
    out = sanitizeForTier1Write(table, row, { mode: 'strip', onDrop }) as Record<string, unknown>;
  }
  // created_at absence ⇒ create (the plugin's own discriminator — see the
  // allowlist.ts TIER1_WRITE_STRUCTURAL docs). Checked on the RAW row:
  // sanitize never copies created_at through.
  if (table === 'trips' && !row['created_at']) {
    out['user_id'] = userId;
  }
  return out;
}

/**
 * Attach syncedSupabase to one store root — read-write for the S2.4 slice
 * (trips, trip_places), read-only for the rest.
 *
 * Typing note: our supabase client is untyped (no generated Database
 * generic — the project validates rows with Zod instead), so the plugin's
 * deep PostgREST generics cannot infer row shapes; the two targeted casts
 * below acknowledge that. Runtime safety comes from tier1SelectColumns
 * (only allowlisted columns are ever requested) + sanitizeRow +
 * sanitizeWriteRow.
 */
function attachEntity(key: Tier1StoreKey, userId: string): void {
  const table = TABLE_FOR_KEY[key];
  const obs$ = tier1Store$[key];
  const writable = isTier1WriteTable(table);

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
      // S2.4: trips + trip_places gained create/update. 'delete' is
      // deliberately ABSENT everywhere — with fieldDeleted set the plugin
      // never hard-deletes anyway (store deletes become tombstone updates),
      // and trips (no tombstone) must never be hard-deleted through sync
      // (archive is its lifecycle).
      actions: writable ? ['read', 'create', 'update'] : ['read'],
      realtime: true,
      // Incremental pulls: WHERE updated_at > lastSync (server-stamped by
      // handle_times(), indexed by 0027's *_updated_at_idx).
      changesSince: 'last-sync',
      fieldCreatedAt: 'created_at',
      fieldUpdatedAt: 'updated_at',
      // trips has no tombstone — archive (archived_at) is its lifecycle and
      // account deletion cascades server-side (see 0027 header).
      ...(table === 'trips' ? {} : { fieldDeleted: 'deleted' }),
      // Offline write queue: keep retrying sets until they land (exponential
      // 1s → 30s cap). See header for the RLS-rejection caveat.
      ...(writable ? { retry: { infinite: true, backoff: 'exponential', maxDelay: 30000 } } : {}),
      transform: {
        load: (row: Record<string, unknown>) => sanitizeRow(table, row),
        ...(writable
          ? { save: (row: Record<string, unknown>) => sanitizeWriteRow(table, row, userId) }
          : {}),
      },
      // Persistence is attached ONLY when a real plugin exists. Wave 1
      // passed `plugin: undefined` on the degraded path, but Legend-State's
      // loadLocal throws "Local persist is not configured" when persist.name
      // is set without a resolvable plugin (an unhandled async rejection) —
      // degraded mode must mean NO persist config at all. retrySync persists
      // pending writes + the last-sync watermark in the table's metadata so
      // an offline queue survives restarts (writable roots only need it, but
      // the watermark benefits every root).
      ...(persistencePlugin
        ? {
            persist: {
              name: `tier1/${userId}/${table}`,
              plugin: persistencePlugin,
              retrySync: true,
              // Third C3 layer: sanitize rows COMING OFF DISK. Local store
              // writes persist WITHOUT passing transform.save (that runs on
              // the network path only), so a buggy upstream that shoved a
              // restricted field into an observable could briefly land it in
              // SQLite — this guarantees it dies on the next cold start
              // instead of living there for 30+ days. Whole-table shape:
              // persist transform.load receives the Record<id,row>.
              transform: {
                load: (tableValue: Record<string, Record<string, unknown>> | null | undefined) => {
                  if (!tableValue || typeof tableValue !== 'object') return tableValue;
                  const out: Record<string, Record<string, unknown>> = {};
                  for (const [id, row] of Object.entries(tableValue)) {
                    out[id] = row && typeof row === 'object' ? sanitizeRow(table, row) : row;
                  }
                  return out;
                },
              },
            },
          }
        : {}),
      onError: (error: Error, params?: { type?: string }) => {
        if (params?.type === 'set') recordWriteFailure(table, error);
        else recordHydrationFailure(table, error);
      },
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
 * Boot Tier-1 sync for the signed-in user (read-write for the trips +
 * trip_places slice, read-only elsewhere). Idempotent per process; call
 * after auth resolves (Wave 3 wires this into the app — nothing calls it
 * yet). Resolves fast: hydration continues in the background.
 */
export async function initTier1Sync(opts: { userId: string }): Promise<InitTier1SyncResult> {
  const enabled = await loadTier1SyncFlag();
  if (!enabled) return { started: false, degraded: false };

  if (initializedForUser !== null) {
    // Same user re-init is a resync; a DIFFERENT user requires an app
    // restart (sign-out teardown/clearPersist is a Wave 3 task — per-user
    // persist names already prevent cross-account reads).
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
