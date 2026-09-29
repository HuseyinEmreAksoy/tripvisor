/**
 * persistence.web.ts — Web persistence plugin for the Tier-1 store
 * (v2 S2.2, risk R5; async warm-up added in S2.8.13 for blocker B1).
 *
 * expo-sqlite's web implementation runs wa-sqlite (WASM) in a Worker with
 * an OPFS-backed VFS, and its SYNCHRONOUS API — which Legend-State's
 * observablePersistSqlite requires — is built on SharedArrayBuffer
 * (web/WorkerChannel.ts allocates SABs for the sync lock/result channel).
 * SharedArrayBuffer only exists under cross-origin isolation: COOP/COEP
 * are sent by the metro dev middleware (metro.config.js) and by Cloudflare
 * Pages via public/_headers (S2.8.10). Safari has no COEP `credentialless`
 * and stays on the in-memory degrade path by design.
 *
 * ── Why this factory is ASYNC (S2.8.13 blocker B1)
 * WorkerChannel's synchronous wait budget is ~24 ms in current Chromium
 * (1,000,000 `Atomics.pause()` spin iterations; ~256 ms on the no-pause
 * fallback). The FIRST-ever sync op additionally has to win a race against
 * worker spawn + wasm compile + OPFS open — hundreds of ms — so a
 * cold-start `getItemSync` deterministically threw "Sync operation
 * timeout" in any modern Chrome and the engine degraded on every load
 * (smoke S2.8.13, B1). Fix: warm the channel with ONE awaited ASYNC op
 * first (the async path has no sync-wait deadline — it boots worker +
 * wasm + OPFS at its own pace), then run the sync probe against the
 * already-warm channel, where the ~24 ms budget is plenty.
 *
 * The warm-up await is BOUNDED (WARMUP_TIMEOUT_MS): a hung or
 * never-booting worker degrades honestly with a clear reason instead of
 * stalling initTier1Sync forever. R5 contract otherwise unchanged: TRY the
 * SQLite/OPFS path; on ANY failure (no SAB, worker/wasm init throws,
 * warm-up timeout) fall back to IN-MEMORY (plugin: undefined) and report
 * `degraded` — never crash, never block startup beyond the bounded await.
 *
 * Lazy `require` (same stance as persistence.native.ts): keeps the
 * worker/wasm graph out of the startup path and lets a bundler-level
 * failure surface as a catchable error here rather than a white screen.
 * In bare node (sync:validate) the require itself throws and we degrade —
 * the node path never reaches the await.
 */

import { guardPersistPlugin, guardStorage } from './persistGuard';
import type { SyncPersistenceResult } from './persistence.types';

const SYNC_DB_NAME = 'tripvisor-sync.db';

/**
 * Upper bound on the async warm-up. A healthy cold boot (worker spawn +
 * wasm compile + OPFS open) is hundreds of ms; 6 s is ~10× headroom for
 * slow hardware while keeping a wedged worker from stalling sync init.
 */
const WARMUP_TIMEOUT_MS = 6000;

/**
 * Await the warm-up probe with a deadline. The probe promise gets a no-op
 * rejection handler up front so a late settle (after losing the race) can
 * never surface as an unhandled rejection.
 */
async function awaitWarmup(probe: Promise<unknown>): Promise<void> {
  probe.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      probe,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `OPFS warm-up timed out after ${WARMUP_TIMEOUT_MS}ms (worker never became ready)`,
              ),
            ),
          WARMUP_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function createSyncPersistence(): Promise<SyncPersistenceResult> {
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

    // B1 warm-up: boot worker + wasm + OPFS over the ASYNC channel (no
    // sync-wait deadline applies), bounded so a hung worker degrades
    // instead of wedging init. See the module header.
    await awaitWarmup(storage.getItemAsync('__sync_probe__'));

    // Sync probe — the capability observablePersistSqlite actually needs.
    // The channel is warm now, so this verifies the SAB sync path itself
    // rather than racing the worker boot.
    storage.getItemSync('__sync_probe__');

    // persistGuard: a table that fails to load (or loads empty) never keeps
    // its incremental last-sync watermark, and oversized values leave a
    // breadcrumb. See persistGuard.ts.
    const guardedStorage = guardStorage(storage);
    const plugin = guardPersistPlugin(
      // observablePersistSqlite only calls get/set/removeItemSync. The cast
      // bridges its nominal SQLiteStorage parameter type.
      observablePersistSqlite(guardedStorage as unknown as typeof storage),
      guardedStorage,
    );
    return { plugin, degraded: false, reason: null };
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
