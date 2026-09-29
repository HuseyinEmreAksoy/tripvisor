/**
 * wipe.ts — RAW Tier-1 storage wipe for ACCOUNT DELETION (v2 S2.8.11,
 * ADR-0010 §2).
 *
 * The ONE lifecycle event allowed to delete Tier-1 data from disk. Plain
 * sign-out NEVER does this (see teardownTier1Sync in hydrate.ts — the
 * privacy boundary there is the per-user persist namespace + OS sandbox /
 * per-origin OPFS).
 *
 * WHY RAW, NEVER THROUGH THE ENGINE
 * ---------------------------------
 * `tier1Store$.<root>[id].delete()` (or `.set({})`) is a STORE EDIT: on the
 * write-enabled roots the attached syncedSupabase engine diffs it as a mass
 * tombstone-delete and would emit `UPDATE … SET deleted = true` per row —
 * against an account that is being deleted server-side, that is at best
 * infinite-retry fodder and at worst data destruction if the deletion
 * half-fails. So this module goes UNDERNEATH the engine: it removes the
 * persisted keys from the expo-sqlite kv-store directly, exactly as the
 * persistence plugin wrote them.
 *
 * Key layout being wiped (must track hydrate.ts + the Legend-State plugin):
 *   - hydrate.ts persists each root under  `tier1/<userId>/<table>`
 *   - observablePersistSqlite additionally stores per-table sync metadata
 *     (last-sync watermark, pending writes) under `<name>__m`, i.e.
 *     `tier1/<userId>/<table>__m`
 * Both shapes share the `tier1/<userId>/` prefix, so a prefix sweep over
 * getAllKeys covers current AND future roots without a table list to drift.
 *
 * Storage backend (both platforms, see persistence.native/web): expo-sqlite
 * kv-store `SQLiteStorage('tripvisor-sync.db')` — native SQLite on iOS/
 * Android, wa-sqlite/OPFS on web. We use the ASYNC kv API here: it does not
 * need SharedArrayBuffer, so a previously-persisted OPFS database can be
 * wiped even from a session whose SYNC persistence is degraded (e.g. the
 * COOP/COEP headers were since removed). The TanStack/AsyncStorage cache is
 * NOT this module's concern — the delete-account flow already clears the
 * QueryClient, and its persister rewrites the cleared cache.
 *
 * BEST-EFFORT CONTRACT (plan S2.8.11): callers must treat failure as
 * non-fatal — the account is already gone server-side, so leftover local
 * rows are unreadable dead weight, not a server-state risk. Failures emit a
 * Sentry breadcrumb and resolve (never throw, never block the sign-out).
 *
 * CALL ORDER + RESTART CAVEAT: call teardownTier1Sync() FIRST so the engine
 * is gated off while we sweep. The beta plugin keeps an in-memory copy of
 * each persisted table and re-saves on any observable change, and teardown
 * cannot detach the attachments — so a late realtime event in the same
 * process could theoretically re-persist a key after the sweep. Accepted:
 * the session is ending (sign-out revokes the JWT, killing realtime), and a
 * process restart leaves nothing to re-persist. Documented restart
 * requirement per the plan's race mitigation.
 */

import { Sentry } from '../lib/sentry';

/**
 * Must match SYNC_DB_NAME in persistence.native.ts / persistence.web.ts —
 * those modules deliberately keep the constant private ("a future wipe must
 * never touch anything else" is enforced by this being the ONLY other place
 * that opens the database).
 */
const SYNC_DB_NAME = 'tripvisor-sync.db';

export interface WipeTier1Result {
  /** false = best-effort wipe failed (breadcrumbed); caller proceeds anyway. */
  ok: boolean;
  /** Number of `tier1/<userId>/…` keys removed (tables + `__m` metadata). */
  removedKeys: number;
  reason: string | null;
}

/**
 * Remove every persisted Tier-1 key for `userId` from the sync kv-store.
 * Raw storage removal only — never touches the Legend-State observables.
 */
export async function wipeTier1PersistedStorage(userId: string): Promise<WipeTier1Result> {
  if (!userId) return { ok: false, removedKeys: 0, reason: 'no userId' };
  const prefix = `tier1/${userId}/`;
  // M5 Y2.1: the durable photo upload queue keeps re-encoded images of this
  // user on the device (AsyncStorage manifest + document-dir files / web
  // IndexedDB) until they upload. Account deletion drops them too. Lazy
  // require: keeps the queue off this module's import graph; best-effort
  // (the helper never throws), same contract as the rest of this wipe.
  try {
    const queue = require('../api/memories.upload-queue') as typeof import('../api/memories.upload-queue');
    await queue.wipePhotoUploadQueue(userId);
  } catch {
    // queue module unavailable — nothing queued through it
  }
  try {
    // Lazy require, same stance as persistence.native/web: expo-sqlite is a
    // native module riding the S1 dev-client rebuild — a top-level import
    // would crash older clients at module-eval even when never called.
    const kvStore = require('expo-sqlite/kv-store') as typeof import('expo-sqlite/kv-store');
    const storage = new kvStore.SQLiteStorage(SYNC_DB_NAME);
    const keys = await storage.getAllKeysAsync();
    const mine = keys.filter((k) => k.startsWith(prefix));
    if (mine.length > 0) {
      await storage.multiRemove(mine);
    }
    return { ok: true, removedKeys: mine.length, reason: null };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    try {
      Sentry.addBreadcrumb({
        category: 'sync',
        level: 'warning',
        message: 'tier-1 raw storage wipe failed (account deletion) — leftover local rows are inert',
        data: { reason },
      });
    } catch {
      // Sentry unavailable (no DSN / test env) — best-effort stays best-effort.
    }
    return { ok: false, removedKeys: 0, reason };
  }
}
