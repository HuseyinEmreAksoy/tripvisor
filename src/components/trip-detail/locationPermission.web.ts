/**
 * locationPermission (web) — read the geolocation permission WITHOUT
 * prompting (v2 M4 X2.2). MapTab uses it to decide whether a persisted
 * "From my location" intent may fetch a fix on mount: only when the browser
 * already granted access. A prompt must only ever follow a user gesture.
 *
 * Platform split: consumers import './locationPermission'; Metro picks this
 * file on web and locationPermission.native.ts on iOS/Android.
 */
export type LocationPermissionState = 'granted' | 'prompt' | 'denied' | 'unknown';

export async function getLocationPermissionState(): Promise<LocationPermissionState> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown';
    const res = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return res.state === 'granted' || res.state === 'denied' ? res.state : 'prompt';
  } catch {
    // Safari < 16 and some embedded webviews reject the geolocation query.
    return 'unknown';
  }
}
