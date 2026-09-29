// export-account — Deno tests.
//
// Run with:
//   deno test --allow-env --allow-net=127.0.0.1 supabase/functions/export-account/index.test.ts
//
// `handler` end-to-end with globalThis.fetch stubbed (same pattern as
// delete-account/index.test.ts). Pins the privacy-relevant query shapes:
//   - trips by the JWT-derived user id, trip children by the owned-trip ids,
//     tombstones excluded where the table has them;
//   - authored rows (memories, comments, reactions) by the author column =
//     caller (never by trip id, so a trip owner never receives another
//     member's items) and without tombstones;
//   - secrets (share / invite tokens) and other members' user ids never
//     selected;
//   - user_preferences by `user_id = caller`, returned as an object or null;
//   - every table paged past PostgREST's 1000-row cap.
//
// The handler is imported from ./handler.ts (index.ts only calls Deno.serve).
// `@ts-ignore`s: see delete-account/index.test.ts.

// @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  AUTHORED_TABLES,
  EXPORT_FILES_NOTE,
  EXPORT_PAGE_ROWS,
  handler,
  OWNED_TRIP_TABLES,
  TRIP_ID_CHUNK,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from './handler.ts';

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
  trip_expenses: [{
    id: 'e1',
    trip_id: TRIP_A,
    category: 'food',
    amount: 42.5,
    currency: 'TRY',
    fx_rate: 0.0179,
    fx_date: '2026-09-24',
    fx_home_currency: 'EUR',
  }],
  trip_accommodations: [{ id: 'a1', trip_id: TRIP_A, name: 'Hotel' }],
  trip_packing_items: [{ id: 'k1', trip_id: TRIP_A, label: 'Charger', checked: false }],
  trip_documents: [{ id: 'doc1', trip_id: TRIP_A, name: 'ticket.pdf', storage_path: `${TRIP_A}/1_ticket.pdf` }],
  trip_shares: [{ id: 's1', trip_id: TRIP_A, revoked_at: null, show_itinerary: true, show_expenses: false, show_memories: false }],
  trip_collaborators: [{ id: 'c1', trip_id: TRIP_A, invitee_email: 'friend@example.test', role: 'viewer', status: 'accepted' }],
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
  trip_place_comments: [{ id: 'pc1', trip_id: TRIP_C, author_id: USER_ID, body: 'Great view' }],
  trip_place_reactions: [{ id: 'pr1', trip_place_id: 'p9', user_id: USER_ID, reaction: 'liked' }],
  user_preferences: [{ user_id: USER_ID, locale: 'tr', home_currency: 'TRY', interests: ['food'] }],
};

const OWNED = OWNED_TRIP_TABLES.map((s: { table: string }) => s.table) as string[];
const AUTHORED = AUTHORED_TABLES as ReadonlyArray<{ table: string; author: string }>;

/** PostgREST-ish router: honours offset/limit so paging is exercised. */
function router(opts: { rows?: Partial<Record<string, unknown[]>>; failTable?: string } = {}) {
  const rows = { ...ROWS, ...opts.rows };
  return (c: Call): Response => {
    if (c.url.includes('/auth/v1/user')) return json({ id: USER_ID, aud: 'authenticated' });
    const m = /\/rest\/v1\/([a-z_]+)/.exec(c.url);
    if (m && c.method === 'GET') {
      if (opts.failTable === m[1]) return json({ message: 'db down' }, 500);
      let all = rows[m[1]!] ?? [];
      const inTrips = /trip_id=in\.\(([^)]*)\)/.exec(c.url);
      if (inTrips) {
        const ids = new Set(inTrips[1]!.split(','));
        all = all.filter((r) => ids.has(String((r as { trip_id?: unknown }).trip_id)));
      }
      const u = new URL(c.url);
      const offset = Number(u.searchParams.get('offset') ?? 0);
      const limit = Number(u.searchParams.get('limit') ?? all.length);
      return json(all.slice(offset, offset + limit));
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

const readsOf = (calls: Call[], table: string) => calls.filter((x) => x.url.includes(`/rest/v1/${table}?`));

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

D.test('export includes trip data, money, stays, packing, documents, sharing, memories, comments, reactions, preferences', async () => {
  const { restore } = stubFetch(router());
  try {
    const res = await handler(postReq());
    assertEquals(res.status, 200);
    const body = (await res.json()) as ExportBody;
    assertEquals(body.ok, true);
    const e = body.export;
    assertEquals(e.user_id, USER_ID);
    assertEquals(e.trips, ROWS.trips);
    for (const table of [...OWNED, ...AUTHORED.map((a) => a.table)]) {
      assertEquals(e[table], ROWS[table], table);
    }
    assertEquals(
      (e.trip_expenses as Array<Record<string, unknown>>)[0],
      ROWS.trip_expenses![0],
      'expenses keep amount + currency + frozen FX fields',
    );
    assertEquals(e.trip_photos, ROWS.trip_photos, 'photo metadata incl. storage_path / thumb_path');
    assertEquals(e.user_preferences, ROWS.user_preferences![0], 'preferences are one object, not an array');
    assertEquals(e.files, EXPORT_FILES_NOTE);
    assertEquals((e.files as typeof EXPORT_FILES_NOTE).buckets.trip_photos.bucket, 'trip-memories');
    assertEquals((e.files as typeof EXPORT_FILES_NOTE).buckets.trip_documents.bucket, 'trip-docs');
    assert(typeof e.exported_at === 'string');
    assert(!JSON.stringify(e).includes('/object/sign/'), 'no signed URLs');
  } finally {
    restore();
  }
});

D.test('trip-level tables are scoped to owned trips, tombstones excluded where they exist; service role only', async () => {
  const { calls, restore } = stubFetch(router());
  try {
    const res = await handler(postReq());
    assertEquals(res.status, 200);
    await res.body?.cancel();
    const trips = readsOf(calls, 'trips')[0]!;
    assert(trips.url.includes(`user_id=eq.${USER_ID}`), trips.url);
    const tombstoned = new Set([
      'trip_places',
      'trip_days',
      'trip_expenses',
      'trip_accommodations',
      'trip_packing_items',
    ]);
    for (const table of OWNED) {
      const c = readsOf(calls, table)[0];
      if (!c) throw new Error(`${table} must be read`);
      assert(c.url.includes(`trip_id=in.(${TRIP_A})`), `${table} scoped to owned trips: ${c.url}`);
      assert(!c.url.includes('author_id=') && !c.url.includes('user_id='), `${table} is trip-scoped: ${c.url}`);
      assertEquals(c.url.includes('deleted=eq.false'), tombstoned.has(table), `${table} tombstone filter: ${c.url}`);
      assert(c.url.includes('order=id.asc'), `${table} deterministic order: ${c.url}`);
    }
    for (const c of calls.filter((x) => x.url.includes('/rest/v1/'))) {
      assertEquals(c.auth, 'Bearer test-service-role-key', `reads use the service role: ${c.url}`);
    }
  } finally {
    restore();
  }
});

D.test('secrets and other members\' ids are never selected', async () => {
  const { calls, restore } = stubFetch(router());
  try {
    const res = await handler(postReq());
    await res.body?.cancel();
    const shares = readsOf(calls, 'trip_shares')[0]!;
    assert(!shares.url.includes('select=*'), shares.url);
    assert(!/select=[^&]*token/.test(shares.url), `share token must not be selected: ${shares.url}`);
    assert(shares.url.includes('show_memories'), 'the public-link toggles are exported');
    const collab = readsOf(calls, 'trip_collaborators')[0]!;
    assert(!collab.url.includes('select=*'), collab.url);
    assert(!/select=[^&]*invite_token/.test(collab.url), `invite token must not be selected: ${collab.url}`);
    assert(!/select=[^&]*user_id/.test(collab.url), `members' user ids must not be selected: ${collab.url}`);
    assert(collab.url.includes('invitee_email') && collab.url.includes('role'), collab.url);
  } finally {
    restore();
  }
});

D.test('authored rows are read by author (never by trip id) and without tombstones', async () => {
  const { calls, restore } = stubFetch(router());
  try {
    const res = await handler(postReq());
    assertEquals(res.status, 200);
    await res.body?.cancel();
    assertEquals(
      AUTHORED.map((a) => a.table).sort(),
      ['trip_journal_entries', 'trip_photos', 'trip_place_comments', 'trip_place_reactions', 'trip_place_reviews'],
    );
    for (const { table, author } of AUTHORED) {
      const c = readsOf(calls, table)[0];
      if (!c) throw new Error(`${table} must be read`);
      assert(c.url.includes(`${author}=eq.${USER_ID}`), `${table} must be scoped to the caller: ${c.url}`);
      assert(c.url.includes('deleted=eq.false'), `${table} must exclude tombstones: ${c.url}`);
      assert(!c.url.includes('trip_id='), `${table} must NOT be read by trip id (other members' items): ${c.url}`);
    }
    assertEquals(AUTHORED.find((a) => a.table === 'trip_place_reactions')!.author, 'user_id');
    const prefs = readsOf(calls, 'user_preferences')[0]!;
    assert(prefs.url.includes(`user_id=eq.${USER_ID}`), prefs.url);
  } finally {
    restore();
  }
});

D.test('a member who owns no trip still gets their authored rows (and no trip-child reads)', async () => {
  const { calls, restore } = stubFetch(router({ rows: { trips: [], user_preferences: [] } }));
  try {
    const res = await handler(postReq());
    assertEquals(res.status, 200);
    const e = ((await res.json()) as ExportBody).export;
    assertEquals(e.trips, []);
    for (const table of OWNED) assertEquals(e[table], [], table);
    assertEquals(e.trip_photos, ROWS.trip_photos);
    assertEquals(e.trip_place_comments, ROWS.trip_place_comments);
    assertEquals(e.trip_place_reactions, ROWS.trip_place_reactions);
    assertEquals(e.user_preferences, null);
    for (const table of OWNED) assertEquals(readsOf(calls, table).length, 0, `no empty in() read of ${table}`);
  } finally {
    restore();
  }
});

D.test('tables past the 1000-row PostgREST cap are paged, not truncated', async () => {
  const many = Array.from({ length: EXPORT_PAGE_ROWS * 2 + 5 }, (_, i) => ({
    id: `e${String(i).padStart(5, '0')}`,
    trip_id: TRIP_A,
    amount: i,
    currency: 'EUR',
  }));
  const { calls, restore } = stubFetch(router({ rows: { trip_expenses: many } }));
  try {
    const res = await handler(postReq());
    assertEquals(res.status, 200);
    const e = ((await res.json()) as ExportBody).export;
    assertEquals((e.trip_expenses as unknown[]).length, many.length);
    assertEquals(e.trip_expenses, many);
    const pages = readsOf(calls, 'trip_expenses');
    assertEquals(pages.length, 3);
    assert(pages[0]!.url.includes('offset=0') && pages[0]!.url.includes(`limit=${EXPORT_PAGE_ROWS}`), pages[0]!.url);
    assert(pages[2]!.url.includes(`offset=${EXPORT_PAGE_ROWS * 2}`), pages[2]!.url);
    // Small tables stop after one short page.
    assertEquals(readsOf(calls, 'trip_places').length, 1);
  } finally {
    restore();
  }
});

D.test('hundreds of owned trips: trip filters go out in chunks, merged back in id order', async () => {
  const tripIds = Array.from({ length: TRIP_ID_CHUNK * 2 + 50 }, (_, i) =>
    `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`,
  );
  const trips = tripIds.map((id) => ({ id, user_id: USER_ID, title: id.slice(-4) }));
  // One place per trip, ids deliberately in the opposite order of the trips.
  const places = tripIds.map((trip_id, i) => ({ id: `p${String(9999 - i).padStart(4, '0')}`, trip_id }));
  const { calls, restore } = stubFetch(router({ rows: { trips, trip_places: places } }));
  try {
    const res = await handler(postReq());
    assertEquals(res.status, 200);
    const e = ((await res.json()) as ExportBody).export;
    assertEquals((e.trips as unknown[]).length, tripIds.length);
    const got = e.trip_places as Array<{ id: string }>;
    assertEquals(got.length, places.length);
    assertEquals(got.map((p) => p.id), places.map((p) => p.id).sort(), 'one list, sorted by id');
    const reads = readsOf(calls, 'trip_places');
    assertEquals(reads.length, 3);
    for (const r of reads) {
      const n = /trip_id=in\.\(([^)]*)\)/.exec(r.url)![1]!.split(',').length;
      assert(n <= TRIP_ID_CHUNK, `chunk of ${n}`);
      assert(r.url.length < 8000, `URL ${r.url.length} chars`);
    }
  } finally {
    restore();
  }
});

for (const table of ['trips', 'trip_places', 'trip_expenses', 'trip_shares', 'trip_photos', 'trip_place_reactions', 'user_preferences']) {
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
