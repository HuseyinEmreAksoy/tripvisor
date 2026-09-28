/**
 * Dynamic Expo config (v2 M4 X1.2).
 *
 * `app.json` stays the static base: Expo passes it in as `config`, and
 * `eas init` / `eas build:version` can still write to it (they write the static
 * file and re-evaluate this function). This file only layers on the
 * values that come from the environment at build time:
 *
 *  - Native Google Maps SDK keys (`GOOGLE_MAPS_ANDROID_KEY`, `GOOGLE_MAPS_IOS_KEY`).
 *    They are NOT `EXPO_PUBLIC_*`: the native config plugin writes them into
 *    AndroidManifest / Info.plist. They are package- or bundle-restricted SDK keys,
 *    not the server HTTP key. When a key is absent we emit nothing (no
 *    placeholder). `extra.nativeMaps` tells `Map.native.tsx` to render
 *    `MapUnavailable` instead of a blank or crashing Google map.
 *  - `extra` fallbacks the runtime reads via `Constants.expoConfig.extra`
 *    (src/api/supabase.ts, place-photos.ts, useEdgeRuntimeHealth.ts,
 *    GoogleMap.web.tsx). The build-time inlined `process.env.EXPO_PUBLIC_*`
 *    remains the primary path.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  // Treat legacy placeholders as "unset" so they can never reach a build.
  if (!v || v.startsWith('REPLACE_')) return undefined;
  return v;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const androidMapsKey = env('GOOGLE_MAPS_ANDROID_KEY');
  const iosMapsKey = env('GOOGLE_MAPS_IOS_KEY');

  const publicExtra: Record<string, string> = {};
  const supabaseUrl = env('EXPO_PUBLIC_SUPABASE_URL');
  const supabaseAnon = env('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  const webMapsKey = env('EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY');
  if (supabaseUrl) publicExtra.EXPO_PUBLIC_SUPABASE_URL = supabaseUrl;
  if (supabaseAnon) publicExtra.EXPO_PUBLIC_SUPABASE_ANON_KEY = supabaseAnon;
  if (webMapsKey) publicExtra.googleMapsWebKey = webMapsKey;

  return {
    ...config,
    name: config.name ?? 'Tripvisor',
    slug: config.slug ?? 'tripvisor',
    ios: {
      ...config.ios,
      config: {
        ...config.ios?.config,
        ...(iosMapsKey ? { googleMapsApiKey: iosMapsKey } : {}),
      },
    },
    android: {
      ...config.android,
      config: {
        ...config.android?.config,
        ...(androidMapsKey ? { googleMaps: { apiKey: androidMapsKey } } : {}),
      },
    },
    extra: {
      ...config.extra,
      ...publicExtra,
      nativeMaps: {
        android: Boolean(androidMapsKey),
        ios: Boolean(iosMapsKey),
      },
    },
  };
};
