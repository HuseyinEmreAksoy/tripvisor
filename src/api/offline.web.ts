// Tripvisor Phase 4 — offline cache policy + online detection (web).
//
// See offline.native.ts for the shared allowlist rationale. Web uses
// `navigator.onLine` + `online`/`offline` events — no extra deps.

import { useEffect, useState } from 'react';
import type { Query } from '@tanstack/react-query';

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
