// Deno tests for _shared/auth.ts: requireUser + per-user quota (audit #2).
// Run with: deno test --allow-env --allow-net supabase/functions/_shared/auth.test.ts
//
// Written against node:test / node:assert / node:process. `deno test` runs
// these natively, and the repo-level `tsc` (include: **/*.ts) resolves them
// through @types/node instead of reporting every Deno.* reference.
import assert from 'node:assert/strict';
import process from 'node:process';
import { test } from 'node:test';
import {
  _setQuotaRpcForTests,
  _setTokenVerifierForTests,
  consumeQuota,
  DAILY_QUOTA,
  describeInvalidInput,
  extractBearer,
  quotaDeniedResponse,
  quotaExceededResponse,
  requireUser,
  secondsUntilUtcMidnight,
} from './auth.ts';

// base64url JSON segment, the shape of a JWT payload.
function seg(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const HEADER = seg({ alg: 'HS256', typ: 'JWT' });
// The local/hosted anon key has role=anon and NO sub. Same for service_role.
const ANON_JWT = `${HEADER}.${seg({ iss: 'supabase-demo', role: 'anon', exp: 1983812996 })}.sig`;
const SERVICE_JWT = `${HEADER}.${seg({ iss: 'supabase-demo', role: 'service_role' })}.sig`;
const USER_JWT = `${HEADER}.${seg({ sub: 'user-123', role: 'authenticated' })}.sig`;
const USER_ID = '00000000-0000-4000-8000-00000000abcd';

const CTX = { fn: 'test-fn', requestId: 'req-1', origin: null };

function req(auth?: string): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: auth ? { Authorization: auth } : {},
  });
}

async function errCode(res: Response): Promise<string> {
  const body = (await res.json()) as { error: { code: string } };
  return body.error.code;
}

test('extractBearer: parses "Bearer <t>" case-insensitively, rejects others', () => {
  assert.deepEqual(extractBearer(req('Bearer abc')), 'abc');
  assert.deepEqual(extractBearer(req('bearer abc')), 'abc');
  assert.deepEqual(extractBearer(req('Basic abc')), null);
  assert.deepEqual(extractBearer(req('Bearer ')), null);
  assert.deepEqual(extractBearer(req()), null);
});

test('requireUser: missing Authorization -> 401 not_authenticated', async () => {
  let called = false;
  _setTokenVerifierForTests(() => {
    called = true;
    return Promise.resolve({ ok: true, userId: USER_ID });
  });
  try {
    const r = await requireUser(req(), CTX);
    assert.ok(!r.ok);
    assert.deepEqual(r.response.status, 401);
    assert.deepEqual(await errCode(r.response), 'not_authenticated');
    assert.deepEqual(called, false);
  } finally {
    _setTokenVerifierForTests(null);
  }
});

test('requireUser: anon key (no sub) -> 401 WITHOUT a GoTrue round-trip', async () => {
  let called = false;
  _setTokenVerifierForTests(() => {
    called = true;
    return Promise.resolve({ ok: true, userId: USER_ID });
  });
  try {
    for (const token of [ANON_JWT, SERVICE_JWT]) {
      const r = await requireUser(req(`Bearer ${token}`), CTX);
      assert.ok(!r.ok, 'anon/service key must be rejected');
      assert.deepEqual(r.response.status, 401);
      assert.deepEqual(await errCode(r.response), 'not_authenticated');
    }
    assert.deepEqual(called, false, 'the verifier must not even be consulted');
  } finally {
    _setTokenVerifierForTests(null);
  }
});

test('requireUser: token GoTrue rejects -> 401', async () => {
  _setTokenVerifierForTests(() =>
    Promise.resolve({ ok: false, status: 401, code: 'not_authenticated', message: 'Invalid or expired token' }),
  );
  try {
    const r = await requireUser(req(`Bearer ${USER_JWT}`), CTX);
    assert.ok(!r.ok);
    assert.deepEqual(r.response.status, 401);
  } finally {
    _setTokenVerifierForTests(null);
  }
});

test('requireUser: GoTrue outage -> 503 auth_unavailable (not a 401)', async () => {
  _setTokenVerifierForTests(() =>
    Promise.resolve({ ok: false, status: 503, code: 'auth_unavailable', message: 'down' }),
  );
  try {
    const r = await requireUser(req(`Bearer ${USER_JWT}`), CTX);
    assert.ok(!r.ok);
    assert.deepEqual(r.response.status, 503);
    assert.deepEqual(await errCode(r.response), 'auth_unavailable');
  } finally {
    _setTokenVerifierForTests(null);
  }
});

test('requireUser: valid user -> id from the verifier + original header preserved', async () => {
  let seen = '';
  _setTokenVerifierForTests((token) => {
    seen = token;
    return Promise.resolve({ ok: true, userId: USER_ID });
  });
  try {
    const r = await requireUser(req(`Bearer ${USER_JWT}`), CTX);
    assert.ok(r.ok);
    assert.deepEqual(r.user.id, USER_ID);
    assert.deepEqual(r.user.authHeader, `Bearer ${USER_JWT}`);
    assert.deepEqual(seen, USER_JWT);
  } finally {
    _setTokenVerifierForTests(null);
  }
});

test('requireUser: real verifier without SUPABASE env -> 500 server_misconfigured', async () => {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  try {
    const r = await requireUser(req(`Bearer ${USER_JWT}`), CTX);
    assert.ok(!r.ok);
    assert.deepEqual(r.response.status, 500);
    assert.deepEqual(await errCode(r.response), 'server_misconfigured');
  } finally {
    if (url) process.env.SUPABASE_URL = url;
    if (anon) process.env.SUPABASE_ANON_KEY = anon;
  }
});

test('consumeQuota: passes caller id, kind, units and the constant cap to the RPC', async () => {
  const calls: unknown[] = [];
  _setQuotaRpcForTests((args) => {
    calls.push(args);
    return Promise.resolve({ data: true, error: null });
  });
  try {
    const out = await consumeQuota({
      userId: USER_ID,
      kind: 'routing_elements',
      units: 625,
      requestId: 'r',
      fn: 'f',
    });
    assert.deepEqual(out, 'ok');
    assert.deepEqual(calls, [
      { p_user: USER_ID, p_kind: 'routing_elements', p_units: 625, p_cap: DAILY_QUOTA.routing_elements },
    ]);
  } finally {
    _setQuotaRpcForTests(null);
  }
});

test('consumeQuota: RPC false -> exceeded', async () => {
  _setQuotaRpcForTests(() => Promise.resolve({ data: false, error: null }));
  try {
    assert.deepEqual(
      await consumeQuota({ userId: USER_ID, kind: 'place_details', units: 1, requestId: 'r', fn: 'f' }),
      'exceeded',
    );
  } finally {
    _setQuotaRpcForTests(null);
  }
});

test('consumeQuota: a request larger than the whole cap never reaches the RPC', async () => {
  let called = false;
  _setQuotaRpcForTests(() => {
    called = true;
    return Promise.resolve({ data: true, error: null });
  });
  try {
    assert.deepEqual(
      await consumeQuota({
        userId: USER_ID,
        kind: 'routing_elements',
        units: DAILY_QUOTA.routing_elements + 1,
        requestId: 'r',
        fn: 'f',
      }),
      'exceeded',
    );
    assert.deepEqual(called, false);
  } finally {
    _setQuotaRpcForTests(null);
  }
});

test('consumeQuota: RPC error or odd payload fails CLOSED -> unavailable (never ok)', async () => {
  for (const reply of [
    { data: null, error: { message: 'function consume_usage_quota does not exist' } },
    { data: null, error: null },
    { data: 'true', error: null },
  ]) {
    _setQuotaRpcForTests(() => Promise.resolve(reply));
    try {
      assert.equal(
        await consumeQuota({ userId: USER_ID, kind: 'places_autocomplete', units: 1, requestId: 'r', fn: 'f' }),
        'unavailable',
      );
    } finally {
      _setQuotaRpcForTests(null);
    }
  }
});

test('quotaDeniedResponse: exceeded -> 429 quota_exceeded, unavailable -> 503 quota_unavailable', async () => {
  const exceeded = quotaDeniedResponse('exceeded', 'place_details', null);
  assert.equal(exceeded.status, 429);
  assert.equal(await errCode(exceeded), 'quota_exceeded');
  const unavailable = quotaDeniedResponse('unavailable', 'place_details', null);
  assert.equal(unavailable.status, 503);
  assert.equal(await errCode(unavailable), 'quota_unavailable');
  assert.ok(unavailable.headers.get('Retry-After'));
});

test('quotaExceededResponse: 429, shared envelope, Retry-After to UTC midnight', async () => {
  const now = Date.UTC(2026, 8, 29, 23, 0, 0); // 1h before midnight UTC
  const res = quotaExceededResponse('places_autocomplete', null, now);
  assert.deepEqual(res.status, 429);
  assert.deepEqual(res.headers.get('Retry-After'), '3600');
  const body = (await res.json()) as { error: { code: string; message: string; limit: number } };
  assert.deepEqual(body.error.code, 'quota_exceeded');
  assert.deepEqual(body.error.limit, DAILY_QUOTA.places_autocomplete);
  assert.ok(body.error.message.includes(String(DAILY_QUOTA.places_autocomplete)));
});

test('secondsUntilUtcMidnight: never below 1', () => {
  assert.deepEqual(secondsUntilUtcMidnight(Date.UTC(2026, 0, 1, 0, 0, 0)), 86400);
  assert.deepEqual(secondsUntilUtcMidnight(Date.UTC(2026, 0, 1, 23, 59, 59, 999)), 1);
});

test('describeInvalidInput: zod-like issues joined; anything else -> Invalid JSON', () => {
  assert.deepEqual(describeInvalidInput({ issues: [{ message: 'a' }, { message: 'b' }] }), 'a; b');
  assert.deepEqual(describeInvalidInput(new SyntaxError('Unexpected end')), 'Invalid JSON');
  assert.deepEqual(describeInvalidInput(null), 'Invalid JSON');
});
