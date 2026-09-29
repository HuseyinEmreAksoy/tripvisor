// delete-trip — Deno tests.
//
// Run with:
//   deno test --allow-env --allow-net=127.0.0.1 supabase/functions/delete-trip/index.test.ts
//
// Two layers:
//   1. `createHandler` driven by in-memory fake deps (no network): auth,
//      owner gate, storage-before-delete ordering, abort-on-storage-failure,
//      post-delete sweep, idempotent/refused deletes.
//   2. `createHandler(supabaseDeps())` with globalThis.fetch stubbed: pins the
//      supabase-js wiring (user JWT for the trip read/delete, service role
//      only for Storage, `<tripId>/` prefix only).
//
// The repo-root `npx tsc` (Expo tsconfig) also type-checks this file but
// cannot resolve Deno URL / `.ts`-suffixed imports or the `Deno` global. The
// `@ts-ignore`s below silence exactly those lines for tsc; `deno test` still
// type-checks everything normally (same pattern as delete-account/index.test.ts).

// @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { createHandler, type DeleteTripDeps, type TripOwnerRow } from './handler.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { supabaseDeps } from './deps.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import type { BucketApi } from '../delete-account/storage-cleanup.ts';

// @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
const D = Deno;

D.env.set('SUPABASE_URL', 'http://127.0.0.1:54321');
D.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
D.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
D.env.set('ALLOWED_ORIGINS', 'http://localhost:8081');

const OWNER_ID = '11111111-1111-4111-8111-000000000001';
const VIEWER_ID = '22222222-2222-4222-8222-000000000002';
const TRIP_ID = '33333333-3333-4333-8333-00000000000a';
const OTHER_TRIP = '33333333-3333-4333-8333-00000000000b';

// ---- Fakes -------------------------------------------------------------------

/** In-memory bucket over a flat key set; `list` mimics Storage one-level listing. */
function fakeBucket(keys: string[], opts: { failRemove?: boolean } = {}) {
  const store = new Set(keys);
  const api: BucketApi = {
    list(path: string, { limit, offset }: { limit: number; offset: number }) {
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
      const page = sorted.slice(offset, offset + limit).map(([name, isFolder]) => ({
        name,
        id: isFolder ? null : `id-${name}`,
      }));
      return Promise.resolve({ data: page, error: null });
    },
    remove(paths: string[]) {
      if (opts.failRemove) return Promise.resolve({ data: null, error: { message: 'storage down' } });
      for (const p of paths) store.delete(p);
      return Promise.resolve({ data: paths, error: null });
    },
  };
  return { api, store };
}

interface FakeWorld {
  deps: DeleteTripDeps;
  events: string[];
  trips: Map<string, TripOwnerRow>;
  /** `trip-docs` */
  bucket: ReturnType<typeof fakeBucket>;
  /** `trip-memories` (0036) */
  memories: ReturnType<typeof fakeBucket>;
}

function world(opts: {
  caller: string | null;
  trips?: TripOwnerRow[];
  /** trip-docs keys */
  keys?: string[];
  /** trip-memories keys (`<trip>/<author>/<photo>.jpg`) */
  memoryKeys?: string[];
  failRemove?: boolean;
  failMemoriesRemove?: boolean;
  refuseDelete?: boolean;
  /** Keys that "land" (a racing collaborator upload) between pass 1 and the row delete. */
  raceUploadKeys?: string[];
  raceMemoryKeys?: string[];
}): FakeWorld {
  const events: string[] = [];
  const trips = new Map((opts.trips ?? []).map((t) => [t.id, t]));
  const bucket = fakeBucket(opts.keys ?? [], { failRemove: opts.failRemove });
  const memories = fakeBucket(opts.memoryKeys ?? [], { failRemove: opts.failMemoriesRemove });
  const deps: DeleteTripDeps = {
    authenticate: () => {
      events.push('auth');
      return Promise.resolve(opts.caller);
    },
    loadTrip: (_req: Request, id: string) => {
      events.push('load');
      return Promise.resolve({ row: trips.get(id) ?? null, error: null });
    },
    deleteTrip: (_req: Request, id: string) => {
      events.push('delete');
      for (const k of opts.raceUploadKeys ?? []) bucket.store.add(k);
      for (const k of opts.raceMemoryKeys ?? []) memories.store.add(k);
      if (opts.refuseDelete) return Promise.resolve({ deleted: 0, error: null });
      const had = trips.delete(id);
      return Promise.resolve({ deleted: had ? 1 : 0, error: null });
    },
    bucket: (name: string) => {
      events.push(`storage:${name}`);
      if (name === 'trip-docs') return bucket.api;
      if (name === 'trip-memories') return memories.api;
      throw new Error(`unexpected bucket ${name}`);
    },
  };
  return { deps, events, trips, bucket, memories };
}

function post(body: unknown, auth = 'Bearer eyJ.OWNER.sig'): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: auth, origin: 'http://localhost:8081' },
    body: JSON.stringify(body),
  });
}

const ownedTrip: TripOwnerRow = { id: TRIP_ID, user_id: OWNER_ID };

// ---- Routing / validation ------------------------------------------------------

D.test('?ping → { ok, fn: "delete-trip" }; GET → 405; bad body → 400', async () => {
  const w = world({ caller: OWNER_ID });
  const h = createHandler(w.deps);
  const ping = await h(new Request('http://localhost/?ping'));
  assertEquals(await ping.json(), { ok: true, fn: 'delete-trip' });
  assertEquals((await h(new Request('http://localhost/', { method: 'GET' }))).status, 405);
  assertEquals((await h(post({ tripId: 'not-a-uuid' }))).status, 400);
  const badJson = await h(new Request('http://localhost/', { method: 'POST', body: '{', headers: { Authorization: 'Bearer x' } }));
  assertEquals(badJson.status, 400);
  assertEquals(w.events, [], 'no side effect for ping / invalid requests');
});

// ---- Auth + owner gate ------------------------------------------------------------

D.test('no / invalid session → 401 not_authenticated, nothing touched', async () => {
  const w = world({ caller: null, trips: [ownedTrip], keys: [`${TRIP_ID}/a.pdf`] });
  const res = await createHandler(w.deps)(post({ tripId: TRIP_ID }));
  assertEquals(res.status, 401);
  assertEquals(((await res.json()) as { error: { code: string } }).error.code, 'not_authenticated');
  assertEquals(w.events, ['auth']);
  assertEquals(w.bucket.store.size, 1);
});

D.test('trip not visible to the caller → 404 not_found, nothing touched', async () => {
  const w = world({ caller: OWNER_ID, trips: [], keys: [`${TRIP_ID}/a.pdf`] });
  const res = await createHandler(w.deps)(post({ tripId: TRIP_ID }));
  assertEquals(res.status, 404);
  assertEquals(w.events, ['auth', 'load']);
  assertEquals(w.bucket.store.size, 1);
});

D.test('collaborator (viewer/editor) → 403 not_owner: no Storage call, no delete', async () => {
  const w = world({ caller: VIEWER_ID, trips: [ownedTrip], keys: [`${TRIP_ID}/a.pdf`] });
  const res = await createHandler(w.deps)(post({ tripId: TRIP_ID }, 'Bearer eyJ.VIEWER.sig'));
  assertEquals(res.status, 403);
  assertEquals(((await res.json()) as { error: { code: string } }).error.code, 'not_owner');
  assertEquals(w.events, ['auth', 'load'], 'refused before any destructive step');
  assert(w.trips.has(TRIP_ID));
  assertEquals(w.bucket.store.size, 1);
});

// ---- Owner happy path -----------------------------------------------------------

D.test('owner: Storage cleaned BEFORE the row delete, then swept; only this trip prefix', async () => {
  const w = world({
    caller: OWNER_ID,
    trips: [ownedTrip, { id: OTHER_TRIP, user_id: OWNER_ID }],
    keys: [
      `${TRIP_ID}/1_ticket.pdf`,
      `${TRIP_ID}/2_hotel.pdf`,
      `${TRIP_ID}/nested/3_deep.pdf`,
      `${OTHER_TRIP}/keep.pdf`,
    ],
  });
  const res = await createHandler(w.deps)(post({ tripId: TRIP_ID }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    ok: true,
    tripId: TRIP_ID,
    deleted: true,
    storage: { objectsRemoved: 3 },
    meta: { contractVersion: 1 },
  });
  assertEquals(w.events, [
    'auth',
    'load',
    'storage:trip-docs',
    'storage:trip-memories',
    'delete',
    'storage:trip-docs',
    'storage:trip-memories',
  ]);
  assertEquals([...w.bucket.store], [`${OTHER_TRIP}/keep.pdf`], 'other trips untouched');
  assert(!w.trips.has(TRIP_ID));
  assert(w.trips.has(OTHER_TRIP));
});

D.test('owner: every member\'s memory photos of the trip go too (trip-memories, 0036)', async () => {
  const w = world({
    caller: OWNER_ID,
    trips: [ownedTrip, { id: OTHER_TRIP, user_id: OWNER_ID }],
    keys: [`${TRIP_ID}/1_ticket.pdf`],
    memoryKeys: [
      `${TRIP_ID}/${OWNER_ID}/p1.jpg`,
      `${TRIP_ID}/${OWNER_ID}/p1_t.jpg`,
      `${TRIP_ID}/${VIEWER_ID}/p2.jpg`, // a collaborator's photo: its row cascades with the trip
      `${OTHER_TRIP}/${OWNER_ID}/keep.jpg`,
    ],
  });
  const res = await createHandler(w.deps)(post({ tripId: TRIP_ID }));
  assertEquals(res.status, 200);
  assertEquals(((await res.json()) as { storage: { objectsRemoved: number } }).storage.objectsRemoved, 4);
  assertEquals([...w.memories.store], [`${OTHER_TRIP}/${OWNER_ID}/keep.jpg`], 'other trips untouched');
  assertEquals(w.bucket.store.size, 0);
});

D.test('owner, trip with no documents → 200, objectsRemoved 0', async () => {
  const w = world({ caller: OWNER_ID, trips: [ownedTrip] });
  const res = await createHandler(w.deps)(post({ tripId: TRIP_ID }));
  assertEquals(res.status, 200);
  const body = (await res.json()) as { deleted: boolean; storage: { objectsRemoved: number } };
  assertEquals(body.deleted, true);
  assertEquals(body.storage.objectsRemoved, 0);
});

D.test('post-delete sweep removes an upload that raced the row delete', async () => {
  const w = world({
    caller: OWNER_ID,
    trips: [ownedTrip],
    keys: [`${TRIP_ID}/a.pdf`],
    raceUploadKeys: [`${TRIP_ID}/late_upload.pdf`],
    raceMemoryKeys: [`${TRIP_ID}/${VIEWER_ID}/late_photo.jpg`],
  });
  const res = await createHandler(w.deps)(post({ tripId: TRIP_ID }));
  assertEquals(res.status, 200);
  assertEquals(((await res.json()) as { storage: { objectsRemoved: number } }).storage.objectsRemoved, 3);
  assertEquals(w.bucket.store.size, 0, 'no orphan document left behind');
  assertEquals(w.memories.store.size, 0, 'no orphan photo left behind');
});

// ---- Failure modes ------------------------------------------------------------------

D.test('Storage failure → 500 storage_cleanup_failed and the trip is NOT deleted (retryable)', async () => {
  const w = world({ caller: OWNER_ID, trips: [ownedTrip], keys: [`${TRIP_ID}/a.pdf`], failRemove: true });
  const res = await createHandler(w.deps)(post({ tripId: TRIP_ID }));
  assertEquals(res.status, 500);
  assertEquals(((await res.json()) as { error: { code: string } }).error.code, 'storage_cleanup_failed');
  assert(!w.events.includes('delete'), 'row delete must not run after a Storage failure');
  assert(w.trips.has(TRIP_ID), 'trip still exists → the user can retry');
});

D.test('trip-memories failure alone also aborts: 500 storage_cleanup_failed, trip kept', async () => {
  const w = world({
    caller: OWNER_ID,
    trips: [ownedTrip],
    memoryKeys: [`${TRIP_ID}/${OWNER_ID}/p.jpg`],
    failMemoriesRemove: true,
  });
  const res = await createHandler(w.deps)(post({ tripId: TRIP_ID }));
  assertEquals(res.status, 500);
  assertEquals(((await res.json()) as { error: { code: string } }).error.code, 'storage_cleanup_failed');
  assert(!w.events.includes('delete'));
  assert(w.trips.has(TRIP_ID));
});

D.test('row vanished between read and delete (other device) → 200, deleted:false', async () => {
  const w = world({ caller: OWNER_ID, trips: [ownedTrip] });
  const inner = w.deps.deleteTrip;
  w.deps.deleteTrip = async (req: Request, id: string) => {
    w.trips.delete(id); // someone else got there first
    const r = await inner(req, id);
    return r;
  };
  const res = await createHandler(w.deps)(post({ tripId: TRIP_ID }));
  assertEquals(res.status, 200);
  assertEquals(((await res.json()) as { deleted: boolean }).deleted, false);
});

D.test('delete silently refused (0 rows, row still there) → 500 db_error, never a false success', async () => {
  const w = world({ caller: OWNER_ID, trips: [ownedTrip], refuseDelete: true });
  const res = await createHandler(w.deps)(post({ tripId: TRIP_ID }));
  assertEquals(res.status, 500);
  assertEquals(((await res.json()) as { error: { code: string } }).error.code, 'db_error');
});

D.test('a throwing dependency → 500 internal_error', async () => {
  const w = world({ caller: OWNER_ID, trips: [ownedTrip] });
  w.deps.loadTrip = () => Promise.reject(new Error('socket hang up'));
  const res = await createHandler(w.deps)(post({ tripId: TRIP_ID }));
  assertEquals(res.status, 500);
  assertEquals(((await res.json()) as { error: { code: string } }).error.code, 'internal_error');
});

// ---- supabase-js wiring (deps.ts) -----------------------------------------------------

interface Call {
  url: string;
  method: string;
  auth: string;
  body: string | null;
}

D.test('supabaseDeps: user JWT for trip read + delete, service role only for trip-prefixed Storage', async () => {
  const USER_JWT = 'eyJhbGciOiJIUzI1NiJ9.OWNER.sig';
  const calls: Call[] = [];
  let deleted = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const auth = new Headers(init?.headers as HeadersInit).get('authorization') ?? '';
    const body = typeof init?.body === 'string' ? init.body : null;
    calls.push({ url, method, auth, body });
    const j = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes('/auth/v1/user')) return j({ id: OWNER_ID, aud: 'authenticated' });
    if (url.includes('/rest/v1/trips') && method === 'GET') return j(deleted ? [] : [{ id: TRIP_ID, user_id: OWNER_ID }]);
    if (url.includes('/rest/v1/trips') && method === 'DELETE') {
      deleted = true;
      return j([{ id: TRIP_ID }]);
    }
    if (url.includes('/storage/v1/object/list/trip-docs')) {
      const prefix = JSON.parse(body ?? '{}').prefix;
      return j(prefix === TRIP_ID && !deleted ? [{ name: 'a.pdf', id: 'obj-1' }] : []);
    }
    if (url.includes('/storage/v1/object/list/trip-memories')) {
      // One level at a time, like the real API: <trip>/ → author folder → files.
      const prefix = JSON.parse(body ?? '{}').prefix;
      if (deleted) return j([]);
      if (prefix === TRIP_ID) return j([{ name: OWNER_ID, id: null }]);
      if (prefix === `${TRIP_ID}/${OWNER_ID}`) return j([{ name: 'p.jpg', id: 'obj-2' }, { name: 'p_t.jpg', id: 'obj-3' }]);
      return j([]);
    }
    if (url.includes('/storage/v1/object/trip-docs') && method === 'DELETE') return j([{ name: `${TRIP_ID}/a.pdf` }]);
    if (url.includes('/storage/v1/object/trip-memories') && method === 'DELETE') return j(JSON.parse(body ?? '{}').prefixes);
    return j({ error: `unexpected ${method} ${url}` }, 500);
  }) as typeof fetch;
  try {
    const res = await createHandler(supabaseDeps())(post({ tripId: TRIP_ID }, `Bearer ${USER_JWT}`));
    assertEquals(res.status, 200);
    const body = (await res.json()) as { deleted: boolean; storage: { objectsRemoved: number } };
    assertEquals(body.deleted, true);
    assertEquals(body.storage.objectsRemoved, 3);

    const rest = calls.filter((c) => c.url.includes('/rest/v1/'));
    assert(rest.length >= 2);
    for (const c of rest) {
      assertEquals(c.auth, `Bearer ${USER_JWT}`, `PostgREST must run under the caller JWT: ${c.method} ${c.url}`);
    }
    const del = rest.find((c) => c.method === 'DELETE')!;
    assert(del.url.includes(`id=eq.${TRIP_ID}`), `delete must target the trip id: ${del.url}`);

    const storage = calls.filter((c) => c.url.includes('/storage/v1/'));
    assert(storage.length >= 2, 'list + remove');
    for (const c of storage) {
      assertEquals(c.auth, 'Bearer test-service-role-key', 'Storage runs with the service role');
    }
    const removed = storage.find((c) => c.method === 'DELETE' && c.url.endsWith('/trip-docs'))!;
    assertEquals(JSON.parse(removed.body ?? '{}').prefixes, [`${TRIP_ID}/a.pdf`]);
    const removedPhotos = storage.find((c) => c.method === 'DELETE' && c.url.endsWith('/trip-memories'))!;
    assertEquals(JSON.parse(removedPhotos.body ?? '{}').prefixes, [
      `${TRIP_ID}/${OWNER_ID}/p.jpg`,
      `${TRIP_ID}/${OWNER_ID}/p_t.jpg`,
    ]);
    for (const c of storage.filter((c) => c.url.includes('/object/list/'))) {
      const prefix = JSON.parse(c.body ?? '{}').prefix as string;
      assert(prefix === TRIP_ID || prefix.startsWith(`${TRIP_ID}/`), `listing must stay inside the trip prefix: ${prefix}`);
    }
  } finally {
    globalThis.fetch = original;
  }
});
