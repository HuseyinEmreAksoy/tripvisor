// Tripvisor Phase 4 — offline cache policy + online detection (native).
//
// Query-key allowlist enforced via TanStack Query's `shouldDehydrateQuery`.
// Only durable, ToS-safe query keys are persisted. Google-ToS-restricted keys
// (`place-details`, `places-autocomplete`) are explicitly never persisted —
// they live only in memory for the lifetime of the process.

import { useEffect, useState } from 'react';
import type { Query } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { isTier1PersistenceDegraded } from '@/sync/hydrate';
import { isTier1SyncActive } from '@/sync/mutations';

/**
 * Per ADR-0005: persist only these query key shapes.
 *
 *   ["trips", ...]        trip list + detail queries
 *   ["trip-places", id]   places on a trip
 *   ["trip-legs", id]     legs (travel segments) on a trip
 *
 * Everything else (notably `place-details` and `places-autocomplete`) is
 * memory-only — Google ToS forbids persisting those payloads beyond the
 * process lifetime, and this allowlist is the single enforcement point.
 */
const PERSIST_ROOTS: ReadonlySet<string> = new Set([
  'trips',
  'trip-places',
  'trip-legs',
]);

/**
 * S2.8.11: roots whose DURABILITY moves to the Tier-1 sync store once the
 * engine is active with real (SQLite) persistence attached. Keeping the
 * TanStack persister writing them too would (a) double-spend the
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
 *   active                 | attached (SQLite)      | SKIP — Tier-1 owns           | DEHYDRATE | never
 *                          |                        |   their durability           |           |
 *   active                 | DEGRADED (in-memory:   | DEHYDRATE — degraded clients | DEHYDRATE | never
 *                          |   pre-S1 dev client)   |   must never regress below   |           |
 *                          |                        |   v1 offline reads           |           |
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

let lastKnownOnline = true;

// Subscribe once at module load so `isOnline()` stays fresh even when no hook
// is mounted. Cheap — NetInfo dedupes subscribers.
NetInfo.addEventListener((state) => {
  // `isInternetReachable` is the stricter signal; fall back to `isConnected`
  // when it's indeterminate (null) because the OS hasn't probed yet.
  const reachable =
    state.isInternetReachable === null ? state.isConnected : state.isInternetReachable;
  lastKnownOnline = Boolean(reachable);
});

export function isOnline(): boolean {
  return lastKnownOnline;
}

export function useIsOnline(): boolean {
  const [online, setOnline] = useState<boolean>(lastKnownOnline);
  useEffect(() => {
    // Re-seed immediately from the current snapshot.
    NetInfo.fetch().then((state) => {
      const reachable =
        state.isInternetReachable === null ? state.isConnected : state.isInternetReachable;
      setOnline(Boolean(reachable));
    });
    const unsub = NetInfo.addEventListener((state) => {
      const reachable =
        state.isInternetReachable === null ? state.isConnected : state.isInternetReachable;
      setOnline(Boolean(reachable));
    });
    return () => unsub();
  }, []);
  return online;
}
