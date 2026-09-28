// delete-account — Deno tests.
//
// Run with:
//   deno test --allow-env --allow-net=127.0.0.1 supabase/functions/delete-account/index.test.ts
//
// Two layers:
//   1. `cleanupTripStorage` against an in-memory fake bucket (pagination,
//      nested folders, batching, failure reporting).
//   2. `handler` end-to-end with globalThis.fetch stubbed (pattern follows
//      supabase/functions/manage-collaborators/index.test.ts): verifies the
//      owned-trip enumeration happens BEFORE the auth delete, that trip-docs
//      objects are removed, and that a Storage failure keeps `{ ok: true }`.

// The repo-root `npx tsc` (Expo tsconfig) also type-checks this file but
// cannot resolve Deno URL / `.ts`-suffixed imports or the `Deno` global. The
// `@ts-ignore`s below silence exactly those lines for tsc; `deno test` still
// type-checks everything normally.
// @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { type BucketApi, cleanupTripStorage, LIST_PAGE_SIZE, REMOVE_BATCH_SIZE } from './storage-cleanup.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { handler } from './index.ts';

// @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
const D = Deno;

D.env.set('SUPABASE_URL', 'http://127.0.0.1:54321');
D.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
D.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
D.env.set('ALLOWED_ORIGINS', 'http://localhost:8081');

const USER_ID = '11111111-1111-1111-1111-000000000001';
const TRIP_A = '33333333-3333-4444-8888-00000000000a';
const TRIP_B = '33333333-3333-4444-8888-00000000000b';

// ---- Fake bucket -------------------------------------------------------------

/** In-memory bucket over a flat key set; `list` mimics Storage one-level listing. */
function fakeBucket(keys: string[], opts: { failRemove?: boolean; failListFor?: string } = {}) {
  const store = new Set(keys);
  const removeCalls: string[][] = [];
  const api: BucketApi = {
    list(path, { limit, offset }) {
      if (opts.failListFor && path === opts.failListFor) {
        return Promise.resolve({ data: null, error: { message: 'boom' } });
      }
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
    remove(paths) {
      removeCalls.push(paths);
      if (opts.failRemove) return Promise.resolve({ data: null, error: { message: 'denied' } });
      for (const p of paths) store.delete(p);
      return Promise.resolve({ data: [], error: null });
    },
  };
  return { api, store, removeCalls };
}

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

function happyRouter(opts: { storageFails?: boolean } = {}) {
  const objects = new Set([`${TRIP_A}/1_a.pdf`, `${TRIP_A}/2_b.png`]);
  return (c: Call): Response => {
    if (c.url.includes('/auth/v1/user')) return json({ id: USER_ID, email: 'u@test.local' });
    if (c.url.includes('/rest/v1/trips') && c.method === 'GET') return json([{ id: TRIP_A }]);
    if (c.url.includes('/auth/v1/admin/users/') && c.method === 'DELETE') return json({});
    if (c.url.includes('/rest/v1/trips') && c.method === 'DELETE') return new Response(null, { status: 204 });
    if (c.url.includes('/storage/v1/object/list/trip-docs')) {
      if (opts.storageFails) return json({ statusCode: '500', error: 'x', message: 'storage down' }, 500);
      const { prefix } = JSON.parse(c.body ?? '{}') as { prefix: string };
      const names = [...objects].filter((k) => k.startsWith(`${prefix}/`)).map((k) => k.slice(prefix.length + 1));
      return json(names.map((name) => ({ name, id: `id-${name}` })));
    }
    if (c.url.includes('/storage/v1/object/trip-docs') && c.method === 'DELETE') {
      const { prefixes } = JSON.parse(c.body ?? '{}') as { prefixes: string[] };
      for (const p of prefixes) objects.delete(p);
      return json(prefixes.map((name) => ({ name })));
    }
    return json({ message: `unrouted ${c.method} ${c.url}` }, 599);
  };
}

function postReq() {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { Authorization: 'Bearer user.jwt.sig', origin: 'http://localhost:8081' },
  });
}

D.test('handler: lists owned trips before auth delete, removes trip-docs objects, returns ok', async () => {
  const { calls, restore } = stubFetch(happyRouter());
  try {
    const res = await handler(postReq());
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true });

    const listIdx = calls.findIndex((c) => c.url.includes('/rest/v1/trips') && c.method === 'GET');
    const authDelIdx = calls.findIndex((c) => c.url.includes('/auth/v1/admin/users/'));
    assert(listIdx >= 0 && authDelIdx > listIdx, 'owned trips must be read before auth delete');
    assert(calls[listIdx]!.url.includes(`user_id=eq.${USER_ID}`), 'must scope to owner user_id');

    const removes = calls.filter((c) => c.url.includes('/storage/v1/object/trip-docs') && c.method === 'DELETE');
    assertEquals(removes.length, 1);
    const removed = (JSON.parse(removes[0]!.body ?? '{}') as { prefixes: string[] }).prefixes.sort();
    assertEquals(removed, [`${TRIP_A}/1_a.pdf`, `${TRIP_A}/2_b.png`]);
    // Storage cleanup runs after the auth delete (never before it).
    assert(calls.indexOf(removes[0]!) > authDelIdx);
  } finally {
    restore();
  }
});

D.test('handler: Storage failure is best-effort — response stays { ok: true }', async () => {
  const { restore } = stubFetch(happyRouter({ storageFails: true }));
  try {
    const res = await handler(postReq());
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true });
  } finally {
    restore();
  }
});

D.test('handler: owned-trip read failure aborts before any destructive call', async () => {
  const base = happyRouter();
  const { calls, restore } = stubFetch((c) =>
    c.url.includes('/rest/v1/trips') && c.method === 'GET' ? json({ message: 'db down' }, 500) : base(c)
  );
  try {
    const res = await handler(postReq());
    assertEquals(res.status, 500);
    await res.body?.cancel();
    assert(!calls.some((c) => c.method === 'DELETE'), 'no destructive call may run');
  } finally {
    restore();
  }
});
