/**
 * persistence.web.ts — Web persistence plugin for the Tier-1 store
 * (v2 S2.2, risk R5).
 *
 * expo-sqlite's web implementation runs wa-sqlite (WASM) in a Worker with
 * an OPFS-backed VFS, and its SYNCHRONOUS API — which Legend-State's
 * observablePersistSqlite requires — is built on SharedArrayBuffer
 * (web/WorkerChannel.ts allocates SABs for the sync lock/result channel).
 * SharedArrayBuffer only exists under cross-origin isolation
 * (COOP/COEP headers), which neither the Expo dev server nor our default
 * Cloudflare Pages deploy currently sends.
 *
 * R5 contract, implemented literally: TRY the SQLite/OPFS path; on ANY
 * failure (no crossOriginIsolated, no SAB, wasm/worker init throws) fall
 * back to IN-MEMORY (plugin: undefined) and report `degraded` — never
 * crash, never block startup. Full offline editing is a native promise;
 * web is read-mostly until the COOP/COEP work lands (tracked for Wave 3 —
 * Cloudflare Pages can set the headers via `_headers`).
 *
 * Lazy `require` (same stance as persistence.native.ts): keeps the
 * worker/wasm graph out of the startup path and lets a bundler-level
 * failure surface as a catchable error here rather than a white screen.
 */

import type { SyncPersistenceResult } from './persistence.types';

const SYNC_DB_NAME = 'tripvisor-sync.db';

export function createSyncPersistence(): SyncPersistenceResult {
  // Fast preflight: without cross-origin isolation the synchronous channel
  // cannot exist — skip the wasm/worker boot entirely.
  if (typeof SharedArrayBuffer === 'undefined') {
    return {
      plugin: undefined,
      degraded: true,
      reason:
        'SharedArrayBuffer unavailable (page is not cross-origin isolated; COOP/COEP headers required) — web store is in-memory this session',
    };
  }
  try {
    const kvStore = require('expo-sqlite/kv-store') as typeof import('expo-sqlite/kv-store');
    const { observablePersistSqlite } =
      require('@legendapp/state/persist-plugins/expo-sqlite') as typeof import('@legendapp/state/persist-plugins/expo-sqlite');

    const storage = new kvStore.SQLiteStorage(SYNC_DB_NAME);
    // Probe forces worker + wasm + OPFS init synchronously, inside the try.
    storage.getItemSync('__sync_probe__');

    return { plugin: observablePersistSqlite(storage), degraded: false, reason: null };
  } catch (e) {
    return {
      plugin: undefined,
      degraded: true,
      reason: `expo-sqlite web (wa-sqlite/OPFS) init failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
}
