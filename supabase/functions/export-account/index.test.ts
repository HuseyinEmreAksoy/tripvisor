// export-account — Deno tests.
//
// Run with:
//   deno test --allow-env --allow-net=127.0.0.1 supabase/functions/export-account/index.test.ts
//
// `handler` end-to-end with globalThis.fetch stubbed (same pattern as
// delete-account/index.test.ts). Pins the privacy-relevant query shapes:
//   - trips by the JWT-derived user id, trip children by the owned-trip ids;
//   - M5 memories by `author_id = caller` (never by trip id, so a trip owner
//     never receives another member's items) and without tombstones;
//   - user_preferences by `user_id = caller`, returned as an object or null.
//
// The handler is imported from ./handler.ts (index.ts only calls Deno.serve).
// `@ts-ignore`s: see delete-account/index.test.ts.

// @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { AUTHORED_MEMORY_TABLES, handler } from './handler.ts';

// @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
const D = Deno;

D.env.set('SUPABASE_URL', 'http://127.0.0.1:54321');
D.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
D.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
D.env.set('ALLOWED_ORIGINS', 'http://localhost:8081');

const USER_ID = '11111111-1111-4111-8111-000000000001';
const TRIP_A = '33333333-3333-4333-8333-00000000000a';
const TRIP_C = '33333333-3333-4333-8333-00000000000c'; // someone else's trip the user is a member of

interface Call { url: string; method: string; auth: string }

function stubFetch(handle: (c: Call) => Response): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const auth = new Headers(init?.headers as HeadersInit).get('authorization') ?? '';
    const c = { url: decodeURIComponent(url), method, auth };
    calls.push(c);
    return await Promise.resolve(handle(c));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

const ROWS: Record<string, unknown[]> = {
  trips: [{ id: TRIP_A, user_id: USER_ID, title: 'Rome' }],
  trip_places: [{ id: 'p1', trip_id: TRIP_A }],
  trip_legs: [{ id: 'l1', trip_id: TRIP_A }],
  trip_days: [{ id: 'd1', trip_id: TRIP_A }],
  trip_journal_entries: [{ id: 'j1', trip_id: TRIP_C, author_id: USER_ID, body: 'day 1', visibility: 'only_me' }],
  trip_place_reviews: [{ id: 'r1', trip_id: TRIP_A, author_id: USER_ID, rating: 5 }],
  trip_photos: [{
    id: 'ph1',
    trip_id: TRIP_C,
    author_id: USER_ID,
    storage_path: `${TRIP_C}/${USER_ID}/ph1.jpg`,
    thumb_path: `${TRIP_C}/${USER_ID}/ph1_t.jpg`,
    status: 'ready',
  }],
  user_preferences: [{ user_id: USER_ID, locale: 'tr', home_currency: 'TRY', interests: ['food'] }],
};

function router(opts: { rows?: Partial<Record<string, unknown[]>>; failTable?: string } = {}) {
  const rows = { ...ROWS, ...opts.rows };
  return (c: Call): Response => {
    if (c.url.includes('/auth/v1/user')) return json({ id: USER_ID, aud: 'authenticated' });
    const m = /\/rest\/v1\/([a-z_]+)/.exec(c.url);
    if (m && c.method === 'GET') {
      if (opts.failTable === m[1]) return json({ message: 'db down' }, 500);
      return json(rows[m[1]!] ?? []);
    }
    return json({ message: `unrouted ${c.method} ${c.url}` }, 599);
  };
}

function postReq(auth = 'Bearer user.jwt.sig') {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { Authorization: auth, origin: 'http://localhost:8081' },
  });
}

type ExportBody = { ok: boolean; export: Record<string, unknown> };

D.test('?ping, 405, 401 without a bearer', async () => {
  const ping = await handler(new Request('http://localhost/?ping'));
  assertEquals(await ping.json(), { ok: true, fn: 'export-account' });
  const get = await handler(new Request('http://localhost/', { method: 'GET' }));
  assertEquals(get.status, 405);
  await get.body?.cancel();
  const noAuth = await handler(new Request('http://localhost/', { method: 'POST' }));
  assertEquals(noAuth.status, 401);
  await noAuth.body?.cancel();
});

D.test('export includes the M5 memory tables and preferences next to the trip data', async () => {
  const { restore } = stubFetch(router());
  try {
    const res = await handler(postReq());
    assertEquals(res.status, 200);
    const body = (await res.json()) as ExportBody;
    assertEquals(body.ok, true);
    const e = body.export;
    assertEquals(e.user_id, USER_ID);
    assertEquals(e.trips, ROWS.trips);
    assertEquals(e.trip_places, ROWS.trip_places);
    assertEquals(e.trip_legs, ROWS.trip_legs);
    assertEquals(e.trip_days, ROWS.trip_days);
    assertEquals(e.trip_journal_entries, ROWS.trip_journal_entries);
    assertEquals(e.trip_place_reviews, ROWS.trip_place_reviews);
    assertEquals(e.trip_photos, ROWS.trip_photos, 'photo metadata incl. storage_path / thumb_path');
    assertEquals(e.user_preferences, ROWS.user_preferences![0], 'preferences are one object, not an array');
    assert(typeof e.exported_at === 'string');
  } finally {
    restore();
  }
});

D.test('memories are read by author (never by trip id) and without tombstones; service role only', async () => {
  const { calls, restore } = stubFetch(router());
  try {
    const res = await handler(postReq());
    assertEquals(res.status, 200);
    await res.body?.cancel();
    for (const table of AUTHORED_MEMORY_TABLES) {
      const c = calls.find((x) => x.url.includes(`/rest/v1/${table}?`));
      if (!c) throw new Error(`${table} must be read`);
      assert(c.url.includes(`author_id=eq.${USER_ID}`), `${table} must be scoped to the caller: ${c.url}`);
      assert(c.url.includes('deleted=eq.false'), `${table} must exclude tombstones: ${c.url}`);
      assert(!c.url.includes('trip_id='), `${table} must NOT be read by trip id (other members' items): ${c.url}`);
    }
    const prefs = calls.find((x) => x.url.includes('/rest/v1/user_preferences?'))!;
    assert(prefs.url.includes(`user_id=eq.${USER_ID}`), prefs.url);
    const trips = calls.find((x) => x.url.includes('/rest/v1/trips?'))!;
    assert(trips.url.includes(`user_id=eq.${USER_ID}`), trips.url);
    for (const table of ['trip_places', 'trip_legs', 'trip_days']) {
      const c = calls.find((x) => x.url.includes(`/rest/v1/${table}?`))!;
      assert(c.url.includes(`trip_id=in.(${TRIP_A})`), `${table} scoped to owned trips: ${c.url}`);
    }
    for (const c of calls.filter((x) => x.url.includes('/rest/v1/'))) {
      assertEquals(c.auth, 'Bearer test-service-role-key', `reads use the service role: ${c.url}`);
    }
  } finally {
    restore();
  }
});

D.test('a member who owns no trip still gets their memories (and no trip-child reads)', async () => {
  const { calls, restore } = stubFetch(router({ rows: { trips: [], user_preferences: [] } }));
  try {
    const res = await handler(postReq());
    assertEquals(res.status, 200);
    const e = ((await res.json()) as ExportBody).export;
    assertEquals(e.trips, []);
    assertEquals(e.trip_places, []);
    assertEquals(e.trip_photos, ROWS.trip_photos);
    assertEquals(e.user_preferences, null);
    assert(!calls.some((c) => /\/rest\/v1\/trip_(places|legs|days)\?/.test(c.url)), 'no empty in() reads');
  } finally {
    restore();
  }
});

for (const table of ['trips', 'trip_places', 'trip_photos', 'user_preferences']) {
  D.test(`${table} read failure → 500 db_error, no partial export`, async () => {
    const { restore } = stubFetch(router({ failTable: table }));
    try {
      const res = await handler(postReq());
      assertEquals(res.status, 500);
      const body = (await res.json()) as { error: { code: string; message: string } };
      assertEquals(body.error.code, 'db_error');
      assert(body.error.message.includes(table), body.error.message);
    } finally {
      restore();
    }
  });
}
