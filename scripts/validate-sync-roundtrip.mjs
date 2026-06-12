/**
 * validate-sync-roundtrip.mjs — S2 Wave 2 R6 ABORT-GATE validation.
 *
 * Proves (or disproves) that the @legendapp/state 3.0.0-beta.47 syncedSupabase
 * WRITE path works end-to-end against the REAL local Supabase stack, through
 * the REAL src/sync modules (hydrate.ts, allowlist.ts, store.ts — not a
 * re-implementation). Run: `npm run sync:validate` (local stack must be up).
 *
 * What it asserts (PASS/FAIL per item, exit 1 on any FAIL):
 *   a. engine boots in node (persistence degrades to in-memory — expected)
 *   b. CREATE trip through the store → row in Postgres, server-stamped times
 *   c. UPDATE trip title → server updated; forged client updated_at ignored
 *   d. CREATE trip_place with manual_rank → persisted; day_index/order_in_day NULL (C1)
 *   e. dirty write (day_index + rating) → server shows NEITHER (C1 + C3 strip)
 *   f. tombstone (deleted=true) → fresh store instance excludes the row
 *   g. LWW: later server-side edit wins after resync
 *
 * If a FAILURE traces to the beta plugin's write path itself, the verdict is
 * "ABORT GATE TRIPPED" (R6): stop, fall back to the named hand-rolled
 * expo-sqlite sync plan. Sanitize bugs (our code) are NOT abort verdicts.
 *
 * HOW the TS modules load in node: a require('.ts') hook transpiles with
 * @babel/preset-typescript + commonjs transform (both already in
 * node_modules via babel-preset-expo). Two RN-only modules are stubbed at
 * their resolved paths BEFORE anything imports them:
 *   - src/api/supabase.ts  → a node @supabase/supabase-js client signed in
 *     as the local smoke user (password grant — same user/flow as
 *     e2e/web/setup/auth.setup.ts)
 *   - src/lib/sentry.ts    → inert breadcrumb sink
 * Everything else (the sync engine, the plugin, the firewall) is the real
 * production code path.
 *
 * SAFETY: refuses to run unless the Supabase URL from `npx supabase status`
 * is local. Creates only rows titled "SYNC-VALIDATE …" for the smoke user
 * and hard-deletes them (service role) at the end.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ──────────────────────────────────────────────────────────────────────────
// 0. Result plumbing
// ──────────────────────────────────────────────────────────────────────────

const results = [];
function check(id, desc, pass, detail = '') {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${desc}${detail ? ` — ${detail}` : ''}`);
}

/** Engine-write-path assertion ids — a FAIL here is the R6 abort signal. */
const ENGINE_PATH_IDS = new Set(['b', 'c', 'd', 'f', 'g']);

function fail(id, desc, err) {
  check(id, desc, false, err instanceof Error ? err.message : String(err));
}

async function waitFor(label, fn, timeoutMs = 20000, intervalMs = 250) {
  const start = Date.now();
  for (;;) {
    let val;
    try {
      val = await fn();
    } catch {
      // poll again
    }
    if (val) return val;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout (${timeoutMs}ms) waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// Surface beta-plugin async surprises instead of dying silently.
process.on('unhandledRejection', (err) => {
  console.error(`[unhandledRejection] ${err instanceof Error ? err.message : String(err)}`);
});

// ──────────────────────────────────────────────────────────────────────────
// 1. Local stack discovery + safety rail
// ──────────────────────────────────────────────────────────────────────────

function getLocalStack() {
  const res = spawnSync('npx', ['supabase', 'status', '-o', 'json'], {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
  });
  const out = res.stdout ?? '';
  const jsonStart = out.indexOf('{');
  if (jsonStart < 0) {
    throw new Error(
      `could not read local Supabase status (is the stack running? try: npx supabase start)\nstderr: ${res.stderr}`,
    );
  }
  const status = JSON.parse(out.slice(jsonStart));
  const url = status.API_URL;
  if (!/127\.0\.0\.1|localhost/.test(url ?? '')) {
    throw new Error(`refusing to run against non-local Supabase: ${url}`);
  }
  if (!status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
    throw new Error('local status missing ANON_KEY / SERVICE_ROLE_KEY');
  }
  return { url, anonKey: status.ANON_KEY, serviceKey: status.SERVICE_ROLE_KEY };
}

// ──────────────────────────────────────────────────────────────────────────
// 2. Smoke user (same identity + flow as e2e/web/setup/auth.setup.ts)
// ──────────────────────────────────────────────────────────────────────────

const SMOKE_EMAIL = process.env.SMOKE_EMAIL ?? 'smoke-phase6@test.local';
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD ?? 'pw-tripvisor-e2e-1234';

async function ensureSmokeUser({ url, serviceKey }) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
  const createRes = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: SMOKE_EMAIL, email_confirm: true, password: SMOKE_PASSWORD }),
  });
  if (!createRes.ok && createRes.status !== 422 && createRes.status !== 409) {
    throw new Error(`admin user create failed: HTTP ${createRes.status} ${await createRes.text()}`);
  }
  const listRes = await fetch(`${url}/auth/v1/admin/users?email=${encodeURIComponent(SMOKE_EMAIL)}`, { headers });
  const listJson = await listRes.json();
  const user = (listJson.users ?? []).find((u) => u.email === SMOKE_EMAIL);
  if (!user) throw new Error(`smoke user not found after create: ${SMOKE_EMAIL}`);
  // Idempotent password reset (the user may predate this script with another pw).
  const updRes = await fetch(`${url}/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ password: SMOKE_PASSWORD, email_confirm: true }),
  });
  if (!updRes.ok) throw new Error(`admin password reset failed: HTTP ${updRes.status}`);
  return user.id;
}

// ──────────────────────────────────────────────────────────────────────────
// 3. require('.ts') hook + RN-module stubs
// ──────────────────────────────────────────────────────────────────────────

function registerTsHook() {
  const babel = require('@babel/core');
  require.extensions['.ts'] = (module, filename) => {
    const src = fs.readFileSync(filename, 'utf8');
    const { code } = babel.transformSync(src, {
      filename,
      babelrc: false,
      configFile: false,
      sourceMaps: 'inline',
      presets: [[require.resolve('@babel/preset-typescript'), {}]],
      plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
    });
    module._compile(code, filename);
  };
}

function stubModule(absPath, exportsObj) {
  const m = new Module.Module(absPath, null);
  m.filename = absPath;
  m.loaded = true;
  m.exports = exportsObj;
  require.cache[absPath] = m;
}

/** Drop the src/sync/* modules from the require cache → next require gives a
 * FRESH store + engine (the "fresh store instance" of assertion f). The
 * stubs (src/api/supabase, src/lib/sentry) deliberately stay cached. */
function purgeSyncModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.split(path.sep).join('/').includes('/src/sync/')) delete require.cache[key];
  }
}

function loadSyncModules() {
  return {
    hydrate: require(path.join(ROOT, 'src', 'sync', 'hydrate.ts')),
    store: require(path.join(ROOT, 'src', 'sync', 'store.ts')),
    telemetry: require(path.join(ROOT, 'src', 'sync', 'telemetry.ts')),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 4. Main
// ──────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('── sync round-trip validation (S2 Wave 2 / R6 abort gate) ──');
  const stack = getLocalStack();
  console.log(`local stack: ${stack.url}`);
  const userId = await ensureSmokeUser(stack);
  console.log(`smoke user: ${SMOKE_EMAIL} (${userId})`);

  // Force the Tier-1 flag on for this process BEFORE flags.ts loads.
  process.env.EXPO_PUBLIC_SYNC_TIER1 = '1';

  const { createClient } = require('@supabase/supabase-js');
  const userClient = createClient(stack.url, stack.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const signIn = await userClient.auth.signInWithPassword({ email: SMOKE_EMAIL, password: SMOKE_PASSWORD });
  if (signIn.error) throw new Error(`password sign-in failed: ${signIn.error.message}`);

  /** Service-role client: SERVER-TRUTH assertions + cleanup only. */
  const service = createClient(stack.url, stack.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  registerTsHook();
  stubModule(path.join(ROOT, 'src', 'api', 'supabase.ts'), {
    supabase: userClient,
    SUPABASE_CONFIGURED: true,
  });
  stubModule(path.join(ROOT, 'src', 'lib', 'sentry.ts'), {
    Sentry: { addBreadcrumb: () => {} },
    initSentry: () => {},
  });

  const tripId = randomUUID();
  const placeId = randomUUID();
  const runTag = `SYNC-VALIDATE ${new Date().toISOString()}`;

  try {
    // ── a. engine boots in node ─────────────────────────────────────────
    let sync1;
    try {
      sync1 = loadSyncModules();
      const boot = await sync1.hydrate.initTier1Sync({ userId });
      check(
        'a',
        'engine boots in node under forced flag',
        boot.started === true,
        `started=${boot.started} degraded=${boot.degraded} (degraded=true is EXPECTED in node: in-memory persistence, R5)`,
      );
      if (!boot.started) throw new Error('initTier1Sync did not start (flag off? app_config sync_tier1 set to non-on?)');
    } catch (err) {
      fail('a', 'engine boots in node under forced flag', err);
      throw err; // nothing downstream can run
    }

    const { syncState } = require('@legendapp/state');
    const store1 = sync1.store.tier1Store$;

    // Wait for the first trips pull so creates are classified correctly.
    await waitFor('initial trips hydration (isLoaded)', () => syncState(store1.trips).isLoaded.get());

    // ── b. CREATE trip through the store ────────────────────────────────
    try {
      store1.trips[tripId].set({ id: tripId, title: `${runTag} trip` });
      const row = await waitFor(`trips/${tripId} on server`, async () => {
        const { data } = await service.from('trips').select('*').eq('id', tripId).maybeSingle();
        return data;
      });
      const stamped = row.created_at != null && row.updated_at != null && row.user_id === userId;
      check(
        'b',
        'store CREATE → Postgres row with server-stamped created_at/updated_at + session user_id',
        stamped,
        `created_at=${row.created_at} updated_at=${row.updated_at} user_id=${row.user_id}`,
      );
      // The saveResult merge must hand created_at back to the store — later
      // updates rely on it for create/update classification.
      await waitFor('store row gains created_at after create-ack', () => store1.trips[tripId].created_at.get());
    } catch (err) {
      fail('b', 'store CREATE → Postgres row', err);
    }

    // ── c. UPDATE title; forged client updated_at must be ignored ───────
    try {
      const before = await service.from('trips').select('created_at,updated_at').eq('id', tripId).single();
      store1.trips[tripId].assign({
        title: `${runTag} renamed`,
        updated_at: '2099-01-01T00:00:00.000Z', // forged conflict clock
      });
      const row = await waitFor('trips title update on server', async () => {
        const { data } = await service.from('trips').select('*').eq('id', tripId).maybeSingle();
        return data && data.title === `${runTag} renamed` ? data : undefined;
      });
      const clockSane = new Date(row.updated_at).getFullYear() < 2090;
      const createdImmutable = row.created_at === before.data.created_at;
      check(
        'c',
        'store UPDATE → server row updated; forged client updated_at ignored; created_at immutable',
        clockSane && createdImmutable,
        `updated_at=${row.updated_at} created_at(before)=${before.data.created_at} created_at(after)=${row.created_at}`,
      );
    } catch (err) {
      fail('c', 'store UPDATE with forged updated_at', err);
    }

    // ── d. CREATE trip_place with manual_rank (C1) ──────────────────────
    try {
      store1.tripPlaces[placeId].set({
        id: placeId,
        trip_id: tripId,
        google_place_id: 'sync-validate-fixture',
        user_title: `${runTag} place`,
        lat: 41.0082,
        lng: 28.9784,
        visit_duration_minutes: 45,
        manual_rank: 'a0V',
      });
      const row = await waitFor(`trip_places/${placeId} on server`, async () => {
        const { data } = await service.from('trip_places').select('*').eq('id', placeId).maybeSingle();
        return data;
      });
      check(
        'd',
        'store CREATE trip_place → manual_rank persisted; day_index/order_in_day stay NULL (C1)',
        row.manual_rank === 'a0V' && row.day_index === null && row.order_in_day === null,
        `manual_rank=${row.manual_rank} day_index=${row.day_index} order_in_day=${row.order_in_day}`,
      );
      await waitFor('store place gains created_at after create-ack', () => store1.tripPlaces[placeId].created_at.get());
    } catch (err) {
      fail('d', 'store CREATE trip_place with manual_rank', err);
    }

    // ── e. dirty write: day_index (C1) + rating (C3) must be stripped ───
    try {
      store1.tripPlaces[placeId].assign({
        user_title: `${runTag} sanitize-survivor`,
        day_index: 2, // C1: server-only writer
        rating: 4.5, // C3: Google-restricted — column doesn't even exist server-side
      });
      const row = await waitFor('sanitized place update on server', async () => {
        const { data } = await service.from('trip_places').select('*').eq('id', placeId).maybeSingle();
        return data && data.user_title === `${runTag} sanitize-survivor` ? data : undefined;
      });
      // The write LANDING at all proves `rating` was stripped: PostgREST
      // rejects unknown columns (PGRST204), so an unsanitized payload would
      // never have reached the table.
      const telemetry = sync1.telemetry.getSyncTelemetry();
      check(
        'e',
        'dirty write (day_index + rating) → server shows NEITHER; strip telemetry recorded',
        row.day_index === null && !('rating' in row) &&
          telemetry.tosViolations >= 1 && telemetry.strippedServerOnlyWriteFields >= 1,
        `day_index=${row.day_index} tosViolations=${telemetry.tosViolations} strippedServerOnly=${telemetry.strippedServerOnlyWriteFields}`,
      );
    } catch (err) {
      fail('e', 'dirty write sanitization (day_index + rating)', err);
    }

    // ── f. tombstone → fresh store instance excludes the row ────────────
    try {
      store1.tripPlaces[placeId].deleted.set(true);
      await waitFor('tombstone on server', async () => {
        const { data } = await service.from('trip_places').select('deleted').eq('id', placeId).maybeSingle();
        return data?.deleted === true;
      });

      purgeSyncModules();
      const sync2 = loadSyncModules();
      const boot2 = await sync2.hydrate.initTier1Sync({ userId });
      if (!boot2.started) throw new Error('fresh engine instance failed to start');
      const store2 = sync2.store.tier1Store$;
      await waitFor('fresh instance hydrates the trip', () => store2.trips[tripId].get());
      // Places hydration: wait for the root to load, then assert exclusion.
      await waitFor('fresh instance places loaded', () => syncState(store2.tripPlaces).isLoaded.get());
      const ghost = store2.tripPlaces[placeId].get();
      check(
        'f',
        'tombstoned row excluded from fresh-instance hydration (fieldDeleted)',
        ghost === undefined,
        `store2.tripPlaces[place]=${JSON.stringify(ghost) ?? 'undefined'}`,
      );

      // ── g. LWW: later server-side edit wins after resync ──────────────
      try {
        const upd = await service.from('trips').update({ title: `${runTag} SERVER-WINS` }).eq('id', tripId);
        if (upd.error) throw new Error(upd.error.message);
        sync2.hydrate.resyncTier1();
        await waitFor(
          'store reflects the later server-side title',
          () => store2.trips[tripId].title.get() === `${runTag} SERVER-WINS`,
        );
        check('g', 'LWW: later server-stamped edit wins in the store after resync', true);
      } catch (err) {
        fail('g', 'LWW resync convergence', err);
      }
    } catch (err) {
      fail('f', 'tombstone exclusion on fresh hydration', err);
      check('g', 'LWW resync convergence', false, 'skipped — fresh instance unavailable (see f)');
    }
  } finally {
    // ── cleanup: this run's rows + any strays from prior runs ───────────
    try {
      await service.from('trip_places').delete().eq('trip_id', tripId);
      await service.from('trips').delete().eq('id', tripId);
      const stale = await service.from('trips').select('id').eq('user_id', userId).like('title', 'SYNC-VALIDATE%');
      for (const t of stale.data ?? []) {
        await service.from('trip_places').delete().eq('trip_id', t.id);
        await service.from('trips').delete().eq('id', t.id);
      }
      console.log('cleanup: test rows removed');
    } catch (err) {
      console.error(`cleanup failed (manual sweep may be needed): ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── verdict ───────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.pass);
  const engineFailures = failed.filter((r) => ENGINE_PATH_IDS.has(r.id));
  console.log('──────────────────────────────────────────────');
  console.log(`${results.length - failed.length}/${results.length} assertions passed`);
  if (engineFailures.length > 0) {
    console.log(
      `ABORT GATE TRIPPED (R6): beta plugin write path failed on [${engineFailures.map((r) => r.id).join(', ')}]. ` +
        'Recommendation: stop the syncedSupabase rollout and switch to the named fallback — hand-rolled expo-sqlite sync ' +
        '(docs/v2/risks-and-decisions.md R6); everything Supabase-specific is contained in hydrate.ts.',
    );
  } else if (failed.length > 0) {
    console.log('Failures are in OUR sanitize/telemetry layer (not the plugin) — fix forward, no abort.');
  } else {
    console.log('R6 VERDICT: GO — beta plugin write path round-trips cleanly on the trips+trip_places slice.');
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
