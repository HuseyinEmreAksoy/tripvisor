// optimize-trip Edge Function — Deno integration tests.
//
// Run with:
//   deno test --allow-net --allow-env --allow-read supabase/functions/optimize-trip/test.ts
//
// The orchestrator touches a lot of moving parts:
//   - Supabase PostgREST (trips, trip_places, trip_legs, RPC)
//   - The distance-matrix Edge Function (over fetch to /functions/v1/...)
//   - The directions-polyline Edge Function (same)
//
// We mock globalThis.fetch at the top of each test and route by URL substring.
// For PostgREST, supabase-js expects:
//   - maybeSingle() → returns the first element of an array (accept: application/json)
//     OR a bare JSON object if the pgrst.object accept header is set. Returning
//     a JSON array of 0 or 1 elements works for both modes.
//   - array .select() → plain JSON array.
//   - .rpc(name, args) → POST /rest/v1/rpc/<name>; response is the function result.
//
// We distinguish user-client calls from admin-client calls by matching the
// Authorization bearer prefix where relevant — but for this orchestrator the
// call *order* is deterministic, so an ordered routing table works.
//
// Pattern: follows supabase/functions/share-trip/test.ts and
// supabase/functions/place-details/test.ts.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import process from 'node:process';
import { test } from 'node:test';
import { handler } from './index.ts';
import { _setTokenVerifierForTests } from '../_shared/auth.ts';

// ---- Environment setup -----------------------------------------------------

process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
// ALLOWED_ORIGINS deliberately does NOT include https://evil.example so the
// CORS-deny test below can verify fail-closed behaviour.
process.env.ALLOWED_ORIGINS = 'http://localhost:8081,https://tripvisor.app';

// ---- Shared helpers --------------------------------------------------------

const FAKE_JWT =
  'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ1c2VyLWFhYSIsImVtYWlsIjoiYUB0ZXN0LmxvY2FsIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const TRIP_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-00000000aaaa';

// Audit #2: requireUser resolves the caller through GoTrue. Tests swap in a
// verifier that maps FAKE_JWT to USER_ID and rejects anything else.
_setTokenVerifierForTests((token) =>
  Promise.resolve(
    `Bearer ${token}` === FAKE_JWT
      ? { ok: true as const, userId: USER_ID }
      : {
          ok: false as const,
          status: 401 as const,
          code: 'not_authenticated',
          message: 'Invalid or expired token',
        },
  ),
);

// Audit #6: every captureFetch answers the editor-role RPC from this flag
// (true = owner/editor) so the pre-existing tests keep their shape. The
// role tests flip it and restore it.
let editorRoleResult: unknown = true;

interface FetchCall {
  url: string;
  init: RequestInit;
  method: string;
  body: string | null;
}

function captureFetch(
  handle: (call: FetchCall) => Response | Promise<Response>,
): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const rawBody = init?.body;
    const body =
      typeof rawBody === 'string'
        ? rawBody
        : rawBody == null
          ? null
          : // Uint8Array / Blob / etc — coerce to string for inspection.
            String(rawBody);
    const call: FetchCall = { url, init: init ?? {}, method, body };
    calls.push(call);
    if (url.includes('/rest/v1/rpc/user_can_access_trip')) return jsonResp(editorRoleResult);
    return await Promise.resolve(handle(call));
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function jsonResp(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });
}

// ---- ?ping -----------------------------------------------------------------

test('?ping returns { ok: true, fn: "optimize-trip" }', async () => {
  const res = await handler(new Request('http://localhost/?ping=1'));
  assertEquals(res.status, 200);
  const body = (await res.json()) as { ok: boolean; fn: string };
  assert(body.ok === true);
  assertEquals(body.fn, 'optimize-trip');
});

// ---- Input validation ------------------------------------------------------

test('POST with missing tripId returns 400 with invalid_input', async () => {
  const res = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: FAKE_JWT },
      body: JSON.stringify({}),
    }),
  );
  assertEquals(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assertEquals(body.error.code, 'invalid_input');
});

test('POST with malformed tripId (not a UUID) returns 400', async () => {
  const res = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: FAKE_JWT },
      body: JSON.stringify({ tripId: 'not-a-uuid' }),
    }),
  );
  assertEquals(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assertEquals(body.error.code, 'invalid_input');
});

// ---- Auth / RLS ------------------------------------------------------------

test('unauthenticated POST → 401 not_authenticated before any DB read (audit #2)', async () => {
  // Pre-audit this fell through to an RLS-hidden 404. requireUser now
  // rejects before the trip is even queried.
  const mock = captureFetch((call) => jsonResp({ error: `unexpected ${call.url}` }, 500));
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tripId: TRIP_ID }),
      }),
    );
    assertEquals(res.status, 401);
    const body = (await res.json()) as { error: { code: string } };
    assertEquals(body.error.code, 'not_authenticated');
    assertEquals(mock.calls.length, 0, 'no PostgREST / Edge traffic for an anonymous caller');
  } finally {
    mock.restore();
  }
});

test('public anon key as bearer → 401 (audit #2)', async () => {
  const ANON_KEY_JWT =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
  const mock = captureFetch((call) => jsonResp({ error: `unexpected ${call.url}` }, 500));
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${ANON_KEY_JWT}` },
        body: JSON.stringify({ tripId: TRIP_ID }),
      }),
    );
    assertEquals(res.status, 401);
    assertEquals(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

// ---- Role gate (audit #6) --------------------------------------------------

test('viewer (can see trip, not editor) → 403 not_editor; no lock, no writes, no Edge calls', async () => {
  editorRoleResult = false;
  let roleArgs: string | null = null;
  const mock = captureFetch((call) => {
    if (call.url.includes('/rest/v1/trips') && !call.url.includes('trip_')) {
      return jsonResp([
        {
          id: TRIP_ID,
          user_id: '00000000-0000-4000-8000-00000000bbbb', // someone else's trip
          daily_hours_budget: 8,
          transport_mode: 'driving',
          anchor_place_id: null,
        },
      ]);
    }
    return jsonResp({ error: `unexpected ${call.url}` }, 500);
  });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: FAKE_JWT },
        body: JSON.stringify({ tripId: TRIP_ID, mode: 'manual' }),
      }),
    );
    assertEquals(res.status, 403);
    const body = (await res.json()) as { error: { code: string } };
    assertEquals(body.error.code, 'not_editor');

    const roleCall = mock.calls.find((c) => c.url.includes('/rpc/user_can_access_trip'));
    assert(roleCall, 'user_can_access_trip must be consulted');
    roleArgs = roleCall.body;
    const parsed = JSON.parse(roleArgs ?? '{}') as Record<string, string>;
    assertEquals(parsed.p_trip_id, TRIP_ID);
    assertEquals(parsed.p_user_id, USER_ID, "checked with the caller's OWN id");
    assertEquals(parsed.p_min_role, 'editor');
    // Caller-scoped client (the user JWT), never the service role.
    assertEquals(new Headers(roleCall.init.headers).get('Authorization'), FAKE_JWT);

    for (const c of mock.calls) {
      assert(!c.url.includes('claim_trip_optimize'), 'viewer must not take the mutex');
      assert(!c.url.includes('/rest/v1/trip_places'), 'viewer must not reach the place load');
      assert(!c.url.includes('/functions/v1/'), 'viewer must not trigger billed routing');
      assert(!c.url.includes('apply_optimization'), 'viewer must not write');
    }
  } finally {
    editorRoleResult = true;
    mock.restore();
  }
});

test('role RPC error → 500 (fails closed, never proceeds)', async () => {
  const mock = captureFetch((call) => {
    if (call.url.includes('/rest/v1/trips') && !call.url.includes('trip_')) {
      return jsonResp([
        { id: TRIP_ID, user_id: USER_ID, daily_hours_budget: 8, transport_mode: 'driving', anchor_place_id: null },
      ]);
    }
    return jsonResp({ error: `unexpected ${call.url}` }, 500);
  });
  // Make the role RPC itself fail at the HTTP level.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/rest/v1/rpc/user_can_access_trip')) {
      return Promise.resolve(jsonResp({ message: 'permission denied', code: '42501' }, 403));
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: FAKE_JWT },
        body: JSON.stringify({ tripId: TRIP_ID }),
      }),
    );
    assertEquals(res.status, 500);
    assert(!mock.calls.some((c) => c.url.includes('claim_trip_optimize')));
  } finally {
    globalThis.fetch = originalFetch;
    mock.restore();
  }
});

// ---- Caller auth forwarding (audit #2) -------------------------------------

test("sibling calls forward the CALLER's Authorization (never the anon key)", async () => {
  const p1 = { id: '00000000-0000-4000-8000-000000000501', lat: 38.7, lng: -9.2, visit_duration_minutes: 60 };
  const p2 = { id: '00000000-0000-4000-8000-000000000502', lat: 38.71, lng: -9.21, visit_duration_minutes: 45 };
  const edgeAuth: string[] = [];
  const mock = captureFetch((call) => {
    if (call.url.includes('/rest/v1/trips') && !call.url.includes('trip_')) {
      return jsonResp([
        { id: TRIP_ID, user_id: USER_ID, daily_hours_budget: 8, transport_mode: 'driving', anchor_place_id: null },
      ]);
    }
    if (call.url.includes('/rest/v1/trip_places')) return jsonResp([p1, p2]);
    if (call.url.includes('/rest/v1/trip_legs') && call.method === 'GET') return jsonResp([]);
    if (call.url.includes('/functions/v1/')) {
      edgeAuth.push(new Headers(call.init.headers).get('Authorization') ?? '');
      if (call.url.includes('distance-matrix')) {
        return jsonResp({
          legs: [
            { fromIndex: 0, toIndex: 1, durationSeconds: 600, distanceMeters: 1000 },
            { fromIndex: 1, toIndex: 0, durationSeconds: 600, distanceMeters: 1000 },
          ],
        });
      }
      return jsonResp({ polyline: 'abc', durationSeconds: 600, distanceMeters: 1000 });
    }
    if (call.url.includes('/rest/v1/rpc/apply_optimization')) return jsonResp(2);
    if (call.url.includes('/rest/v1/trip_legs') && call.method === 'POST') return jsonResp([], 201);
    return jsonResp({ error: `unexpected ${call.url}` }, 500);
  });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: FAKE_JWT },
        body: JSON.stringify({ tripId: TRIP_ID }),
      }),
    );
    assertEquals(res.status, 200);
    assert(edgeAuth.length >= 1, 'at least the matrix call must happen');
    for (const a of edgeAuth) {
      assertEquals(a, FAKE_JWT, 'must forward the caller JWT');
      assert(!a.includes('test-anon-key'), 'must never send the anon key as bearer');
    }
  } finally {
    mock.restore();
  }
});

test('matrix 429 quota_exceeded → optimize-trip 429 quota_exceeded (not matrix_failed)', async () => {
  const p1 = { id: '00000000-0000-4000-8000-000000000601', lat: 38.7, lng: -9.2, visit_duration_minutes: 60 };
  const p2 = { id: '00000000-0000-4000-8000-000000000602', lat: 38.71, lng: -9.21, visit_duration_minutes: 45 };
  let applied = false;
  const mock = captureFetch((call) => {
    if (call.url.includes('/rest/v1/trips') && !call.url.includes('trip_')) {
      return jsonResp([
        { id: TRIP_ID, user_id: USER_ID, daily_hours_budget: 8, transport_mode: 'driving', anchor_place_id: null },
      ]);
    }
    if (call.url.includes('/rest/v1/trip_places')) return jsonResp([p1, p2]);
    if (call.url.includes('/rest/v1/trip_legs') && call.method === 'GET') return jsonResp([]);
    if (call.url.includes('/functions/v1/distance-matrix')) {
      return jsonResp(
        { error: { code: 'quota_exceeded', message: 'Daily route calculation limit reached (2000/day).' } },
        429,
      );
    }
    if (call.url.includes('apply_optimization')) {
      applied = true;
      return jsonResp(2);
    }
    return jsonResp({ error: `unexpected ${call.url}` }, 500);
  });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: FAKE_JWT },
        body: JSON.stringify({ tripId: TRIP_ID }),
      }),
    );
    assertEquals(res.status, 429);
    const body = (await res.json()) as { error: { code: string; message: string } };
    assertEquals(body.error.code, 'quota_exceeded');
    assertStringIncludes(body.error.message, '2000');
    assertEquals(applied, false, 'no layout write when routing is refused');
  } finally {
    mock.restore();
  }
});

test('trip not visible to caller (RLS returns empty) → 404', async () => {
  const mock = captureFetch((call) => {
    if (call.url.includes('/rest/v1/trips')) return jsonResp([]);
    return jsonResp({ error: `unexpected ${call.url}` }, 500);
  });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: FAKE_JWT },
        body: JSON.stringify({ tripId: TRIP_ID }),
      }),
    );
    assertEquals(res.status, 404);
  } finally {
    mock.restore();
  }
});

// ---- Zero places — early short-circuit -------------------------------------

test('trip with 0 places short-circuits and writes nothing', async () => {
  let placesQueried = false;
  let rpcCalled = false;
  let legsInserted = false;

  const mock = captureFetch((call) => {
    if (call.url.includes('/rest/v1/trips') && !call.url.includes('trip_')) {
      return jsonResp([
        {
          id: TRIP_ID,
          user_id: USER_ID,
          daily_hours_budget: 8,
          transport_mode: 'driving',
          anchor_place_id: null,
        },
      ]);
    }
    if (call.url.includes('/rest/v1/rpc/pg_advisory_xact_lock')) {
      return jsonResp(null);
    }
    if (call.url.includes('/rest/v1/trip_places')) {
      placesQueried = true;
      return jsonResp([]); // empty trip
    }
    if (call.url.includes('/rest/v1/rpc/apply_optimization')) {
      rpcCalled = true;
      return jsonResp(0);
    }
    if (call.url.includes('/rest/v1/trip_legs') && call.method === 'POST') {
      legsInserted = true;
      return jsonResp([], 201);
    }
    if (call.url.includes('/functions/v1/')) {
      throw new Error(`empty-places path should never call an Edge Function, but hit ${call.url}`);
    }
    return jsonResp({ error: `unexpected ${call.url}` }, 500);
  });

  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: FAKE_JWT },
        body: JSON.stringify({ tripId: TRIP_ID }),
      }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as {
      days: unknown[];
      placesUpdated: number;
      legsWritten: number;
      cacheHit: boolean;
      polylineDays: number;
    };
    assertEquals(body.days, []);
    assertEquals(body.placesUpdated, 0);
    assertEquals(body.legsWritten, 0);
    assertEquals(body.polylineDays, 0);
    assert(placesQueried, 'trip_places SELECT must have been attempted');
    assertEquals(rpcCalled, false, 'apply_optimization must NOT be called for 0-place trip');
    assertEquals(legsInserted, false, 'trip_legs insert must NOT occur for 0-place trip');
  } finally {
    mock.restore();
  }
});

// ---- >25 places cap --------------------------------------------------------

test('trip with >25 places → 400 too_many_places', async () => {
  const twentySix = Array.from({ length: 26 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    lat: 38.7 + i * 0.001,
    lng: -9.1 + i * 0.001,
    visit_duration_minutes: 60,
  }));

  const mock = captureFetch((call) => {
    if (call.url.includes('/rest/v1/trips') && !call.url.includes('trip_')) {
      return jsonResp([
        {
          id: TRIP_ID,
          user_id: USER_ID,
          daily_hours_budget: 8,
          transport_mode: 'driving',
          anchor_place_id: null,
        },
      ]);
    }
    if (call.url.includes('/rest/v1/rpc/pg_advisory_xact_lock')) return jsonResp(null);
    if (call.url.includes('/rest/v1/trip_places')) return jsonResp(twentySix);
    return jsonResp({ error: `unexpected ${call.url}` }, 500);
  });

  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: FAKE_JWT },
        body: JSON.stringify({ tripId: TRIP_ID }),
      }),
    );
    assertEquals(res.status, 400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    assertEquals(body.error.code, 'too_many_places');
    assertStringIncludes(body.error.message, '26');
    assertStringIncludes(body.error.message, '25');
  } finally {
    mock.restore();
  }
});

// ---- Leg TTL — stale legs re-fetched via distance-matrix -------------------

test('stale trip_leg (31 days old) is ignored and re-fetched via distance-matrix', async () => {
  // Two places → 2 directed pairs (p1→p2, p2→p1). We seed:
  //   - p1→p2 stale (31 days old) — must be treated as missing
  //   - p2→p1 fresh (1 day old)   — must be kept as-is
  // Expected: distance-matrix is called for the stale pair only.
  const p1 = {
    id: '00000000-0000-4000-8000-000000000101',
    lat: 38.7,
    lng: -9.2,
    visit_duration_minutes: 60,
  };
  const p2 = {
    id: '00000000-0000-4000-8000-000000000102',
    lat: 38.71,
    lng: -9.21,
    visit_duration_minutes: 45,
  };
  const now = Date.now();
  const stale = new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString();
  const fresh = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();

  let distanceMatrixCalls = 0;
  let distanceMatrixBody: string | null = null;

  const mock = captureFetch((call) => {
    if (call.url.includes('/rest/v1/trips') && !call.url.includes('trip_')) {
      return jsonResp([
        {
          id: TRIP_ID,
          user_id: USER_ID,
          daily_hours_budget: 8,
          transport_mode: 'driving',
          anchor_place_id: null,
        },
      ]);
    }
    if (call.url.includes('/rest/v1/rpc/pg_advisory_xact_lock')) return jsonResp(null);
    if (call.url.includes('/rest/v1/trip_places')) return jsonResp([p1, p2]);
    if (call.url.includes('/rest/v1/trip_legs') && call.method === 'GET') {
      return jsonResp([
        {
          from_place_id: p1.id,
          to_place_id: p2.id,
          duration_seconds: 99999, // sentinel — must NOT appear in optimizer output
          distance_meters: 0,
          computed_at: stale,
          transport_mode: 'driving',
          polyline: null,
        },
        {
          from_place_id: p2.id,
          to_place_id: p1.id,
          duration_seconds: 600,
          distance_meters: 5000,
          computed_at: fresh,
          transport_mode: 'driving',
          polyline: null,
        },
      ]);
    }
    if (call.url.includes('/functions/v1/distance-matrix')) {
      distanceMatrixCalls++;
      distanceMatrixBody = call.body;
      // Respond with a deterministic matrix for whatever pairs were requested.
      // The orchestrator sends N origins × N destinations as parallel arrays.
      const parsed = JSON.parse(call.body ?? '{}') as {
        origins: Array<{ lat: number; lng: number }>;
        destinations: Array<{ lat: number; lng: number }>;
      };
      const legs = parsed.origins.map((_, i) => ({
        fromIndex: i,
        toIndex: i,
        durationSeconds: 777, // distinguishable marker
        distanceMeters: 1000,
      }));
      return jsonResp({ legs });
    }
    if (call.url.includes('/rest/v1/rpc/apply_optimization')) return jsonResp(2);
    if (call.url.includes('/functions/v1/directions-polyline')) {
      return jsonResp({ polyline: 'abc', durationSeconds: 600, distanceMeters: 5000 });
    }
    if (call.url.includes('/rest/v1/trip_legs') && call.method === 'POST') {
      return jsonResp([], 201);
    }
    return jsonResp({ error: `unexpected ${call.url}` }, 500);
  });

  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: FAKE_JWT },
        body: JSON.stringify({ tripId: TRIP_ID }),
      }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { cacheHit: boolean };
    assertEquals(body.cacheHit, false, 'must be a cache MISS because the stale leg was dropped');

    assertEquals(
      distanceMatrixCalls,
      1,
      'distance-matrix must be invoked exactly once to backfill the stale pair',
    );
    assert(distanceMatrixBody, 'distance-matrix request body must have been captured');
    // The orchestrator should request the missing p1→p2 pair.
    assertStringIncludes(distanceMatrixBody!, String(p1.lat));
    assertStringIncludes(distanceMatrixBody!, String(p2.lat));
  } finally {
    mock.restore();
  }
});

// ---- All legs cached fresh — cacheHit path skips distance-matrix -----------

test('all legs fresh in cache → distance-matrix is NOT invoked (cacheHit=true)', async () => {
  const p1 = {
    id: '00000000-0000-4000-8000-000000000201',
    lat: 38.7,
    lng: -9.2,
    visit_duration_minutes: 60,
  };
  const p2 = {
    id: '00000000-0000-4000-8000-000000000202',
    lat: 38.71,
    lng: -9.21,
    visit_duration_minutes: 45,
  };
  const freshIso = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour old

  let distanceMatrixCalls = 0;

  const mock = captureFetch((call) => {
    if (call.url.includes('/rest/v1/trips') && !call.url.includes('trip_')) {
      return jsonResp([
        {
          id: TRIP_ID,
          user_id: USER_ID,
          daily_hours_budget: 8,
          transport_mode: 'driving',
          anchor_place_id: null,
        },
      ]);
    }
    if (call.url.includes('/rest/v1/rpc/pg_advisory_xact_lock')) return jsonResp(null);
    if (call.url.includes('/rest/v1/trip_places')) return jsonResp([p1, p2]);
    if (call.url.includes('/rest/v1/trip_legs') && call.method === 'GET') {
      return jsonResp([
        {
          from_place_id: p1.id,
          to_place_id: p2.id,
          duration_seconds: 600,
          distance_meters: 5000,
          computed_at: freshIso,
          transport_mode: 'driving',
          polyline: null,
        },
        {
          from_place_id: p2.id,
          to_place_id: p1.id,
          duration_seconds: 600,
          distance_meters: 5000,
          computed_at: freshIso,
          transport_mode: 'driving',
          polyline: null,
        },
      ]);
    }
    if (call.url.includes('/functions/v1/distance-matrix')) {
      distanceMatrixCalls++;
      return jsonResp({ legs: [] });
    }
    if (call.url.includes('/rest/v1/rpc/apply_optimization')) return jsonResp(2);
    if (call.url.includes('/functions/v1/directions-polyline')) {
      return jsonResp({ polyline: 'abc', durationSeconds: 600, distanceMeters: 5000 });
    }
    if (call.url.includes('/rest/v1/trip_legs') && call.method === 'POST') {
      return jsonResp([], 201);
    }
    return jsonResp({ error: `unexpected ${call.url}` }, 500);
  });

  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: FAKE_JWT },
        body: JSON.stringify({ tripId: TRIP_ID }),
      }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { cacheHit: boolean; days: unknown[] };
    assertEquals(body.cacheHit, true, 'cacheHit must be true when every pair is fresh');
    assertEquals(
      distanceMatrixCalls,
      0,
      'distance-matrix must NOT be invoked when all legs are cached fresh',
    );
    assert(Array.isArray(body.days), 'days must be returned even on cache hit');
  } finally {
    mock.restore();
  }
});

// ---- Polyline per-day failure tolerated ------------------------------------

test('per-day directions-polyline failure does not abort the run', async () => {
  // Four places → with a 480-min budget and 240 min per place we expect
  // k = ceil(960/480) = 2 days, each with 2 places. That gives us at least
  // two polyline calls (one per day) so we can fail the first and verify the
  // orchestrator continues rather than short-circuiting on the 500.
  const places = [
    {
      id: '00000000-0000-4000-8000-000000000301',
      lat: 38.70,
      lng: -9.20,
      visit_duration_minutes: 240,
    },
    {
      id: '00000000-0000-4000-8000-000000000302',
      lat: 38.71,
      lng: -9.21,
      visit_duration_minutes: 240,
    },
    {
      id: '00000000-0000-4000-8000-000000000303',
      lat: 41.15,
      lng: -8.62,
      visit_duration_minutes: 240,
    },
    {
      id: '00000000-0000-4000-8000-000000000304',
      lat: 41.16,
      lng: -8.63,
      visit_duration_minutes: 240,
    },
  ];

  let polylineCalls = 0;

  const mock = captureFetch((call) => {
    if (call.url.includes('/rest/v1/trips') && !call.url.includes('trip_')) {
      return jsonResp([
        {
          id: TRIP_ID,
          user_id: USER_ID,
          daily_hours_budget: 8, // 8h × 60 = 480 min budget → 2 places/day
          transport_mode: 'driving',
          anchor_place_id: null,
        },
      ]);
    }
    if (call.url.includes('/rest/v1/rpc/pg_advisory_xact_lock')) return jsonResp(null);
    if (call.url.includes('/rest/v1/trip_places')) return jsonResp(places);
    if (call.url.includes('/rest/v1/trip_legs') && call.method === 'GET') {
      // No cache → distance-matrix will be called.
      return jsonResp([]);
    }
    if (call.url.includes('/functions/v1/distance-matrix')) {
      const parsed = JSON.parse(call.body ?? '{}') as {
        origins: Array<unknown>;
      };
      return jsonResp({
        legs: parsed.origins.map((_, i) => ({
          fromIndex: i,
          toIndex: i,
          durationSeconds: 1800,
          distanceMeters: 50_000,
        })),
      });
    }
    if (call.url.includes('/rest/v1/rpc/apply_optimization')) return jsonResp(places.length);
    if (call.url.includes('/functions/v1/directions-polyline')) {
      polylineCalls++;
      // Fail the first polyline call, succeed subsequent ones.
      if (polylineCalls === 1) {
        return jsonResp({ error: 'upstream failure' }, 500);
      }
      return jsonResp({
        polyline: `poly-${polylineCalls}`,
        durationSeconds: 1800,
        distanceMeters: 50_000,
      });
    }
    if (call.url.includes('/rest/v1/trip_legs') && call.method === 'POST') {
      return jsonResp([], 201);
    }
    return jsonResp({ error: `unexpected ${call.url}` }, 500);
  });

  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: FAKE_JWT },
        body: JSON.stringify({ tripId: TRIP_ID }),
      }),
    );
    // The orchestrator must NOT short-circuit — a 2xx response means the
    // partial failure was tolerated as designed.
    assertEquals(res.status, 200, 'orchestrator must not short-circuit on single-day polyline 500');
    const body = (await res.json()) as {
      polylineDays: number;
      days: Array<{ orderedPlaceIds: string[] }>;
    };
    assert(polylineCalls >= 1, 'at least one polyline call must have been attempted');
    // polylineDays counts only successful polyline responses — with 1 failure
    // out of N attempts, it must be strictly less than the attempt count.
    assert(
      body.polylineDays < polylineCalls,
      `polylineDays (${body.polylineDays}) must be < attempts (${polylineCalls})`,
    );
    assert(body.days.length > 0, 'days must still be computed and returned');
  } finally {
    mock.restore();
  }
});

// ---- CORS fail-closed ------------------------------------------------------

test('CORS: request from a non-allowlisted Origin does NOT get that Origin echoed back', async () => {
  // ALLOWED_ORIGINS is set at the top to "http://localhost:8081,https://tripvisor.app".
  // A POST from https://evil.example must not receive Access-Control-Allow-Origin: https://evil.example.
  const mock = captureFetch(() => jsonResp([])); // everything empty — 404 path is fine
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: FAKE_JWT,
          origin: 'https://evil.example',
        },
        body: JSON.stringify({ tripId: TRIP_ID }),
      }),
    );
    const acao = res.headers.get('access-control-allow-origin');
    // Either the header is absent (preferred) or it is NOT echoing the evil origin.
    assert(
      acao === null || acao !== 'https://evil.example',
      `evil origin must not be echoed; got: ${acao}`,
    );
  } finally {
    mock.restore();
  }
});
