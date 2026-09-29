import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { supabase } from './supabase';
import type { PlaceAutocompleteSuggestion, PlaceDetails } from './types';
import { EdgeFunctionError, tryParseEdgeFunctionError } from './_errors';
import { registerPhotoSignatures } from './place-photos';
import { requestLang, type ApiLang } from './_lang';

export const placesKeys = {
  autocomplete: (input: string) => ['places', 'autocomplete', input] as const,
  details: (placeId: string) => ['places', 'details', placeId] as const,
};

/**
 * Typed error thrown by `usePlacesAutocomplete` and `usePlaceDetails` when
 * the underlying Edge Function (`places-autocomplete` / `place-details`)
 * returns a structured `{ error: { code, message } }` envelope with a
 * non-2xx HTTP status. Consumers can branch on the error via
 * `instanceof PlacesError` and inspect `.code` to render an appropriate
 * surface (e.g. a "Maps integration not configured" banner on
 * `server_misconfigured` vs. a generic failure on transient errors).
 *
 * Phase 20 Step 6: now extends the shared {@link EdgeFunctionError} base
 * class. The class name and field shape are unchanged so existing
 * `instanceof PlacesError` checks at consumer sites keep working.
 *
 * Known codes (from `supabase/functions/{places-autocomplete,place-details}/index.ts`):
 *   - `server_misconfigured` — 500 — `GOOGLE_MAPS_SERVER_KEY` is not set on the
 *                              Edge Function host. UI should render a setup banner
 *                              pointing at docs/google-maps-setup.md.
 *   - `google_places_disabled` - 502 - Places API (New) is disabled or billing is inactive.
 *   - `google_key_restricted`  - 502 - server key restrictions block Edge Function calls.
 *   - `google_places_forbidden` - 502 - Google rejected the server key.
 *   - `invalid_input`        — 400 — request body failed Zod validation
 *   - `method_not_allowed`   — 405 — non-POST request to the function
 *   - `upstream_error`       — 502 — Google Places returned a non-2xx
 *   - `upstream_timeout`     — 504 — request to Google exceeded timeout
 *   - `place_not_found`      — 404 — place-details only; placeId is unknown
 *   - `not_authenticated`    — 401 — (audit 2026-09-29 #2) no signed-in user
 *                              session; the public anon key alone is rejected
 *   - `auth_unavailable`     — 503 — GoTrue unreachable; transient
 *   - `quota_exceeded`       — 429 — the per-user daily limit is reached
 *                              (places_autocomplete 300 / place_details 150
 *                              per UTC day). Not retryable. See
 *                              {@link isPlacesQuotaExceeded} for the UI check.
 *
 * Network-only failures (no envelope / parse failure) fall through to the
 * original `Error` thrown by `supabase.functions.invoke` — query consumers
 * should treat the error type as `PlacesError | Error`.
 */
export class PlacesError extends EdgeFunctionError {
  constructor(code: string, message: string, status: number) {
    super(code, message, status);
    this.name = 'PlacesError';
  }
}

const nonRetryablePlaceErrorCodes = new Set([
  'server_misconfigured',
  'google_places_disabled',
  'google_key_restricted',
  'google_places_forbidden',
  // Audit #2: retrying a spent daily quota or a missing session only adds
  // load. Neither resolves within TanStack's retry window.
  'quota_exceeded',
  'not_authenticated',
]);

function isNonRetryablePlacesError(error: PlacesError | Error): boolean {
  return error instanceof PlacesError && nonRetryablePlaceErrorCodes.has(error.code);
}

/**
 * True when a places hook failed because the caller's daily Places quota
 * (autocomplete or details) is spent. The UI should show a friendly "daily
 * search limit reached, try again tomorrow" notice instead of "no results"
 * or a setup banner. The server message is English-only. Use a `t()` key
 * for the copy.
 */
export function isPlacesQuotaExceeded(error: unknown): error is PlacesError {
  return error instanceof PlacesError && error.code === 'quota_exceeded';
}

function generateSessionToken(): string {
  // RFC4122 v4-ish. Crypto may be unavailable on some RN runtimes; fall back to Math.random.
  const bytes = new Uint8Array(16);
  const cryptoRef =
    typeof globalThis !== 'undefined' && (globalThis as { crypto?: Crypto }).crypto
      ? (globalThis as { crypto?: Crypto }).crypto
      : null;
  if (cryptoRef?.getRandomValues) {
    cryptoRef.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface AutocompleteSession {
  /** Token to send on every autocomplete call AND the place-details call that ends the session. */
  sessionToken: string;
  /**
   * Start a new billing session. Call once the details call that closes the
   * current session has resolved (e.g. the user confirmed a place), so each
   * search → details pair is exactly one Google session. Neither query key
   * includes the token, so rotating never triggers a refetch.
   */
  rotate: () => void;
}

/**
 * Session token with an explicit rotate(). Propagate the same token to
 * autocomplete AND the following place-details call — otherwise Google bills
 * the details call separately — then rotate() to start the next session.
 */
export function useAutocompleteSession(): AutocompleteSession {
  const [sessionToken, setSessionToken] = useState(generateSessionToken);
  const rotate = useCallback(() => setSessionToken(generateSessionToken()), []);
  return useMemo(() => ({ sessionToken, rotate }), [sessionToken, rotate]);
}

/**
 * Returns a stable session token tied to this component mount (never rotates).
 * Kept for backward compatibility; prefer `useAutocompleteSession()` in flows
 * where the user can run more than one search → details pair per mount.
 */
export function useAutocompleteSessionToken(): string {
  return useAutocompleteSession().sessionToken;
}

export interface PlacesAutocompleteRequest {
  input: string;
  sessionToken: string;
  locationBias?: { lat: number; lng: number; radiusMeters?: number };
  /** M5 Y2.5: result language (Google `languageCode`). Default: the app language. */
  lang?: ApiLang;
}

/**
 * One metered `places-autocomplete` call (counts against the per-user daily
 * quota). Throws `PlacesError` for the envelope codes documented above.
 * Non-hook form for flows that resolve a name once (e.g. adding a
 * recommendation to a trip); screens with a search box use the hook.
 */
export async function fetchPlacesAutocomplete(
  req: PlacesAutocompleteRequest,
): Promise<PlaceAutocompleteSuggestion[]> {
  const { data, error } = await supabase.functions.invoke<{
    suggestions: PlaceAutocompleteSuggestion[];
  }>('places-autocomplete', {
    body: {
      input: req.input,
      sessionToken: req.sessionToken,
      locationBias: req.locationBias,
      lang: req.lang ?? requestLang(),
    },
  });
  if (error) {
    const typed = await tryParseEdgeFunctionError(error, PlacesError);
    if (typed) throw typed;
    throw error;
  }
  return data?.suggestions ?? [];
}

/** Fresh v4-style token for a one-off autocomplete session (non-hook callers). */
export function newAutocompleteSessionToken(): string {
  return generateSessionToken();
}

export function usePlacesAutocomplete(params: {
  input: string;
  sessionToken: string;
  locationBias?: { lat: number; lng: number; radiusMeters?: number };
  enabled?: boolean;
}) {
  const { input, sessionToken, locationBias, enabled = true } = params;
  // M5 Y2.5: the language is part of the key, so switching it refetches.
  const lang = requestLang();
  const key = useMemo(() => [...placesKeys.autocomplete(input), lang] as const, [input, lang]);

  return useQuery<PlaceAutocompleteSuggestion[], PlacesError | Error>({
    queryKey: key,
    enabled: enabled && input.trim().length >= 2,
    staleTime: 1000 * 60 * 5,
    // Setup failures are not transient; retrying only adds noise.
    // Let transient errors fall back to TanStack's default retry behaviour.
    retry: (failureCount, error) => {
      if (isNonRetryablePlacesError(error)) return false;
      return failureCount < 3;
    },
    queryFn: () => fetchPlacesAutocomplete({ input, sessionToken, locationBias, lang }),
  });
}

/**
 * Fetches full place details. Never persist the response —
 * leave it in the React Query cache only (ToS).
 */
export function usePlaceDetails(params: {
  placeId: string | undefined;
  sessionToken?: string;
  /**
   * Granular field mask. Default is a full detail-screen mask.
   * Use a narrower mask for list views to reduce billing.
   */
  fields?: string[];
  enabled?: boolean;
}) {
  const { placeId, sessionToken, fields, enabled = true } = params;
  // M5 Y2.5: names, hours and review text follow the app language; the
  // language is part of the key so switching it refetches.
  const lang = requestLang();
  return useQuery<PlaceDetails | null, PlacesError | Error>({
    queryKey: placeId
      ? [...placesKeys.details(placeId), fields ?? 'full', lang]
      : ['places', 'details', 'none'],
    enabled: enabled && Boolean(placeId),
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 24,
    retry: (failureCount, error) => {
      if (isNonRetryablePlacesError(error)) return false;
      return failureCount < 3;
    },
    queryFn: async () => {
      if (!placeId) return null;
      const { data, error } = await supabase.functions.invoke<{ place: PlaceDetails }>(
        'place-details',
        { body: { placeId, sessionToken, fields, lang } },
      );
      if (error) {
        const typed = await tryParseEdgeFunctionError(error, PlacesError);
        if (typed) throw typed;
        throw error;
      }
      // Audit #3: remember the photo URL signatures this authenticated
      // response carries, so usePlacePhotoUrl can build URLs synchronously.
      registerPhotoSignatures(data?.place?.photos);
      return data?.place ?? null;
    },
  });
}
