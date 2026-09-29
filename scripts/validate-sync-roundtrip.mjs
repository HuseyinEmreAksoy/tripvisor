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
 * S2.8.12 Wave B/C contract proofs (appended; NOT R6 abort ids — a failure
 * here routes back to the owning step, see plan.md S2.8.12):
 *   h1–h3. D5 prune no-echo: pruneTripFromLocalStore drops the local row,
 *          emits ZERO network writes (server row + updated_at intact after a
 *          settle window), and a fresh instance re-hydrates the trip. The
 *          dev-console '[legend-state] missing delete function' warn is the
 *          EXPECTED no-op branch signature — captured and reported, never a
 *          failure.
 *   i1–i3. Rank chain: setPlaceManualRank (rankBetween append + between, the
 *          UI sequence) persists to the server; server-owned
 *          day_index/order_in_day stay untouched (C1 write strip, observed
 *          via telemetry); a fresh-instance hydration ordered with
 *          orderPlacesForDisplay(…, 'manual', true) reproduces the exact id
 *          sequence.
 *   j1–j2. Mutation-layer tombstonePlace → server deleted=true + fresh
 *          hydration excludes the place (extends f to the mutation path);
 *          the captured UndoEntry.inverse() revives it server-side and it
 *          rehydrates.
 *   k.     R4 firewall: trip_legs appears in NO allowlist export
 *          (TIER1_FIELDS/TIER1_TABLES/TIER1_WRITE_*) and NO store-namespace
 *          key — static check against the real imported modules.
 *
 * M4 X2.5 (appended; contract proofs, NOT R6 abort ids):
 *   l1–l3. Expenses through the mutation layer: create (client UUID, server
 *          stamps created_at) → edit after ack → tombstone (row kept
 *          server-side with deleted=true; a fresh hydration excludes it).
 *   m1–m3. Packing: the ≤30-row seed racing a tick on one of its own unacked
 *          creates (the beta finding) lands every row exactly once with the
 *          tick applied; later edits sync with `auto` untouched; tombstone +
 *          UndoEntry.inverse round trip.
 *
 * M5 Y1.1 (appended; contract proofs for migrations 0034/0035, NOT R6 ids):
 *   n1–n3. Multi-currency expenses through the mutation layer: a frozen-rate
 *          EUR expense round-trips all four money fields; an edit after ack
 *          (currency + rate change) reaches the server with trip_id/created_at
 *          intact; a "rate pending" create is later reconciled by an update,
 *          and a fresh hydration carries the money fields (the new select
 *          columns exist server-side).
 *   n4.    A currency-less create (pre-M5 client shape) is filled server-side
 *          (0034 §3d: trip home currency @ 1) and the create-ack merges the
 *          filled values back into the store.
 *   o1–o2. Per-leg modes: updatePlace({arrival_mode, arrival_minutes}) reaches
 *          the server with optimizer order untouched (C1); a fresh hydration
 *          carries arrival_mode/arrival_minutes and trip_days.transport_mode.
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

/** Engine-write-path assertion ids — a FAIL here is the R6 abort signal.
 * Deliberately UNCHANGED by S2.8.12: the h/i/j/k proofs are Wave B/C
 * contract checks whose failures route to their owning step, not to the
 * R6 abort verdict. */
const ENGINE_PATH_IDS = new Set(['b', 'c', 'd', 'f', 'g']);

function fail(id, desc, err) {
  check(id, desc, false, err instanceof Error ? err.message : String(err));
}

/** Canonical descriptions for the S2.8.12 assertions — used both at the
 * check site and by failRemaining so a thrown error fails every not-yet-run
 * assertion of its block exactly once (no double-registration). */
const S2812_DESC = {
  h1: 'D5 prune: pruneTripFromLocalStore removes the row from the local store',
  h2: 'D5 prune: NO network echo — server row + updated_at/archived_at intact after settle window',
  h3: 'D5 prune: fresh-instance hydration restores the trip',
  i1: 'rank chain: setPlaceManualRank append/between sequence persists to server',
  i2: 'rank chain: server-owned day_index/order_in_day untouched by rank writes (C1 strip live)',
  i3: "rank chain: fresh hydration + orderPlacesForDisplay(…,'manual',true) reproduces the exact id sequence",
  j1: 'mutation tombstone: server deleted=true + fresh hydration excludes the place',
  j2: 'undo inverse: place live again server-side (deleted=false) and rehydrates',
  k: 'no-legs firewall (R4): trip_legs absent from allowlist exports + store namespace',
  // M4 X2.5 — expense + packing write round trips (mutation layer → server → fresh hydration)
  l1: 'expense create: mutations.createExpense → server row (client id, server-stamped created_at, deleted=false)',
  l2: 'expense edit: updateExpense after ack → server amount/label/day_index updated; trip_id + created_at unchanged',
  l3: 'expense tombstone: server deleted=true (row kept, not hard-deleted) + fresh hydration excludes it',
  m1: 'packing seed race: 25-row bulk create + a tick BEFORE ack → all 25 rows land once, the ticked row is checked',
  m2: 'packing edit: label + untick after ack reach the server; `auto` provenance unchanged (create-only)',
  m3: 'packing tombstone: server deleted=true + fresh hydration excludes it; UndoEntry.inverse revives it',
  // M5 Y1.1 — money (0034) + per-leg modes (0035) on the existing write roots
  n1: 'expense w/ currency create: frozen EUR rate → server has currency/fx_rate/fx_date/fx_home_currency verbatim',
  n2: 'expense currency edit after ack: currency + fx_rate + fx_date change reaches the server; trip_id + created_at unchanged',
  n3: 'rate-pending create (fx_rate null) → reconciler update fills fx_rate server-side; fresh hydration carries all 4 money fields',
  n4: 'currency-less create (pre-M5 shape) → server fills the trip home currency @ 1; the create-ack merges it into the store',
  o1: 'arrival_mode write: updatePlace({arrival_mode, arrival_minutes}) → server row updated; day_index/order_in_day untouched (C1)',
  o2: 'fresh hydration carries trip_places.arrival_mode/arrival_minutes + trip_days.transport_mode',
};

/** Fail every id in `ids` that has not produced a result yet (block-level
 * catch handler — sub-assertions that already ran keep their verdict). */
function failRemaining(err, ids) {
  const done = new Set(results.map((r) => r.id));
  for (const id of ids) {
    if (!done.has(id)) fail(id, S2812_DESC[id], err);
  }
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
    // S2.8.12 — the Wave-3 mutation layer + ordering/rank helpers, loaded
    // from the SAME require-cache generation as hydrate/store so the
    // UndoEntry closures and store writes bind to the live instance.
    mutations: require(path.join(ROOT, 'src', 'sync', 'mutations.ts')),
    order: require(path.join(ROOT, 'src', 'sync', 'order.ts')),
    rank: require(path.join(ROOT, 'src', 'sync', 'rank.ts')),
    allowlist: require(path.join(ROOT, 'src', 'sync', 'allowlist.ts')),
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

  // S2.8.12 rows — declared here so the finally-cleanup can always see them.
  const pruneTripId = randomUUID();
  let rankTripId = null; // minted by mutations.createTrip inside block i
  let ledgerTripId = null; // minted by mutations.createTrip inside block l (X2.5)

  /** Purge + reload the real src/sync modules and boot a brand-new engine
   * instance (the "fresh instance" the hydration proofs need). The previous
   * instances stay attached for the process lifetime (the beta has no
   * detach) — their realtime merges only ever touch their OWN observables. */
  async function freshInstance(label) {
    const { syncState } = require('@legendapp/state');
    purgeSyncModules();
    const sync = loadSyncModules();
    const boot = await sync.hydrate.initTier1Sync({ userId });
    if (!boot.started) throw new Error(`${label}: fresh engine instance failed to start`);
    const store = sync.store.tier1Store$;
    await waitFor(`${label}: fresh instance trips loaded`, () => syncState(store.trips).isLoaded.get());
    await waitFor(`${label}: fresh instance places loaded`, () => syncState(store.tripPlaces).isLoaded.get());
    return { sync, store };
  }

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
    // sync2/store2 hoisted: the S2.8.12 h-block reuses this live instance.
    let sync2 = null;
    let store2 = null;
    try {
      store1.tripPlaces[placeId].deleted.set(true);
      await waitFor('tombstone on server', async () => {
        const { data } = await service.from('trip_places').select('deleted').eq('id', placeId).maybeSingle();
        return data?.deleted === true;
      });

      purgeSyncModules();
      sync2 = loadSyncModules();
      const boot2 = await sync2.hydrate.initTier1Sync({ userId });
      if (!boot2.started) throw new Error('fresh engine instance failed to start');
      store2 = sync2.store.tier1Store$;
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

    // ════════════════════════════════════════════════════════════════════
    // S2.8.12 — Wave B/C contract proofs (h–k). Failures here are NOT R6
    // abort signals; they route to the owning step (S2.8.4 / S2.8.2+S2.8.6 /
    // S2.8.1 / R4). See the header for what each block proves.
    // ════════════════════════════════════════════════════════════════════

    console.log('── S2.8.12 Wave B/C proofs ──');

    // ── h. D5 prune no-echo (pruneTripFromLocalStore) ────────────────────
    let sync3 = null; // live mutation instance for blocks i/j (set by h3)
    let store3 = null;
    try {
      // Live writable instance: reuse the f/g one when its boot succeeded.
      let live = store2 ? { sync: sync2, store: store2 } : null;
      if (!live) live = await freshInstance('h: live instance');

      live.store.trips[pruneTripId].set({ id: pruneTripId, title: `${runTag} prune` });
      await waitFor(`trips/${pruneTripId} on server`, async () => {
        const { data } = await service.from('trips').select('id').eq('id', pruneTripId).maybeSingle();
        return data;
      });
      await waitFor('prune trip gains created_at (create-ack)', () => live.store.trips[pruneTripId].created_at.get());
      // Let the row's OWN realtime INSERT echo land before pruning. In
      // production a pruned trip is minutes-to-months old (its create echo
      // is long gone); in this script the create is seconds old, and a late
      // echo merging after the prune would re-add the row — a scenario
      // artifact, not a D5 violation (here the server row deliberately
      // still exists; in the real S2.8.4 flow the server DELETE precedes
      // the prune, so no pull can resurrect it).
      await new Promise((r) => setTimeout(r, 2000));
      const beforeRes = await service
        .from('trips')
        .select('updated_at,archived_at')
        .eq('id', pruneTripId)
        .single();
      if (beforeRes.error) throw new Error(beforeRes.error.message);
      const before = beforeRes.data;

      // Capture the EXPECTED no-op signature ('[legend-state] missing delete
      // function' — hydrate.ts pruneTripFromLocalStore docs) so it is
      // reported as proof, never mistaken for a failure.
      const warns = [];
      const origWarn = console.warn;
      console.warn = (...args) => {
        warns.push(args.map(String).join(' '));
        origWarn.apply(console, args);
      };
      // The observable delete applies SYNCHRONOUSLY — gate on the immediate
      // state. A synchronous engine REVERT here would be the real D5
      // disproof (warn branch undoing local deletes); a later async re-add
      // is the scenario artifact documented above, reported not gated.
      let goneImmediately = false;
      let goneAt500 = false;
      let goneAfterSettle = false;
      try {
        live.sync.hydrate.pruneTripFromLocalStore(pruneTripId);
        goneImmediately = live.store.trips[pruneTripId].get() === undefined;
        // Let the engine process the store-level delete (warn branch)…
        await new Promise((r) => setTimeout(r, 500));
        goneAt500 = live.store.trips[pruneTripId].get() === undefined;
        // …then a settle window: on the local stack a networked echo (hard
        // DELETE or tombstone-style UPDATE) would land in well under 4s.
        await new Promise((r) => setTimeout(r, 4000));
        goneAfterSettle = live.store.trips[pruneTripId].get() === undefined;
      } finally {
        console.warn = origWarn;
      }
      const warnSeen = warns.some((w) => w.includes('missing delete function'));
      check(
        'h1',
        S2812_DESC.h1,
        goneImmediately,
        `gone: immediate=${goneImmediately} +500ms=${goneAt500} +settle=${goneAfterSettle}; no-op warn ${
          warnSeen ? 'observed (expected branch signature)' : 'not observed'
        }${
          goneImmediately && !goneAfterSettle
            ? ' — re-added by an async echo/pull (server row still live in THIS scenario only)'
            : ''
        }`,
      );

      const afterRes = await service
        .from('trips')
        .select('id,updated_at,archived_at')
        .eq('id', pruneTripId)
        .maybeSingle();
      const after = afterRes.data;
      check(
        'h2',
        S2812_DESC.h2,
        after != null && after.updated_at === before.updated_at && after.archived_at === before.archived_at,
        after
          ? `updated_at before=${before.updated_at} after=${after.updated_at} archived_at=${after.archived_at}`
          : 'server row GONE — the prune echoed a DELETE (D5 disproved)',
      );

      ({ sync: sync3, store: store3 } = await freshInstance('h3'));
      const restored = store3.trips[pruneTripId].get();
      check('h3', S2812_DESC.h3, restored?.title === `${runTag} prune`, `title=${restored?.title ?? 'ABSENT'}`);
    } catch (err) {
      failRemaining(err, ['h1', 'h2', 'h3']);
    }

    // ── i. Rank chain round-trip (i1/i2 on the live instance) ───────────
    let rankIds = null; // [pA, pB, pC] in optimizer order_in_day order
    let expectedSeq = null; // expected manual display order after the move
    try {
      if (!sync3) throw new Error('skipped — no live instance (see h3)');
      const m = sync3.mutations;
      rankTripId = m.createTrip({ title: `${runTag} rank` });
      // Parent must exist server-side before child INSERTs (RLS WITH CHECK
      // + FK both need it — the two roots queue independently).
      await waitFor('rank trip on server', async () => {
        const { data } = await service.from('trips').select('id').eq('id', rankTripId).maybeSingle();
        return data;
      });
      await waitFor('rank trip create-ack', () => store3.trips[rankTripId].created_at.get());

      const mk = (n) =>
        m.createPlace({
          trip_id: rankTripId,
          google_place_id: `sync-validate-rank-${n}`,
          lat: 41.001 + n / 1000,
          lng: 28.97,
          user_title: `${runTag} rank-${n}`,
        });
      const pA = mk(1);
      const pB = mk(2);
      const pC = mk(3);
      rankIds = [pA, pB, pC];
      for (const pid of rankIds) {
        await waitFor(`rank place ${pid} on server`, async () => {
          const { data } = await service.from('trip_places').select('id').eq('id', pid).maybeSingle();
          return data;
        });
        // Acked rows carry created_at — later rank writes must classify as
        // UPDATEs (mutations.ts header: update racing an unacked create).
        await waitFor(`rank place ${pid} create-ack`, () => store3.tripPlaces[pid].created_at.get());
      }

      // Simulate the optimizer — the ONLY sanctioned day_index/order_in_day
      // writer is server-side (C1), so write them with the service role.
      for (let i = 0; i < rankIds.length; i++) {
        const upd = await service
          .from('trip_places')
          .update({ day_index: 0, order_in_day: i })
          .eq('id', rankIds[i]);
        if (upd.error) throw new Error(upd.error.message);
      }
      sync3.hydrate.resyncTier1();
      await waitFor('store reflects optimizer day_index after resync', () =>
        rankIds.every((pid) => store3.tripPlaces[pid].day_index.get() === 0),
      );

      // UI-like rank sequence: append A, B, C, then drag C between A and B.
      const { rankBetween } = sync3.rank;
      const rA = rankBetween(null, null); // 'V'
      const rB = rankBetween(rA, null); //   append
      const rC0 = rankBetween(rB, null); //  append
      m.setPlaceManualRank(pA, rA);
      m.setPlaceManualRank(pB, rB);
      m.setPlaceManualRank(pC, rC0);
      const stripsBefore = sync3.telemetry.getSyncTelemetry().strippedServerOnlyWriteFields;
      const rC = rankBetween(rA, rB); // the between-move (drag)
      m.setPlaceManualRank(pC, rC);
      expectedSeq = [pA, pC, pB];

      const want = { [pA]: rA, [pB]: rB, [pC]: rC };
      const rows = await waitFor('final manual_rank values on server', async () => {
        const { data } = await service
          .from('trip_places')
          .select('id,manual_rank,day_index,order_in_day')
          .in('id', rankIds);
        if (!data || data.length !== 3) return undefined;
        return data.every((r) => r.manual_rank === want[r.id]) ? data : undefined;
      });
      check('i1', S2812_DESC.i1, true, `A=${rA} B=${rB} C=${rC0}→${rC} (moved between A and B)`);

      // Full-row updates carried day_index/order_in_day/timestamps along —
      // the C1 strip is what kept them off the wire. Values alone can't
      // prove the strip (the store mirrors the server here), so also assert
      // the strip TELEMETRY advanced for the post-capture rank write.
      const orderIntact = rows.every((r) => r.day_index === 0 && r.order_in_day === rankIds.indexOf(r.id));
      const strips = sync3.telemetry.getSyncTelemetry().strippedServerOnlyWriteFields;
      check(
        'i2',
        S2812_DESC.i2,
        orderIntact && strips > stripsBefore,
        `day_index/order_in_day intact=${orderIntact}; strippedServerOnlyWriteFields ${stripsBefore} → ${strips}`,
      );
    } catch (err) {
      failRemaining(err, ['i1', 'i2']);
    }

    // ── j-setup + shared fresh instance: i3 + j1 ─────────────────────────
    let undoEntry = null; // tombstonePlace's UndoEntry (inverse run in j2)
    let p4 = null;
    try {
      if (!sync3 || !rankTripId) throw new Error('skipped — live instance/rank trip unavailable');
      const m = sync3.mutations;
      p4 = m.createPlace({
        trip_id: rankTripId,
        google_place_id: 'sync-validate-rank-tombstone',
        lat: 41.02,
        lng: 28.99,
        user_title: `${runTag} tombstone-undo`,
      });
      await waitFor(`tombstone-candidate ${p4} on server`, async () => {
        const { data } = await service.from('trip_places').select('id').eq('id', p4).maybeSingle();
        return data;
      });
      await waitFor('tombstone-candidate create-ack', () => store3.tripPlaces[p4].created_at.get());

      undoEntry = m.tombstonePlace(p4); // capture the inverse BEFORE asserting
      await waitFor('mutation-layer tombstone on server (deleted=true)', async () => {
        const { data } = await service.from('trip_places').select('deleted').eq('id', p4).maybeSingle();
        return data?.deleted === true;
      });

      // ONE fresh instance serves both i3 and j1.
      const inst = await freshInstance('i3/j1');

      if (expectedSeq && rankIds) {
        // Feed the WHOLE trip's hydrated rows, exactly like the UI does, then
        // compare the rank-trio subsequence (independent of j1's outcome).
        const all = inst.store.tripPlaces.peek() ?? {};
        const tripRows = Object.values(all).filter((r) => r && r.trip_id === rankTripId);
        const ordered = inst.sync.order
          .orderPlacesForDisplay(tripRows, 'manual', true)
          .map((r) => r.id)
          .filter((id) => rankIds.includes(id));
        check(
          'i3',
          S2812_DESC.i3,
          ordered.join(',') === expectedSeq.join(','),
          `got=[${ordered.join(', ')}] want=[${expectedSeq.join(', ')}]`,
        );
      } else {
        check('i3', S2812_DESC.i3, false, 'skipped — rank chain not established (see i1)');
      }

      const ghost = inst.store.tripPlaces[p4].get();
      check('j1', S2812_DESC.j1, ghost === undefined, `fresh store row=${JSON.stringify(ghost) ?? 'undefined'}`);
    } catch (err) {
      failRemaining(err, ['i3', 'j1']);
    }

    // ── j2. UndoEntry.inverse() un-tombstones + rehydrates ──────────────
    try {
      if (!undoEntry) throw new Error('skipped — no UndoEntry captured (see j1)');
      // The inverse closes over the ORIGIN instance's store + gate (sync3 is
      // still attached and active — exactly how the in-app undo stack works).
      await undoEntry.inverse();
      await waitFor('undo inverse on server (deleted=false)', async () => {
        const { data } = await service.from('trip_places').select('deleted').eq('id', p4).maybeSingle();
        return data ? data.deleted === false : undefined;
      });
      const inst = await freshInstance('j2');
      const revived = inst.store.tripPlaces[p4].get();
      check(
        'j2',
        S2812_DESC.j2,
        revived != null && revived.deleted !== true,
        revived ? `rehydrated with deleted=${revived.deleted}` : 'ABSENT from fresh hydration',
      );
    } catch (err) {
      failRemaining(err, ['j2']);
    }

    // ── k. No-legs firewall (R4) — static check on the real modules ─────
    try {
      const allow = require(path.join(ROOT, 'src', 'sync', 'allowlist.ts'));
      const storeMod = require(path.join(ROOT, 'src', 'sync', 'store.ts'));
      const allowClean =
        !Object.prototype.hasOwnProperty.call(allow.TIER1_FIELDS, 'trip_legs') &&
        !allow.TIER1_TABLES.includes('trip_legs') &&
        !Object.prototype.hasOwnProperty.call(allow.TIER1_WRITE_FIELDS, 'trip_legs') &&
        !allow.TIER1_WRITE_TABLES.includes('trip_legs');
      const mappedTables = Object.values(storeMod.TABLE_FOR_KEY);
      const namespaceKeys = [
        ...storeMod.TIER1_STORE_KEYS,
        ...Object.keys(storeMod.tier1Store$.peek() ?? {}),
      ];
      const storeClean = !mappedTables.includes('trip_legs') && !namespaceKeys.some((key) => /leg/i.test(key));
      check(
        'k',
        S2812_DESC.k,
        allowClean && storeClean,
        `tables=[${allow.TIER1_TABLES.join(',')}] storeKeys=[${storeMod.TIER1_STORE_KEYS.join(',')}]`,
      );
    } catch (err) {
      failRemaining(err, ['k']);
    }

    // ════════════════════════════════════════════════════════════════════
    // M4 X2.5 — expense + packing write round trips (l, m). Not R6 ids.
    // ════════════════════════════════════════════════════════════════════

    console.log('── X2.5 expense + packing proofs ──');

    /** Fresh instance whose expense + packing roots have finished loading. */
    async function freshLedgerInstance(label) {
      const inst = await freshInstance(label);
      await waitFor(`${label}: expenses loaded`, () => syncState(inst.store.tripExpenses).isLoaded.get());
      await waitFor(`${label}: packing loaded`, () => syncState(inst.store.tripPackingItems).isLoaded.get());
      return inst;
    }

    // One live writable instance for both blocks (the last one booted —
    // sync3 when h3 succeeded, else a new one).
    let live = null;
    try {
      live = sync3 ? { sync: sync3, store: store3 } : await freshInstance('l: live instance');
      const m = live.sync.mutations;
      ledgerTripId = m.createTrip({ title: `${runTag} ledger` });
      await waitFor('ledger trip on server', async () => {
        const { data } = await service.from('trips').select('id').eq('id', ledgerTripId).maybeSingle();
        return data;
      });
      await waitFor('ledger trip create-ack', () => live.store.trips[ledgerTripId].created_at.get());
    } catch (err) {
      live = null;
      failRemaining(err, ['l1', 'l2', 'l3', 'm1', 'm2', 'm3']);
    }

    // ── l. expenses ──────────────────────────────────────────────────────
    if (live) {
      let expenseId = null;
      try {
        const m = live.sync.mutations;
        expenseId = m.createExpense({
          trip_id: ledgerTripId,
          category: 'food',
          amount: 12.5,
          kind: 'actual',
          day_index: 0,
          label: `${runTag} lunch`,
        });
        const row = await waitFor(`trip_expenses/${expenseId} on server`, async () => {
          const { data } = await service.from('trip_expenses').select('*').eq('id', expenseId).maybeSingle();
          return data;
        });
        check(
          'l1',
          S2812_DESC.l1,
          row.id === expenseId &&
            Number(row.amount) === 12.5 &&
            row.kind === 'actual' &&
            row.day_index === 0 &&
            row.deleted === false &&
            row.created_at != null,
          `amount=${row.amount} kind=${row.kind} day_index=${row.day_index} deleted=${row.deleted} created_at=${row.created_at}`,
        );
        await waitFor('expense create-ack', () => live.store.tripExpenses[expenseId].created_at.get());

        const before = row;
        m.updateExpense(expenseId, { amount: 20, label: `${runTag} lunch (edited)`, day_index: 1 });
        const edited = await waitFor('expense edit on server', async () => {
          const { data } = await service.from('trip_expenses').select('*').eq('id', expenseId).maybeSingle();
          return data && Number(data.amount) === 20 ? data : undefined;
        });
        check(
          'l2',
          S2812_DESC.l2,
          edited.label === `${runTag} lunch (edited)` &&
            edited.day_index === 1 &&
            edited.trip_id === ledgerTripId &&
            edited.created_at === before.created_at,
          `amount=${edited.amount} label=${edited.label} day_index=${edited.day_index} created_at ${before.created_at} → ${edited.created_at}`,
        );

        m.tombstoneExpense(expenseId);
        await waitFor('expense tombstone on server', async () => {
          const { data } = await service.from('trip_expenses').select('deleted').eq('id', expenseId).maybeSingle();
          return data?.deleted === true;
        });
        const inst = await freshLedgerInstance('l3');
        const ghost = inst.store.tripExpenses[expenseId].get();
        check('l3', S2812_DESC.l3, ghost === undefined, `fresh store row=${JSON.stringify(ghost) ?? 'undefined'}`);
      } catch (err) {
        failRemaining(err, ['l1', 'l2', 'l3']);
      }
    }

    // ── m. packing ───────────────────────────────────────────────────────
    if (live) {
      try {
        const m = live.sync.mutations;
        const SEED = 25;
        const items = Array.from({ length: SEED }, (_, i) => ({
          label: `${runTag} item ${String(i).padStart(2, '0')}`,
          category: i % 2 ? 'clothing' : 'toiletries',
          auto: true,
        }));
        const ids = m.createPackingItems(ledgerTripId, items);
        // THE RACE: tick one of the seed rows before any create is acked.
        const ticked = ids[3];
        m.updatePackingItem(ticked, { checked: true });

        const rows = await waitFor(
          'all seeded packing rows on server with the tick applied',
          async () => {
            const { data } = await service.from('trip_packing_items').select('*').eq('trip_id', ledgerTripId);
            if (!data || data.length < SEED) return undefined;
            const t = data.find((r) => r.id === ticked);
            return t && t.checked === true ? data : undefined;
          },
          30000,
        );
        const uniqueIds = new Set(rows.map((r) => r.id));
        check(
          'm1',
          S2812_DESC.m1,
          rows.length === SEED &&
            uniqueIds.size === SEED &&
            ids.every((id) => uniqueIds.has(id)) &&
            rows.every((r) => r.auto === true && r.deleted === false),
          `server rows=${rows.length} unique=${uniqueIds.size} ticked=${rows.find((r) => r.id === ticked)?.checked}`,
        );
        for (const id of [ticked, ids[4]]) {
          await waitFor(`packing ${id} create-ack`, () => live.store.tripPackingItems[id].created_at.get());
        }

        m.updatePackingItem(ticked, { checked: false, label: `${runTag} item 03 (renamed)` });
        const edited = await waitFor('packing edit on server', async () => {
          const { data } = await service.from('trip_packing_items').select('*').eq('id', ticked).maybeSingle();
          return data && data.label === `${runTag} item 03 (renamed)` ? data : undefined;
        });
        check('m2', S2812_DESC.m2, edited.checked === false && edited.auto === true, `checked=${edited.checked} auto=${edited.auto}`);

        const victim = ids[4];
        const undo = m.tombstonePackingItem(victim);
        await waitFor('packing tombstone on server', async () => {
          const { data } = await service.from('trip_packing_items').select('deleted').eq('id', victim).maybeSingle();
          return data?.deleted === true;
        });
        const inst = await freshLedgerInstance('m3');
        const ghost = inst.store.tripPackingItems[victim].get();
        await undo.inverse(); // closes over the ORIGIN (live) instance, like the in-app stack
        await waitFor('packing undo on server (deleted=false)', async () => {
          const { data } = await service.from('trip_packing_items').select('deleted').eq('id', victim).maybeSingle();
          return data ? data.deleted === false : undefined;
        });
        check(
          'm3',
          S2812_DESC.m3,
          ghost === undefined,
          `fresh store row after tombstone=${JSON.stringify(ghost) ?? 'undefined'}; undo revived server-side`,
        );
      } catch (err) {
        failRemaining(err, ['m1', 'm2', 'm3']);
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // M5 Y1.1 — multi-currency expenses (n) + per-leg modes (o). Not R6 ids.
    // ════════════════════════════════════════════════════════════════════

    console.log('── M5 Y1.1 money + leg-mode proofs ──');

    if (!live) {
      failRemaining(new Error('skipped — no live ledger instance (see l)'), ['n1', 'n2', 'n3', 'n4', 'o1', 'o2']);
    }

    // ── n. multi-currency expenses ───────────────────────────────────────
    let pendingId = null;
    if (live) {
      try {
        const m = live.sync.mutations;
        // The ledger trip was created with the default home currency.
        const home = (await service.from('trips').select('currency').eq('id', ledgerTripId).single()).data.currency;
        const frozen = {
          currency: 'EUR',
          fx_rate: 1.0842,
          fx_date: '2026-07-01',
          fx_home_currency: home,
        };
        const moneyId = m.createExpense({
          trip_id: ledgerTripId,
          category: 'food',
          amount: 12.5,
          kind: 'actual',
          label: `${runTag} pasta (EUR)`,
          ...frozen,
        });
        const row = await waitFor(`trip_expenses/${moneyId} on server`, async () => {
          const { data } = await service.from('trip_expenses').select('*').eq('id', moneyId).maybeSingle();
          return data;
        });
        check(
          'n1',
          S2812_DESC.n1,
          row.currency === 'EUR' &&
            Number(row.fx_rate) === 1.0842 &&
            row.fx_date === '2026-07-01' &&
            row.fx_home_currency === home &&
            Number(row.amount) === 12.5,
          `amount=${row.amount} ${row.currency} fx_rate=${row.fx_rate} fx_date=${row.fx_date} home=${row.fx_home_currency}`,
        );
        await waitFor('money expense create-ack', () => live.store.tripExpenses[moneyId].created_at.get());

        m.updateExpense(moneyId, { currency: 'TRY', amount: 450, fx_rate: 0.0301, fx_date: '2026-07-02' });
        const edited = await waitFor('money expense edit on server', async () => {
          const { data } = await service.from('trip_expenses').select('*').eq('id', moneyId).maybeSingle();
          return data && data.currency === 'TRY' ? data : undefined;
        });
        check(
          'n2',
          S2812_DESC.n2,
          Number(edited.amount) === 450 &&
            Number(edited.fx_rate) === 0.0301 &&
            edited.fx_date === '2026-07-02' &&
            edited.fx_home_currency === home &&
            edited.trip_id === ledgerTripId &&
            edited.created_at === row.created_at,
          `amount=${edited.amount} ${edited.currency} fx_rate=${edited.fx_rate} fx_date=${edited.fx_date} created_at ${row.created_at} → ${edited.created_at}`,
        );

        // Offline-style entry with no known rate, then the reconciler fill.
        pendingId = m.createExpense({
          trip_id: ledgerTripId,
          category: 'transport',
          amount: 3.2,
          kind: 'actual',
          label: `${runTag} tram (pending rate)`,
          currency: 'EUR',
          fx_rate: null,
          fx_date: '2026-07-03',
          fx_home_currency: home,
        });
        await waitFor('pending expense on server', async () => {
          const { data } = await service.from('trip_expenses').select('fx_rate').eq('id', pendingId).maybeSingle();
          return data ? data : undefined;
        });
        await waitFor('pending expense create-ack', () => live.store.tripExpenses[pendingId].created_at.get());
        m.updateExpense(pendingId, { fx_rate: 1.09 });
        await waitFor('reconciled rate on server', async () => {
          const { data } = await service.from('trip_expenses').select('fx_rate').eq('id', pendingId).maybeSingle();
          return data && Number(data.fx_rate) === 1.09 ? data : undefined;
        });
        const inst = await freshLedgerInstance('n3');
        const hydrated = inst.store.tripExpenses[pendingId].get();
        const hydratedMoney = inst.store.tripExpenses[moneyId].get();
        check(
          'n3',
          S2812_DESC.n3,
          hydrated?.currency === 'EUR' &&
            Number(hydrated?.fx_rate) === 1.09 &&
            hydrated?.fx_date === '2026-07-03' &&
            hydrated?.fx_home_currency === home &&
            hydratedMoney?.currency === 'TRY' &&
            Number(hydratedMoney?.fx_rate) === 0.0301,
          `fresh store: pending→${hydrated?.currency} ${hydrated?.fx_rate} ${hydrated?.fx_date} ${hydrated?.fx_home_currency}; edited→${hydratedMoney?.currency} ${hydratedMoney?.fx_rate}`,
        );
      } catch (err) {
        failRemaining(err, ['n1', 'n2', 'n3']);
      }

      try {
        const m = live.sync.mutations;
        const home = (await service.from('trips').select('currency').eq('id', ledgerTripId).single()).data.currency;
        const legacyId = m.createExpense({
          trip_id: ledgerTripId,
          category: 'other',
          amount: 7,
          label: `${runTag} legacy-shaped (no currency)`,
        });
        const serverRow = await waitFor('legacy-shaped expense on server', async () => {
          const { data } = await service.from('trip_expenses').select('*').eq('id', legacyId).maybeSingle();
          return data ?? undefined;
        });
        const merged = await waitFor(
          'store merges the server-filled currency on create-ack',
          () => {
            const r = live.store.tripExpenses[legacyId].get();
            return r && r.created_at && r.currency ? r : undefined;
          },
        );
        check(
          'n4',
          S2812_DESC.n4,
          serverRow.currency === home &&
            Number(serverRow.fx_rate) === 1 &&
            serverRow.fx_home_currency === home &&
            serverRow.fx_date != null &&
            merged.currency === home &&
            Number(merged.fx_rate) === 1,
          `server: ${serverRow.currency} @ ${serverRow.fx_rate} (${serverRow.fx_date}, home ${serverRow.fx_home_currency}); store: ${merged.currency} @ ${merged.fx_rate}`,
        );
      } catch (err) {
        failRemaining(err, ['n4']);
      }
    }

    // ── o. per-leg modes ────────────────────────────────────────────────
    if (live) {
      try {
        const m = live.sync.mutations;
        const legPlace = m.createPlace({
          trip_id: ledgerTripId,
          google_place_id: 'sync-validate-leg-mode',
          lat: 41.03,
          lng: 29.01,
          user_title: `${runTag} leg-mode`,
        });
        await waitFor(`leg-mode place ${legPlace} on server`, async () => {
          const { data } = await service.from('trip_places').select('id').eq('id', legPlace).maybeSingle();
          return data;
        });
        await waitFor('leg-mode place create-ack', () => live.store.tripPlaces[legPlace].created_at.get());
        // The optimizer (server role) owns order — seed it so C1 can be observed.
        const seed = await service.from('trip_places').update({ day_index: 0, order_in_day: 4 }).eq('id', legPlace);
        if (seed.error) throw new Error(seed.error.message);
        live.sync.hydrate.resyncTier1();
        await waitFor('store reflects the seeded optimizer order', () => live.store.tripPlaces[legPlace].day_index.get() === 0);

        m.updatePlace(legPlace, { arrival_mode: 'flight', arrival_minutes: 95 });
        const row = await waitFor('arrival_mode on server', async () => {
          const { data } = await service.from('trip_places').select('*').eq('id', legPlace).maybeSingle();
          return data && data.arrival_mode === 'flight' ? data : undefined;
        });
        check(
          'o1',
          S2812_DESC.o1,
          row.arrival_minutes === 95 && row.day_index === 0 && row.order_in_day === 4,
          `arrival_mode=${row.arrival_mode} arrival_minutes=${row.arrival_minutes} day_index=${row.day_index} order_in_day=${row.order_in_day}`,
        );

        // trip_days is a READ-ONLY root: write the day default the way the
        // online path does (here: service role), then prove it hydrates.
        const day = await service
          .from('trip_days')
          .upsert({ trip_id: ledgerTripId, day_index: 0, transport_mode: 'transit' }, { onConflict: 'trip_id,day_index' })
          .select('id')
          .single();
        if (day.error) throw new Error(day.error.message);
        const inst = await freshLedgerInstance('o2');
        await waitFor('o2: days loaded', () => syncState(inst.store.tripDays).isLoaded.get());
        const hp = inst.store.tripPlaces[legPlace].get();
        const hd = inst.store.tripDays[day.data.id].get();
        check(
          'o2',
          S2812_DESC.o2,
          hp?.arrival_mode === 'flight' && hp?.arrival_minutes === 95 && hd?.transport_mode === 'transit',
          `place arrival=${hp?.arrival_mode}/${hp?.arrival_minutes} day transport_mode=${hd?.transport_mode}`,
        );
      } catch (err) {
        failRemaining(err, ['o1', 'o2']);
      }
    }
  } finally {
    // ── cleanup: this run's rows + any strays from prior runs ───────────
    try {
      const sweep = async (tid) => {
        await service.from('trip_places').delete().eq('trip_id', tid);
        await service.from('trip_expenses').delete().eq('trip_id', tid);
        await service.from('trip_packing_items').delete().eq('trip_id', tid);
        await service.from('trips').delete().eq('id', tid);
      };
      for (const tid of [tripId, pruneTripId, rankTripId, ledgerTripId].filter(Boolean)) {
        await sweep(tid);
      }
      const stale = await service.from('trips').select('id').eq('user_id', userId).like('title', 'SYNC-VALIDATE%');
      for (const t of stale.data ?? []) {
        await sweep(t.id);
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
  if (failed.some((r) => String(r.id).startsWith('h'))) {
    // The S2.8.12 plan risk: D5's "prune is a no-op" assumption disproved.
    console.log(
      'D5 NOTE: the prune no-echo contract did NOT hold — apply the S2.8.4 fallback ' +
        '(facade-level deleted-ids session set) and re-plan only that seam (plan.md S2.8.12 risk).',
    );
  }
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
