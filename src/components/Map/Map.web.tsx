/**
 * Map.web.tsx — web map provider dispatcher (v2 Phase N5.1).
 *
 * Default provider: MapLibre GL + OpenFreeMap (MapLibreMap.web.tsx) — no API
 * key, no quota, works zero-config. The legacy Google Maps JS implementation
 * (GoogleMap.web.tsx) stays available behind a runtime switch:
 *
 *   provider := providerOverride            (test-only escape hatch)
 *            ?? app_config.map_provider_web (remote kill-switch, useAppConfig)
 *            ?? EXPO_PUBLIC_MAP_PROVIDER    (build-time default)
 *            ?? 'maplibre'
 *
 * When provider='google' without EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY, GoogleMap
 * renders the existing <MapUnavailable> fallback — unchanged behavior.
 *
 * Both providers are require()-deferred (same pattern as useCurrentLocation's
 * expo-location require): the '@/components/Map' barrel is imported by many
 * non-map screens just for `dayColor`, and deferral keeps map engines
 * (maplibre-gl ≈ 250 KB gz) from EVALUATING anywhere a map never renders.
 * True byte-splitting would need dynamic import(), which the project tsconfig
 * rejects (TS1323 — same pre-existing limitation seen in the e2e specs);
 * require() is resolved statically by Metro so the bytes ship in the main
 * chunk, but parse/eval cost is paid only on first map render.
 *
 * Map.native.tsx is untouched — native keeps react-native-maps.
 */
import { useAppConfig } from '@/api/app-config';
import type { MapViewProps } from './types';

type WebMapProvider = 'maplibre' | 'google';

type MapWebProps = MapViewProps & {
  /**
   * Test-only escape hatch: pin the provider, bypassing app_config and env.
   * Intentionally absent from MapViewProps (types.ts) — not public API.
   */
  providerOverride?: WebMapProvider;
};

/** Unknown/typo'd config values fall through to the next source in the chain. */
function normalizeProvider(value: string | undefined): WebMapProvider | undefined {
  return value === 'google' || value === 'maplibre' ? value : undefined;
}

export function Map({ providerOverride, ...props }: MapWebProps) {
  // Always called (Rules of Hooks); resolves to {} pre-migration or on error,
  // so the env default / 'maplibre' fallback always has the last word.
  const config = useAppConfig();

  const provider: WebMapProvider =
    providerOverride ??
    normalizeProvider(config.data?.map_provider_web) ??
    normalizeProvider(
      typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_MAP_PROVIDER : undefined,
    ) ??
    'maplibre';

  if (provider === 'google') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GoogleMap } = require('./GoogleMap.web') as typeof import('./GoogleMap.web');
    return <GoogleMap {...props} />;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MapLibreMap } = require('./MapLibreMap.web') as typeof import('./MapLibreMap.web');
  return <MapLibreMap {...props} />;
}
