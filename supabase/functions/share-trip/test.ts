// share-trip Edge Function — Deno integration tests.
//
// Run with:
//   deno test --allow-env --allow-net supabase/functions/share-trip/test.ts
//
// The tests mock globalThis.fetch to intercept all outbound HTTP calls
// (GoTrue `/auth/v1/user` for caller identity + PostgREST). We return
// PostgREST-compliant response bodies so the @supabase/supabase-js client
// processes them correctly.
//
// The Supabase JS client uses maybeSingle() which sets
//   Accept: application/vnd.pgrst.object+json
// and expects either a bare JSON object (status 200) or HTTP 406 (no rows).
// For array responses (normal .select()), it expects a JSON array.
//
// Pattern: follows supabase/functions/place-details/test.ts.
//
// The repo-root `npx tsc` (Expo tsconfig) also type-checks this file but
// cannot resolve Deno URL / `.ts`-suffixed imports or the `Deno` global. The
// `@ts-ignore`s below silence exactly those lines for tsc; `deno test` still
// type-checks everything normally (same pattern as delete-account/index.test.ts).

// @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { handler } from './index.ts';
import {
  buildPublicSharePayload,
  FORBIDDEN_PUBLIC_KEYS,
  LEG_FIELDS,
  PLACE_FIELDS,
  PUBLIC_PLACE_KEYS,
  PUBLIC_TRIP_KEYS,
  SHARE_READ_CONTRACT_VERSION,
  TRIP_FIELDS,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from './public-fields.ts';

// @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
const D = Deno;

// ---- Environment setup -----------------------------------------------------

D.env.set('SUPABASE_URL', 'http://127.0.0.1:54321');
D.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
D.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
D.env.set('ALLOWED_ORIGINS', '*');

// ---- Identities --------------------------------------------------------------

const OWNER_ID = '11111111-1111-4111-8111-000000000001';
const VIEWER_ID = '22222222-2222-4222-8222-000000000002';
const EDITOR_ID = '33333333-3333-4333-8333-000000000003';

// Fake bearer tokens — not verified here; the `/auth/v1/user` mock maps the
// marker in the token to a user (the real GoTrue verifies signatures).
const OWNER_JWT = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.OWNER.SIG';
const VIEWER_JWT = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.VIEWER.SIG';
const EDITOR_JWT = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.EDITOR.SIG';
// What anonymous share viewers send (the project anon key): GoTrue says 401.
const ANON_JWT = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ANONKEY.SIG';

const VALID_TRIP_ID = '00000000-0000-4000-8000-000000000001';

// ---- Mock helpers ------------------------------------------------------------

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });
}

/** GoTrue `GET /auth/v1/user` — maps the token marker to a user id. */
function authUser(init: RequestInit | undefined): Response {
  const auth = new Headers(init?.headers as HeadersInit).get('authorization') ?? '';
  if (auth.includes('.OWNER.')) return json({ id: OWNER_ID, aud: 'authenticated' });
  if (auth.includes('.VIEWER.')) return json({ id: VIEWER_ID, aud: 'authenticated' });
  if (auth.includes('.EDITOR.')) return json({ id: EDITOR_ID, aud: 'authenticated' });
  return json({ code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }, 401);
}

interface Call {
  url: string;
  method: string;
}

/**
 * Install a fetch stub. `/auth/v1/user` is always routed through `authUser`;
 * everything else goes to `route` (return undefined → 500 "unmatched").
 */
function stubFetch(route: (url: string, method: string, init?: RequestInit) => Response | undefined) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ url, method });
    if (url.includes('/auth/v1/user')) return Promise.resolve(authUser(init));
    const res = route(url, method, init);
    if (res) return Promise.resolve(res);
    console.error(`[stubFetch] unmatched URL: ${method} ${url}`);
    return Promise.resolve(json({ message: 'unmatched url in mock' }, 500));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** `trips` ownership lookup under the caller's JWT: the row RLS lets them see. */
const tripsRow = (userId: string) => (url: string) =>
  /\/rest\/v1\/trips\b/.test(url) && !url.includes('/trip_') ? json({ id: VALID_TRIP_ID, user_id: userId }) : undefined;

function post(body: unknown, auth?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) headers.Authorization = auth;
  return new Request('http://localhost/', { method: 'POST', headers, body: JSON.stringify(body) });
}

const sharesWrites = (calls: Call[]) =>
  calls.filter((c) => c.url.includes('/trip_shares') && (c.method === 'POST' || c.method === 'PATCH'));

// ---- ?ping -----------------------------------------------------------------

D.test('?ping returns { ok: true, fn: "share-trip" }', async () => {
  const res = await handler(new Request('http://localhost/?ping=1'));
  assertEquals(res.status, 200);
  const body = (await res.json()) as { ok: boolean; fn: string };
  assert(body.ok === true);
  assertEquals(body.fn, 'share-trip');
});

// ---- Input validation -------------------------------------------------------

D.test('POST with invalid JSON returns 400', async () => {
  const res = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    }),
  );
  assertEquals(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assertEquals(body.error.code, 'invalid_input');
});

D.test('POST with unknown op returns 400', async () => {
  const res = await handler(post({ op: 'delete_everything' }));
  assertEquals(res.status, 400);
});

D.test('GET (non-ping) returns 405', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'GET' }));
  assertEquals(res.status, 405);
});

D.test('op:create with invalid tripId UUID returns 400', async () => {
  const res = await handler(post({ op: 'create', tripId: 'not-a-uuid' }, OWNER_JWT));
  assertEquals(res.status, 400);
});

D.test('op:read token shorter than 16 chars returns 400 (Zod validation)', async () => {
  const res = await handler(post({ op: 'read', token: 'short' }));
  assertEquals(res.status, 400);
});

// ---- CORS preflight ---------------------------------------------------------

D.test('OPTIONS preflight returns 204', async () => {
  const res = await handler(
    new Request('http://localhost/', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:8081' },
    }),
  );
  assertEquals(res.status, 204);
});

// ---- op: create — owner happy path -------------------------------------------

D.test('op:create by the OWNER returns { token }', async () => {
  const mock = stubFetch((url, method) =>
    tripsRow(OWNER_ID)(url) ??
    (url.includes('/trip_shares') && method === 'POST' ? json([{ id: 'share-row-1' }], 201) : undefined));
  try {
    const res = await handler(post({ op: 'create', tripId: VALID_TRIP_ID }, OWNER_JWT));
    assertEquals(res.status, 200);
    const body = (await res.json()) as { token: string };
    assert(typeof body.token === 'string', 'token must be a string');
    assert(body.token.length >= 20, `Token too short: ${body.token}`);
    assert(/^[A-Za-z0-9_-]+$/.test(body.token), 'Token should be base64url');
    assertEquals(sharesWrites(mock.calls).length, 1, 'exactly one trip_shares insert');
  } finally {
    mock.restore();
  }
});

// ---- op: create — audit #5: non-owners are refused ---------------------------

D.test('audit #5: op:create by an accepted VIEWER → 403 not_owner, nothing written', async () => {
  // RLS lets the viewer SEE the trip (that is what the old check relied on);
  // the owner gate must still refuse because user_id !== caller.
  const mock = stubFetch((url) => tripsRow(OWNER_ID)(url));
  try {
    const res = await handler(post({ op: 'create', tripId: VALID_TRIP_ID }, VIEWER_JWT));
    assertEquals(res.status, 403);
    const body = (await res.json()) as { error: { code: string } };
    assertEquals(body.error.code, 'not_owner');
    assertEquals(sharesWrites(mock.calls).length, 0, 'no trip_shares write for a viewer');
    assert(
      !mock.calls.some((c) => c.url.includes('/trip_shares')),
      'trip_shares must not even be touched',
    );
  } finally {
    mock.restore();
  }
});

D.test('audit #5: op:create by an accepted EDITOR → 403 not_owner (owner-only by design)', async () => {
  const mock = stubFetch((url) => tripsRow(OWNER_ID)(url));
  try {
    const res = await handler(post({ op: 'create', tripId: VALID_TRIP_ID }, EDITOR_JWT));
    assertEquals(res.status, 403);
    assertEquals(((await res.json()) as { error: { code: string } }).error.code, 'not_owner');
    assertEquals(sharesWrites(mock.calls).length, 0);
  } finally {
    mock.restore();
  }
});

D.test('op:create without a bearer → 401 not_authenticated before any DB call', async () => {
  const mock = stubFetch(() => undefined);
  try {
    const res = await handler(post({ op: 'create', tripId: VALID_TRIP_ID }));
    assertEquals(res.status, 401);
    assertEquals(((await res.json()) as { error: { code: string } }).error.code, 'not_authenticated');
    assertEquals(mock.calls.length, 0, 'no network call without a bearer');
  } finally {
    mock.restore();
  }
});

D.test('op:create with the anon key as bearer → 401 (GoTrue rejects), no DB call', async () => {
  const mock = stubFetch(() => undefined);
  try {
    const res = await handler(post({ op: 'create', tripId: VALID_TRIP_ID }, ANON_JWT));
    assertEquals(res.status, 401);
    assert(!mock.calls.some((c) => c.url.includes('/rest/v1/')), 'no PostgREST call');
  } finally {
    mock.restore();
  }
});

D.test('op:create on a trip RLS hides from the caller → 404 not_found', async () => {
  // maybeSingle(): empty array = no matching rows.
  const mock = stubFetch((url) => (url.includes('/rest/v1/trips') ? json([]) : undefined));
  try {
    const res = await handler(post({ op: 'create', tripId: VALID_TRIP_ID }, VIEWER_JWT));
    assertEquals(res.status, 404);
    assertEquals(sharesWrites(mock.calls).length, 0);
  } finally {
    mock.restore();
  }
});

// ---- op: read — missing / revoked token --------------------------------------

D.test('op:read with missing token → 404', async () => {
  const mock = stubFetch((url) => (url.includes('/trip_shares') ? json([]) : undefined));
  try {
    const res = await handler(post({ op: 'read', token: 'nonexistent-token-value-1234567' }));
    assertEquals(res.status, 404);
    const body = (await res.json()) as { error: { code: string } };
    assertEquals(body.error.code, 'not_found');
  } finally {
    mock.restore();
  }
});

D.test('op:read with revoked token returns 404', async () => {
  const mock = stubFetch((url) =>
    url.includes('/trip_shares') ? json({ trip_id: 'trip-aaa', revoked_at: '2026-04-01T00:00:00Z' }) : undefined);
  try {
    const res = await handler(post({ op: 'read', token: 'revoked-token-value-12345678' }));
    assertEquals(res.status, 404);
  } finally {
    mock.restore();
  }
});

// ---- op: read — happy path + audit #12 --------------------------------------

/** Anonymous read fixture. The DB rows deliberately carry MORE than the allow-list. */
function readRoutes(tripId: string, captured: { tripsUrl?: string; placesUrl?: string }) {
  return (url: string): Response | undefined => {
    if (url.includes('/trip_shares')) return json([{ trip_id: tripId, revoked_at: null }]);
    if (url.includes('/trip_places')) {
      captured.placesUrl = url;
      return json([{
        id: 'place-1',
        google_place_id: 'ChIJ_1',
        user_title: 'Belem Tower',
        category: 'attraction',
        lat: 38.7,
        lng: -9.2,
        visit_duration_minutes: 75,
        day_index: 0,
        order_in_day: 0,
        notes: 'PRIVATE: door code 1234', // must never reach the anonymous viewer
        trip_id: tripId,
      }]);
    }
    if (url.includes('/trip_legs')) return json([]);
    if (url.includes('/trips')) {
      captured.tripsUrl = url;
      return json([{
        id: tripId, // must never reach the anonymous viewer (audit #12)
        user_id: OWNER_ID, // must never reach the anonymous viewer
        title: 'Shared Trip',
        start_date: '2026-06-01',
        end_date: '2026-06-03',
        daily_hours_budget: 8,
        transport_mode: 'driving',
        timezone: 'Europe/Lisbon',
      }]);
    }
    return undefined;
  };
}

D.test('op:read returns trip + places + legs + meta.contractVersion (no user_id / trip.id / notes)', async () => {
  const TRIP_ID = '00000000-0000-4000-8000-000000000099';
  const captured: { tripsUrl?: string; placesUrl?: string } = {};
  const mock = stubFetch(readRoutes(TRIP_ID, captured));
  try {
    const res = await handler(post({ op: 'read', token: 'validtoken12345678901234' }));
    assertEquals(res.status, 200);
    const body = (await res.json()) as {
      trip: Record<string, unknown>;
      places: Array<Record<string, unknown>>;
      legs: unknown[];
      meta: { contractVersion: number };
    };
    assertEquals(body.trip.title, 'Shared Trip');
    assertEquals(body.meta.contractVersion, 2);
    assert(!('user_id' in body.trip), 'user_id must NOT appear in the response');
    assert(!('id' in body.trip), 'audit #12: trip.id must NOT appear in the response');
    assertEquals(body.places.length, 1);
    assertEquals(body.places[0]?.user_title, 'Belem Tower');
    assertEquals(body.places[0]?.id, 'place-1', 'place ids stay (legs + list keys need them)');
    assert(!('notes' in body.places[0]!), 'audit #12: place notes are private by default');
    assert(!('trip_id' in body.places[0]!), 'non-allow-listed column must be dropped');
    assert(Array.isArray(body.legs));
    assertEquals(body.legs.length, 0);
    // Least data fetched, too: the PostgREST select must not ask for them.
    const tripSelect = new URL(captured.tripsUrl!).searchParams.get('select') ?? '';
    const placeSelect = new URL(captured.placesUrl!).searchParams.get('select') ?? '';
    assert(!tripSelect.split(',').includes('id'), `trips select must not include id: ${tripSelect}`);
    assert(!tripSelect.includes('user_id'), `trips select must not include user_id: ${tripSelect}`);
    assert(!placeSelect.includes('notes'), `trip_places select must not include notes: ${placeSelect}`);
  } finally {
    mock.restore();
  }
});

D.test('op:read filters trip_legs older than 30 days via computed_at cutoff', async () => {
  // Regression test for the Phase 4 ToS fix: legs whose `computed_at` is
  // older than 30 days must NOT be returned from the public share endpoint.
  // The handler appends `.gte('computed_at', <cutoff>)` to the legs query;
  // PostgREST surfaces that as `computed_at=gte.<iso>`. We simulate PostgREST
  // honoring the filter by returning only the fresh leg, and assert the
  // handler pushed a ~30-day cutoff down.
  const TRIP_ID = '00000000-0000-4000-8000-0000000000aa';
  const freshLeg = {
    id: 'leg-fresh',
    from_place_id: 'p1',
    to_place_id: 'p2',
    day_index: 0,
    transport_mode: 'driving',
    duration_seconds: 1200,
    distance_meters: 15000,
    polyline: 'abcdef',
    computed_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  };
  let capturedLegsUrl = '';
  const invokedAt = Date.now();
  const base = readRoutes(TRIP_ID, {});
  const mock = stubFetch((url) => {
    if (url.includes('/trip_legs')) {
      capturedLegsUrl = url;
      return json([freshLeg]);
    }
    return base(url);
  });
  try {
    const res = await handler(post({ op: 'read', token: 'ttltoken1234567890123456' }));
    assertEquals(res.status, 200);
    const body = (await res.json()) as { legs: Array<{ id: string; computed_at: string }> };
    assertEquals(body.legs.length, 1, 'only the fresh leg should be returned');
    assertEquals(body.legs[0]?.id, 'leg-fresh');

    assert(/computed_at=gte\./.test(capturedLegsUrl), `trip_legs URL must gte-filter computed_at: ${capturedLegsUrl}`);
    const match = capturedLegsUrl.match(/computed_at=gte\.([^&]+)/);
    assert(match && match[1], 'failed to extract cutoff timestamp from URL');
    const cutoffMs = Date.parse(decodeURIComponent(match![1]!));
    assert(!Number.isNaN(cutoffMs), 'cutoff must be a valid ISO timestamp');
    const expectedCutoff = invokedAt - 30 * 24 * 60 * 60 * 1000;
    assert(Math.abs(cutoffMs - expectedCutoff) <= 10_000, 'cutoff must be within 10s of now() - 30d');
  } finally {
    mock.restore();
  }
});

// ---- public-fields.ts (pure) ------------------------------------------------

D.test('public-fields: allow-lists exclude private keys and drive the select strings', () => {
  assertEquals(SHARE_READ_CONTRACT_VERSION, 2);
  for (const k of FORBIDDEN_PUBLIC_KEYS) {
    assert(!(PUBLIC_TRIP_KEYS as readonly string[]).includes(k), `trip allow-list must not have ${k}`);
    assert(!(PUBLIC_PLACE_KEYS as readonly string[]).includes(k), `place allow-list must not have ${k}`);
  }
  assert(!(PUBLIC_TRIP_KEYS as readonly string[]).includes('id'), 'trip allow-list must not have id');
  assertEquals(TRIP_FIELDS, PUBLIC_TRIP_KEYS.join(', '));
  assertEquals(PLACE_FIELDS, PUBLIC_PLACE_KEYS.join(', '));
  assert(LEG_FIELDS.includes('computed_at'));
});

D.test('public-fields: buildPublicSharePayload strips everything off-list', () => {
  const out = buildPublicSharePayload({
    trip: { id: 't', user_id: 'u', title: 'T', notes: 'x', start_date: null },
    places: [{ id: 'p', notes: 'secret', user_title: 'A', lat: 1, lng: 2 }],
    legs: null,
  });
  assertEquals(out.trip, { title: 'T', start_date: null });
  assertEquals(out.places, [{ id: 'p', user_title: 'A', lat: 1, lng: 2 }]);
  assertEquals(out.legs, []);
  assertEquals(out.meta, { contractVersion: 2 });
});

// ---- op: revoke --------------------------------------------------------------

/** Revoke fixture: owner lookup → PATCH trip_shares → count (content-range). */
function revokeRoutes(ownerId: string) {
  return (url: string, method: string): Response | undefined => {
    const trips = tripsRow(ownerId)(url);
    if (trips) return trips;
    if (url.includes('/trip_shares') && method === 'PATCH') return json(null, 204);
    if (url.includes('/trip_shares')) return json([], 200, { 'content-range': '0-0/1' });
    return undefined;
  };
}

D.test('op:revoke by the OWNER revokes and returns { revoked }', async () => {
  const mock = stubFetch(revokeRoutes(OWNER_ID));
  try {
    const res = await handler(post({ op: 'revoke', tripId: VALID_TRIP_ID }, OWNER_JWT));
    assertEquals(res.status, 200);
    const body = (await res.json()) as { revoked: number };
    assertEquals(body.revoked, 1);
    assertEquals(sharesWrites(mock.calls).length, 1, 'exactly one trip_shares PATCH');
  } finally {
    mock.restore();
  }
});

D.test('audit #5: op:revoke by an accepted VIEWER → 403 not_owner, links untouched', async () => {
  const mock = stubFetch(revokeRoutes(OWNER_ID));
  try {
    const res = await handler(
      post({ op: 'revoke', tripId: VALID_TRIP_ID, token: 'owner-token-value-1234567' }, VIEWER_JWT),
    );
    assertEquals(res.status, 403);
    assertEquals(((await res.json()) as { error: { code: string } }).error.code, 'not_owner');
    assertEquals(sharesWrites(mock.calls).length, 0, 'no PATCH on trip_shares for a viewer');
  } finally {
    mock.restore();
  }
});

D.test('audit #5: op:revoke by an accepted EDITOR → 403 not_owner', async () => {
  const mock = stubFetch(revokeRoutes(OWNER_ID));
  try {
    const res = await handler(post({ op: 'revoke', tripId: VALID_TRIP_ID }, EDITOR_JWT));
    assertEquals(res.status, 403);
    assertEquals(sharesWrites(mock.calls).length, 0);
  } finally {
    mock.restore();
  }
});

D.test('op:revoke without auth → 401 not_authenticated', async () => {
  const mock = stubFetch(() => undefined);
  try {
    const res = await handler(post({ op: 'revoke', tripId: VALID_TRIP_ID }));
    assertEquals(res.status, 401);
    assertEquals(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

// ---- gap #8: CORS deny (Step 5.2) ----------------------------------------
// _shared/cors.ts fails closed when ALLOWED_ORIGINS does not include the
// caller's origin. Regression guard for Phase 1 Problem 1 fix.

D.test('CORS deny: disallowed origin is not echoed in response', async () => {
  D.env.set('ALLOWED_ORIGINS', 'http://localhost:8081,https://tripvisor.app');

  const res = await handler(new Request('http://localhost/?ping=1', {
    headers: { origin: 'https://evil.example' },
  }));
  assertEquals(res.status, 200);
  const acao = res.headers.get('Access-Control-Allow-Origin');
  assert(
    acao !== 'https://evil.example',
    `CORS must not echo disallowed origin; got: ${acao}`,
  );
  // Reset for subsequent tests
  D.env.set('ALLOWED_ORIGINS', '*');
});

// ---- gap #18: revoke-then-create idempotence (Step 5.2) ------------------
// Create a share → revoke it → create a new share → assert:
//   1. The second token is distinct from the first.
//   2. Reading the first (revoked) token returns 404.
//   3. Reading the second token returns the trip.

D.test('revoke-then-create idempotence: second token is distinct; first is 404', async () => {
  const createRoutes = (url: string, method: string) =>
    tripsRow(OWNER_ID)(url) ??
    (url.includes('/trip_shares') && method === 'POST' ? json([{ id: 'share-row' }], 201) : undefined);

  // --- STEP 1: create first share ---
  let mock = stubFetch(createRoutes);
  const res1 = await handler(post({ op: 'create', tripId: VALID_TRIP_ID }, OWNER_JWT));
  mock.restore();
  assertEquals(res1.status, 200);
  const token1 = ((await res1.json()) as { token: string }).token;
  assert(token1.length >= 20, 'First token must be a non-trivial string');

  // --- STEP 2: revoke first share ---
  mock = stubFetch(revokeRoutes(OWNER_ID));
  const res2 = await handler(post({ op: 'revoke', tripId: VALID_TRIP_ID }, OWNER_JWT));
  mock.restore();
  assertEquals(res2.status, 200);

  // --- STEP 3: create second share ---
  mock = stubFetch(createRoutes);
  const res3 = await handler(post({ op: 'create', tripId: VALID_TRIP_ID }, OWNER_JWT));
  mock.restore();
  assertEquals(res3.status, 200);
  const token2 = ((await res3.json()) as { token: string }).token;
  assert(token1 !== token2, `Second token must differ from first; both are: ${token1}`);

  // --- STEP 4: reading the revoked (first) token → 404 ---
  mock = stubFetch((url) =>
    url.includes('/trip_shares') ? json({ trip_id: VALID_TRIP_ID, revoked_at: new Date().toISOString() }) : undefined);
  const res4 = await handler(post({ op: 'read', token: token1 }));
  mock.restore();
  assertEquals(res4.status, 404, 'Revoked first token must return 404');

  // --- STEP 5: reading the second (active) token → trip data ---
  mock = stubFetch(readRoutes(VALID_TRIP_ID, {}));
  const res5 = await handler(post({ op: 'read', token: token2 }));
  mock.restore();
  assertEquals(res5.status, 200, 'Second (active) token must return 200');
  const body5 = (await res5.json()) as { trip: Record<string, unknown> };
  assertEquals(body5.trip.title, 'Shared Trip');
});
