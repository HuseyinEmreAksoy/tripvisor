/**
 * directions — "navigate there" deep links (v2 M4 X1.1).
 *
 * Builds a turn-by-turn directions URL for the platform's maps app:
 *   - Android + web → Google Maps universal URL (opens the Google Maps app
 *     when installed, otherwise maps.google.com).
 *   - iOS → Apple Maps (always installed). Apple Maps has no cycling
 *     directions, so `bicycling` falls back to the Google universal URL.
 *
 * Always carries a DESTINATION (the v1 transit link sent an origin only).
 * Origin is optional: omitted, both apps route from the user's location.
 *
 * Pure except `openDirections`, which hands the URL to `Linking` and falls
 * back to the Google URL if the primary app can't be opened.
 */
import { Linking, Platform } from 'react-native';
import type { TransportMode } from '@/api/types';

export interface DirectionsPoint {
  lat: number;
  lng: number;
  /** Google place id — lets Google Maps show the named place, not a bare pin. */
  placeId?: string | null;
  /** Human label (place name) — used by Apple Maps as the pin title. */
  label?: string | null;
}

export interface DirectionsOptions {
  destination: DirectionsPoint;
  origin?: DirectionsPoint | null;
  mode?: TransportMode;
  /** Override for tests; defaults to `Platform.OS`. */
  platform?: typeof Platform.OS;
}

const APPLE_DIRFLG: Partial<Record<TransportMode, string>> = {
  driving: 'd',
  walking: 'w',
  transit: 'r',
};

function coords(p: DirectionsPoint): string {
  return `${p.lat},${p.lng}`;
}

/** Google Maps universal directions URL (https://developers.google.com/maps/documentation/urls). */
export function buildGoogleDirectionsUrl({ destination, origin, mode = 'driving' }: DirectionsOptions): string {
  const params: string[] = ['api=1', `destination=${encodeURIComponent(coords(destination))}`];
  if (destination.placeId) {
    params.push(`destination_place_id=${encodeURIComponent(destination.placeId)}`);
  }
  if (origin) {
    params.push(`origin=${encodeURIComponent(coords(origin))}`);
    if (origin.placeId) params.push(`origin_place_id=${encodeURIComponent(origin.placeId)}`);
  }
  params.push(`travelmode=${mode}`);
  return `https://www.google.com/maps/dir/?${params.join('&')}`;
}

/** Apple Maps directions URL, or null when Apple Maps can't do `mode`. */
export function buildAppleDirectionsUrl({ destination, origin, mode = 'driving' }: DirectionsOptions): string | null {
  const flag = APPLE_DIRFLG[mode];
  if (!flag) return null;
  const params: string[] = [`daddr=${encodeURIComponent(coords(destination))}`];
  if (destination.label) params.push(`q=${encodeURIComponent(destination.label)}`);
  if (origin) params.push(`saddr=${encodeURIComponent(coords(origin))}`);
  params.push(`dirflg=${flag}`);
  return `https://maps.apple.com/?${params.join('&')}`;
}

/** The directions URL for the current (or given) platform. */
export function buildDirectionsUrl(options: DirectionsOptions): string {
  const platform = options.platform ?? Platform.OS;
  if (platform === 'ios') {
    return buildAppleDirectionsUrl(options) ?? buildGoogleDirectionsUrl(options);
  }
  return buildGoogleDirectionsUrl(options);
}

/**
 * Open directions in the maps app. Resolves true when something opened.
 * On failure of the primary URL (e.g. Apple Maps removed) retries Google.
 */
export async function openDirections(options: DirectionsOptions): Promise<boolean> {
  const primary = buildDirectionsUrl(options);
  try {
    await Linking.openURL(primary);
    return true;
  } catch {
    const fallback = buildGoogleDirectionsUrl(options);
    if (fallback === primary) return false;
    try {
      await Linking.openURL(fallback);
      return true;
    } catch {
      return false;
    }
  }
}
