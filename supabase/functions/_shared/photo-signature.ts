// _shared/photo-signature.ts — short-lived HMAC signatures for place-photo URLs.
//
// Security audit #3 (2026-09-29): `place-photo` is a `verify_jwt = false`
// GET endpoint because an `<Image src>` cannot send an Authorization header.
// Before this module it was a public, unlimited, billed proxy onto Google's
// Place Photo SKU. An arbitrary `maxWidthPx` (1..4800) also defeated every
// cache layer. The fix makes each photo URL self-authenticating:
//
//   sig = base64url( HMAC-SHA256( PHOTO_URL_SECRET, `${photoName}|${w}|${exp}` ) )
//
// - Only AUTHENTICATED paths mint signatures: `place-details` embeds them
//   in `photos[].signature`, and `POST place-photo` is the metered fallback.
// - `w` is snapped UP to one of PHOTO_WIDTHS, so there are at most four
//   cache variants per photo.
// - `exp` is bucketed (see photoSignatureExpiry), so every signature minted
//   inside the same 12h window is byte-identical. The URL, and with it the
//   browser/CDN cache key, therefore stays stable across place-details
//   refetches and across users. A per-request `now + 24h` would bust the
//   cache on every refetch.
//
// PURE module: no imports, no Deno globals, only Web Crypto. Deno and Node
// (>= 22 with --experimental-strip-types) can both run it. That is what
// photo-signature.test.mjs relies on. Keep it that way.

/** The only widths place-photo will fetch from Google. */
export const PHOTO_WIDTHS = [200, 400, 800, 1600] as const;
export type PhotoWidth = (typeof PHOTO_WIDTHS)[number];

/** Width used when the caller omits maxWidthPx or sends garbage. */
export const DEFAULT_PHOTO_WIDTH: PhotoWidth = 400;

/**
 * Google's photo resource name: `places/{placeId}/photos/{photoRef}`. Both
 * segments are opaque URL-safe ids. Anything else is rejected so the proxy
 * can never be pointed at an arbitrary Google URL.
 */
export const PHOTO_NAME_PATTERN = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

/** Expiry bucket. Signatures minted in the same bucket share one `exp`. */
export const PHOTO_SIG_BUCKET_S = 12 * 60 * 60;

/** Hard ceiling on how far in the future a valid `exp` may be (audit: <= 24h). */
export const PHOTO_SIG_MAX_TTL_S = 24 * 60 * 60;

/** Clock-skew allowance on the max-TTL check only (never on expiry). */
const MAX_TTL_SKEW_S = 60;

/**
 * Snap a requested width UP to the next allowed width. Anything above the
 * largest allowed width gets the largest. Missing, non-finite or
 * non-positive input gets DEFAULT_PHOTO_WIDTH. Accepts strings so the GET
 * handler can pass the raw query param straight in.
 */
export function snapPhotoWidth(requested: number | string | null | undefined): PhotoWidth {
  const n = typeof requested === 'string' ? Number.parseInt(requested, 10) : requested;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return DEFAULT_PHOTO_WIDTH;
  for (const w of PHOTO_WIDTHS) {
    if (n <= w) return w;
  }
  return PHOTO_WIDTHS[PHOTO_WIDTHS.length - 1]!;
}

/**
 * Bucketed expiry (unix seconds). For `now` in bucket k this returns the end
 * of bucket k+1. The remaining lifetime is therefore always in
 * (PHOTO_SIG_BUCKET_S, 2 * PHOTO_SIG_BUCKET_S], which is (12h, 24h]. That
 * satisfies the 24h ceiling, and a freshly minted URL is always good for at
 * least 12h.
 */
export function photoSignatureExpiry(nowMs: number): number {
  const nowS = Math.floor(nowMs / 1000);
  return (Math.floor(nowS / PHOTO_SIG_BUCKET_S) + 2) * PHOTO_SIG_BUCKET_S;
}

/** The exact byte string that gets MAC'd. Exported for tests. */
export function photoSignaturePayload(photoName: string, width: number, exp: number): string {
  return `${photoName}|${width}|${exp}`;
}

// ---- base64url -----------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Returns a plain ArrayBuffer (a valid BufferSource under every TS lib
// version, unlike a generic-typed Uint8Array view).
function fromBase64Url(s: string): ArrayBuffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const buf = new ArrayBuffer(bin.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
    return buf;
  } catch {
    return null;
  }
}

// ---- HMAC key cache --------------------------------------------------------

// One CryptoKey per secret per isolate. importKey is cheap, but place-details
// signs up to 10 photos x 4 widths per call, so caching is worth it.
const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
    keyCache.set(secret, key);
  }
  return key;
}

/** base64url(HMAC-SHA256(secret, `${photoName}|${width}|${exp}`)), no padding. */
export async function signPhoto(
  secret: string,
  photoName: string,
  width: number,
  exp: number,
): Promise<string> {
  const key = await hmacKey(secret);
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(photoSignaturePayload(photoName, width, exp)),
  );
  return toBase64Url(new Uint8Array(mac));
}

/** Wire shape embedded in place-details `photos[].signature`. */
export interface PhotoSignatureSet {
  /** Unix seconds; shared by every width in `sig`. */
  exp: number;
  /** One signature per allowed width, keyed by the width as a string. */
  sig: Record<string, string>;
}

/** Sign every allowed width for one photo, sharing one bucketed `exp`. */
export async function signPhotoAllWidths(
  secret: string,
  photoName: string,
  nowMs: number,
): Promise<PhotoSignatureSet> {
  const exp = photoSignatureExpiry(nowMs);
  const sigs = await Promise.all(PHOTO_WIDTHS.map((w) => signPhoto(secret, photoName, w, exp)));
  const sig: Record<string, string> = {};
  PHOTO_WIDTHS.forEach((w, i) => {
    sig[String(w)] = sigs[i]!;
  });
  return { exp, sig };
}

export type PhotoSignatureCheck =
  | { ok: true; width: PhotoWidth; exp: number }
  | { ok: false; reason: 'missing' | 'bad_name' | 'bad_exp' | 'expired' | 'exp_too_far' | 'bad_signature' };

/**
 * Verify a GET's (photoName, maxWidthPx, exp, sig) tuple. The width is
 * snapped first, the same way the client does, so a URL built with
 * `maxWidthPx=500` checks against the 800 signature. The MAC comparison
 * goes through crypto.subtle.verify, which is constant-time.
 */
export async function verifyPhotoSignature(args: {
  secret: string;
  photoName: string | null;
  maxWidthPx: string | number | null;
  exp: string | number | null;
  sig: string | null;
  nowMs: number;
}): Promise<PhotoSignatureCheck> {
  const { secret, photoName, sig, nowMs } = args;
  if (!photoName || !sig || args.exp === null || args.exp === '') {
    return { ok: false, reason: 'missing' };
  }
  if (!PHOTO_NAME_PATTERN.test(photoName)) return { ok: false, reason: 'bad_name' };

  const exp = typeof args.exp === 'number' ? args.exp : Number(args.exp);
  if (!Number.isSafeInteger(exp) || exp <= 0) return { ok: false, reason: 'bad_exp' };

  const nowS = Math.floor(nowMs / 1000);
  if (exp <= nowS) return { ok: false, reason: 'expired' };
  if (exp - nowS > PHOTO_SIG_MAX_TTL_S + MAX_TTL_SKEW_S) return { ok: false, reason: 'exp_too_far' };

  const width = snapPhotoWidth(args.maxWidthPx);
  const sigBytes = fromBase64Url(sig);
  // HMAC-SHA256 is exactly 32 bytes. Reject other lengths before verify().
  if (!sigBytes || sigBytes.byteLength !== 32) return { ok: false, reason: 'bad_signature' };

  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes,
    new TextEncoder().encode(photoSignaturePayload(photoName, width, exp)),
  );
  return valid ? { ok: true, width, exp } : { ok: false, reason: 'bad_signature' };
}
