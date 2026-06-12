// Tripvisor Phase 4 — offline cache policy + online detection (web).
//
// See offline.native.ts for the shared allowlist rationale. Web uses
// `navigator.onLine` + `online`/`offline` events — no extra deps.

import { useEffect, useState } from 'react';
import type { Query } from '@tanstack/react-query';
import { isTier1PersistenceDegraded } from '@/sync/hydrate';
import { isTier1SyncActive } from '@/sync/mutations';

const PERSIST_ROOTS: ReadonlySet<string> = new Set([
  'trips',
  'trip-places',
  'trip-legs',
]);

/**
 * S2.8.11: roots whose DURABILITY moves to the Tier-1 sync store once the
 * engine is active with real (SQLite/OPFS) persistence attached. Keeping
 * the TanStack persister writing them too would (a) double-spend the
 * AsyncStorage budget and (b) leave a stale flag-off-shaped snapshot that
 * could render after a future flag flip-back. `trip-legs` is deliberately
 * NOT here: legs are server-authoritative (C1) and not a Tier-1 root —
 * the TanStack persister remains their only client-side durability.
 */
const TIER1_OWNED_ROOTS: ReadonlySet<string> = new Set(['trips', 'trip-places']);

/**
 * Dehydration matrix (S2.8.11, ADR-0010 §3) — flag × persistence × key root.
 * Runs on every (throttled) dehydration cycle, so all checks below are cheap
 * synchronous module-variable reads (no awaits, no I/O):
 *
 *   Tier-1 engine          | persistence            | trips / trip-places          | trip-legs | everything else
 *   -----------------------|------------------------|------------------------------|-----------|----------------
 *   inactive (flag off /   | —                      | DEHYDRATE (v1 behavior,      | DEHYDRATE | never (Google
 *     torn down)           |                        |   byte-identical)            |           |   ToS allowlist)
 *   active                 | attached (SQLite/OPFS) | SKIP — Tier-1 owns           | DEHYDRATE | never
 *                          |                        |   their durability           |           |
 *   active                 | DEGRADED (in-memory:   | DEHYDRATE — degraded clients | DEHYDRATE | never
 *                          |   web w/o COOP/COEP,   |   must never regress below   |           |
 *                          |   pre-S1 dev client)   |   v1 offline reads           |           |
 */
export function shouldDehydrateQuery(query: Query): boolean {
  const root = query.queryKey[0];
  if (typeof root !== 'string') return false;
  if (!PERSIST_ROOTS.has(root)) return false;
  if (TIER1_OWNED_ROOTS.has(root) && isTier1SyncActive() && !isTier1PersistenceDegraded()) {
    return false;
  }
  return true;
}

// ---- Online detection -----------------------------------------------------

function readOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  // `navigator.onLine` is `true` by default in Node/SSR shims; the only signal
  // we treat as "definitely offline" is an explicit `false`.
  return navigator.onLine !== false;
}

export function isOnline(): boolean {
  return readOnline();
}

export function useIsOnline(): boolean {
  const [online, setOnline] = useState<boolean>(readOnline());
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener('online', onUp);
    window.addEventListener('offline', onDown);
    // Re-seed in case the event fired before mount.
    setOnline(readOnline());
    return () => {
      window.removeEventListener('online', onUp);
      window.removeEventListener('offline', onDown);
    };
  }, []);
  return online;
}
