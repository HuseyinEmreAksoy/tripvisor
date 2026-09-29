// Run with: deno test --allow-env --allow-net supabase/functions/place-photo/test.ts
//
// Security audit 2026-09-29 #3: the GET is public (verify_jwt = false, for
// <Image src>) but must only serve bytes for a valid, unexpired HMAC
// signature at an allowed width. The POST signer requires a real user and is
// metered.
//
// Written against node:test / node:assert / node:process (run natively by
// `deno test`; typed via @types/node for the repo-level tsc).
import assert from 'node:assert/strict';
import process from 'node:process';
import { test } from 'node:test';
import { _resetRateLimitForTests, handler } from './index.ts';
import { _setQuotaRpcForTests, _setTokenVerifierForTests } from '../_shared/auth.ts';
import { photoSignatureExpiry, signPhoto, verifyPhotoSignature } from '../_shared/photo-signature.ts';

const SECRET = 'test-photo-secret';
const NAME = 'places/ChIJ_test-1/photos/AciIO_ref-2';
const USER_ID = '00000000-0000-4000-8000-0000000000aa';

process.env.GOOGLE_MAPS_SERVER_KEY = 'test-key';
process.env.PHOTO_URL_SECRET = SECRET;
_setTokenVerifierForTests((token) =>
  Promise.resolve(
    token === 'user-token'
      ? { ok: true as const, userId: USER_ID }
      : { ok: false as const, status: 401 as const, code: 'not_authenticated', message: 'bad' },
  ),
);
_setQuotaRpcForTests(() => Promise.resolve({ data: true, error: null }));

function mockGoogleImage() {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL) => {
    calls.push(String(url));
    return Promise.resolve(
      new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }),
    );
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

async function signedUrl(opts: { w?: number; exp?: number; sigWidth?: number; name?: string } = {}) {
  const name = opts.name ?? NAME;
  const w = opts.w ?? 400;
  const exp = opts.exp ?? photoSignatureExpiry(Date.now());
  const sig = await signPhoto(SECRET, name, opts.sigWidth ?? w, exp);
  const p = new URLSearchParams({ photoName: name, maxWidthPx: String(w), exp: String(exp), sig });
  return `http://localhost/?${p.toString()}`;
}

test('?ping stays public', async () => {
  const res = await handler(new Request('http://localhost/?ping=1'));
  assert.deepEqual(res.status, 200);
});

test('GET without a signature -> 403 invalid_signature, Google never called', async () => {
  _resetRateLimitForTests();
  const mock = mockGoogleImage();
  try {
    const res = await handler(
      new Request(`http://localhost/?photoName=${encodeURIComponent(NAME)}&maxWidthPx=400`),
    );
    assert.deepEqual(res.status, 403);
    const body = (await res.json()) as { error: { code: string } };
    assert.deepEqual(body.error.code, 'invalid_signature');
    assert.deepEqual(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test('GET with a valid signature -> 200 bytes, Cache-Control kept, snapped width upstream', async () => {
  _resetRateLimitForTests();
  const mock = mockGoogleImage();
  try {
    const res = await handler(new Request(await signedUrl({ w: 400 })));
    assert.deepEqual(res.status, 200);
    assert.deepEqual(res.headers.get('Cache-Control'), 'public, max-age=21600');
    assert.deepEqual(res.headers.get('Content-Type'), 'image/jpeg');
    assert.deepEqual(mock.calls.length, 1);
    const upstream = new URL(mock.calls[0]!);
    assert.deepEqual(upstream.searchParams.get('maxWidthPx'), '400');
  } finally {
    mock.restore();
  }
});

test('GET: an unsnapped width is served at the snapped width it was signed for', async () => {
  _resetRateLimitForTests();
  const mock = mockGoogleImage();
  try {
    // Client asked for 500 -> snapped to 800 -> signed for 800.
    const res = await handler(new Request(await signedUrl({ w: 500, sigWidth: 800 })));
    assert.deepEqual(res.status, 200);
    assert.deepEqual(new URL(mock.calls[0]!).searchParams.get('maxWidthPx'), '800');
  } finally {
    mock.restore();
  }
});

test('GET: width tampering (sig for 200, ask 4800) -> 403', async () => {
  _resetRateLimitForTests();
  const mock = mockGoogleImage();
  try {
    const res = await handler(new Request(await signedUrl({ w: 4800, sigWidth: 200 })));
    assert.deepEqual(res.status, 403);
    assert.deepEqual(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test('GET: expired signature -> 403 signature_expired', async () => {
  _resetRateLimitForTests();
  const mock = mockGoogleImage();
  try {
    const past = Math.floor(Date.now() / 1000) - 10;
    const res = await handler(new Request(await signedUrl({ exp: past })));
    assert.deepEqual(res.status, 403);
    const body = (await res.json()) as { error: { code: string } };
    assert.deepEqual(body.error.code, 'signature_expired');
    assert.deepEqual(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test('GET: malformed photoName -> 400 (never an open proxy)', async () => {
  const res = await handler(new Request('http://localhost/?photoName=https://evil.example/x&sig=a&exp=1'));
  assert.deepEqual(res.status, 400);
});

test('GET: one signed URL replayed past the per-signature window -> 429', async () => {
  _resetRateLimitForTests();
  const mock = mockGoogleImage();
  try {
    const url = await signedUrl({ w: 200 });
    let last = 0;
    let ok = 0;
    for (let i = 0; i < 25; i++) {
      const res = await handler(new Request(url));
      last = res.status;
      if (res.status === 200) ok++;
      await res.body?.cancel();
    }
    assert.deepEqual(ok, 20, 'first 20 fetches per window are served');
    assert.deepEqual(last, 429);
    assert.deepEqual(mock.calls.length, 20, 'Google hit at most RL_MAX_PER_SIG times');
  } finally {
    mock.restore();
    _resetRateLimitForTests();
  }
});

test('GET: PHOTO_URL_SECRET unset -> 500 server_misconfigured (fails closed)', async () => {
  delete process.env.PHOTO_URL_SECRET;
  try {
    const res = await handler(new Request(await signedUrl()));
    assert.deepEqual(res.status, 500);
    const body = (await res.json()) as { error: { code: string } };
    assert.deepEqual(body.error.code, 'server_misconfigured');
  } finally {
    process.env.PHOTO_URL_SECRET = SECRET;
  }
});

test('POST sign without a user -> 401', async () => {
  const res = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ photos: [{ name: NAME }] }),
    }),
  );
  assert.deepEqual(res.status, 401);
});

test('POST sign with a user -> snapped widths + signatures that verify; metered per name', async () => {
  const seen: unknown[] = [];
  _setQuotaRpcForTests((args) => {
    seen.push(args);
    return Promise.resolve({ data: true, error: null });
  });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer user-token' },
        body: JSON.stringify({ photos: [{ name: NAME, maxWidthPx: 100 }, { name: NAME }] }),
      }),
    );
    assert.deepEqual(res.status, 200);
    const body = (await res.json()) as {
      photos: Array<{ name: string; maxWidthPx: number; exp: number; sig: string }>;
    };
    assert.deepEqual(body.photos.map((p) => p.maxWidthPx), [200, 400]);
    for (const p of body.photos) {
      const check = await verifyPhotoSignature({
        secret: SECRET,
        photoName: p.name,
        maxWidthPx: p.maxWidthPx,
        exp: p.exp,
        sig: p.sig,
        nowMs: Date.now(),
      });
      assert.ok(check.ok);
    }
    assert.deepEqual(seen, [{ p_user: USER_ID, p_kind: 'photo_sign', p_units: 2, p_cap: 300 }]);
  } finally {
    _setQuotaRpcForTests(() => Promise.resolve({ data: true, error: null }));
  }
});

test('POST sign: bad photo name -> 400; quota spent -> 429', async () => {
  const bad = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer user-token' },
      body: JSON.stringify({ photos: [{ name: 'https://evil.example/x' }] }),
    }),
  );
  assert.deepEqual(bad.status, 400);

  _setQuotaRpcForTests(() => Promise.resolve({ data: false, error: null }));
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer user-token' },
        body: JSON.stringify({ photos: [{ name: NAME }] }),
      }),
    );
    assert.deepEqual(res.status, 429);
  } finally {
    _setQuotaRpcForTests(() => Promise.resolve({ data: true, error: null }));
  }
});
