/**
 * locationPermission (native) — read the foreground location permission
 * WITHOUT prompting (v2 M4 X2.2). See locationPermission.web.ts.
 */
export type LocationPermissionState = 'granted' | 'prompt' | 'denied' | 'unknown';

export async function getLocationPermissionState(): Promise<LocationPermissionState> {
  try {
    // Lazy require mirrors useCurrentLocation: a missing native module must
    // not crash the map screen.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Location = require('expo-location') as typeof import('expo-location');
    const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
    if (status === 'granted') return 'granted';
    if (status === 'denied' && !canAskAgain) return 'denied';
    return 'prompt';
  } catch {
    return 'unknown';
  }
}
