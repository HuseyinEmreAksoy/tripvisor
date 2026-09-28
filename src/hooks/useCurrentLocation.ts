/**
 * useCurrentLocation — cross-platform current-position hook.
 *
 * Platform split handled inside one file via Platform.OS check:
 *   - web:    uses navigator.geolocation.getCurrentPosition
 *   - native: uses expo-location (requestForegroundPermissionsAsync +
 *             getCurrentPositionAsync)
 *
 * The hook is LAZY: it does NOT auto-request permission on mount.
 * Call `request()` to trigger the permission + position fetch.
 *
 * Signature:
 *   const { location, status, request } = useCurrentLocation();
 *
 * - `location`: { lat: number; lng: number } | null
 * - `status`:   'idle' | 'requesting' | 'granted' | 'denied' | 'error' | 'unavailable'
 *     - 'error'       — transient failure (timeout / position unavailable);
 *                       retryable, call `request()` again.
 *     - 'unavailable' — no geolocation capability at all (no
 *                       navigator.geolocation, expo-location missing).
 * - `request`:  async () => void
 *
 * Phase 24 Step 24.7.
 */
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';

export type LocationStatus =
  | 'idle'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'error'
  | 'unavailable';

export interface CurrentLocation {
  lat: number;
  lng: number;
}

export interface UseCurrentLocationResult {
  location: CurrentLocation | null;
  status: LocationStatus;
  request: () => Promise<void>;
}

export function useCurrentLocation(): UseCurrentLocationResult {
  const [location, setLocation] = useState<CurrentLocation | null>(null);
  const [status, setStatus] = useState<LocationStatus>('idle');

  const request = useCallback(async () => {
    if (status === 'requesting') return; // debounce double-tap

    setStatus('requesting');

    if (Platform.OS === 'web') {
      // ── Web: navigator.geolocation ──────────────────────────────────────
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        setStatus('unavailable');
        return;
      }

      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
            setStatus('granted');
            resolve();
          },
          (err) => {
            // GeolocationPositionError.code:
            //   1 = PERMISSION_DENIED
            //   2 = POSITION_UNAVAILABLE
            //   3 = TIMEOUT
            // 2/3 are transient (indoors, GPS cold start) — retryable 'error',
            // not the permanent 'unavailable' that hides the control.
            setStatus(err.code === 1 ? 'denied' : 'error');
            resolve();
          },
          { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
        );
      });
      return;
    }

    // ── Native: expo-location ─────────────────────────────────────────────
    // Belt-and-suspenders: import inside the function so a missing package
    // doesn't crash the module on web (though Metro will never bundle this
    // branch on web).
    let Location: typeof import('expo-location');
    try {
      // Dynamic require keeps the web bundle clean; on native Metro statically
      // includes this because Platform.OS === 'native' is always true.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      Location = require('expo-location') as typeof import('expo-location');
    } catch {
      // expo-location not installed (e.g. bare workflow without native
      // rebuild) — the capability genuinely doesn't exist.
      setStatus('unavailable');
      return;
    }

    try {
      const { status: permStatus } =
        await Location.requestForegroundPermissionsAsync();

      if (permStatus !== 'granted') {
        setStatus('denied');
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setStatus('granted');
    } catch {
      // Location services off, timeout, no fix — transient and retryable.
      setStatus('error');
    }
  }, [status]);

  return { location, status, request };
}
