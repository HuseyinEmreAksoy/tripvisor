// Tripvisor Phase 25 Step 25.4 — `place-photo` Edge Function client wrapper.
//
// Security audit 2026-09-29 #3: place-photo only serves bytes for a URL that
// carries a short-lived HMAC signature (`exp` + `sig`), and only for the
// widths {200, 400, 800, 1600}. The URL stays usable directly as
// `<Image src>`, because it authenticates itself. Signatures come from:
//   1. `place-details`, which embeds `photos[].signature` (all four widths,
//      one bucketed `exp`). `usePlaceDetails` feeds them into the in-memory
//      registry below via `registerPhotoSignatures`. This is the normal
//      path, with zero extra requests.
//   2. `POST place-photo` (authenticated and metered) as the fallback, when
//      a photo name has no signature in memory or it is about to expire.
//      Requests from many rows are coalesced into one batched POST.
//
// `usePlacePhotoUrl(photoName, { maxWidthPx })` -> `{ url }` keeps its
// pre-audit signature, so no component had to change. `url` is null while a
// fallback signature is in flight or when signing fails. Callers already
// render their placeholder for null.
//
// Signatures are Tier-2 memory only (Google ToS: photo names are
// short-lived). Nothing here is persisted.

import { useEffect, useMemo, useState } from 'react';
import Constants from 'expo-constants';
import { supabase } from './supabase';
import type { PlacePhoto } from './types';

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

// ---- Widths (mirror of supabase/functions/_shared/photo-signature.ts) --------

/** The only widths place-photo serves. Keep in lockstep with the server. */
export const PHOTO_WIDTHS = [200, 400, 800, 1600] as const;
export type PhotoWidth = (typeof PHOTO_WIDTHS)[number];
export const DEFAULT_PHOTO_WIDTH: PhotoWidth = 400;

/**
 * Snap UP to the next allowed width (same rule as the server): 100 -> 200,
 * 600 -> 800, and anything above 1600 -> 1600. Missing or garbage input
 * -> 400.
 */
export function snapPhotoWidth(requested: number | null | undefined): PhotoWidth {
  if (typeof requested !== 'number' || !Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_PHOTO_WIDTH;
  }
  for (const w of PHOTO_WIDTHS) {
    if (requested <= w) return w;
  }
  return PHOTO_WIDTHS[PHOTO_WIDTHS.length - 1]!;
}

// ---- Signature registry ----------------------------------------------------------

/**
 * Anything with less than this much life left is treated as expired, so a
 * URL handed to `<Image>` never dies while it loads.
 */
const MIN_REMAINING_S = 10 * 60;
/** Memory bound; the oldest photo names are evicted first (Map insertion order). */
const REGISTRY_MAX = 1000;

interface RegistryEntry {
  exp: number;
  sig: Record<string, string>;
}

const registry = new Map<string, RegistryEntry>();

function storeSignature(name: string, exp: number, sigs: Record<string, string>): void {
  const existing = registry.get(name);
  if (existing && existing.exp > exp) return; // never downgrade to an older bucket
  const merged: RegistryEntry =
    existing && existing.exp === exp
      ? { exp, sig: { ...existing.sig, ...sigs } }
      : { exp, sig: { ...sigs } };
  registry.delete(name); // re-insert so it moves to the "newest" end
  registry.set(name, merged);
  while (registry.size > REGISTRY_MAX) {
    const oldest = registry.keys().next().value;
    if (oldest === undefined) break;
    registry.delete(oldest);
  }
}

/**
 * Record the signatures that `place-details` embedded in `photos[]`.
 * Called by `usePlaceDetails` for every response; safe with photos that
 * have no signature (older server / secret unset), which are skipped.
 */
export function registerPhotoSignatures(
  photos: ReadonlyArray<Pick<PlacePhoto, 'name' | 'signature'>> | null | undefined,
): void {
  if (!photos) return;
  for (const p of photos) {
    const s = p.signature;
    if (!p.name || !s || typeof s.exp !== 'number' || !s.sig || typeof s.sig !== 'object') continue;
    storeSignature(p.name, s.exp, s.sig);
  }
}

export interface SignedPhotoRef {
  exp: number;
  sig: string;
}

/** A usable (not near-expiry) signature for name+width, or null. Exported for tests. */
export function lookupPhotoSignature(
  photoName: string,
  width: PhotoWidth,
  nowMs: number = Date.now(),
): SignedPhotoRef | null {
  const entry = registry.get(photoName);
  if (!entry) return null;
  if (entry.exp - Math.floor(nowMs / 1000) < MIN_REMAINING_S) return null;
  const sig = entry.sig[String(width)];
  return typeof sig === 'string' && sig.length > 0 ? { exp: entry.exp, sig } : null;
}

/** Build the self-authenticating place-photo URL. Exported for tests. */
export function buildPlacePhotoUrl(
  baseUrl: string,
  photoName: string,
  width: PhotoWidth,
  signed: SignedPhotoRef,
  anonKey: string | null,
): string {
  // URLSearchParams handles encoding, so the `/` in photo names and any
  // reserved characters round-trip correctly.
  const params = new URLSearchParams();
  params.set('photoName', photoName);
  params.set('maxWidthPx', String(width));
  params.set('exp', String(signed.exp));
  params.set('sig', signed.sig);
  if (anonKey) {
    // Kept for the Supabase gateway's routing (the function itself is
    // verify_jwt = false). This is the PUBLIC anon key: it authorizes
    // nothing here, and the HMAC signature is what the function checks.
    params.set('apikey', anonKey);
  }
  return `${baseUrl}/functions/v1/place-photo?${params.toString()}`;
}

// ---- Fallback signer: batched POST place-photo -----------------------------------

const SIGN_BATCH_MAX = 20; // server-side MAX_SIGN_BATCH
const SIGN_BATCH_DELAY_MS = 16; // coalesce one render pass of list rows
/** After a failed sign (quota, offline, misconfig), don't re-ask for this long. */
const SIGN_FAILURE_BACKOFF_MS = 60_000;

interface SignWaiter {
  resolve: () => void;
  reject: (err: unknown) => void;
}

let batch = new Map<string, { name: string; width: PhotoWidth; waiters: SignWaiter[] }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const inflight = new Map<string, Promise<void>>();
const failedUntil = new Map<string, number>();

interface SignResponse {
  photos?: Array<{ name: string; maxWidthPx: number; exp: number; sig: string }>;
}

async function flushSignBatch(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const entries = [...batch.values()];
  batch = new Map();
  if (entries.length === 0) return;

  const failAll = (err: unknown) => {
    const until = Date.now() + SIGN_FAILURE_BACKOFF_MS;
    for (const e of entries) {
      failedUntil.set(`${e.name}|${e.width}`, until);
      e.waiters.forEach((w) => w.reject(err));
    }
  };

  try {
    const { data, error } = await supabase.functions.invoke<SignResponse>('place-photo', {
      body: { photos: entries.map((e) => ({ name: e.name, maxWidthPx: e.width })) },
    });
    if (error) {
      failAll(error);
      return;
    }
    for (const p of data?.photos ?? []) {
      if (typeof p?.name === 'string' && typeof p.exp === 'number' && typeof p.sig === 'string') {
        storeSignature(p.name, p.exp, { [String(p.maxWidthPx)]: p.sig });
      }
    }
    const now = Date.now();
    for (const e of entries) {
      if (lookupPhotoSignature(e.name, e.width, now)) {
        e.waiters.forEach((w) => w.resolve());
      } else {
        failedUntil.set(`${e.name}|${e.width}`, now + SIGN_FAILURE_BACKOFF_MS);
        e.waiters.forEach((w) => w.reject(new Error('photo_sign_missing')));
      }
    }
  } catch (err) {
    failAll(err);
  }
}

/**
 * Ask the server for a signature for name+width. Calls from many
 * components within one tick are coalesced into a single POST (max 20 per
 * request), and concurrent asks for the same key share one promise.
 * Resolves once the registry holds a usable signature. Exported for tests.
 */
export function requestPhotoSignature(photoName: string, width: PhotoWidth): Promise<void> {
  const key = `${photoName}|${width}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const until = failedUntil.get(key);
  if (until !== undefined && until > Date.now()) {
    return Promise.reject(new Error('photo_sign_backoff'));
  }
  const promise = new Promise<void>((resolve, reject) => {
    const entry = batch.get(key) ?? { name: photoName, width, waiters: [] };
    entry.waiters.push({ resolve, reject });
    batch.set(key, entry);
    if (batch.size >= SIGN_BATCH_MAX) {
      void flushSignBatch();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => void flushSignBatch(), SIGN_BATCH_DELAY_MS);
    }
  }).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

/** Test-only: reset all module state. */
export function _resetPlacePhotoStateForTests(): void {
  registry.clear();
  batch = new Map();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  inflight.clear();
  failedUntil.clear();
}

// ---- Hook --------------------------------------------------------------------------

export interface UsePlacePhotoUrlOptions {
  /**
   * Desired width in CSS pixels. Snapped UP to one of 200/400/800/1600
   * (the only widths the server serves). Default 400.
   */
  maxWidthPx?: number;
}

export interface UsePlacePhotoUrlResult {
  /**
   * Fully-qualified, self-authenticating URL for `<Image src>` / `<img src>`.
   * `null` when:
   *   - `photoName` is null/undefined/empty (render the placeholder), OR
   *   - the Supabase URL env var is missing, OR
   *   - no usable signature is available yet (fallback signing in flight)
   *     or signing failed (quota, offline). Render the placeholder.
   */
  url: string | null;
}

/**
 * The URL the client should pass to `<Image src>` / `<img src>` to load a
 * Google Places photo through the `place-photo` Edge Function proxy.
 *
 * Normally synchronous: the signature arrived with the `usePlaceDetails`
 * response that produced `photoName`. Otherwise it triggers one batched,
 * authenticated sign request and re-renders when it lands.
 *
 * Caching: the image component does the fetch. Bytes are cached per the
 * function's `Cache-Control: public, max-age=21600`, and the bucketed `exp`
 * keeps the URL stable for about 12h, so repeat renders hit the cache.
 *
 * @example
 *   const { url } = usePlacePhotoUrl(place.photos[0]?.name, { maxWidthPx: 800 });
 *   return url ? <Image source={{ uri: url }} /> : <PlaceholderHero />;
 */
export function usePlacePhotoUrl(
  photoName: string | null | undefined,
  options: UsePlacePhotoUrlOptions = {},
): UsePlacePhotoUrlResult {
  const width = snapPhotoWidth(options.maxWidthPx);
  // Bumped when a fallback signature lands. The registry is plain module
  // state, so this is the only way to re-render the subscriber.
  const [, setSignVersion] = useState(0);

  // Map lookup, cheap on every render. Recomputing each render also means
  // a signature that ages into its final 10 minutes is renewed.
  const signed = photoName && SUPABASE_URL ? lookupPhotoSignature(photoName, width) : null;
  const url =
    photoName && signed && SUPABASE_URL
      ? buildPlacePhotoUrl(SUPABASE_URL, photoName, width, signed, SUPABASE_ANON_KEY)
      : null;
  const needsSigning = Boolean(photoName && SUPABASE_URL && !signed);

  useEffect(() => {
    if (!needsSigning || !photoName) return;
    let cancelled = false;
    requestPhotoSignature(photoName, width).then(
      () => {
        if (!cancelled) setSignVersion((v) => v + 1);
      },
      () => {
        // Degrade quietly: url stays null and the caller shows its
        // placeholder. The failure backoff stops re-asking every render.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [needsSigning, photoName, width]);

  return useMemo<UsePlacePhotoUrlResult>(() => ({ url }), [url]);
}
