// Tripvisor Phase 25 Step 25.4 — `place-photo` Edge Function client wrapper.
//
// This module exposes ONE hook, `usePlacePhotoUrl`, which is a pure URL
// builder, NOT a network call. The hook returns the URL the caller's
// `<Image>` (or `<img>`) component should set as `src`. The browser /
// React Native image loader does the actual fetch and caches the bytes
// per the function's `Cache-Control: public, max-age=21600` header.
//
// Why a hook (and not just a plain function): keeping a hook signature
// matches the rest of the api surface (`usePlaceDetails`, `useTripPlaces`,
// etc.) and gives us a clean place to memoize the URL on the inputs.
// Returning `{ url }` (instead of a bare string) leaves room to add
// loading / error / fallback fields later without breaking call sites.

import { useMemo } from 'react';
import Constants from 'expo-constants';

// Read the Supabase URL the same way `./supabase.ts` does: `inlined` must be
// a literal `process.env.EXPO_PUBLIC_X` expression at the call site — the
// only form Expo's babel preset replaces at build time. Computed
// `process.env[key]` is NOT inlined (production web has no runtime
// process.env). Dynamic read kept as dev-server/jest fallback.
function readEnv(key: string, inlined: string | undefined): string | undefined {
  if (inlined) return inlined;
  const fromProcess = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  if (fromProcess) return fromProcess;
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const val = extra[key];
  return typeof val === 'string' ? val : undefined;
}

const SUPABASE_URL =
  readEnv('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL) ?? null;
const SUPABASE_ANON_KEY =
  readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) ?? null;

export interface UsePlacePhotoUrlOptions {
  /**
   * Width in CSS pixels to request from Google. Default `400` (matches
   * the Edge Function's default). Clamp range 1..4800 — values outside
   * are clamped server-side rather than rejected.
   */
  maxWidthPx?: number;
}

export interface UsePlacePhotoUrlResult {
  /**
   * Fully-qualified URL the caller's image component should fetch.
   * `null` when:
   *   - `photoName` is null/undefined/empty (UI should render the
   *     placeholder), OR
   *   - the supabase URL env var is missing (we can't construct a
   *     reachable URL).
   */
  url: string | null;
}

/**
 * Build the URL the client should pass to `<Image src>` / `<img src>` to
 * load a Google Places photo via the `place-photo` Edge Function proxy.
 *
 * The Edge Function is configured with `verify_jwt = false` (see
 * supabase/config.toml + the function's README) because `<Image>` cannot
 * set Authorization headers. We still attach `apikey=<anon>` so the
 * Supabase gateway routes the request to our function (the gateway
 * requires the anon key on every request even when JWT verification is
 * disabled).
 *
 * Caching: this hook is a pure URL builder. The actual fetch is done by
 * the image component, and the response is cached by the browser / RN
 * image loader per the function's `Cache-Control: public, max-age=21600`
 * header. We do NOT plug into TanStack Query because images are a
 * binary, not a JSON payload.
 *
 * @example
 *   const { url } = usePlacePhotoUrl(place.photos[0]?.name, { maxWidthPx: 800 });
 *   return url ? <Image source={{ uri: url }} /> : <PlaceholderHero />;
 */
export function usePlacePhotoUrl(
  photoName: string | null | undefined,
  options: UsePlacePhotoUrlOptions = {},
): UsePlacePhotoUrlResult {
  const { maxWidthPx } = options;
  return useMemo<UsePlacePhotoUrlResult>(() => {
    if (!photoName) return { url: null };
    if (!SUPABASE_URL) return { url: null };

    // Build the URL with explicit param encoding so a `+` or other
    // reserved character in the photo name (Google does include `_`
    // and `-` and the very occasional `+` in opaque ids) round-trips
    // correctly. URLSearchParams handles the encoding for us.
    const params = new URLSearchParams();
    params.set('photoName', photoName);
    if (typeof maxWidthPx === 'number' && Number.isFinite(maxWidthPx)) {
      params.set('maxWidthPx', String(Math.trunc(maxWidthPx)));
    }
    if (SUPABASE_ANON_KEY) {
      // Required by the Supabase gateway even when verify_jwt = false:
      // the gateway uses `apikey` to route the request to the right
      // project. Without it the gateway returns 401 before the
      // function even runs.
      params.set('apikey', SUPABASE_ANON_KEY);
    }

    const url = `${SUPABASE_URL}/functions/v1/place-photo?${params.toString()}`;
    return { url };
  }, [photoName, maxWidthPx]);
}
