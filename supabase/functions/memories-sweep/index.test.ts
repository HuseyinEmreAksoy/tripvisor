// memories-sweep — Deno tests (M5 Y2.1).
//
// Run with:
//   deno test --allow-env --allow-net=127.0.0.1 supabase/functions/memories-sweep/index.test.ts
//
// No network: the sweep loop runs against an in-memory fake of the 0038
// candidates RPC + the Storage bucket, and the handler gets the same fakes
// through _setSweepDepsForTests. Covers: batching (<= 1000 per remove), the
// age floor, dry runs, error / no-progress stops, and the explicit caller
// check (cron secret or service-role key; anon / user JWTs refused).

// The repo-root `npx tsc` (Expo tsconfig) also type-checks this file but
// cannot resolve Deno URL / `.ts`-suffixed imports or the `Deno` global.
// @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  _setSweepDepsForTests,
  authorizeCaller,
  handler,
  MIN_SECRET_LENGTH,
  safeEqual,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from './handler.ts';
import {
  clampOptions,
  MAX_BATCH,
  runSweep,
  type SweepCandidate,
  type SweepDeps,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from './sweep.ts';

// @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
const D = Deno;

const SERVICE_KEY = 'service-role-key-for-tests-0123456789abcdef';
const SWEEP_SECRET = 'sweep-secret-for-tests-0123456789abcdef-XYZ';
D.env.set('SUPABASE_URL', 'http://127.0.0.1:54321');
D.env.set('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY);
D.env.set('MEMORIES_SWEEP_SECRET', SWEEP_SECRET);
D.env.set('ALLOWED_ORIGINS', 'http://localhost:8081');

// ---- fake bucket + RPC -------------------------------------------------------

interface FakeStore {
  objects: Map<string, { bytes: number; ageMin: number }>;
  rows: Set<string>; // object names that still have a trip_photos row
  removeCalls: string[][];
  rpcCalls: Array<{ minAge: string; limit: number }>;
  failCandidates?: string;
  failRemove?: string;
  removeIsNoop?: boolean;
}

function makeStore(orphans: number, opts: { withRows?: number; young?: number } = {}): FakeStore {
  const s: FakeStore = { objects: new Map(), rows: new Set(), removeCalls: [], rpcCalls: [] };
  for (let i = 0; i < orphans; i++) s.objects.set(`t/a/${String(i).padStart(5, '0')}.jpg`, { bytes: 1000, ageMin: 120 });
  for (let i = 0; i < (opts.withRows ?? 0); i++) {
    const n = `t/a/row-${i}.jpg`;
    s.objects.set(n, { bytes: 5, ageMin: 500 });
    s.rows.add(n);
  }
  for (let i = 0; i < (opts.young ?? 0); i++) s.objects.set(`t/a/young-${i}.jpg`, { bytes: 7, ageMin: 10 });
  return s;
}

function fakeDeps(s: FakeStore): SweepDeps {
  return {
    async candidates(minAge: string, limit: number) {
      s.rpcCalls.push({ minAge, limit });
      if (s.failCandidates) return { data: null, error: s.failCandidates };
      const floor = Number(minAge.split(' ')[0]);
      const out: SweepCandidate[] = [];
      for (const [name, o] of s.objects) {
        if (s.rows.has(name) || o.ageMin < floor) continue;
        out.push({ name, bytes: o.bytes, created_at: '2026-09-29T00:00:00Z' });
        if (out.length >= Math.min(limit, 1000)) break;
      }
      return { data: out, error: null };
    },
    async remove(names: string[]) {
      s.removeCalls.push(names);
      if (s.failRemove) return { removed: [], error: s.failRemove };
      if (s.removeIsNoop) return { removed: [], error: null };
      const removed = names.filter((n) => s.objects.delete(n));
      return { removed, error: null };
    },
  };
}

// ---- sweep loop ------------------------------------------------------------------

D.test('sweep: removes every orphan in batches of <= 1000, never objects with a row or younger than the floor', async () => {
  const s = makeStore(2500, { withRows: 3, young: 4 });
  const report = await runSweep(fakeDeps(s), clampOptions({}));
  assertEquals(report.removed, 2500);
  assertEquals(report.bytes, 2500 * 1000);
  assertEquals(report.batches, 3);
  assertEquals(report.errors, []);
  assertEquals(report.more, false);
  assert(s.removeCalls.every((c) => c.length <= MAX_BATCH));
  assertEquals(s.removeCalls.map((c) => c.length), [1000, 1000, 500]);
  // objects with a trip_photos row and young objects survive
  assertEquals(s.objects.size, 3 + 4);
  assertEquals(s.rpcCalls[0], { minAge: '60 minutes', limit: 1000 });
});

D.test('sweep: the age floor cannot be lowered below 60 minutes; sizes are clamped', () => {
  assertEquals(clampOptions({ minAgeMinutes: 1 }).minAgeMinutes, 60);
  assertEquals(clampOptions({ batchSize: 50_000 }).batchSize, 1000);
  assertEquals(clampOptions({ batchSize: 0 }).batchSize, 1);
  assertEquals(clampOptions({ maxBatches: 999 }).maxBatches, 20);
  assertEquals(clampOptions({}).dryRun, false);
});

D.test('sweep: maxBatches stops the loop and reports more=true', async () => {
  const s = makeStore(2500);
  const report = await runSweep(fakeDeps(s), clampOptions({ maxBatches: 2 }));
  assertEquals(report.removed, 2000);
  assertEquals(report.more, true);
  assertEquals(s.objects.size, 500);
});

D.test('sweep: dry run lists one batch and removes nothing', async () => {
  const s = makeStore(1500);
  const report = await runSweep(fakeDeps(s), clampOptions({ dryRun: true }));
  assertEquals(report.removed, 0);
  assertEquals(report.candidates, 1000);
  assertEquals(report.more, true);
  assertEquals(s.removeCalls.length, 0);
});

D.test('sweep: candidates / remove errors stop the loop; a no-op remove never spins', async () => {
  const a = makeStore(10);
  a.failCandidates = 'permission denied for function trip_memories_sweep_candidates';
  const ra = await runSweep(fakeDeps(a), clampOptions({}));
  assertEquals(ra.batches, 0);
  assert(ra.errors[0]!.startsWith('candidates:'));

  const b = makeStore(10);
  b.failRemove = 'storage down';
  const rb = await runSweep(fakeDeps(b), clampOptions({}));
  assertEquals(rb.removed, 0);
  assert(rb.errors[0]!.startsWith('remove:'));

  const c = makeStore(3000);
  c.removeIsNoop = true;
  const rc = await runSweep(fakeDeps(c), clampOptions({ maxBatches: 20 }));
  assertEquals(c.removeCalls.length, 1);
  assert(rc.errors[0]!.startsWith('no_progress'));
});

D.test('sweep: nothing to do → one empty batch, no remove call', async () => {
  const s = makeStore(0, { withRows: 5 });
  const r = await runSweep(fakeDeps(s), clampOptions({}));
  assertEquals(r, { batches: 1, candidates: 0, removed: 0, bytes: 0, more: false, errors: [] });
  assertEquals(s.removeCalls.length, 0);
});

// ---- caller check ------------------------------------------------------------------

function req(headers: Record<string, string>, body?: unknown, method = 'POST', path = '/memories-sweep'): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
  });
}

D.test('auth: constant-time compare', () => {
  assert(safeEqual('abc', 'abc'));
  assert(!safeEqual('abc', 'abd'));
  assert(!safeEqual('abc', 'abcd'));
  assert(!safeEqual('', 'a'));
});

D.test('auth: cron secret header or the service-role key; nothing else', () => {
  const cfg = { serviceKey: SERVICE_KEY, sweepSecret: SWEEP_SECRET };
  assertEquals(authorizeCaller(req({ 'x-sweep-secret': SWEEP_SECRET, Authorization: 'Bearer anon.jwt.x' }), cfg), 'cron_secret');
  assertEquals(authorizeCaller(req({ Authorization: `Bearer ${SERVICE_KEY}` }), cfg), 'service_role');
  assertEquals(authorizeCaller(req({ Authorization: 'Bearer some.user.jwt' }), cfg), null);
  assertEquals(authorizeCaller(req({ 'x-sweep-secret': 'wrong', Authorization: 'Bearer anon' }), cfg), null);
  assertEquals(authorizeCaller(req({}), cfg), null);
  // A short / missing configured secret disables the header path entirely.
  const short = 'x'.repeat(MIN_SECRET_LENGTH - 1);
  assertEquals(authorizeCaller(req({ 'x-sweep-secret': short }), { serviceKey: SERVICE_KEY, sweepSecret: short }), null);
  assertEquals(authorizeCaller(req({ 'x-sweep-secret': '' }), { serviceKey: SERVICE_KEY, sweepSecret: undefined }), null);
});

// ---- handler -------------------------------------------------------------------------

D.test('handler: ?ping is public; GET otherwise 405', async () => {
  const ping = await handler(req({}, undefined, 'GET', '/memories-sweep?ping'));
  assertEquals(ping.status, 200);
  assertEquals(await ping.json(), { ok: true, fn: 'memories-sweep' });
  const get = await handler(req({}, undefined, 'GET'));
  assertEquals(get.status, 405);
  await get.body?.cancel();
});

D.test('handler: 401 for a user / anon JWT, never touches Storage', async () => {
  const s = makeStore(5);
  _setSweepDepsForTests(fakeDeps(s));
  try {
    const res = await handler(req({ Authorization: 'Bearer eyJ.user.jwt' }, {}));
    assertEquals(res.status, 401);
    assertEquals((await res.json()).error.code, 'not_authorized');
    assertEquals(s.rpcCalls.length, 0);
    assertEquals(s.objects.size, 5);
  } finally {
    _setSweepDepsForTests(null);
  }
});

D.test('handler: cron secret → sweeps and reports; contractVersion 1', async () => {
  const s = makeStore(1200);
  _setSweepDepsForTests(fakeDeps(s));
  try {
    const res = await handler(req({ 'x-sweep-secret': SWEEP_SECRET, Authorization: 'Bearer anon.jwt' }, {}));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.removed, 1200);
    assertEquals(body.batches, 2);
    assertEquals(body.meta.contractVersion, 1);
    assertEquals(s.objects.size, 0);
  } finally {
    _setSweepDepsForTests(null);
  }
});

D.test('handler: service-role bearer + dry run', async () => {
  const s = makeStore(3);
  _setSweepDepsForTests(fakeDeps(s));
  try {
    const res = await handler(req({ Authorization: `Bearer ${SERVICE_KEY}` }, { dryRun: true }));
    const body = await res.json();
    assertEquals(res.status, 200);
    assertEquals(body.dryRun, true);
    assertEquals(body.candidates, 3);
    assertEquals(s.objects.size, 3);
  } finally {
    _setSweepDepsForTests(null);
  }
});

D.test('handler: Zod rejects bad input (400)', async () => {
  _setSweepDepsForTests(fakeDeps(makeStore(1)));
  try {
    for (const bad of [{ batchSize: 5000 }, { minAgeMinutes: 5 }, { tripId: 'x' }, { dryRun: 'yes' }]) {
      const res = await handler(req({ 'x-sweep-secret': SWEEP_SECRET }, bad));
      assertEquals(res.status, 400);
      assertEquals((await res.json()).error.code, 'invalid_input');
    }
    const junk = await handler(
      new Request('http://127.0.0.1/memories-sweep', { method: 'POST', headers: { 'x-sweep-secret': SWEEP_SECRET }, body: '{nope' }),
    );
    assertEquals(junk.status, 400);
    await junk.body?.cancel();
  } finally {
    _setSweepDepsForTests(null);
  }
});

D.test('handler: a failing candidates RPC → 502 sweep_failed', async () => {
  const s = makeStore(2);
  s.failCandidates = 'timeout';
  _setSweepDepsForTests(fakeDeps(s));
  try {
    const res = await handler(req({ 'x-sweep-secret': SWEEP_SECRET }, {}));
    assertEquals(res.status, 502);
    assertEquals((await res.json()).error.code, 'sweep_failed');
  } finally {
    _setSweepDepsForTests(null);
  }
});
