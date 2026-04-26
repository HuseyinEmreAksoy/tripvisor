/**
 * useTripUseMyLocation — persists the "From my location" toggle per trip.
 *
 * Backed by AsyncStorage (works on web and native via RN Web adapter).
 * Key: `tripvisor:useMyLocation:<tripId>`.
 *
 * Default: false. Async load on mount — `enabled` starts false until
 * AsyncStorage resolves. Writes are synchronous from the caller's
 * perspective (optimistic local state update + background persist).
 *
 * Phase 24 Step 24.8.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const PREFIX = 'tripvisor:useMyLocation:';

export interface UseTripUseMyLocationResult {
  enabled: boolean;
  setEnabled: (next: boolean) => void;
}

export function useTripUseMyLocation(tripId: string): UseTripUseMyLocationResult {
  const [enabled, setEnabledState] = useState(false);

  // Load persisted value on mount (or when tripId changes).
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(PREFIX + tripId)
      .then((raw) => {
        if (!cancelled && raw !== null) {
          setEnabledState(raw === 'true');
        }
      })
      .catch(() => {
        // Silently ignore storage errors — default false is safe.
      });
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const setEnabled = useCallback(
    (next: boolean) => {
      setEnabledState(next);
      // Fire-and-forget persist — we don't await because the UI should feel
      // instant. A failed write is non-critical: the toggle resets on the
      // next session, which is acceptable for a UX preference.
      AsyncStorage.setItem(PREFIX + tripId, String(next)).catch(() => {
        // Swallow storage errors.
      });
    },
    [tripId],
  );

  return { enabled, setEnabled };
}
