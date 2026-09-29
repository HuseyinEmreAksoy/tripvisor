// delete-account — Deno tests.
//
// Run with:
//   deno test --allow-env --allow-net=127.0.0.1 supabase/functions/delete-account/index.test.ts
//
// Two layers:
//   1. `storage-cleanup.ts` against an in-memory fake bucket (pagination,
//      nested folders, batching, failure reporting, author-folder scoping,
//      missing buckets).
//   2. `handler` end-to-end with globalThis.fetch stubbed (pattern follows
//      supabase/functions/manage-collaborators/index.test.ts): verifies every
//      enumeration happens BEFORE the auth delete, that trip-docs and
//      trip-memories objects of owned trips are removed, that on trips the
//      user does NOT own only their own `<trip>/<user>/` memories folder is
//      removed, and that a Storage failure keeps `{ ok: true }`.
//
// The handler is imported from ./handler.ts (index.ts only calls Deno.serve,
// which would try to bind a port when imported by a test).

// The repo-root `npx tsc` (Expo tsconfig) also type-checks this file but
// cannot resolve Deno URL / `.ts`-suffixed imports or the `Deno` global. The
// `@ts-ignore`s below silence exactly those lines for tsc; `deno test` still
// type-checks everything normally.
// @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  AUTHOR_PREFIXED_BUCKETS,
  authorPrefix,
  type BucketApi,
  cleanupStoragePrefixes,
  cleanupTripStorage,
  isMissingBucketError,
  LIST_PAGE_SIZE,
  REMOVE_BATCH_SIZE,
  TRIP_PREFIXED_BUCKETS,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from './storage-cleanup.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { handler } from './handler.ts';

// @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
const D = Deno;

D.env.set('SUPABASE_URL', 'http://127.0.0.1:54321');
D.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
D.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
D.env.set('ALLOWED_ORIGINS', 'http://localhost:8081');

const USER_ID = '11111111-1111-1111-1111-000000000001';
const OTHER_ID = '22222222-2222-2222-2222-000000000002';
const TRIP_A = '33333333-3333-4444-8888-00000000000a'; // owned by USER
const TRIP_B = '33333333-3333-4444-8888-00000000000b'; // not USER's
const TRIP_C = '33333333-3333-4444-8888-00000000000c'; // USER is a member, has photos
const TRIP_R = '33333333-3333-4444-8888-00000000000d'; // USER was a (revoked) member

// ---- Fake bucket -------------------------------------------------------------

/** One-level listing over a flat key set, the way Storage `list` behaves. */
function listLevel(store: Set<string>, path: string, limit: number, offset: number) {
  const prefix = `${path}/`;
  const children = new Map<string, boolean>(); // name -> isFolder
  for (const k of store) {
    if (!k.startsWith(prefix)) continue;
    const rest = k.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) children.set(rest, false);
    else children.set(rest.slice(0, slash), true);
  }
  const sorted = [...children.entries()].sort(([a], [b]) => a.localeCompare(b));
  return sorted.slice(offset, offset + limit).map(([name, isFolder]) => ({
    name,
    id: isFolder ? null : `id-${name}`,
  }));
}

/** In-memory bucket over a flat key set; `list` mimics Storage one-level listing. */
function fakeBucket(
  keys: string[],
  opts: { failRemove?: boolean; failListFor?: string; missingBucket?: boolean } = {},
) {
  const store = new Set(keys);
  const removeCalls: string[][] = [];
  const api: BucketApi = {
    list(path: string, { limit, offset }: { limit: number; offset: number }) {
      if (opts.missingBucket) return Promise.resolve({ data: null, error: { message: 'Bucket not found' } });
      if (opts.failListFor && path === opts.failListFor) {
        return Promise.resolve({ data: null, error: { message: 'boom' } });
      }
      return Promise.resolve({ data: listLevel(store, path, limit, offset), error: null });
    },
    remove(paths: string[]) {
      removeCalls.push(paths);
      if (opts.failRemove) return Promise.resolve({ data: null, error: { message: 'denied' } });
      for (const p of paths) store.delete(p);
      return Promise.resolve({ data: [], error: null });
    },
  };
  return { api, store, removeCalls };
}

D.test('bucket lists: both trip-prefixed buckets are cleaned; memories are also author-prefixed', () => {
  assertEquals([...TRIP_PREFIXED_BUCKETS], ['trip-docs', 'trip-memories']);
  assertEquals([...AUTHOR_PREFIXED_BUCKETS], ['trip-memories']);
  assertEquals(authorPrefix(TRIP_C, USER_ID), `${TRIP_C}/${USER_ID}`);
});

D.test('cleanupTripStorage removes paginated + nested objects only under owned prefixes', async () => {
  const many = Array.from({ length: LIST_PAGE_SIZE + 5 }, (_, i) => `${TRIP_A}/${String(i).padStart(4, '0')}_f.pdf`);
  const nested = [`${TRIP_A}/sub/deep/x.png`, `${TRIP_A}/sub/y.png`];
  const other = `${TRIP_B}/keep.pdf`;
  const { api, store, removeCalls } = fakeBucket([...many, ...nested, other]);

  const report = await cleanupTripStorage(api, 'trip-docs', [TRIP_A]);

  assertEquals(report.errors, []);
  assertEquals(report.found, many.length + nested.length);
  assertEquals(report.removed, many.length + nested.length);
  assertEquals([...store], [other]);
  assert(removeCalls.every((b) => b.length <= REMOVE_BATCH_SIZE));
  assertEquals(removeCalls.length, Math.ceil((many.length + nested.length) / REMOVE_BATCH_SIZE));
});

D.test('cleanupTripStorage reports failures without throwing and continues other trips', async () => {
  const { api, store } = fakeBucket([`${TRIP_A}/a.pdf`, `${TRIP_B}/b.pdf`], { failListFor: TRIP_A });
  const report = await cleanupTripStorage(api, 'trip-docs', [TRIP_A, TRIP_B]);
  assertEquals(report.errors.length, 1);
  assertEquals(report.removed, 1);
  assertEquals([...store], [`${TRIP_A}/a.pdf`]);

  const failing = fakeBucket([`${TRIP_A}/a.pdf`], { failRemove: true });
  const r2 = await cleanupTripStorage(failing.api, 'trip-docs', [TRIP_A]);
  assertEquals(r2.found, 1);
  assertEquals(r2.removed, 0);
  assertEquals(r2.errors.length, 1);
});

D.test('cleanupTripStorage with no trips is a no-op', async () => {
  const { api, removeCalls } = fakeBucket([`${TRIP_A}/a.pdf`]);
  const report = await cleanupTripStorage(api, 'trip-docs', []);
  assertEquals(report.found, 0);
  assertEquals(removeCalls.length, 0);
});

D.test('cleanupStoragePrefixes on an author folder removes only that author\'s photos', async () => {
  const mine = [`${TRIP_C}/${USER_ID}/p1.jpg`, `${TRIP_C}/${USER_ID}/p1_t.jpg`];
  const theirs = [`${TRIP_C}/${OTHER_ID}/p2.jpg`, `${TRIP_C}/${OTHER_ID}/p2_t.jpg`];
  const { api, store } = fakeBucket([...mine, ...theirs]);
  const report = await cleanupStoragePrefixes(api, 'trip-memories', [authorPrefix(TRIP_C, USER_ID)]);
  assertEquals(report.errors, []);
  assertEquals(report.removed, 2);
  assertEquals([...store].sort(), [...theirs].sort());
});

D.test('a bucket that does not exist yet counts as empty (deploy before migration)', async () => {
  assert(isMissingBucketError({ message: 'Bucket not found' }));
  assert(!isMissingBucketError({ message: 'storage down' }));
  const { api, removeCalls } = fakeBucket([], { missingBucket: true });
  const report = await cleanupTripStorage(api, 'trip-memories', [TRIP_A]);
  assertEquals(report.errors, []);
  assertEquals(report.found, 0);
  assertEquals(removeCalls.length, 0);
});

// ---- Handler (fetch-stubbed) -------------------------------------------------

interface Call { url: string; method: string; body: string | null }

function stubFetch(handle: (c: Call) => Response): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : null;
    const c = { url, method, body };
    calls.push(c);
    return await Promise.resolve(handle(c));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

interface World {
  buckets: Record<string, Set<string>>;
}

const collabRowId = (i: number) => `44444444-4444-4444-8888-${String(i + 1).padStart(12, '0')}`;

function router(
  opts: {
    storageFails?: boolean;
    photoTrips?: string[];
    collabTrips?: string[];
    failTable?: string;
    failCollabDelete?: boolean;
  } = {},
): { route: (c: Call) => Response; world: World } {
  const world: World = {
    buckets: {
      'trip-docs': new Set([`${TRIP_A}/1_a.pdf`, `${TRIP_A}/2_b.png`, `${TRIP_B}/keep.pdf`]),
      'trip-memories': new Set([
        // Owned trip A: the whole prefix goes (the trip and its rows are deleted).
        `${TRIP_A}/${USER_ID}/p1.jpg`,
        `${TRIP_A}/${USER_ID}/p1_t.jpg`,
        `${TRIP_A}/${OTHER_ID}/p2.jpg`,
        // Trip C (member): only USER's folder goes.
        `${TRIP_C}/${USER_ID}/p3.jpg`,
        `${TRIP_C}/${USER_ID}/p3_t.jpg`,
        `${TRIP_C}/${OTHER_ID}/p4.jpg`,
        // Trip R (revoked member): USER's orphan goes, the rest stays.
        `${TRIP_R}/${USER_ID}/old.jpg`,
        `${TRIP_R}/${OTHER_ID}/p5.jpg`,
        // Trip B (unrelated): untouched.
        `${TRIP_B}/${OTHER_ID}/p6.jpg`,
      ]),
    },
  };
  const tableRows: Record<string, unknown[]> = {
    trips: [{ id: TRIP_A }],
    trip_photos: (opts.photoTrips ?? [TRIP_A, TRIP_C, TRIP_C]).map((trip_id) => ({ trip_id })),
    trip_collaborators: (opts.collabTrips ?? [TRIP_C, TRIP_R]).map((trip_id, i) => ({ id: collabRowId(i), trip_id })),
  };
  const route = (c: Call): Response => {
    if (c.url.includes('/auth/v1/user')) return json({ id: USER_ID, email: 'u@test.local' });
    if (c.url.includes('/auth/v1/admin/users/') && c.method === 'DELETE') return json({});
    const rest = /\/rest\/v1\/([a-z_]+)/.exec(c.url);
    if (rest) {
      const table = rest[1]!;
      if (c.method === 'GET') {
        if (opts.failTable === table) return json({ message: 'db down' }, 500);
        return json(tableRows[table] ?? []);
      }
      if (table === 'trips' && c.method === 'DELETE') return new Response(null, { status: 204 });
      if (table === 'trip_collaborators' && c.method === 'DELETE') {
        if (opts.failCollabDelete) return json({ message: 'db down' }, 500);
        return new Response(null, { status: 204 });
      }
    }
    const list = /\/storage\/v1\/object\/list\/([a-z-]+)/.exec(c.url);
    if (list) {
      if (opts.storageFails) return json({ statusCode: '500', error: 'x', message: 'storage down' }, 500);
      const store = world.buckets[list[1]!] ?? new Set<string>();
      const { prefix, limit, offset } = JSON.parse(c.body ?? '{}') as { prefix: string; limit: number; offset: number };
      return json(listLevel(store, prefix, limit ?? 100, offset ?? 0));
    }
    const remove = /\/storage\/v1\/object\/([a-z-]+)$/.exec(c.url);
    if (remove && c.method === 'DELETE') {
      const store = world.buckets[remove[1]!] ?? new Set<string>();
      const { prefixes } = JSON.parse(c.body ?? '{}') as { prefixes: string[] };
      for (const p of prefixes) store.delete(p);
      return json(prefixes.map((name) => ({ name })));
    }
    return json({ message: `unrouted ${c.method} ${c.url}` }, 599);
  };
  return { route, world };
}

function postReq() {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { Authorization: 'Bearer user.jwt.sig', origin: 'http://localhost:8081' },
  });
}

D.test('handler: enumerates owned + memory trips before auth delete, removes trip-docs objects, returns ok', async () => {
  const { route, world } = router();
  const { calls, restore } = stubFetch(route);
  try {
    const res = await handler(postReq());
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true });

    const authDelIdx = calls.findIndex((c) => c.url.includes('/auth/v1/admin/users/'));
    for (const [table, filter] of [
      ['trips', `user_id=eq.${USER_ID}`],
      ['trip_photos', `author_id=eq.${USER_ID}`],
      ['trip_collaborators', `user_id=eq.${USER_ID}`],
    ]) {
      const idx = calls.findIndex((c) => c.url.includes(`/rest/v1/${table}`) && c.method === 'GET');
      assert(idx >= 0 && authDelIdx > idx, `${table} must be read before the auth delete`);
      assert(calls[idx]!.url.includes(filter!), `${table} read must be scoped by ${filter}`);
    }

    const removes = calls.filter((c) => c.url.endsWith('/storage/v1/object/trip-docs') && c.method === 'DELETE');
    assertEquals(removes.length, 1);
    const removed = (JSON.parse(removes[0]!.body ?? '{}') as { prefixes: string[] }).prefixes.sort();
    assertEquals(removed, [`${TRIP_A}/1_a.pdf`, `${TRIP_A}/2_b.png`]);
    assertEquals([...world.buckets['trip-docs']!], [`${TRIP_B}/keep.pdf`]);
    // Storage cleanup runs after the auth delete (never before it).
    for (const c of calls.filter((c) => c.url.includes('/storage/v1/'))) {
      assert(calls.indexOf(c) > authDelIdx, 'storage calls must follow the auth delete');
    }
  } finally {
    restore();
  }
});

D.test('handler: trip-memories — whole prefix of owned trips, only the user\'s folder elsewhere', async () => {
  const { route, world } = router();
  const { restore } = stubFetch(route);
  try {
    const res = await handler(postReq());
    assertEquals(res.status, 200);
    await res.body?.cancel();
    assertEquals(
      [...world.buckets['trip-memories']!].sort(),
      [
        `${TRIP_B}/${OTHER_ID}/p6.jpg`, // unrelated trip
        `${TRIP_C}/${OTHER_ID}/p4.jpg`, // another member's photo on a trip the user doesn't own
        `${TRIP_R}/${OTHER_ID}/p5.jpg`,
      ].sort(),
    );
  } finally {
    restore();
  }
});

D.test('handler: owned trips are never ALSO swept author-scoped (no duplicate work)', async () => {
  const { route } = router({ photoTrips: [TRIP_A], collabTrips: [] });
  const { calls, restore } = stubFetch(route);
  try {
    const res = await handler(postReq());
    assertEquals(res.status, 200);
    await res.body?.cancel();
    const memLists = calls
      .filter((c) => c.url.includes('/storage/v1/object/list/trip-memories'))
      .map((c) => (JSON.parse(c.body ?? '{}') as { prefix: string }).prefix);
    assert(memLists.includes(TRIP_A), 'owned trip A is cleaned via its whole prefix');
    // Listed once by the whole-prefix recursion; a separate author-scoped
    // pass over the same folder would list it a second time.
    assertEquals(memLists.filter((p) => p === `${TRIP_A}/${USER_ID}`).length, 1);
  } finally {
    restore();
  }
});

D.test('handler: Storage failure is best-effort — response stays { ok: true }', async () => {
  const { route } = router({ storageFails: true });
  const { restore } = stubFetch(route);
  try {
    const res = await handler(postReq());
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true });
  } finally {
    restore();
  }
});

D.test('handler: deletes the user\'s trip_collaborators rows (by id) AFTER the auth delete', async () => {
  const { route } = router();
  const { calls, restore } = stubFetch(route);
  try {
    const res = await handler(postReq());
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true });
    const read = calls.find((c) => c.url.includes('/rest/v1/trip_collaborators') && c.method === 'GET')!;
    assert(decodeURIComponent(read.url).includes('select=id,trip_id'), `ids must be read up front: ${read.url}`);
    const authDelIdx = calls.findIndex((c) => c.url.includes('/auth/v1/admin/users/'));
    const dels = calls.filter((c) => c.url.includes('/rest/v1/trip_collaborators') && c.method === 'DELETE');
    assertEquals(dels.length, 1);
    assert(calls.indexOf(dels[0]!) > authDelIdx, 'membership rows go after the auth delete (user keeps them if it fails)');
    const url = decodeURIComponent(dels[0]!.url);
    assert(url.includes(`id=in.(${collabRowId(0)},${collabRowId(1)})`), `delete must be scoped to the read ids: ${url}`);
    assert(!url.includes('user_id'), 'never a broad user_id filter (it may already be NULL)');
  } finally {
    restore();
  }
});

D.test('handler: no memberships -> no trip_collaborators delete; a failing delete stays best-effort', async () => {
  {
    const { route } = router({ collabTrips: [] });
    const { calls, restore } = stubFetch(route);
    try {
      const res = await handler(postReq());
      assertEquals(res.status, 200);
      await res.body?.cancel();
      assert(!calls.some((c) => c.url.includes('/rest/v1/trip_collaborators') && c.method === 'DELETE'));
    } finally {
      restore();
    }
  }
  {
    const { route } = router({ failCollabDelete: true });
    const { restore } = stubFetch(route);
    try {
      const res = await handler(postReq());
      assertEquals(res.status, 200);
      assertEquals(await res.json(), { ok: true });
    } finally {
      restore();
    }
  }
});

for (const table of ['trips', 'trip_photos', 'trip_collaborators']) {
  D.test(`handler: ${table} read failure aborts before any destructive call`, async () => {
    const { route } = router({ failTable: table });
    const { calls, restore } = stubFetch(route);
    try {
      const res = await handler(postReq());
      assertEquals(res.status, 500);
      assertEquals(((await res.json()) as { error: { code: string } }).error.code, 'db_error');
      assert(!calls.some((c) => c.method === 'DELETE'), 'no destructive call may run');
    } finally {
      restore();
    }
  });
}
