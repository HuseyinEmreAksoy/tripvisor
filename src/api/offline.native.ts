// Tripvisor Phase 4 — offline cache policy + online detection (native).
//
// Query-key allowlist enforced via TanStack Query's `shouldDehydrateQuery`.
// Only durable, ToS-safe query keys are persisted. Google-ToS-restricted keys
// (`place-details`, `places-autocomplete`) are explicitly never persisted —
// they live only in memory for the lifetime of the process.

import { useEffect, useState } from 'react';
import type { Query } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';

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

export function shouldDehydrateQuery(query: Query): boolean {
  const root = query.queryKey[0];
  if (typeof root !== 'string') return false;
  return PERSIST_ROOTS.has(root);
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
