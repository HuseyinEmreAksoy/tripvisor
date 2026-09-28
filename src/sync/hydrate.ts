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
 *     persistence plugin attached (native with the S1 dev client; web on
 *     cross-origin-isolated browsers — COOP/COEP shipped in S2.8.10, the
 *     OPFS worker warm-up in S2.8.13/B1; Safari stays degraded). On the
 *     in-memory degrade path (non-isolated web, node) offline writes retry
 *     within the session but DIE WITH THE PROCESS. Surfaced via the
 *     existing `degraded` telemetry.
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
 * the column everywhere first. For TRIPS specifically (the one root with no
 * tombstone at all) the full coverage analysis + accepted ghost-trip window
 * is the F5 contract note inside attachEntity, next to the fieldDeleted
 * config line (S2.8.13 triage verdict: documented acceptance, no config
 * change).
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
  markSyncStopped,
  recordDroppedField,
  recordEntityHydrated,
  recordEntityRowCount,
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

  // F5 (S2.8.13): own the plugin's dev-only config warning for trips. The
  // very next call below makes syncedSupabase print "[legend-state]
  // fieldDeleted is required when using last-sync mode" ONCE (dev builds
  // only, at config time — supabase.js gates on NODE_ENV==='development').
  // That warning is the EXPECTED signature of a deliberate choice, not a
  // regression — see the fieldDeleted contract note below for the full
  // hard-delete coverage analysis. This info line lands adjacent to it in
  // the console so the pairing is self-explanatory.
  if (table === 'trips' && typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info(
      '[sync] expected: the next legend-state "fieldDeleted is required" dev warning is the trips root — trips deliberately has no tombstone (archive is its lifecycle, migration 0027). Hard-delete coverage: same-device D5 prune + realtime DELETE events; an other-device hard-delete while this device is offline leaves a ghost row (accepted — see hydrate.ts attachEntity).',
    );
  }

  const state$ = syncObservable(
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
      //
      // F5 CONTRACT (S2.8.13, documented acceptance — verdict: NO config
      // change). last-sync mode without fieldDeleted means a HARD DELETE of
      // a trip cannot replicate through incremental pulls (no row left to
      // carry the fact; the plugin dev-warns about exactly this at attach —
      // owned by the console.info above). Trip-removal coverage as shipped:
      //   1. same-device hard-delete (flag-on): legacy PostgREST DELETE +
      //      pruneTripFromLocalStore after server ack (S2.8.4/D5) — covered.
      //   2. archive: a plain updated_at row change — replicates — covered.
      //   3. other-device hard-delete while THIS device's realtime channel
      //      is up: the supabase plugin's subscribe handler processes
      //      eventType DELETE (old[symbolDelete] = true → row removed;
      //      verified in beta.47 sync-plugins/supabase.js) — covered,
      //      best-effort (no replay across socket drops, issue #362).
      //   4. other-device hard-delete while this device is offline/socket
      //      down: NOT covered — the reconnect force-pull is still an
      //      incremental `updated_at > lastSync` query and cannot observe a
      //      vanished row. The ghost trip persists until the persisted
      //      store/watermark is discarded (fresh device, account-deletion
      //      wipe); with OPFS/SQLite persistence attached there is no
      //      "next full pull" that would re-baseline it. ACCEPTED for this
      //      phase: trips hard-delete is owner-initiated and rare, the
      //      ghost is read-only stale (writes against it fail server-side
      //      and surface as write errors in the status sheet) — revisit
      //      when trip sharing makes cross-client deletes common.
      // Do NOT "fix" by adding fieldDeleted here: D5's prune-no-echo
      // contract DEPENDS on its absence (with fieldDeleted a store-level
      // delete becomes UPDATE … SET deleted=true against a row the server
      // already hard-deleted → zero-row update retried forever). And 'all'
      // mode would not help either — mode:'merge' never evicts absent ids,
      // and mode:'set' would clobber pending offline creates.
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

  // ── lastSyncAt stamping (S2.8.13/B2) ──────────────────────────────────
  // The obs$.onChange listener below only fires when row DATA changes — a
  // root whose pull returns ZERO rows never changes the observable, never
  // got stamped, and telemetry's lastSyncAgeMs (which requires a stamp on
  // EVERY entity) stayed null forever: the pill could never reach "Synced"
  // for any user with one empty root (smoke S2.8.13, B2). Stamp from the
  // engine's own sync state instead — beta.47 sets `isLoaded: true` and
  // `isGetting: false` when a get COMPLETES, row count irrelevant
  // (sync.js `handle()`):
  //   - isLoaded false→true  = the FIRST remote load finished;
  //   - isGetting true→false = EVERY later pull finished (resyncTier1's
  //     reconnect/foreground re-pulls re-stamp empty roots too).
  // First load fires both (one double-stamp, idempotent); failures never
  // set isLoaded and land in onError → recordHydrationFailure as before.
  const stampHydrated = () => {
    const value = obs$.peek();
    recordEntityHydrated(table, value ? Object.keys(value).length : 0);
  };
  state$.isLoaded.onChange(({ value }) => {
    if (value === true) stampHydrated();
  });
  state$.isGetting.onChange(({ value }) => {
    if (value === false && state$.isLoaded.peek() === true) stampHydrated();
  });

  // Row-count (+ last-sync once remotely loaded) telemetry. A shallow
  // listener is enough — any hydration/realtime merge fires it; tables are
  // small (per-user data). X1.3: BEFORE the first remote load completes a
  // data change can only be the persisted (OPFS/SQLite) cold-start load or a
  // local edit — neither is server contact, so it updates the row count but
  // must NOT stamp lastSyncAt (with B1 fixed, disk loads now really happen
  // and would otherwise show "Synced · now" on an offline cold start).
  // After isLoaded, changes are realtime merges/pull results → stamp.
  obs$.onChange(({ value }) => {
    const rows = value ? Object.keys(value).length : 0;
    if (state$.isLoaded.peek() === true) recordEntityHydrated(table, rows);
    else recordEntityRowCount(table, rows);
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
 * Session user the engine is ACTIVE for, or null when inactive (flag off /
 * never initialized / torn down). The S2.8.3 read facades use this to derive
 * `isOwner` and to backfill `user_id` on locally-created rows that have not
 * been acked yet (sync creates deliberately omit user_id — it is stamped at
 * the write boundary by sanitizeWriteRow, so the only client whose store can
 * contain a user_id-less row is the engine user's own).
 */
export function getTier1SyncUserId(): string | null {
  return initializedForUser;
}

/**
 * S2.8.4 (decision D5) — drop a hard-DELETED trip from the LOCAL Tier-1
 * store WITHOUT echoing a network write.
 *
 * Trip hard-delete stays on the legacy PostgREST path even flag-on (trips
 * have no tombstone by design — 0027: archive is their lifecycle). After the
 * server acks the DELETE, the hydrated row must leave the local store, but
 * `trips` is sync-attached — so the prune has to be a store write the engine
 * provably treats as a no-op:
 *
 *   - attachEntity configures trips with `actions: ['read','create','update']`
 *     (no 'delete') and NO `fieldDeleted` (the trips-only exception above).
 *   - The crud plugin's set() handler routes a store-level delete through:
 *     deleteFn? → (fieldDeleted && updateFn)? → `console.warn("[legend-state]
 *     missing delete function")`. With neither configured for trips it takes
 *     the warn branch: NO outbound request, and the change resolves without
 *     retry-queue residue. Verified against @legendapp/state 3.0.0-beta.47
 *     (sync-plugins/crud.js, "Handle deletes" block); Step S2.8.12's validate
 *     extension asserts zero network writes for this op before the flag
 *     flips. The dev-console warn IS the expected signature of the no-op
 *     branch — do not "fix" it by adding a delete action.
 *
 * DO NOT generalize this to trip_places (or any root with `fieldDeleted`
 * configured): there a store-level delete IS interpreted as a local edit and
 * EMITS `UPDATE … SET deleted = true` — a real network write.
 *
 * Known, accepted leftover: the deleted trip's trip_places rows were
 * hard-deleted server-side by FK cascade, which incremental pulls cannot
 * observe (no row left to carry the fact). Those store rows go stale but are
 * unreachable — every read facade selects places by trip, and the trip is
 * gone from both the store and the server. Store-deleting them here would
 * echo tombstone UPDATEs against rows that no longer exist (infinite-retry
 * fodder), so we deliberately leave them.
 *
 * Fallback if S2.8.12 disproves the no-op (plan risk): replace this with a
 * facade-level deleted-ids session set and re-plan only this seam.
 */
export function pruneTripFromLocalStore(tripId: string): void {
  const row = tier1Store$.trips[tripId]?.peek();
  if (!row) return; // never hydrated (flag off / other user) — nothing to prune
  tier1Store$.trips[tripId]?.delete();
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
 * trip_places slice, read-only elsewhere). Idempotent per process; called
 * fire-and-forget from the auth listener (src/api/auth.ts). Resolves after
 * the bounded persistence warm-up (web ≤ ~6 s worst case, typically <1 s;
 * native immediate — S2.8.13/B1); hydration continues in the background.
 * Concurrent same-user calls share one boot (bootInFlight below).
 */
export async function initTier1Sync(opts: { userId: string }): Promise<InitTier1SyncResult> {
  const enabled = await loadTier1SyncFlag();
  if (!enabled) return { started: false, degraded: false };

  // syncObservable attachments are permanent for the process lifetime (the
  // beta exposes no unsubscribe) — track which user they were built for
  // separately from whether the engine is currently ACTIVE (teardown gates
  // activity without detaching).
  if (attachedForUser !== null) {
    if (attachedForUser === opts.userId) {
      // Same user re-init (or sign-in after sign-out): resume + resync.
      // markSyncEnabled re-shows the pill after a teardown's markSyncStopped
      // (X1.3: previously a sign-out → sign-in left the pill hidden).
      const wasActive = initializedForUser !== null;
      initializedForUser = opts.userId;
      if (!wasActive) markSyncEnabled();
      resyncTier1();
      return { started: true, degraded: lastPersistenceDegraded };
    }
    // A DIFFERENT user in the same process requires an app restart — the
    // engine's per-table sync state is bound to the first user's persist
    // namespace (which already prevents cross-account disk reads).
    return { started: false, degraded: false };
  }

  // S2.8.13/B1: createSyncPersistence is now ASYNC (web awaits a BOUNDED
  // OPFS worker warm-up, ≤ ~6 s worst case and typically well under 1 s;
  // native resolves in one tick). Blocking on it here is fine — the auth
  // listener (src/api/auth.ts) calls initTier1Sync fire-and-forget, so app
  // startup is never gated on the warm-up. BUT the await breaks the old
  // invariant that check→attach was synchronous, so concurrent calls (the
  // auth listener can fire SIGNED_IN + TOKEN_REFRESHED back-to-back) must
  // share one boot instead of double-attaching every root.
  //
  // Sign-out DURING the await (teardownTier1Sync while bootInFlight) sets
  // bootCancelled: the boot still attaches (so a later same-user sign-in
  // takes the cheap resume path and the SQLite DB is never opened twice —
  // exactly the state a teardown right after boot leaves), but it does NOT
  // activate the engine. A same-user init arriving mid-boot un-cancels.
  if (bootInFlight) {
    if (bootInFlightUser !== opts.userId) {
      return { started: false, degraded: false }; // different user mid-boot: same "restart required" answer as post-attach
    }
    bootCancelled = false;
    return bootInFlight;
  }
  bootInFlightUser = opts.userId;
  bootCancelled = false;
  bootInFlight = (async (): Promise<InitTier1SyncResult> => {
    const persistence = await createSyncPersistence();
    persistencePlugin = persistence.plugin;
    lastPersistenceDegraded = persistence.degraded;
    if (persistence.degraded) {
      markSyncDegraded(persistence.reason ?? 'unknown');
    }

    for (const key of TIER1_STORE_KEYS) {
      attachEntity(key, opts.userId);
    }
    attachReconnectResync();
    attachedForUser = opts.userId;
    if (bootCancelled) {
      // Signed out mid-boot: attached but inactive (see above).
      return { started: false, degraded: persistence.degraded };
    }
    initializedForUser = opts.userId;
    markSyncEnabled();
    return { started: true, degraded: persistence.degraded };
  })();
  const inFlight = bootInFlight;
  try {
    return await inFlight;
  } finally {
    if (bootInFlight === inFlight) {
      bootInFlight = null;
      bootInFlightUser = null;
      bootCancelled = false;
    }
  }
}

let attachedForUser: string | null = null;
let lastPersistenceDegraded = false;
let bootInFlight: Promise<InitTier1SyncResult> | null = null;
let bootInFlightUser: string | null = null;
/** teardownTier1Sync ran while bootInFlight — finish attaching, don't activate. */
let bootCancelled = false;

/** Is the engine the ACTIVE write path right now? (mutations.ts gates on this.) */
export function isTier1SyncInitialized(): boolean {
  return initializedForUser !== null;
}

/**
 * S2.8.11 — is the ACTIVE engine's persistence DEGRADED to in-memory?
 * (web without COOP/COEP → no SharedArrayBuffer → no OPFS; native on a
 * pre-S1 dev client → no expo-sqlite. See persistence.web/native, risk R5.)
 *
 * Consumers: the TanStack persister allowlist (src/api/offline.*) keeps
 * dehydrating trips/trip-places for degraded clients so their offline reads
 * never regress below v1 (ADR-0010 §3). Cheap synchronous module-var read —
 * safe to call from shouldDehydrateQuery on every (throttled) dehydration.
 *
 * Meaningful only while the engine is active (`isTier1SyncActive()`); before
 * the first initTier1Sync it returns false, which is why callers must gate
 * on activity FIRST.
 */
export function isTier1PersistenceDegraded(): boolean {
  return lastPersistenceDegraded || persistencePlugin === undefined;
}

/**
 * Sign-out teardown (S2.8 partial). HONESTY: the beta plugin has no clean
 * detach — syncObservable attachments live until the process dies. What this
 * CAN safely do is gate the engine off: `initializedForUser = null` makes
 * isTier1SyncActive() false, so the mutation layer throws `sync_inactive`
 * and callers fall back to the v1 hooks. We deliberately do NOT clear the
 * store observables: on the write-enabled roots a `.set({})` would diff as
 * mass tombstone-deletes and the attached engine would happily sync them.
 * Cross-account safety comes from the per-user persist namespace + RLS; a
 * different-user sign-in in the same process returns started:false
 * (restart required), documented in initTier1Sync.
 *
 * POLICY (ADR-0010 §2, binding): plain sign-out NEVER clears Tier-1 stores —
 * neither the observables (mass-tombstone risk above) nor the on-disk
 * persist namespaces (`tier1/<userId>/<table>`). The privacy boundary is the
 * per-user namespacing + the OS app sandbox / per-origin OPFS; the
 * accepted consequence is that a signed-out device retains the last user's
 * encrypted-at-rest Tier-1 data until they sign back in. The ONE lifecycle
 * event that wipes disk state is ACCOUNT DELETION, via the RAW storage path
 * in src/sync/wipe.ts (never through the engine — see that module's header).
 */
export function teardownTier1Sync(): void {
  // Sign-out while the (async, S2.8.13/B1) boot is still warming up: the
  // boot must not activate the engine when it lands (X1.3).
  if (bootInFlight) bootCancelled = true;
  if (initializedForUser === null) return;
  initializedForUser = null;
  markSyncStopped();
}
