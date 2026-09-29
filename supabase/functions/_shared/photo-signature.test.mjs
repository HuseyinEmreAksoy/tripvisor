// Pure-logic tests for _shared/photo-signature.ts (security audit #3).
//
// Runs under BOTH runtimes. The module under test has no imports and only
// uses Web Crypto:
//   deno test supabase/functions/_shared/photo-signature.test.mjs
//   node --experimental-strip-types --test supabase/functions/_shared/photo-signature.test.mjs
//
// `.mjs` on purpose: Node can run it without a TS toolchain, and the
// repo-level `tsc` (include: **/*.ts) does not pick it up.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PHOTO_WIDTH,
  PHOTO_NAME_PATTERN,
  PHOTO_SIG_BUCKET_S,
  PHOTO_SIG_MAX_TTL_S,
  PHOTO_WIDTHS,
  photoSignatureExpiry,
  photoSignaturePayload,
  signPhoto,
  signPhotoAllWidths,
  snapPhotoWidth,
  verifyPhotoSignature,
} from './photo-signature.ts';

const SECRET = 'test-secret-not-for-prod';
const NAME = 'places/ChIJN1t_tDeuEmsRUsoyG83frY4/photos/AciIO2c-abc_123';
const NOW = Date.UTC(2026, 8, 29, 10, 30, 0); // 2026-09-29T10:30:00Z

test('widths: allowed set is exactly 200/400/800/1600', () => {
  assert.deepEqual([...PHOTO_WIDTHS], [200, 400, 800, 1600]);
  assert.equal(DEFAULT_PHOTO_WIDTH, 400);
});

test('snapPhotoWidth snaps UP and clamps to 1600', () => {
  assert.equal(snapPhotoWidth(1), 200);
  assert.equal(snapPhotoWidth(100), 200);
  assert.equal(snapPhotoWidth(200), 200);
  assert.equal(snapPhotoWidth(201), 400);
  assert.equal(snapPhotoWidth(600), 800);
  assert.equal(snapPhotoWidth(800), 800);
  assert.equal(snapPhotoWidth(1200), 1600);
  assert.equal(snapPhotoWidth(4800), 1600);
  assert.equal(snapPhotoWidth('600'), 800);
});

test('snapPhotoWidth defaults garbage to 400', () => {
  for (const v of [undefined, null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY, 'abc', '']) {
    assert.equal(snapPhotoWidth(v), 400, `input ${String(v)}`);
  }
});

test('photo name pattern rejects non-photo names', () => {
  assert.ok(PHOTO_NAME_PATTERN.test(NAME));
  for (const bad of [
    'https://evil.example/x',
    'places/abc',
    'places/abc/photos/',
    'places/a b/photos/c',
    'places/abc/photos/def/media',
    '../places/abc/photos/def',
  ]) {
    assert.equal(PHOTO_NAME_PATTERN.test(bad), false, bad);
  }
});

test('expiry is bucketed: (12h, 24h] ahead and stable within a bucket', () => {
  const exp = photoSignatureExpiry(NOW);
  const nowS = Math.floor(NOW / 1000);
  assert.ok(exp - nowS > PHOTO_SIG_BUCKET_S, 'at least 12h of life');
  assert.ok(exp - nowS <= PHOTO_SIG_MAX_TTL_S, 'at most 24h of life');
  assert.equal(exp % PHOTO_SIG_BUCKET_S, 0, 'aligned to a bucket boundary');
  // Same bucket -> byte-identical exp, so the URL stays cache-stable.
  assert.equal(photoSignatureExpiry(NOW + 60 * 60 * 1000), exp);
  // Bucket edges.
  const bucketStart = Math.floor(nowS / PHOTO_SIG_BUCKET_S) * PHOTO_SIG_BUCKET_S;
  assert.equal(photoSignatureExpiry(bucketStart * 1000), bucketStart + 2 * PHOTO_SIG_BUCKET_S);
  assert.equal(
    photoSignatureExpiry((bucketStart + PHOTO_SIG_BUCKET_S) * 1000 - 1),
    bucketStart + 2 * PHOTO_SIG_BUCKET_S,
  );
});

test('signature is HMAC-SHA256(secret, name|w|exp), base64url without padding', async () => {
  assert.equal(photoSignaturePayload(NAME, 400, 123), `${NAME}|400|123`);
  const sig = await signPhoto(SECRET, NAME, 400, 1_000_000);
  assert.match(sig, /^[A-Za-z0-9_-]{43}$/);
  // Deterministic.
  assert.equal(await signPhoto(SECRET, NAME, 400, 1_000_000), sig);
  // Every input changes it.
  assert.notEqual(await signPhoto(SECRET, NAME, 800, 1_000_000), sig);
  assert.notEqual(await signPhoto(SECRET, NAME, 400, 1_000_001), sig);
  assert.notEqual(await signPhoto(SECRET, `${NAME}x`, 400, 1_000_000), sig);
  assert.notEqual(await signPhoto('other-secret', NAME, 400, 1_000_000), sig);
});

test('signPhotoAllWidths: one exp, one sig per allowed width, each verifies', async () => {
  const set = await signPhotoAllWidths(SECRET, NAME, NOW);
  assert.equal(set.exp, photoSignatureExpiry(NOW));
  assert.deepEqual(Object.keys(set.sig).sort(), ['1600', '200', '400', '800']);
  for (const w of PHOTO_WIDTHS) {
    const r = await verifyPhotoSignature({
      secret: SECRET,
      photoName: NAME,
      maxWidthPx: String(w),
      exp: String(set.exp),
      sig: set.sig[String(w)],
      nowMs: NOW,
    });
    assert.deepEqual(r, { ok: true, width: w, exp: set.exp });
  }
});

test('verify: an unsnapped width checks against the snapped signature', async () => {
  const exp = photoSignatureExpiry(NOW);
  const sig800 = await signPhoto(SECRET, NAME, 800, exp);
  const r = await verifyPhotoSignature({
    secret: SECRET,
    photoName: NAME,
    maxWidthPx: '500',
    exp: String(exp),
    sig: sig800,
    nowMs: NOW,
  });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.width, 800);
});

test('verify: a 200px signature cannot fetch 1600px', async () => {
  const exp = photoSignatureExpiry(NOW);
  const sig200 = await signPhoto(SECRET, NAME, 200, exp);
  const r = await verifyPhotoSignature({
    secret: SECRET,
    photoName: NAME,
    maxWidthPx: '1600',
    exp: String(exp),
    sig: sig200,
    nowMs: NOW,
  });
  assert.deepEqual(r, { ok: false, reason: 'bad_signature' });
});

test('verify: rejects missing, malformed, tampered, wrong-secret, expired, and too-far', async () => {
  const exp = photoSignatureExpiry(NOW);
  const sig = await signPhoto(SECRET, NAME, 400, exp);
  const base = { secret: SECRET, photoName: NAME, maxWidthPx: '400', exp: String(exp), sig, nowMs: NOW };

  assert.deepEqual(await verifyPhotoSignature({ ...base, sig: null }), { ok: false, reason: 'missing' });
  assert.deepEqual(await verifyPhotoSignature({ ...base, exp: null }), { ok: false, reason: 'missing' });
  assert.deepEqual(await verifyPhotoSignature({ ...base, photoName: null }), { ok: false, reason: 'missing' });
  assert.deepEqual(
    await verifyPhotoSignature({ ...base, photoName: 'https://evil.example/x' }),
    { ok: false, reason: 'bad_name' },
  );
  assert.deepEqual(await verifyPhotoSignature({ ...base, exp: 'soon' }), { ok: false, reason: 'bad_exp' });
  assert.deepEqual(await verifyPhotoSignature({ ...base, exp: '1.5' }), { ok: false, reason: 'bad_exp' });
  assert.deepEqual(await verifyPhotoSignature({ ...base, sig: 'not base64!' }), {
    ok: false,
    reason: 'bad_signature',
  });
  assert.deepEqual(await verifyPhotoSignature({ ...base, sig: sig.slice(0, 20) }), {
    ok: false,
    reason: 'bad_signature',
  });
  // Flip one character (tamper).
  const tampered = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  assert.deepEqual(await verifyPhotoSignature({ ...base, sig: tampered }), {
    ok: false,
    reason: 'bad_signature',
  });
  // Different photo, same signature.
  assert.deepEqual(
    await verifyPhotoSignature({ ...base, photoName: 'places/other/photos/xyz' }),
    { ok: false, reason: 'bad_signature' },
  );
  // Right MAC shape, wrong secret.
  assert.deepEqual(await verifyPhotoSignature({ ...base, secret: 'other-secret' }), {
    ok: false,
    reason: 'bad_signature',
  });
  // Expired: exp <= now.
  assert.deepEqual(await verifyPhotoSignature({ ...base, nowMs: exp * 1000 }), {
    ok: false,
    reason: 'expired',
  });
  // exp more than 24h out: a (hypothetical) long-lived URL is refused even
  // with a valid MAC.
  const farExp = Math.floor(NOW / 1000) + PHOTO_SIG_MAX_TTL_S + 3600;
  const farSig = await signPhoto(SECRET, NAME, 400, farExp);
  assert.deepEqual(
    await verifyPhotoSignature({ ...base, exp: String(farExp), sig: farSig }),
    { ok: false, reason: 'exp_too_far' },
  );
});
