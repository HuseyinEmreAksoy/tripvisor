/**
 * persistence.native.ts — iOS/Android persistence plugin for the Tier-1
 * store (v2 S2.2): expo-sqlite kv-store behind Legend-State's
 * observablePersistSqlite (a fully SYNCHRONOUS plugin — getItemSync /
 * setItemSync over JSI, which is exactly why expo-sqlite beats
 * AsyncStorage here: cold-start hydration is one synchronous read, no
 * async waterfall before first paint).
 *
 * Lazy `require`, not a top-level import: expo-sqlite is a NATIVE module
 * that rides the pending S1 dev-client rebuild. On a dev client built
 * before it, `requireNativeModule('ExpoSQLite')` throws at module-eval
 * time — a top-level import would crash the app on startup even with the
 * sync flag OFF. The require only runs inside createSyncPersistence(),
 * which hydrate.ts calls after the flag check, and any throw degrades to
 * in-memory (risk R5 contract: never crash).
 *
 * ASYNC SIGNATURE (S2.8.13/B1): the factory is async only to match the
 * unified cross-platform contract — persistence.web.ts must await an OPFS
 * worker warm-up before its sync probe. Native has no worker to warm
 * (expo-sqlite is synchronous over JSI), so this resolves in one tick;
 * every throw below still lands in the catch because async functions
 * convert sync throws into rejections.
 */

import type { SyncPersistenceResult } from './persistence.types';

/** Dedicated DB so a future "wipe sync cache" never touches anything else. */
const SYNC_DB_NAME = 'tripvisor-sync.db';

export async function createSyncPersistence(): Promise<SyncPersistenceResult> {
  try {
    // Type-only imports are erased at compile time; the requires below are
    // the only runtime touch of the native module.
    const kvStore = require('expo-sqlite/kv-store') as typeof import('expo-sqlite/kv-store');
    const { observablePersistSqlite } =
      require('@legendapp/state/persist-plugins/expo-sqlite') as typeof import('@legendapp/state/persist-plugins/expo-sqlite');

    const storage = new kvStore.SQLiteStorage(SYNC_DB_NAME);
    // Probe: forces the lazy database open NOW so a missing/broken native
    // module surfaces here (inside the try) instead of mid-hydration.
    storage.getItemSync('__sync_probe__');

    return { plugin: observablePersistSqlite(storage), degraded: false, reason: null };
  } catch (e) {
    return {
      plugin: undefined,
      degraded: true,
      reason: `expo-sqlite unavailable on this build (pre-S1 dev client?): ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
}
