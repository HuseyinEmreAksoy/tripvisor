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
  // @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import process from 'node:process';
import { test } from 'node:test';
// @ts-ignore -- Deno `.ts`-suffixed import
import { handler, OPTIMIZE_CONTRACT_VERSION } from './index.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { _setTokenVerifierForTests } from '../_shared/auth.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { estimateLeg } from './legs.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { optimize } from '../../../src/lib/optimizer/kmeans-2opt.ts';

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

// M5 Y2.3: the function also reads trip_days (per-day default modes) and
// app_config ('transit_routing' kill switch), and deletes the trip's day legs
// before rewriting them. captureFetch answers those from these flags (no
// day overrides, no kill switch, delete OK) so the pre-Y2.3 tests keep their
// exact shape; the Y2.3 tests set them and restore them.
let tripDayRows: unknown[] = [];
let tripDaysStatus = 200;
let appConfigRows: unknown[] = [];
// Sweep fix: every Google transit call takes one unit of the global daily
// budget (consume_service_usage). true = granted; the budget tests flip it.
let transitBudget: { status: number; body: unknown } = { status: 200, body: true };

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
    if (url.includes('/rest/v1/trip_days') && method === 'GET') {
      return tripDaysStatus === 200
        ? jsonResp(tripDayRows)
        : jsonResp({ message: 'boom', code: 'XX000' }, tripDaysStatus);
    }
    if (url.includes('/rest/v1/app_config') && method === 'GET') return jsonResp(appConfigRows);
    if (url.includes('/rest/v1/rpc/consume_service_usage')) return jsonResp(transitBudget.body, transitBudget.status);
    if (url.includes('/rest/v1/trip_legs') && method === 'DELETE') return jsonResp(null, 204);
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
    roleArgs = roleCall!.body;
    const parsed = JSON.parse(roleArgs ?? '{}') as Record<string, string>;
    assertEquals(parsed.p_trip_id, TRIP_ID);
    assertEquals(parsed.p_user_id, USER_ID, "checked with the caller's OWN id");
    assertEquals(parsed.p_min_role, 'editor');
    // Caller-scoped client (the user JWT), never the service role.
    assertEquals(new Headers(roleCall!.init.headers).get('Authorization'), FAKE_JWT);

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

// ============================================================================
// M5 Y2.3 — per-leg transport modes
// ============================================================================

interface LatLngReq {
  lat: number;
  lng: number;
}
interface DirectionsReq {
  origin: LatLngReq;
  destination: LatLngReq;
  intermediates?: LatLngReq[];
  mode: string;
  perLeg?: boolean;
}
interface MatrixReq {
  origins: LatLngReq[];
  destinations: LatLngReq[];
  mode: string;
}
interface InsertedLeg {
  from_place_id: string;
  to_place_id: string;
  day_index: number;
  transport_mode: string;
  duration_seconds: number;
  distance_meters: number;
  polyline: string | null;
  transit_steps: unknown[] | null;
  source: string;
  computed_at?: string;
}
interface Assignment {
  id: string;
  day_index: number;
  order_in_day: number;
}
interface Y23Body {
  stateHash: string;
  days: Array<{ dayIndex: number; orderedPlaceIds: string[]; totalMinutes: number }>;
  placesUpdated: number;
  legsWritten: number;
  cacheHit: boolean;
  polylineDays: number;
  mode: string;
  keptOrderDays: number[];
  legSources: Record<string, number>;
  meta: { contractVersion: number };
  error?: { code: string };
}
type Y23Place = {
  id: string;
  lat: number;
  lng: number;
  visit_duration_minutes: number;
  day_index: number | null;
  order_in_day: number | null;
  manual_rank: string | null;
  arrival_mode: string | null;
  arrival_minutes: number | null;
};

function y23Place(n: number, lat: number, lng: number, extra: Partial<Y23Place> = {}): Y23Place {
  return {
    id: `00000000-0000-4000-8000-00000000${String(7000 + n)}`,
    lat,
    lng,
    visit_duration_minutes: 60,
    day_index: null,
    order_in_day: null,
    manual_rank: null,
    arrival_mode: null,
    arrival_minutes: null,
    ...extra,
  };
}

function y23Trip(transport_mode: string, daily_hours_budget = 8) {
  return { id: TRIP_ID, user_id: USER_ID, daily_hours_budget, transport_mode, anchor_place_id: null };
}

/** A directions answer for a run: per-leg split when asked (perLeg). */
function routedRun(provider: 'ors' | 'google', perLegSeconds = 300) {
  return (b: DirectionsReq): Response => {
    const n = 2 + (b.intermediates?.length ?? 0);
    const legs = Array.from({ length: n - 1 }, (_, i) => ({
      polyline: `${b.mode}-${i}`,
      durationSeconds: perLegSeconds,
      distanceMeters: 1000,
    }));
    return jsonResp({
      polyline: `${b.mode}-whole`,
      durationSeconds: perLegSeconds * (n - 1),
      distanceMeters: 1000 * (n - 1),
      provider,
      ...(b.perLeg ? { legs } : {}),
    });
  };
}

/** A full N×N matrix answer; `seconds(a, b, mode)` decides each element. */
function fullMatrix(seconds: (a: LatLngReq, b: LatLngReq, mode: string) => number, provider = 'ors') {
  return (b: MatrixReq): Response => {
    const legs: Array<{ fromIndex: number; toIndex: number; durationSeconds: number; distanceMeters: number }> = [];
    b.origins.forEach((o, i) =>
      b.destinations.forEach((d, j) => {
        if (i !== j) legs.push({ fromIndex: i, toIndex: j, durationSeconds: seconds(o, d, b.mode), distanceMeters: 1000 });
      }),
    );
    return jsonResp({ legs, provider });
  };
}

async function runY23(h: {
  trip: Record<string, unknown>;
  places: Y23Place[];
  mode: 'optimized' | 'manual';
  cachedLegs?: unknown[];
  matrix?: (b: MatrixReq) => Response;
  directions?: (b: DirectionsReq) => Response;
}) {
  const directionsCalls: DirectionsReq[] = [];
  const matrixCalls: MatrixReq[] = [];
  const inserted: InsertedLeg[] = [];
  const applied: Assignment[][] = [];
  const mock = captureFetch((call) => {
    if (call.url.includes('/rest/v1/trips') && !call.url.includes('trip_')) return jsonResp([h.trip]);
    if (call.url.includes('/rest/v1/trip_places')) return jsonResp(h.places);
    if (call.url.includes('/rest/v1/trip_legs') && call.method === 'GET') return jsonResp(h.cachedLegs ?? []);
    if (call.url.includes('/rest/v1/rpc/claim_trip_optimize')) return jsonResp(true);
    if (call.url.includes('/rest/v1/rpc/release_trip_optimize')) return jsonResp(null);
    if (call.url.includes('/functions/v1/distance-matrix')) {
      const b = JSON.parse(call.body ?? '{}') as MatrixReq;
      matrixCalls.push(b);
      return h.matrix ? h.matrix(b) : jsonResp({ error: { code: 'unexpected_matrix', message: 'x' } }, 500);
    }
    if (call.url.includes('/functions/v1/directions-polyline')) {
      const b = JSON.parse(call.body ?? '{}') as DirectionsReq;
      directionsCalls.push(b);
      return h.directions ? h.directions(b) : jsonResp({ error: { code: 'unexpected_directions', message: 'x' } }, 500);
    }
    if (call.url.includes('/rest/v1/rpc/apply_optimization')) {
      applied.push((JSON.parse(call.body ?? '{}') as { p_assignments: Assignment[] }).p_assignments);
      return jsonResp(1);
    }
    if (call.url.includes('/rest/v1/trip_legs') && call.method === 'POST') {
      inserted.push(...(JSON.parse(call.body ?? '[]') as InsertedLeg[]));
      return jsonResp([], 201);
    }
    return jsonResp({ error: `unexpected ${call.method} ${call.url}` }, 500);
  });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: FAKE_JWT },
        body: JSON.stringify({ tripId: TRIP_ID, mode: h.mode }),
      }),
    );
    const body = (await res.json()) as Y23Body;
    const deletes = mock.calls
      .filter((c) => c.url.includes('/rest/v1/trip_legs') && c.method === 'DELETE')
      .map((c) => decodeURIComponent(c.url));
    const edgeAuth = mock.calls
      .filter((c) => c.url.includes('/functions/v1/'))
      .map((c) => new Headers(c.init.headers).get('Authorization'));
    return { res, body, directionsCalls, matrixCalls, inserted, applied, deletes, edgeAuth, calls: mock.calls };
  } finally {
    mock.restore();
  }
}

const sameSpot = (a: LatLngReq, b: { lat: number; lng: number }) => a.lat === b.lat && a.lng === b.lng;

test('Y2.3 manual: mixed day drive -> transit -> walk -> walk; day default beats trip default', async () => {
  const p0 = y23Place(1, 38.7, -9.2, { day_index: 0, order_in_day: 0 });
  const p1 = y23Place(2, 38.72, -9.18, { day_index: 0, order_in_day: 1 }); // day default: driving
  const p2 = y23Place(3, 38.75, -9.14, { day_index: 0, order_in_day: 2, arrival_mode: 'transit' });
  const p3 = y23Place(4, 38.751, -9.139, { day_index: 0, order_in_day: 3, arrival_mode: 'walking' });
  const p4 = y23Place(5, 38.752, -9.138, { day_index: 0, order_in_day: 4, arrival_mode: 'walking' });
  const steps = [{ polyline: 'step', travelMode: 'TRANSIT', lineName: 'M2', vehicleType: 'SUBWAY' }];
  tripDayRows = [{ day_index: 0, transport_mode: 'driving' }];
  try {
    const out = await runY23({
      trip: y23Trip('walking'),
      places: [p0, p1, p2, p3, p4],
      mode: 'manual',
      directions: (b) => {
        if (b.mode === 'driving') return jsonResp({ polyline: 'drv', durationSeconds: 900, distanceMeters: 4000, provider: 'ors' });
        if (b.mode === 'transit') {
          return jsonResp({ polyline: null, durationSeconds: 1500, distanceMeters: 6000, transitSteps: steps, provider: 'google' });
        }
        return jsonResp({
          polyline: 'wlk',
          durationSeconds: 400,
          distanceMeters: 300,
          provider: 'ors',
          legs: [
            { polyline: 'w1', durationSeconds: 150, distanceMeters: 120 },
            { polyline: 'w2', durationSeconds: 250, distanceMeters: 180 },
          ],
        });
      },
    });
    assertEquals(out.res.status, 200);
    assertEquals(out.matrixCalls.length, 0, 'manual mode never builds a matrix');

    // One call per segment: driving run, transit leg, walking run (2 legs).
    assertEquals(out.directionsCalls.map((c) => c.mode).sort(), ['driving', 'transit', 'walking']);
    const drive = out.directionsCalls.find((c) => c.mode === 'driving')!;
    assert(sameSpot(drive.origin, p0) && sameSpot(drive.destination, p1));
    assertEquals(drive.perLeg, undefined, 'a one-leg run needs no split');
    const transit = out.directionsCalls.find((c) => c.mode === 'transit')!;
    assert(sameSpot(transit.origin, p1) && sameSpot(transit.destination, p2));
    assertEquals(transit.intermediates, undefined, 'transit is routed one leg per call');
    const walk = out.directionsCalls.find((c) => c.mode === 'walking')!;
    assert(sameSpot(walk.origin, p2) && sameSpot(walk.destination, p4));
    assertEquals(walk.intermediates?.length, 1);
    assertEquals(walk.perLeg, true);
    for (const a of out.edgeAuth) assertEquals(a, FAKE_JWT, 'routing calls carry the caller JWT');

    // Replace ALL legs (manual), then one row per consecutive pair.
    assertEquals(out.deletes.length, 1);
    assertStringIncludes(out.deletes[0]!, `trip_id=eq.${TRIP_ID}`);
    assert(!out.deletes[0]!.includes('day_index'), 'manual wipes every leg of the trip');
    assertEquals(
      out.inserted.map((r) => [r.from_place_id, r.to_place_id, r.day_index, r.transport_mode, r.source, r.duration_seconds, r.polyline]),
      [
        [p0.id, p1.id, 0, 'driving', 'ors', 900, 'drv'],
        [p1.id, p2.id, 0, 'transit', 'google', 1500, null],
        [p2.id, p3.id, 0, 'walking', 'ors', 150, 'w1'],
        [p3.id, p4.id, 0, 'walking', 'ors', 250, 'w2'],
      ],
    );
    assertEquals(out.inserted[1]!.transit_steps, steps);
    assertEquals(out.inserted[0]!.transit_steps, null);

    assertEquals(out.body.mode, 'manual');
    assertEquals(out.body.keptOrderDays, []);
    assertEquals(out.body.legSources, { ors: 3, google: 1, estimate: 0, user: 0 });
    assertEquals(out.body.legsWritten, 4);
    assertEquals(out.body.polylineDays, 1);
    assertEquals(out.body.meta.contractVersion, OPTIMIZE_CONTRACT_VERSION);
    assertEquals(OPTIMIZE_CONTRACT_VERSION, 2);
  } finally {
    tripDayRows = [];
  }
});

test('Y2.3 optimized: a flight/ferry day keeps its manual_rank order; only its legs are recomputed', async () => {
  // Day 0 is kept: rank order A, B, C (stored order_in_day disagrees).
  const A = y23Place(11, 38.72, -9.14, { day_index: 0, order_in_day: 2, manual_rank: 'a0' });
  const B = y23Place(12, 41.9, 12.5, { day_index: 0, order_in_day: 0, manual_rank: 'a1', arrival_mode: 'flight' });
  const C = y23Place(13, 40.85, 14.27, {
    day_index: 0,
    order_in_day: 1,
    manual_rank: 'a2',
    arrival_mode: 'ferry',
    arrival_minutes: 90,
  });
  // Free places: one optimizer day, which must land on index 1.
  const D = y23Place(14, 41.89, 12.49, { day_index: 1, order_in_day: 0 });
  const E = y23Place(15, 41.895, 12.48, { day_index: 1, order_in_day: 1 });
  const F = y23Place(16, 41.91, 12.47); // unscheduled idea
  const out = await runY23({
    trip: y23Trip('driving'),
    places: [A, B, C, D, E, F],
    mode: 'optimized',
    matrix: fullMatrix(() => 600),
    directions: routedRun('ors'),
  });
  assertEquals(out.res.status, 200);
  assertEquals(out.body.keptOrderDays, [0]);
  assertEquals(out.body.days.length, 2);
  assertEquals(out.body.days[0]!.dayIndex, 0);
  assertEquals(out.body.days[0]!.orderedPlaceIds, [A.id, B.id, C.id], 'kept day = manual_rank order');
  assertEquals(out.body.days[1]!.dayIndex, 1, 'the optimized day skips the kept index');
  assertEquals([...out.body.days[1]!.orderedPlaceIds].sort(), [D.id, E.id, F.id].sort());

  // The optimizer (matrix) never sees the kept day's places.
  assertEquals(out.matrixCalls.length, 1);
  assertEquals(out.matrixCalls[0]!.origins.length, 3);
  for (const o of out.matrixCalls[0]!.origins) assert(![A, B, C].some((p) => sameSpot(o, p)));

  // Kept rows: rank-derived order_in_day, day_index unchanged.
  const assignments = out.applied.flat();
  const byId = new Map(assignments.map((a) => [a.id, a]));
  assertEquals(byId.get(A.id), { id: A.id, day_index: 0, order_in_day: 0 });
  assertEquals(byId.get(B.id), { id: B.id, day_index: 0, order_in_day: 1 });
  assertEquals(byId.get(C.id), { id: C.id, day_index: 0, order_in_day: 2 });
  for (const p of [D, E, F]) assertEquals(byId.get(p.id)?.day_index, 1);

  // Flight/ferry are never routed: the only directions call is day 1's run.
  assertEquals(out.directionsCalls.length, 1);
  const run = out.directionsCalls[0]!;
  assertEquals(run.mode, 'driving');
  assertEquals(run.perLeg, true);
  for (const pt of [run.origin, run.destination, ...(run.intermediates ?? [])]) {
    assert(![A, B, C].some((p) => sameSpot(pt, p)), 'no routing call touches the kept day');
  }

  const dayLegs = out.inserted.filter((r) => r.day_index >= 0);
  const cacheRows = out.inserted.filter((r) => r.day_index < 0);
  const flight = dayLegs.find((r) => r.from_place_id === A.id)!;
  assertEquals([flight.to_place_id, flight.transport_mode, flight.source, flight.polyline], [B.id, 'flight', 'estimate', null]);
  assertEquals(flight.duration_seconds, estimateLeg('flight', A, B).durationSeconds);
  const ferry = dayLegs.find((r) => r.from_place_id === B.id)!;
  assertEquals([ferry.to_place_id, ferry.transport_mode, ferry.source, ferry.duration_seconds], [C.id, 'ferry', 'user', 90 * 60]);
  const day1 = dayLegs.filter((r) => r.day_index === 1);
  assertEquals(day1.length, 2);
  for (const r of day1) assertEquals([r.transport_mode, r.source], ['driving', 'ors']);
  assertEquals(cacheRows.length, 6, '3x3 matrix minus the diagonal');
  for (const r of cacheRows) assertEquals([r.transport_mode, r.source, r.day_index], ['driving', 'ors', -1]);
  const firstDayLeg = out.inserted.findIndex((r) => r.day_index >= 0);
  const lastCacheRow = out.inserted.map((r) => r.day_index < 0).lastIndexOf(true);
  assert(firstDayLeg > lastCacheRow, 'cache rows are written before day legs (last-wins for pre-Y2.3 clients)');

  // Day legs are replaced, the matrix cache is kept (only purged: sweep fix).
  const dayLegDeletes = out.deletes.filter((d) => d.includes('day_index=gte.0'));
  assertEquals(dayLegDeletes.length, 1);
  for (const d of out.deletes.filter((d) => !d.includes('day_index=gte.0'))) {
    assertStringIncludes(d, 'day_index=lt.0', 'any other delete is a matrix-cache purge');
  }
  assertEquals(out.body.legSources, { ors: 2, google: 0, estimate: 1, user: 1 });
  assertEquals(out.body.meta.contractVersion, 2);
  assertEquals(out.body.stateHash.length, 64, 'layout-aware hash when a day was kept');
});

test('Y2.3 manual: transit over the routing quota -> clearly-labelled estimates, still 200', async () => {
  const p0 = y23Place(21, 38.7, -9.2, { day_index: 0, order_in_day: 0 });
  const p1 = y23Place(22, 38.73, -9.15, { day_index: 0, order_in_day: 1 });
  const p2 = y23Place(23, 38.76, -9.1, { day_index: 0, order_in_day: 2 });
  const out = await runY23({
    trip: y23Trip('transit'),
    places: [p0, p1, p2],
    mode: 'manual',
    directions: () =>
      jsonResp({ error: { code: 'quota_exceeded', message: 'Daily route calculation limit reached (2000/day).' } }, 429),
  });
  assertEquals(out.res.status, 200, 'a spent quota never fails the render');
  assert(out.directionsCalls.length >= 1 && out.directionsCalls.length <= 2);
  assertEquals(
    out.inserted.map((r) => [r.from_place_id, r.to_place_id, r.transport_mode, r.source, r.polyline]),
    [
      [p0.id, p1.id, 'transit', 'estimate', null],
      [p1.id, p2.id, 'transit', 'estimate', null],
    ],
  );
  assertEquals(out.inserted[0]!.duration_seconds, estimateLeg('transit', p0, p1).durationSeconds);
  assertEquals(out.inserted[1]!.distance_meters, estimateLeg('transit', p1, p2).distanceMeters);
  assertEquals(out.body.legSources, { ors: 0, google: 0, estimate: 2, user: 0 });
  assertEquals(out.body.polylineDays, 0);
});

test('Y2.3: app_config transit_routing=estimate stops Google transit calls', async () => {
  appConfigRows = [{ value: 'estimate' }];
  try {
    const p0 = y23Place(31, 38.7, -9.2, { day_index: 0, order_in_day: 0 });
    const p1 = y23Place(32, 38.73, -9.15, { day_index: 0, order_in_day: 1 });
    const out = await runY23({
      trip: y23Trip('transit'),
      places: [p0, p1],
      mode: 'manual',
      directions: () => jsonResp({ error: 'must not be called' }, 500),
    });
    assertEquals(out.res.status, 200);
    assertEquals(out.directionsCalls.length, 0);
    assertEquals(out.inserted.map((r) => r.source), ['estimate']);
    const cfg = out.calls.find((c) => c.url.includes('/rest/v1/app_config'));
    assert(cfg, 'the kill switch is read');
    assertStringIncludes(decodeURIComponent(cfg!.url), 'key=eq.transit_routing');
    assertEquals(new Headers(cfg!.init.headers).get('Authorization'), FAKE_JWT, 'read as the caller (RLS)');
  } finally {
    appConfigRows = [];
  }
});

test('Y2.3 optimized transit trip with 11 places: no matrix over the 100-element transit cap', async () => {
  const places = Array.from({ length: 11 }, (_, i) => y23Place(40 + i, 38.7 + i * 0.002, -9.2 + i * 0.002));
  const out = await runY23({
    trip: y23Trip('transit', 24),
    places,
    mode: 'optimized',
    matrix: () => jsonResp({ error: 'must not be called' }, 500),
    directions: () =>
      jsonResp({
        polyline: null,
        durationSeconds: 600,
        distanceMeters: 2000,
        transitSteps: [{ polyline: 's', travelMode: 'TRANSIT', lineName: 'B1', vehicleType: 'BUS' }],
        provider: 'google',
      }),
  });
  assertEquals(out.res.status, 200);
  assertEquals(out.matrixCalls.length, 0, 'a 121-element transit matrix is never sent');
  assertEquals(out.body.days.length, 1);
  assertEquals(out.directionsCalls.length, 10, 'one transit call per leg');
  for (const c of out.directionsCalls) {
    assertEquals(c.mode, 'transit');
    assertEquals(c.intermediates, undefined);
  }
  const dayLegs = out.inserted.filter((r) => r.day_index >= 0);
  assertEquals(dayLegs.length, 10);
  for (const r of dayLegs) assertEquals([r.transport_mode, r.source], ['transit', 'google']);
  assertEquals(out.inserted.filter((r) => r.day_index < 0).length, 0, 'estimates are never cached');
  assertEquals(out.body.stateHash.length, 8, 'no kept day, no re-order: the optimizer hash is unchanged');
});

test('Y2.3: a run answered without a per-leg split is re-asked one leg per call', async () => {
  const p0 = y23Place(61, 38.7, -9.2, { day_index: 0, order_in_day: 0 });
  const p1 = y23Place(62, 38.71, -9.19, { day_index: 0, order_in_day: 1 });
  const p2 = y23Place(63, 38.72, -9.18, { day_index: 0, order_in_day: 2 });
  const out = await runY23({
    trip: y23Trip('driving'),
    places: [p0, p1, p2],
    mode: 'manual',
    // A pre-Y2.3 directions-polyline: ignores perLeg, sends no provider.
    directions: (b) =>
      b.perLeg
        ? jsonResp({ polyline: 'whole', durationSeconds: 1000, distanceMeters: 5000 })
        : jsonResp({ polyline: 'single', durationSeconds: 400, distanceMeters: 2000 }),
  });
  assertEquals(out.res.status, 200);
  assertEquals(out.directionsCalls.length, 3);
  assertEquals(out.directionsCalls.filter((c) => c.perLeg).length, 1);
  assertEquals(
    out.inserted.map((r) => [r.source, r.duration_seconds, r.polyline]),
    [
      ['google', 400, 'single'],
      ['google', 400, 'single'],
    ],
  );
});

test('Y2.3: a failed driving run becomes estimates instead of missing legs', async () => {
  const p0 = y23Place(71, 38.7, -9.2, { day_index: 0, order_in_day: 0 });
  const p1 = y23Place(72, 38.71, -9.19, { day_index: 0, order_in_day: 1 });
  const p2 = y23Place(73, 38.72, -9.18, { day_index: 0, order_in_day: 2 });
  const out = await runY23({
    trip: y23Trip('driving'),
    places: [p0, p1, p2],
    mode: 'manual',
    directions: () => jsonResp({ error: { code: 'upstream_error', message: 'Routes API returned an error' } }, 502),
  });
  assertEquals(out.res.status, 200);
  assertEquals(out.directionsCalls.length, 1);
  assertEquals(
    out.inserted.map((r) => [r.transport_mode, r.source, r.polyline, r.duration_seconds]),
    [
      ['driving', 'estimate', null, estimateLeg('driving', p0, p1).durationSeconds],
      ['driving', 'estimate', null, estimateLeg('driving', p1, p2).durationSeconds],
    ],
  );
  assertEquals(out.body.polylineDays, 0);
});

test('Y2.3 optimized: a day whose default mode differs is re-ordered with a matrix in that mode', async () => {
  // Four stops on one street. Walking time is the real distance; the car
  // matrix is deliberately perverse, so the two orders differ.
  const xs = [0, 3, 1, 2];
  const places = xs.map((x, i) => y23Place(80 + i, 38.7, -9.2 + x * 0.01));
  const xOf = (p: LatLngReq) => Math.round((p.lng + 9.2) / 0.01);
  const seconds = (a: LatLngReq, b: LatLngReq, mode: string) =>
    mode === 'walking' ? Math.abs(xOf(a) - xOf(b)) * 100 : (4 - Math.abs(xOf(a) - xOf(b))) * 100;
  tripDayRows = [{ day_index: 0, transport_mode: 'walking' }];
  try {
    const out = await runY23({
      trip: y23Trip('driving', 24),
      places,
      mode: 'optimized',
      matrix: fullMatrix(seconds),
      directions: routedRun('ors'),
    });
    assertEquals(out.res.status, 200);
    assertEquals(out.matrixCalls.map((m) => m.mode), ['driving', 'walking']);
    assertEquals(out.matrixCalls[1]!.origins.length, 4);

    // Expected = phase 1 (car matrix) then phase 2 (walking matrix, one day).
    const optPlaces = places.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, visitMinutes: 60 }));
    const legsFor = (mode: string) =>
      places.flatMap((a) =>
        places.filter((b) => b.id !== a.id).map((b) => ({ fromId: a.id, toId: b.id, durationSeconds: seconds(a, b, mode) })),
      );
    const phase1 = optimize({ places: optPlaces, legs: legsFor('driving'), dailyBudgetMinutes: 24 * 60 });
    const order1: string[] = phase1.days[0]!.orderedPlaceIds;
    const phase2 = optimize({
      places: order1.map((id) => optPlaces.find((p) => p.id === id)!),
      legs: legsFor('walking'),
      dailyBudgetMinutes: Number.MAX_SAFE_INTEGER,
    });
    const expected: string[] = phase2.days[0]!.orderedPlaceIds;
    assertEquals(out.body.days[0]!.orderedPlaceIds, expected);
    // And phase 2 really re-ordered: the walking time of the final order
    // beats the car-optimized order's.
    const walkCost = (order: string[]) => {
      let total = 0;
      for (let i = 1; i < order.length; i++) {
        const a = places.find((p) => p.id === order[i - 1])!;
        const b = places.find((p) => p.id === order[i])!;
        total += seconds(a, b, 'walking');
      }
      return total;
    };
    assert(
      walkCost(expected) < walkCost(order1),
      `walking ${walkCost(expected)} s vs the car order's ${walkCost(order1)} s`,
    );

    // The day's legs use the day default (walking), one run with a split.
    assertEquals(out.directionsCalls.length, 1);
    assertEquals(out.directionsCalls[0]!.mode, 'walking');
    const cacheModes = out.inserted.filter((r) => r.day_index < 0).map((r) => r.transport_mode);
    assertEquals(cacheModes.filter((m) => m === 'driving').length, 12);
    assertEquals(cacheModes.filter((m) => m === 'walking').length, 12);
    assertEquals(out.body.stateHash.length, 64, 'a phase-2 re-order changes the hash rule');
  } finally {
    tripDayRows = [];
  }
});

test('Y2.3 viewer in optimized mode -> 403 before day modes, kill switch, legs or routing', async () => {
  editorRoleResult = false;
  try {
    const out = await runY23({
      trip: y23Trip('driving'),
      places: [y23Place(91, 38.7, -9.2), y23Place(92, 38.71, -9.19)],
      mode: 'optimized',
      matrix: fullMatrix(() => 60),
      directions: routedRun('ors'),
    });
    assertEquals(out.res.status, 403);
    assertEquals(out.body.error?.code, 'not_editor');
    const forbidden = [
      'claim_trip_optimize',
      '/rest/v1/trip_places',
      '/rest/v1/trip_days',
      '/rest/v1/app_config',
      '/rest/v1/trip_legs',
      '/functions/v1/',
      'apply_optimization',
    ];
    for (const c of out.calls) {
      for (const f of forbidden) assert(!c.url.includes(f), `viewer reached ${f}`);
    }
  } finally {
    editorRoleResult = true;
  }
});

test('Y2.3: a failed trip_days read fails closed (500), no writes and no routing', async () => {
  tripDaysStatus = 500;
  try {
    const out = await runY23({
      trip: y23Trip('driving'),
      places: [
        y23Place(95, 38.7, -9.2, { day_index: 0, order_in_day: 0 }),
        y23Place(96, 38.71, -9.19, { day_index: 0, order_in_day: 1 }),
      ],
      mode: 'manual',
      directions: routedRun('ors'),
    });
    assertEquals(out.res.status, 500);
    assertEquals(out.body.error?.code, 'db_error');
    assertEquals(out.directionsCalls.length, 0);
    assertEquals(out.applied.length, 0);
    assertEquals(out.deletes.length, 0);
    assertEquals(out.inserted.length, 0);
    assert(out.calls.some((c) => c.url.includes('release_trip_optimize')), 'the mutex is released');
  } finally {
    tripDaysStatus = 200;
  }
});

// ============================================================================
// Sweep fixes: missing-pairs-only matrix, negative cache, cache purge,
// transit reuse + global transit budget
// ============================================================================

/** Answers every requested cell except same-spot cells and `skip(from, to)`. */
function pairMatrix(seconds: number, skip: (a: LatLngReq, b: LatLngReq) => boolean = () => false, provider = 'ors') {
  return (b: MatrixReq): Response => {
    const legs: Array<{ fromIndex: number; toIndex: number; durationSeconds: number; distanceMeters: number }> = [];
    b.origins.forEach((o, i) =>
      b.destinations.forEach((d, j) => {
        if (sameSpot(o, d) || skip(o, d)) return;
        legs.push({ fromIndex: i, toIndex: j, durationSeconds: seconds, distanceMeters: 1000 });
      }),
    );
    return jsonResp({ legs, provider });
  };
}

function cacheRow(
  from: Y23Place,
  to: Y23Place,
  extra: Partial<{ id: string; source: string; computed_at: string; transport_mode: string; duration_seconds: number }> = {},
) {
  return {
    id: `c-${from.id.slice(-4)}-${to.id.slice(-4)}`,
    from_place_id: from.id,
    to_place_id: to.id,
    duration_seconds: 600,
    distance_meters: 5000,
    computed_at: new Date(Date.now() - 24 * 60 * 60 * 1000 * 2).toISOString(),
    transport_mode: 'driving',
    source: 'ors',
    day_index: -1,
    ...extra,
  };
}

const elements = (calls: MatrixReq[]) => calls.reduce((n, c) => n + c.origins.length * c.destinations.length, 0);

test('sweep: one new place -> only its pairs are requested (two small requests, not N x N)', async () => {
  const old = Array.from({ length: 6 }, (_, i) => y23Place(100 + i, 38.7 + i * 0.01, -9.2));
  const added = y23Place(110, 38.8, -9.1);
  const cachedLegs = old.flatMap((a) => old.filter((b) => b.id !== a.id).map((b) => cacheRow(a, b)));
  const out = await runY23({
    trip: y23Trip('driving', 24),
    places: [...old, added],
    mode: 'optimized',
    cachedLegs,
    matrix: pairMatrix(500),
    directions: routedRun('ors'),
  });
  assertEquals(out.res.status, 200);
  assertEquals(out.matrixCalls.length, 2);
  assertEquals(elements(out.matrixCalls), 12, '6 + 6 elements instead of 7 x 7 = 49');
  for (const c of out.matrixCalls) {
    const touchesNew = [...c.origins, ...c.destinations].some((p) => sameSpot(p, added));
    assert(touchesNew, 'every request involves the new place');
  }
  const cache = out.inserted.filter((r) => r.day_index < 0);
  assertEquals(cache.length, 12, 'only the 12 new pairs are written');
  for (const r of cache) assert(r.from_place_id === added.id || r.to_place_id === added.id);
  assertEquals(out.body.cacheHit, false);
});

test('sweep: a pair answered without a route is negative-cached, then not asked again', async () => {
  const A = y23Place(120, 38.70, -9.20);
  const B = y23Place(121, 38.71, -9.19);
  const C = y23Place(122, 38.72, -9.18);
  const noRoute = (a: LatLngReq, b: LatLngReq) => sameSpot(a, A) && sameSpot(b, C);

  // Run 1: no cache. A -> C comes back empty.
  const first = await runY23({
    trip: y23Trip('driving', 24),
    places: [A, B, C],
    mode: 'optimized',
    matrix: pairMatrix(500, noRoute),
    directions: routedRun('ors'),
  });
  assertEquals(first.res.status, 200);
  const cache1 = first.inserted.filter((r) => r.day_index < 0);
  assertEquals(cache1.length, 6);
  const neg = cache1.find((r) => r.from_place_id === A.id && r.to_place_id === C.id)!;
  assertEquals([neg.source, neg.transport_mode, neg.polyline], ['estimate', 'driving', null]);
  assertEquals(neg.duration_seconds, estimateLeg('driving', A, C).durationSeconds);
  for (const r of cache1.filter((r) => r !== neg)) assertEquals(r.source, 'ors');

  // Run 2: the rows of run 1 (fresh): nothing is asked, the negative row included.
  const fresh = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const cachedLegs = cache1.map((r, i) => ({ ...r, id: `row-${i}`, computed_at: fresh }));
  const second = await runY23({
    trip: y23Trip('driving', 24),
    places: [A, B, C],
    mode: 'optimized',
    cachedLegs,
    matrix: () => jsonResp({ error: 'must not be called' }, 500),
    directions: routedRun('ors'),
  });
  assertEquals(second.res.status, 200);
  assertEquals(second.matrixCalls.length, 0, 'a known-unroutable pair is not re-requested');
  assertEquals(second.body.cacheHit, true);
  assertEquals(second.inserted.filter((r) => r.day_index < 0).length, 0);

  // Run 3: the negative row expired (25 h): only that pair is asked (1 x 1),
  // and the old row is purged by id before the new one is inserted.
  const expired = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const negIdx = cache1.indexOf(neg);
  const third = await runY23({
    trip: y23Trip('driving', 24),
    places: [A, B, C],
    mode: 'optimized',
    cachedLegs: cachedLegs.map((r, i) => (i === negIdx ? { ...r, computed_at: expired } : r)),
    matrix: pairMatrix(700),
    directions: routedRun('ors'),
  });
  assertEquals(third.res.status, 200);
  assertEquals(third.matrixCalls.length, 1);
  assertEquals(elements(third.matrixCalls), 1);
  assert(sameSpot(third.matrixCalls[0]!.origins[0]!, A) && sameSpot(third.matrixCalls[0]!.destinations[0]!, C));
  const cache3 = third.inserted.filter((r) => r.day_index < 0);
  assertEquals(cache3.map((r) => [r.from_place_id, r.to_place_id, r.source, r.duration_seconds]), [[A.id, C.id, 'ors', 700]]);
  const byId = third.deletes.find((d) => d.includes('id=in.'));
  assert(byId, 'the superseded row is deleted');
  assertStringIncludes(byId!, `id=in.(row-${negIdx})`);
  assertStringIncludes(byId!, 'day_index=lt.0');
  const insertIdx = third.calls.findIndex((c) => c.url.includes('/rest/v1/trip_legs') && c.method === 'POST');
  const purgeIdx = third.calls.findIndex(
    (c) => c.url.includes('/rest/v1/trip_legs') && c.method === 'DELETE' && decodeURIComponent(c.url).includes('id=in.'),
  );
  assert(purgeIdx >= 0 && purgeIdx < insertIdx, 'purge runs before the insert');
});

test('sweep: a transit pair without a connection is negative-cached and fed to the optimizer as an estimate', async () => {
  const A = y23Place(130, 38.70, -9.20);
  const B = y23Place(131, 38.71, -9.19);
  const out = await runY23({
    trip: y23Trip('transit', 24),
    places: [A, B],
    mode: 'optimized',
    matrix: pairMatrix(900, (a, b) => sameSpot(a, B) && sameSpot(b, A), 'google'),
    directions: () =>
      jsonResp({ polyline: null, durationSeconds: 900, distanceMeters: 2000, transitSteps: [], provider: 'google' }),
  });
  assertEquals(out.res.status, 200);
  const cache = out.inserted.filter((r) => r.day_index < 0);
  assertEquals(
    cache.map((r) => [r.from_place_id, r.to_place_id, r.source]).sort(),
    [[A.id, B.id, 'google'], [B.id, A.id, 'estimate']].sort(),
  );
});

test('sweep: every optimized run purges expired / orphaned matrix-cache rows (never day legs)', async () => {
  const A = y23Place(140, 38.70, -9.20);
  const B = y23Place(141, 38.71, -9.19);
  const out = await runY23({
    trip: y23Trip('driving', 24),
    places: [A, B],
    mode: 'optimized',
    matrix: pairMatrix(300),
    directions: routedRun('ors'),
  });
  assertEquals(out.res.status, 200);
  const purge = out.deletes.find((d) => d.includes('or=('));
  assert(purge, `a filter purge ran: ${out.deletes.join(' | ')}`);
  assertStringIncludes(purge!, `trip_id=eq.${TRIP_ID}`);
  assertStringIncludes(purge!, 'day_index=lt.0');
  assertStringIncludes(purge!, 'computed_at.lt.');
  assertStringIncludes(purge!, 'and(source.eq.estimate,computed_at.lt.');
  assertStringIncludes(purge!, `from_place_id.not.in.(${A.id},${B.id})`);
  assertStringIncludes(purge!, `to_place_id.not.in.(${A.id},${B.id})`);
  // Manual mode keeps wiping everything in one delete (no extra purge).
  const manual = await runY23({
    trip: y23Trip('driving'),
    places: [{ ...A, day_index: 0, order_in_day: 0 }, { ...B, day_index: 0, order_in_day: 1 }],
    mode: 'manual',
    directions: routedRun('ors'),
  });
  assertEquals(manual.deletes.length, 1);
});

test('sweep: a fresh routed transit day leg is reused (no call, no budget, original computed_at)', async () => {
  const p0 = y23Place(150, 38.7, -9.2, { day_index: 0, order_in_day: 0 });
  const p1 = y23Place(151, 38.73, -9.15, { day_index: 0, order_in_day: 1 });
  const p2 = y23Place(152, 38.76, -9.1, { day_index: 0, order_in_day: 2 });
  const steps = [{ polyline: 'old', travelMode: 'TRANSIT', lineName: 'T1', vehicleType: 'TRAM' }];
  const at = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const staleAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const out = await runY23({
    trip: y23Trip('transit'),
    places: [p0, p1, p2],
    mode: 'manual',
    cachedLegs: [
      {
        from_place_id: p0.id,
        to_place_id: p1.id,
        day_index: 0,
        transport_mode: 'transit',
        source: 'google',
        duration_seconds: 1234,
        distance_meters: 4321,
        transit_steps: steps,
        computed_at: at,
      },
      // Too old to reuse (the ToS window): routed again.
      {
        from_place_id: p1.id,
        to_place_id: p2.id,
        day_index: 0,
        transport_mode: 'transit',
        source: 'google',
        duration_seconds: 1,
        distance_meters: 1,
        transit_steps: steps,
        computed_at: staleAt,
      },
    ],
    directions: () =>
      jsonResp({ polyline: null, durationSeconds: 800, distanceMeters: 2500, transitSteps: [{ polyline: 'new' }], provider: 'google' }),
  });
  assertEquals(out.res.status, 200);
  assertEquals(out.directionsCalls.length, 1, 'only the stale pair is routed');
  assert(sameSpot(out.directionsCalls[0]!.origin, p1));
  const [reused, routed] = out.inserted;
  assertEquals([reused!.source, reused!.duration_seconds, reused!.distance_meters], ['google', 1234, 4321]);
  assertEquals(reused!.transit_steps, steps);
  assertEquals(reused!.computed_at, at, 'the ToS clock is not restarted');
  assertEquals([routed!.source, routed!.duration_seconds], ['google', 800]);
  assert(Date.parse(routed!.computed_at!) > Date.parse(at), 'a routed leg is stamped now');
  const budget = out.calls.filter((c) => c.url.includes('/rest/v1/rpc/consume_service_usage'));
  assertEquals(budget.length, 1, 'one budget unit, for the routed call only');
  assertEquals(JSON.parse(budget[0]!.body ?? '{}'), { p_service: 'google_transit', p_units: 1, p_cap: 300 });
  assertEquals(new Headers(budget[0]!.init.headers).get('Authorization'), 'Bearer test-service-role-key', 'service role only');
  const reuseRead = out.calls.find((c) => c.url.includes('/rest/v1/trip_legs') && c.method === 'GET')!;
  const u = decodeURIComponent(reuseRead.url);
  for (const f of ['day_index=gte.0', 'transport_mode=eq.transit', 'source=eq.google', 'computed_at=gte.']) {
    assertStringIncludes(u, f);
  }
  assertEquals(new Headers(reuseRead.init.headers).get('Authorization'), FAKE_JWT, 'read as the caller (RLS)');
});

for (const [label, budget] of [
  ['the global daily transit budget is spent', { status: 200, body: false }],
  ['the budget counter fails (fails closed)', { status: 500, body: { message: 'db down', code: 'XX000' } }],
] as const) {
  test(`sweep: ${label} -> transit legs are estimates, no Google call`, async () => {
    transitBudget = budget;
    try {
      const p0 = y23Place(160, 38.7, -9.2, { day_index: 0, order_in_day: 0 });
      const p1 = y23Place(161, 38.73, -9.15, { day_index: 0, order_in_day: 1 });
      const p2 = y23Place(162, 38.76, -9.1, { day_index: 0, order_in_day: 2 });
      const out = await runY23({
        trip: y23Trip('transit'),
        places: [p0, p1, p2],
        mode: 'manual',
        directions: () => jsonResp({ error: 'must not be called' }, 500),
      });
      assertEquals(out.res.status, 200);
      assertEquals(out.directionsCalls.length, 0);
      assertEquals(out.inserted.map((r) => r.source), ['estimate', 'estimate']);
      assertEquals(
        out.calls.filter((c) => c.url.includes('consume_service_usage')).length,
        1,
        'once refused, the rest of the run stops asking',
      );
    } finally {
      transitBudget = { status: 200, body: true };
    }
  });
}
