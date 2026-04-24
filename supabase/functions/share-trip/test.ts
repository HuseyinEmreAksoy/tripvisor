// share-trip Edge Function — Deno integration tests.
//
// Run with:
//   deno test --allow-env --allow-net supabase/functions/share-trip/test.ts
//
// The tests mock globalThis.fetch to intercept all outbound HTTP calls
// (both Supabase PostgREST calls). We return PostgREST-compliant response
// bodies so the @supabase/supabase-js client processes them correctly.
//
// The Supabase JS client uses maybeSingle() which sets
//   Accept: application/vnd.pgrst.object+json
// and expects either a bare JSON object (status 200) or HTTP 406 (no rows).
// For array responses (normal .select()), it expects a JSON array.
//
// Pattern: follows supabase/functions/place-details/test.ts.

import {
  assert,
  assertEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

// ---- Environment setup -----------------------------------------------------

Deno.env.set('SUPABASE_URL', 'http://127.0.0.1:54321');
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('ALLOWED_ORIGINS', '*');

// ---- Mock helper -----------------------------------------------------------

interface Route {
  match: string | RegExp;
  // PostgREST status code to return (200, 201, 204, 406, etc.)
  status?: number;
  // Body to return. For maybeSingle() success: bare object. For no-row: use status 406.
  body: unknown;
  // Content-Range header (optional — used by count queries)
  contentRange?: string;
}

function mockFetch(routes: Route[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const original = globalThis.fetch;

  globalThis.fetch = ((url: string, init: RequestInit) => {
    calls.push({ url, init });

    for (const route of routes) {
      const matched =
        typeof route.match === 'string'
          ? url.includes(route.match)
          : route.match.test(url);
      if (!matched) continue;

      const status = route.status ?? 200;
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (route.contentRange) headers['content-range'] = route.contentRange;

      const bodyText = route.body === null ? '' : JSON.stringify(route.body);
      // 204 = No Content (no body allowed in HTTP spec)
      return Promise.resolve(
        new Response(status === 204 ? null : bodyText, { status, headers }),
      );
    }

    // Catch-all: 500 internal server error (helps diagnose missing routes)
    console.error(`[mockFetch] unmatched URL: ${url}`);
    return Promise.resolve(
      new Response(JSON.stringify({ message: 'unmatched url in mock' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;

  return {
    calls,
    restore: () => { globalThis.fetch = original; },
  };
}

// A minimal fake JWT — not verified in these unit tests (we mock all DB calls).
const FAKE_JWT =
  'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ1c2VyLWFhYSIsImVtYWlsIjoiYUB0ZXN0LmxvY2FsIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const VALID_TRIP_ID = '00000000-0000-4000-8000-000000000001';

// ---- ?ping -----------------------------------------------------------------

Deno.test('?ping returns { ok: true, fn: "share-trip" }', async () => {
  const res = await handler(new Request('http://localhost/?ping=1'));
  assertEquals(res.status, 200);
  const body = (await res.json()) as { ok: boolean; fn: string };
  assert(body.ok === true);
  assertEquals(body.fn, 'share-trip');
});

// ---- Input validation -------------------------------------------------------

Deno.test('POST with invalid JSON returns 400', async () => {
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

Deno.test('POST with unknown op returns 400', async () => {
  const res = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'delete_everything' }),
    }),
  );
  assertEquals(res.status, 400);
});

Deno.test('GET (non-ping) returns 405', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'GET' }));
  assertEquals(res.status, 405);
});

Deno.test('op:create with invalid tripId UUID returns 400', async () => {
  const res = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: FAKE_JWT,
      },
      body: JSON.stringify({ op: 'create', tripId: 'not-a-uuid' }),
    }),
  );
  assertEquals(res.status, 400);
});

Deno.test('op:read token shorter than 16 chars returns 400 (Zod validation)', async () => {
  const res = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'read', token: 'short' }),
    }),
  );
  assertEquals(res.status, 400);
});

// ---- CORS preflight ---------------------------------------------------------

Deno.test('OPTIONS preflight returns 204', async () => {
  const res = await handler(
    new Request('http://localhost/', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:8081' },
    }),
  );
  assertEquals(res.status, 204);
});

// ---- op: create — happy path -----------------------------------------------

Deno.test('op:create with valid auth returns { token }', async () => {
  // The supabase-js client uses maybeSingle() which sends
  // Accept: application/vnd.pgrst.object+json and expects a bare JSON object.
  const mock = mockFetch([
    {
      // User-client: SELECT on trips (ownership check)
      // maybeSingle() expects a bare JSON object on 200
      match: /rest\/v1\/trips/,
      body: { id: VALID_TRIP_ID },
    },
    {
      // Admin-client: INSERT into trip_shares → 201 Created
      match: /rest\/v1\/trip_shares/,
      status: 201,
      body: [{ id: 'share-row-1' }],
    },
  ]);
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: FAKE_JWT,
        },
        body: JSON.stringify({ op: 'create', tripId: VALID_TRIP_ID }),
      }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { token: string };
    assert(typeof body.token === 'string', 'token must be a string');
    assert(body.token.length >= 20, `Token too short: ${body.token}`);
    assert(/^[A-Za-z0-9_-]+$/.test(body.token), 'Token should be base64url');
  } finally {
    mock.restore();
  }
});

// ---- op: create — unauthenticated ------------------------------------------

Deno.test('op:create without auth — ownership check returns no trip → 404', async () => {
  // supabase-js v2 maybeSingle() sends Accept: application/json.
  // An empty array [] with 200 is the correct "no rows" PostgREST response
  // for a query with no matching rows.
  const mock = mockFetch([
    {
      // Trips ownership check: empty array = no matching rows
      match: /rest\/v1\/trips/,
      status: 200,
      body: [],
    },
  ]);
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'create', tripId: VALID_TRIP_ID }),
      }),
    );
    // No trip found → 404 not_found
    assertEquals(res.status, 404);
  } finally {
    mock.restore();
  }
});

// ---- op: read — missing token -----------------------------------------------

Deno.test('op:read with missing token → 404', async () => {
  // maybeSingle() returns null when PostgREST returns an empty array [].
  const mock = mockFetch([
    {
      // trip_shares SELECT — empty array = no matching token
      match: /rest\/v1\/trip_shares/,
      status: 200,
      body: [],
    },
  ]);
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'read', token: 'nonexistent-token-value-1234567' }),
      }),
    );
    assertEquals(res.status, 404);
    const body = (await res.json()) as { error: { code: string } };
    assertEquals(body.error.code, 'not_found');
  } finally {
    mock.restore();
  }
});

// ---- op: read — revoked token -----------------------------------------------

Deno.test('op:read with revoked token returns 404', async () => {
  const mock = mockFetch([
    {
      // trip_shares SELECT → row exists but revoked_at is set
      match: /rest\/v1\/trip_shares/,
      body: { trip_id: 'trip-aaa', revoked_at: '2026-04-01T00:00:00Z' },
    },
  ]);
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'read', token: 'revoked-token-value-12345678' }),
      }),
    );
    assertEquals(res.status, 404);
  } finally {
    mock.restore();
  }
});

// ---- op: read — happy path --------------------------------------------------

Deno.test('op:read with valid token returns trip + places + legs (no user_id)', async () => {
  const TRIP_ID = '00000000-0000-4000-8000-000000000099';

  // Route by URL path segment. The handler calls these in this order:
  //   1. trip_shares  (maybeSingle — expects array then [0])
  //   2. trips        (maybeSingle — parallel via Promise.all)
  //   3. trip_places  (array)
  //   4. trip_legs    (array)
  //
  // We track whether trip_shares was already queried to distinguish call 1 from later ones.
  let tripSharesQueried = false;
  const original = globalThis.fetch;

  globalThis.fetch = ((url: string, _init: RequestInit) => {
    // trip_shares: first call returns active share, second call (if any) should not occur
    if (url.includes('/trip_shares')) {
      if (!tripSharesQueried) {
        tripSharesQueried = true;
        // maybeSingle(): return array with one item
        return Promise.resolve(
          new Response(
            JSON.stringify([{ trip_id: TRIP_ID, revoked_at: null }]),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
    }

    if (url.includes('/trips')) {
      // maybeSingle(): return array with one item
      return Promise.resolve(
        new Response(
          JSON.stringify([{
            id: TRIP_ID,
            title: 'Shared Trip',
            start_date: '2026-06-01',
            end_date: '2026-06-03',
            daily_hours_budget: 8,
            transport_mode: 'driving',
            timezone: 'Europe/Lisbon',
          }]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }

    if (url.includes('/trip_places')) {
      return Promise.resolve(
        new Response(
          JSON.stringify([{
            id: 'place-1',
            google_place_id: 'ChIJ_1',
            user_title: 'Belem Tower',
            category: 'attraction',
            lat: 38.7,
            lng: -9.2,
            visit_duration_minutes: 75,
            day_index: 0,
            order_in_day: 0,
            notes: null,
          }]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }

    if (url.includes('/trip_legs')) {
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }

    return Promise.resolve(
      new Response(JSON.stringify({ error: `unmatched: ${url}` }), { status: 500 }),
    );
  }) as typeof fetch;

  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'read', token: 'validtoken12345678901234' }),
      }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as {
      trip: Record<string, unknown>;
      places: Array<Record<string, unknown>>;
      legs: unknown[];
    };
    assertEquals(body.trip.id, TRIP_ID);
    assertEquals(body.trip.title, 'Shared Trip');
    assert(!('user_id' in body.trip), 'user_id must NOT appear in the response');
    assert(Array.isArray(body.places));
    assertEquals(body.places[0]?.user_title, 'Belem Tower');
    assert(Array.isArray(body.legs));
    assertEquals(body.legs.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

// ---- op: read — 30-day leg TTL (stale legs filtered out) ------------------

Deno.test('op:read filters trip_legs older than 30 days via computed_at cutoff', async () => {
  // Regression test for the Phase 4 ToS fix: legs whose `computed_at` is
  // older than 30 days must NOT be returned from the public share endpoint.
  //
  // The handler appends `.gte('computed_at', <cutoff>)` to the legs query.
  // PostgREST surfaces that as a URL query parameter like
  //   computed_at=gte.2026-03-25T...Z
  // We capture that URL, compute a reasonable cutoff window ourselves, and
  // assert the Edge Function sent a cutoff no older than 30 days and no
  // newer than ~30 days minus a few seconds (tolerating clock skew from the
  // moment the Edge Function ran vs. the moment this test code ran).
  //
  // We additionally simulate PostgREST honoring the filter by returning
  // ONLY the fresh leg in the mocked response — a real database query with
  // the gte filter would never send back a 31-day-old row. The assertion on
  // response.legs.length therefore checks that the handler passes through
  // whatever filtered rows PostgREST returns without re-introducing stale
  // legs of its own.
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
    computed_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day old
  };
  const staleLeg = {
    id: 'leg-stale',
    from_place_id: 'p2',
    to_place_id: 'p3',
    day_index: 0,
    transport_mode: 'driving',
    duration_seconds: 900,
    distance_meters: 10000,
    polyline: 'ghijkl',
    computed_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(), // 31 days old
  };

  let sharesQueried = false;
  let capturedLegsUrl = '';
  const original = globalThis.fetch;
  const invokedAt = Date.now();

  globalThis.fetch = ((url: string, _init: RequestInit) => {
    if (url.includes('/trip_shares')) {
      if (!sharesQueried) {
        sharesQueried = true;
        return Promise.resolve(
          new Response(
            JSON.stringify([{ trip_id: TRIP_ID, revoked_at: null }]),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
    }

    if (url.includes('/trips') && !url.includes('trip_')) {
      return Promise.resolve(
        new Response(
          JSON.stringify([{
            id: TRIP_ID,
            title: 'TTL Trip',
            start_date: '2026-06-01',
            end_date: '2026-06-03',
            daily_hours_budget: 8,
            transport_mode: 'driving',
            timezone: 'Europe/Lisbon',
          }]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }

    if (url.includes('/trip_places')) {
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }

    if (url.includes('/trip_legs')) {
      capturedLegsUrl = url;
      // Simulate PostgREST honoring the gte filter by only returning the
      // fresh leg. The handler does no client-side re-filtering — this
      // assertion confirms the handler forwards whatever PostgREST returns.
      return Promise.resolve(
        new Response(JSON.stringify([freshLeg]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }

    return Promise.resolve(
      new Response(JSON.stringify({ error: `unmatched: ${url}` }), { status: 500 }),
    );
  }) as typeof fetch;

  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'read', token: 'ttltoken1234567890123456' }),
      }),
    );
    assertEquals(res.status, 200);

    const body = (await res.json()) as {
      legs: Array<{ id: string; computed_at: string }>;
    };
    assertEquals(body.legs.length, 1, 'only the fresh leg should be returned');
    assertEquals(body.legs[0]?.id, 'leg-fresh');
    assert(
      !body.legs.some((l) => l.id === staleLeg.id),
      'stale leg (31 days old) must not appear in the share-trip read response',
    );

    // Verify the handler actually pushed a 30-day `gte` cutoff down to PostgREST.
    assert(capturedLegsUrl.length > 0, 'trip_legs fetch must have been invoked');
    assert(
      /computed_at=gte\./.test(capturedLegsUrl),
      `trip_legs URL must contain a gte filter on computed_at, got: ${capturedLegsUrl}`,
    );

    const match = capturedLegsUrl.match(/computed_at=gte\.([^&]+)/);
    assert(match && match[1], 'failed to extract cutoff timestamp from URL');
    const cutoffIso = decodeURIComponent(match[1]!);
    const cutoffMs = Date.parse(cutoffIso);
    assert(!Number.isNaN(cutoffMs), `cutoff must be a valid ISO timestamp, got: ${cutoffIso}`);

    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const expectedCutoff = invokedAt - thirtyDaysMs;
    // Allow a 10-second window of clock drift between when the test captured
    // `invokedAt` and when the Edge Function computed its own `Date.now()`.
    const driftMs = 10 * 1000;
    assert(
      cutoffMs >= expectedCutoff - driftMs && cutoffMs <= expectedCutoff + driftMs,
      `cutoff must be within 10s of now() - 30d; got ${cutoffIso} (delta ${cutoffMs - expectedCutoff}ms)`,
    );
  } finally {
    globalThis.fetch = original;
  }
});

// ---- op: revoke — happy path -----------------------------------------------

Deno.test('op:revoke with valid auth revokes and returns { revoked }', async () => {
  // Revoke handler sequence:
  //   1. user-client trips SELECT (ownership check, maybeSingle → array)
  //   2. user-client trip_shares PATCH/UPDATE (set revoked_at) → 204
  //   3. admin-client trip_shares GET with count=exact,head=true → content-range header
  let tripsQueried = false;
  let sharesUpdated = false;
  const original = globalThis.fetch;

  globalThis.fetch = ((url: string, init: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();

    // 1. trips ownership check (user-client, maybeSingle)
    if (url.includes('/trips') && !tripsQueried) {
      tripsQueried = true;
      return Promise.resolve(
        new Response(JSON.stringify([{ id: VALID_TRIP_ID }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }

    // 2. trip_shares UPDATE (PATCH in PostgREST)
    if (url.includes('/trip_shares') && method === 'PATCH' && !sharesUpdated) {
      sharesUpdated = true;
      return Promise.resolve(new Response(null, { status: 204 }));
    }

    // 3. trip_shares count query (GET with Prefer: count=exact)
    if (url.includes('/trip_shares')) {
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'content-range': '0-0/1',
          },
        }),
      );
    }

    return Promise.resolve(
      new Response(JSON.stringify({ error: `unmatched: ${url} ${method}` }), {
        status: 500,
      }),
    );
  }) as typeof fetch;

  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: FAKE_JWT,
        },
        body: JSON.stringify({ op: 'revoke', tripId: VALID_TRIP_ID }),
      }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { revoked: number };
    assert(typeof body.revoked === 'number');
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test('op:revoke without auth → 404 (ownership check fails)', async () => {
  // maybeSingle() returns null when PostgREST returns an empty array.
  const mock = mockFetch([
    {
      // User-client trips SELECT: empty array = no rows visible to anon
      match: /rest\/v1\/trips/,
      status: 200,
      body: [],
    },
  ]);
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          op: 'revoke',
          tripId: VALID_TRIP_ID,
        }),
      }),
    );
    assertEquals(res.status, 404);
  } finally {
    mock.restore();
  }
});
