// fx-rates — Deno tests (pure rates.ts + the handler over fake deps).
//
// Run with:
//   deno test --allow-env --allow-net=127.0.0.1 supabase/functions/fx-rates/index.test.ts
//
// Written against node:test / node:assert (same as _shared/auth.test.ts) so
// the repo-level tsc resolves them through @types/node; the `.ts`-suffixed
// imports carry @ts-ignore for that tsc only. No network: every upstream is
// a fake `fetch`, every DB call a fake dep.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore -- Deno `.ts`-suffixed import (unresolvable under the Expo tsconfig)
import { _setTokenVerifierForTests } from '../_shared/auth.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { createHandler, type FxDeps, type UsageOutcome } from './handler.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { rowsToSnapshot } from './deps.ts';
import {
  crossRate,
  decodeSource,
  ECB_CODES,
  effectiveDate,
  encodeSource,
  isFinal,
  mergeRows,
  needsRefresh,
  parseCurrencyApi,
  parseFrankfurterV2,
  pastDayRowsToKeep,
  planFill,
  type RateRow,
  resolveRequestDate,
  type Snapshot,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from './rates.ts';

const USER = '00000000-0000-4000-8000-0000000000f1';
_setTokenVerifierForTests((token: string) =>
  Promise.resolve(token === 'bad' ? { ok: false, status: 401, code: 'not_authenticated', message: 'nope' } : { ok: true, userId: USER }),
);

// A user JWT shape (has `sub`) so requireUser's pre-screen passes to the verifier.
function seg(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const USER_JWT = `${seg({ alg: 'HS256' })}.${seg({ sub: USER, role: 'authenticated' })}.sig`;

// 2026-09-29 is a Tuesday; 09-26/27 the weekend before.
const NOW = Date.parse('2026-09-29T10:00:00Z');
const HOUR = 3_600_000;

// ---------------------------------------------------------------------------
// Pure: rates.ts
// ---------------------------------------------------------------------------

test('resolveRequestDate: latest, tomorrow-in-UTC, past, future, too old, garbage', () => {
  assert.deepEqual(resolveRequestDate(undefined, NOW), { ok: true, date: '2026-09-29', latest: true });
  assert.deepEqual(resolveRequestDate('latest', NOW), { ok: true, date: '2026-09-29', latest: true });
  // Istanbul (UTC+3) after 21:00 UTC is already "tomorrow": treated as latest.
  assert.deepEqual(resolveRequestDate('2026-09-30', NOW), { ok: true, date: '2026-09-29', latest: true });
  assert.deepEqual(resolveRequestDate('2026-09-26', NOW), { ok: true, date: '2026-09-26', latest: false });
  assert.equal(resolveRequestDate('2026-10-02', NOW).ok, false);
  assert.equal(resolveRequestDate('1998-12-31', NOW).ok, false);
  assert.equal(resolveRequestDate('2026-02-30', NOW).ok, false);
  assert.equal(resolveRequestDate('29/09/2026', NOW).ok, false);
});

function row(quote: string, rate: number, publishedDate: string, source: RateRow['source'] = 'frankfurter-ecb'): RateRow {
  return { quote, rate, source, publishedDate };
}
function snap(date: string, rows: RateRow[], fetchedAt: number): Snapshot {
  return { date, rows: new Map(rows.map((r) => [r.quote, r])), fetchedAt };
}

test('isFinal / needsRefresh: published-for-the-day is final; weekends settle after the day ends', () => {
  // Business day, published for itself: final immediately.
  assert.equal(isFinal(snap('2026-09-28', [row('TRY', 55.7, '2026-09-28')], NOW)), true);
  // Saturday resolved to Friday, fetched ON Saturday: not final yet...
  const satEarly = snap('2026-09-26', [row('TRY', 55.8, '2026-09-25')], Date.parse('2026-09-26T12:00:00Z'));
  assert.equal(isFinal(satEarly), false);
  // ...and refetched once the day is over.
  assert.equal(needsRefresh(satEarly, NOW), true);
  // Fetched after Saturday ended: final.
  assert.equal(isFinal(snap('2026-09-26', [row('TRY', 55.8, '2026-09-25')], Date.parse('2026-09-27T01:00:00Z'))), true);
  // Today before ECB publication: refresh after 6 h, not before.
  const today = snap('2026-09-29', [row('TRY', 55.7, '2026-09-28')], NOW - 2 * HOUR);
  assert.equal(needsRefresh(today, NOW), false);
  assert.equal(needsRefresh(today, NOW + 5 * HOUR), true);
  // The ECB date governs, not a blended row published for the day itself.
  const mixed = snap('2026-09-26', [row('TRY', 55.8, '2026-09-25'), row('AED', 4.18, '2026-09-26', 'frankfurter')], Date.parse('2026-09-26T12:00:00Z'));
  assert.equal(isFinal(mixed), false);
});

test('encodeSource / decodeSource round-trip, reject unknown providers', () => {
  const r = row('TRY', 55.7, '2026-09-25');
  assert.equal(encodeSource(r, '2026-09-25'), 'frankfurter-ecb');
  assert.equal(encodeSource(r, '2026-09-26'), 'frankfurter-ecb@2026-09-25');
  assert.deepEqual(decodeSource('frankfurter-ecb@2026-09-25', '2026-09-26'), { source: 'frankfurter-ecb', publishedDate: '2026-09-25' });
  assert.deepEqual(decodeSource('currency-api', '2026-09-26'), { source: 'currency-api', publishedDate: '2026-09-26' });
  assert.equal(decodeSource('google', '2026-09-26'), null);
  assert.equal(decodeSource('frankfurter@yesterday', '2026-09-26'), null);
});

test('parseFrankfurterV2 keeps EUR-based, well-formed, not-future rows', () => {
  const rows = parseFrankfurterV2(
    [
      { date: '2026-09-25', base: 'EUR', quote: 'TRY', rate: 55.7975 },
      { date: '2026-09-25', base: 'USD', quote: 'TRY', rate: 49 },
      { date: '2026-09-25', base: 'EUR', quote: 'try', rate: 1 },
      { date: '2026-09-27', base: 'EUR', quote: 'USD', rate: 1.1 },
      { date: '2026-09-25', base: 'EUR', quote: 'GBP', rate: 0 },
      { date: '2026-09-25', base: 'EUR', quote: 'EUR', rate: 1 },
      null,
    ],
    'frankfurter-ecb',
    '2026-09-26',
  );
  assert.deepEqual(rows, [row('TRY', 55.7975, '2026-09-25')]);
  assert.deepEqual(parseFrankfurterV2({ message: 'x' }, 'frankfurter', '2026-09-26'), []);
});

test('parseCurrencyApi upper-cases, drops crypto/unknown codes, clamps a future date', () => {
  const rows = parseCurrencyApi(
    { date: '2026-09-27', eur: { try: 55.9, usd: 1.14, btc: 0.00001, ada: 4.6, eur: 1 } },
    '2026-09-26',
    new Set(['TRY', 'USD']),
  );
  assert.deepEqual(rows, [
    { quote: 'TRY', rate: 55.9, source: 'currency-api', publishedDate: '2026-09-26' },
    { quote: 'USD', rate: 1.14, source: 'currency-api', publishedDate: '2026-09-26' },
  ]);
});

test('mergeRows prefers ECB > blend > currency-api; crossRate/effectiveDate', () => {
  const merged = mergeRows(
    [row('AED', 4.19, '2026-09-26', 'frankfurter'), row('TRY', 55.75, '2026-09-26', 'frankfurter')],
    [row('TRY', 55.7975, '2026-09-25')],
    [row('TRY', 56, '2026-09-26', 'currency-api')],
  );
  assert.equal(merged.get('TRY')?.source, 'frankfurter-ecb');
  assert.equal(merged.get('AED')?.source, 'frankfurter');
  assert.equal(crossRate(merged, 'EUR', 'TRY'), 55.7975);
  assert.equal(crossRate(merged, 'TRY', 'EUR'), 1 / 55.7975);
  assert.equal(crossRate(merged, 'TRY', 'AED'), 4.19 / 55.7975);
  assert.equal(crossRate(merged, 'TRY', 'XYZ'), null);
  assert.equal(effectiveDate(merged, ['EUR', 'TRY', 'AED']), '2026-09-25');
});

test('pastDayRowsToKeep: ECB rows, any ECB-set code, and the requested codes only', () => {
  const kept = pastDayRowsToKeep(
    [
      row('TRY', 55.7, '2026-09-25'),
      row('BGN', 1.95, '2025-06-02'), // historical ECB row outside today's ECB set
      row('USD', 1.14, '2026-09-25', 'frankfurter'), // ECB-set code from the blend (ECB call failed)
      row('AED', 4.18, '2026-09-25', 'frankfurter'), // requested
      row('VND', 29548, '2026-09-25', 'frankfurter'), // not requested
      row('GEL', 3.1, '2026-09-25', 'currency-api'), // not requested
    ],
    new Set(['AED', 'TRY']),
  );
  assert.deepEqual(kept.map((r) => r.quote).sort(), ['AED', 'BGN', 'TRY', 'USD']);
  assert.equal(ECB_CODES.size, 29);
  assert.ok(!ECB_CODES.has('EUR'));
});

test('planFill: nothing cached / stale -> full; today re-asks a missing code hourly; a past day tops up unless known absent', () => {
  const none = () => false;
  const today = snap('2026-09-29', [row('TRY', 55.7, '2026-09-29')], NOW - 10 * 60_000);
  const past = snap('2026-09-28', [row('TRY', 55.7, '2026-09-28')], NOW - 10 * 60_000);
  assert.equal(planFill(null, ['TRY'], true, NOW, none), 'full');
  assert.equal(planFill(today, ['TRY'], true, NOW, none), null);
  assert.equal(planFill(today, ['AED'], true, NOW, none), null, 'today is stored whole: 10 min is too soon');
  assert.equal(planFill(today, ['AED'], true, NOW + HOUR, none), 'full');
  assert.equal(planFill(today, ['AED'], true, NOW + 7 * HOUR, none), 'full', '6 h refresh');
  assert.equal(planFill(past, ['TRY'], false, NOW, none), null);
  assert.equal(planFill(past, ['AED'], false, NOW, none), 'topup', 'not stored yet: top up now');
  assert.equal(planFill(past, ['AED'], false, NOW, (c) => c === 'AED'), null, 'upstream just said no');
  assert.equal(planFill(past, ['AED', 'GEL'], false, NOW, (c) => c === 'AED'), 'topup');
  const satEarly = snap('2026-09-26', [row('TRY', 55.8, '2026-09-25')], Date.parse('2026-09-26T12:00:00Z'));
  assert.equal(planFill(satEarly, ['TRY'], false, NOW, none), 'full', 'a non-final day settles');
});

test('rowsToSnapshot decodes sources, parses numeric strings, uses the NEWEST fetched_at', () => {
  const s = rowsToSnapshot('2026-09-26', [
    { quote: 'TRY', rate: '55.7975', source: 'frankfurter-ecb@2026-09-25', fetched_at: '2026-09-27T01:00:00Z' },
    { quote: 'USD', rate: 1.14, source: 'frankfurter-ecb@2026-09-25', fetched_at: '2026-09-26T09:00:00Z' },
    { quote: 'BAD', rate: -1, source: 'frankfurter', fetched_at: '2026-09-27T01:00:00Z' },
    { quote: 'XXX', rate: 1, source: 'mystery', fetched_at: '2026-09-27T01:00:00Z' },
  ]);
  assert.ok(s);
  assert.equal(s!.rows.size, 2);
  assert.equal(s!.rows.get('TRY')?.rate, 55.7975);
  assert.equal(s!.rows.get('TRY')?.publishedDate, '2026-09-25');
  assert.equal(s!.fetchedAt, Date.parse('2026-09-27T01:00:00Z'));
  assert.equal(rowsToSnapshot('2026-09-26', []), null);
});

// ---------------------------------------------------------------------------
// Handler over fake deps
// ---------------------------------------------------------------------------

interface Call {
  url: string;
  headers: Headers;
}

interface WorldOpts {
  now?: number;
  /** date -> snapshot already cached */
  cached?: Record<string, Snapshot>;
  ecb?: (date: string) => { status: number; body?: unknown };
  blend?: (date: string) => { status: number; body?: unknown };
  currencyApi?: (tag: string) => { status: number; body?: unknown };
  userFills?: UsageOutcome;
  service?: Record<string, UsageOutcome>;
}

function ecbTable(date: string, publishedFor = date) {
  return [
    { date: publishedFor, base: 'EUR', quote: 'TRY', rate: 55.7318 },
    { date: publishedFor, base: 'EUR', quote: 'USD', rate: 1.1378 },
    { date: publishedFor, base: 'EUR', quote: 'GBP', rate: 0.85785 },
  ];
}
function blendTable(date: string) {
  return [
    { date, base: 'EUR', quote: 'TRY', rate: 55.74 },
    { date, base: 'EUR', quote: 'AED', rate: 4.1849 },
  ];
}
/** A realistic blend: every ECB code + 40 others (the live one has ~166). */
const WIDE_EXTRA = [
  'AED', 'ALL', 'AMD', 'ARS', 'AZN', 'BAM', 'BDT', 'BHD', 'BOB', 'BYN', 'CLP', 'COP', 'CRC', 'DOP', 'DZD', 'EGP', 'GEL', 'GHS',
  'GTQ', 'IQD', 'JOD', 'KES', 'KWD', 'KZT', 'LBP', 'LKR', 'MAD', 'MDL', 'MKD', 'NGN', 'OMR', 'PEN', 'PKR', 'QAR', 'RSD', 'SAR',
  'TND', 'TWD', 'UAH', 'VND',
];
function wideBlend(date: string) {
  return [...ECB_CODES, ...WIDE_EXTRA].map((quote, i) => ({ date, base: 'EUR', quote, rate: 1 + i / 10 }));
}
function wideEcb(date: string) {
  return [...ECB_CODES].map((quote, i) => ({ date, base: 'EUR', quote, rate: 2 + i / 10 }));
}

function world(opts: WorldOpts = {}) {
  const calls: Call[] = [];
  const store = new Map<string, Snapshot>(Object.entries(opts.cached ?? {}));
  const saves: Array<{ date: string; rows: RateRow[] }> = [];
  const consumed: Array<{ service: string; units: number; cap: number }> = [];
  const userFillCaps: number[] = [];
  let userFillCalls = 0;
  let now = opts.now ?? NOW;
  const respond = (r: { status: number; body?: unknown }) =>
    new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { 'content-type': 'application/json' } });

  const deps: FxDeps = {
    loadSnapshot: (date: string) => Promise.resolve({ snapshot: store.get(date) ?? null, error: null }),
    loadLatestBefore: (before: string, min: string) => {
      const days = [...store.keys()].filter((d) => d < before && d >= min).sort().reverse();
      return Promise.resolve({ snapshot: days[0] ? store.get(days[0])! : null, error: null });
    },
    saveSnapshot: (date: string, rows: RateRow[], fetchedAtIso: string) => {
      saves.push({ date, rows });
      // Upsert semantics (like fx_rates): merge into the day, never delete.
      const day = new Map(store.get(date)?.rows ?? []);
      for (const r of rows) day.set(r.quote, r);
      store.set(date, { date, rows: day, fetchedAt: Date.parse(fetchedAtIso) });
      return Promise.resolve({ error: null });
    },
    consumeService: (service: string, units: number, cap: number) => {
      consumed.push({ service, units, cap });
      return Promise.resolve(opts.service?.[service] ?? 'ok');
    },
    consumeUserFills: (_userId: string, cap: number) => {
      userFillCalls++;
      userFillCaps.push(cap);
      return Promise.resolve(opts.userFills ?? 'ok');
    },
    fetch: (input: string, init?: RequestInit) => {
      calls.push({ url: input, headers: new Headers(init?.headers) });
      const u = new URL(input);
      const date = u.searchParams.get('date') ?? '';
      if (input.includes('/v2/providers/ecb/rates')) return Promise.resolve(respond(opts.ecb?.(date) ?? { status: 200, body: ecbTable(date) }));
      if (input.includes('/v2/rates')) return Promise.resolve(respond(opts.blend?.(date) ?? { status: 200, body: blendTable(date) }));
      if (input.includes('currency-api@')) {
        const tag = input.split('currency-api@')[1]!.split('/')[0]!;
        return Promise.resolve(respond(opts.currencyApi?.(tag) ?? { status: 404 }));
      }
      return Promise.resolve(respond({ status: 404 }));
    },
    now: () => now,
    contact: 'https://example.test/contact',
  };
  return {
    handler: createHandler(deps),
    calls,
    saves,
    consumed,
    store,
    userFillCaps,
    get userFillCalls() {
      return userFillCalls;
    },
    setNow(t: number) {
      now = t;
    },
  };
}

function post(body: unknown, token = USER_JWT): Request {
  return new Request('http://localhost/fx-rates', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// deno-lint-ignore no-explicit-any -- test helper reads loosely-typed JSON bodies
async function json(res: Response): Promise<any> {
  return await res.json();
}

test('?ping is public; PUT is 405; missing/invalid token is 401', async () => {
  const w = world();
  const ping = await w.handler(new Request('http://localhost/fx-rates?ping'));
  assert.equal(ping.status, 200);
  assert.deepEqual(await json(ping), { ok: true, fn: 'fx-rates' });
  assert.equal((await w.handler(new Request('http://localhost/', { method: 'PUT' }))).status, 405);
  const noAuth = await w.handler(new Request('http://localhost/', { method: 'POST', body: '{}' }));
  assert.equal(noAuth.status, 401);
  assert.equal((await w.handler(post({}, 'bad'))).status, 401);
  assert.equal(w.calls.length, 0);
});

test('invalid input is 400 without any upstream call', async () => {
  const w = world();
  for (const body of [{ base: 'EURO' }, { date: '2026-13-01' }, { quotes: 'TRY' }, { from: 'EUR', base: 'USD' }, { nope: 1 }]) {
    const res = await w.handler(post(body));
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal((await json(res)).error.code, 'invalid_input');
  }
  assert.equal(w.calls.length, 0);
});

test('cache miss: fills ECB + blend once, stores the day, answers the pair with contract meta', async () => {
  const w = world();
  const res = await w.handler(post({ from: 'EUR', to: 'TRY' }));
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.base, 'EUR');
  assert.equal(body.date, '2026-09-29');
  assert.equal(body.rate, 55.7318); // ECB wins over the blend's 55.74
  assert.deepEqual(body.rates, { TRY: 55.7318 });
  assert.equal(body.source, 'frankfurter-ecb');
  assert.equal(body.stale, false);
  assert.deepEqual(body.meta, { contractVersion: 1, cache: 'miss' });
  // Exactly the two v2 endpoints, each with the requested date and our User-Agent.
  assert.deepEqual(
    w.calls.map((c) => c.url).sort(),
    [
      'https://api.frankfurter.dev/v2/providers/ecb/rates?date=2026-09-29',
      'https://api.frankfurter.dev/v2/rates?date=2026-09-29',
    ],
  );
  for (const c of w.calls) assert.equal(c.headers.get('User-Agent'), 'Tripvisor/1.0 (https://example.test/contact) fx-rates');
  assert.equal(w.saves.length, 1);
  assert.deepEqual(w.saves[0]!.rows.map((r) => r.quote).sort(), ['AED', 'GBP', 'TRY', 'USD']);
  assert.deepEqual(w.consumed, [{ service: 'frankfurter', units: 2, cap: 600 }]);
  assert.equal(w.userFillCalls, 1);
  assert.deepEqual(w.userFillCaps, [20], 'per-user fill cap is 20/day (Wave-1 review #8)');

  // Same day again: served from cache, no upstream, no quota.
  const again = await w.handler(post({ from: 'EUR', to: 'TRY' }));
  assert.equal((await json(again)).meta.cache, 'hit');
  assert.equal(w.calls.length, 2);
  assert.equal(w.userFillCalls, 1);
});

test('weekend date resolves to the previous business day (rateDate) and is cached under the requested date', async () => {
  const w = world({ ecb: (d) => ({ status: 200, body: ecbTable(d, '2026-09-25') }), blend: () => ({ status: 200, body: [] }) });
  const res = await w.handler(new Request('http://localhost/?date=2026-09-26&from=TRY&to=EUR', { headers: { Authorization: `Bearer ${USER_JWT}` } }));
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.date, '2026-09-26');
  assert.equal(body.rateDate, '2026-09-25');
  assert.equal(body.rate, 1 / 55.7318);
  assert.equal(w.saves[0]!.date, '2026-09-26');
  assert.equal(w.saves[0]!.rows[0]!.publishedDate, '2026-09-25');
  assert.equal(res.headers.get('Cache-Control'), 'private, max-age=86400');
});

test('table mode relative to a non-EUR base, with missing quotes listed', async () => {
  const w = world();
  const body = await json(await w.handler(post({ date: '2026-09-28', base: 'TRY', quotes: ['usd', 'EUR', 'XYZ'] })));
  assert.equal(body.base, 'TRY');
  assert.equal(body.rates.USD, 1.1378 / 55.7318);
  assert.equal(body.rates.EUR, 1 / 55.7318);
  assert.deepEqual(body.missing, ['XYZ']);
  assert.equal(body.rate, undefined);
});

test('full table: no quotes = every known code against the base', async () => {
  const w = world();
  const body = await json(await w.handler(post({ base: 'USD' })));
  assert.deepEqual(Object.keys(body.rates).sort(), ['AED', 'EUR', 'GBP', 'TRY']);
  assert.equal(body.source, 'mixed');
});

test('unknown base / all quotes unknown -> 422 unsupported_currency', async () => {
  const w = world();
  const a = await w.handler(post({ base: 'XYZ' }));
  assert.equal(a.status, 422);
  assert.equal((await json(a)).error.code, 'unsupported_currency');
  const b = await w.handler(post({ quotes: ['XYZ'] }));
  assert.equal(b.status, 422);
});

test("today: a code missing from the (whole) cached table refetches at most once an hour", async () => {
  const cached = snap('2026-09-29', [row('TRY', 55.7, '2026-09-29'), row('USD', 1.13, '2026-09-29')], NOW - 10 * 60_000);
  const w = world({ cached: { '2026-09-29': cached } });
  // Fresh (10 min old) and final: AED is simply unsupported for now, no upstream.
  const res = await w.handler(post({ to: 'AED' }));
  assert.equal(res.status, 422);
  assert.equal(w.calls.length, 0);
  // An hour later the partial day heals from upstream (the blend has AED).
  w.setNow(NOW + 2 * HOUR);
  const healed = await json(await w.handler(post({ to: 'AED' })));
  assert.equal(healed.rate, 4.1849);
  assert.equal(healed.source, 'frankfurter');
  assert.equal(w.calls.length, 2);
});

// ---------------------------------------------------------------------------
// Past days store the ECB set + requested codes only (Wave-1 review #8)
// ---------------------------------------------------------------------------

test('past day, ECB codes only: one ECB call, ~29 rows stored, not the 69-code blend', async () => {
  const w = world({ ecb: (d) => ({ status: 200, body: wideEcb(d) }), blend: (d) => ({ status: 200, body: wideBlend(d) }) });
  const res = await w.handler(post({ date: '2026-09-24', from: 'TRY', to: 'USD' }));
  assert.equal(res.status, 200);
  assert.deepEqual(w.calls.map((c) => c.url), ['https://api.frankfurter.dev/v2/providers/ecb/rates?date=2026-09-24']);
  assert.deepEqual(w.consumed, [{ service: 'frankfurter', units: 1, cap: 600 }]);
  assert.equal(w.saves.length, 1);
  assert.equal(w.saves[0]!.rows.length, 29);
  assert.ok(w.saves[0]!.rows.every((r) => r.source === 'frankfurter-ecb'));
});

test('past day with a non-ECB code: ECB + blend, stores the ECB set + that code only; the answer still uses everything fetched', async () => {
  const w = world({ ecb: (d) => ({ status: 200, body: wideEcb(d) }), blend: (d) => ({ status: 200, body: wideBlend(d) }) });
  const body = await json(await w.handler(post({ date: '2026-09-24', base: 'TRY', quotes: ['AED', 'GEL'] })));
  assert.ok(body.rates.AED > 0 && body.rates.GEL > 0);
  assert.equal(w.calls.length, 2);
  assert.deepEqual(w.consumed, [{ service: 'frankfurter', units: 2, cap: 600 }]);
  const stored = w.saves[0]!.rows.map((r) => r.quote);
  assert.equal(stored.length, 29 + 2, `stored ${stored.length}: ${stored.join(',')}`);
  assert.ok(stored.includes('AED') && stored.includes('GEL') && stored.includes('TRY'));
  assert.ok(!stored.includes('VND') && !stored.includes('KZT'), 'unrequested blend codes are not stored');
  // TRY comes from the ECB, not the blend.
  assert.equal(w.saves[0]!.rows.find((r) => r.quote === 'TRY')!.source, 'frankfurter-ecb');
});

test('past day, ECB-only plan but the ECB call fails: the blend answers, ECB-set codes + request stored', async () => {
  const w = world({ ecb: () => ({ status: 503 }), blend: (d) => ({ status: 200, body: wideBlend(d) }) });
  const body = await json(await w.handler(post({ date: '2026-09-24', to: 'TRY' })));
  assert.ok(body.rate > 0);
  assert.equal(body.source, 'frankfurter');
  assert.deepEqual(w.consumed, [
    { service: 'frankfurter', units: 1, cap: 600 },
    { service: 'frankfurter', units: 1, cap: 600 },
  ]);
  assert.equal(w.saves[0]!.rows.length, 29);
});

test('past day top-up: a code not stored yet costs one blend call, appends only that code, keeps the ECB rows', async () => {
  const cached = snap('2026-09-24', [row('TRY', 55.7, '2026-09-24'), row('USD', 1.13, '2026-09-24')], Date.parse('2026-09-25T08:00:00Z'));
  const w = world({ cached: { '2026-09-24': cached }, blend: (d) => ({ status: 200, body: wideBlend(d) }) });
  const res = await w.handler(post({ date: '2026-09-24', from: 'TRY', to: 'AED' }));
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.meta.cache, 'miss');
  assert.equal(body.rate, (1 + WIDE_EXTRA.indexOf('AED') / 10 + ECB_CODES.size / 10) / 55.7, 'AED from the blend over the cached ECB TRY');
  assert.deepEqual(w.calls.map((c) => c.url), ['https://api.frankfurter.dev/v2/rates?date=2026-09-24']);
  assert.deepEqual(w.consumed, [{ service: 'frankfurter', units: 1, cap: 600 }]);
  assert.equal(w.userFillCalls, 1, 'a top-up is a metered fill');
  assert.deepEqual(w.saves.map((s) => s.rows.map((r) => r.quote)), [['AED']]);
  assert.equal(w.store.get('2026-09-24')!.rows.get('TRY')!.source, 'frankfurter-ecb', 'the ECB row is not overwritten');
  // Now cached: no more upstream.
  const again = await json(await w.handler(post({ date: '2026-09-24', from: 'TRY', to: 'AED' })));
  assert.equal(again.meta.cache, 'hit');
  assert.equal(w.calls.length, 1);
});

test('past day: a code upstream lacks is asked once, then not again for an hour (per isolate)', async () => {
  const cached = snap('2026-09-24', [row('TRY', 55.7, '2026-09-24')], Date.parse('2026-09-25T08:00:00Z'));
  const w = world({ cached: { '2026-09-24': cached } });
  const first = await w.handler(post({ date: '2026-09-24', to: 'XYZ' }));
  assert.equal(first.status, 422);
  assert.equal((await json(first)).error.code, 'unsupported_currency');
  assert.equal(w.calls.length, 1);
  const second = await w.handler(post({ date: '2026-09-24', to: 'XYZ' }));
  assert.equal(second.status, 422);
  await second.body?.cancel();
  assert.equal(w.calls.length, 1, 'remembered as absent');
  assert.equal(w.userFillCalls, 1);
  w.setNow(NOW + 2 * HOUR);
  await (await w.handler(post({ date: '2026-09-24', to: 'XYZ' }))).body?.cancel();
  assert.equal(w.calls.length, 2, 'asked again after an hour');
});

test('past day top-up refused or failing: 429 / 503, never a permanent 422', async () => {
  const cached = snap('2026-09-24', [row('TRY', 55.7, '2026-09-24')], Date.parse('2026-09-25T08:00:00Z'));
  const quota = world({ cached: { '2026-09-24': cached }, userFills: 'exceeded' });
  const q = await quota.handler(post({ date: '2026-09-24', from: 'TRY', to: 'AED' }));
  assert.equal(q.status, 429);
  assert.equal((await json(q)).error.code, 'quota_exceeded');
  // ...while a cached pair on the same day is still served.
  const ok = await quota.handler(post({ date: '2026-09-24', to: 'TRY' }));
  assert.equal(ok.status, 200);
  await ok.body?.cancel();

  const down = world({ cached: { '2026-09-24': cached }, blend: () => ({ status: 500 }) });
  const d = await down.handler(post({ date: '2026-09-24', from: 'TRY', to: 'AED' }));
  assert.equal(d.status, 503);
  assert.equal((await json(d)).error.code, 'rates_unavailable');
  assert.equal(down.saves.length, 0);
  // Upstream failure is not proof of absence: the next request tries again.
  await (await down.handler(post({ date: '2026-09-24', from: 'TRY', to: 'AED' }))).body?.cancel();
  assert.equal(down.calls.filter((c) => c.url.includes('/v2/rates')).length, 4);
});

test('today is still stored whole', async () => {
  const w = world({ ecb: (d) => ({ status: 200, body: wideEcb(d) }), blend: (d) => ({ status: 200, body: wideBlend(d) }) });
  await (await w.handler(post({ to: 'TRY' }))).body?.cancel();
  assert.equal(w.saves[0]!.rows.length, 29 + WIDE_EXTRA.length);
});

test('both Frankfurter calls fail -> currency-api fallback (filtered to ISO codes)', async () => {
  const w = world({
    ecb: () => ({ status: 503 }),
    blend: () => ({ status: 503 }),
    currencyApi: (tag) => ({ status: 200, body: { date: tag === 'latest' ? '2026-09-29' : tag, eur: { try: 56.1, btc: 0.00001 } } }),
  });
  const body = await json(await w.handler(post({ to: 'TRY' })));
  assert.equal(body.rate, 56.1);
  assert.equal(body.source, 'currency-api');
  assert.ok(w.calls.some((c) => c.url === 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.min.json'));
  // 5xx is retried once per endpoint (rule 7), then the fallback.
  assert.equal(w.calls.filter((c) => c.url.includes('frankfurter')).length, 4);
  assert.deepEqual(w.saves[0]!.rows.map((r) => r.quote), ['TRY']);
});

test('Frankfurter over its global budget goes straight to the fallback', async () => {
  const w = world({ service: { frankfurter: 'exceeded' }, currencyApi: () => ({ status: 200, body: { date: '2026-09-28', eur: { try: 56 } } }) });
  const body = await json(await w.handler(post({ date: '2026-09-28', to: 'TRY' })));
  assert.equal(body.rate, 56);
  assert.equal(w.calls.filter((c) => c.url.includes('frankfurter')).length, 0);
  assert.ok(w.calls[0]!.url.includes('currency-api@2026-09-28'));
});

test('upstream down: newest cached day within 7 days is served as stale; nothing -> 503', async () => {
  const older = snap('2026-09-25', [row('TRY', 55.8, '2026-09-25')], NOW - 50 * HOUR);
  const down = { ecb: () => ({ status: 500 }), blend: () => ({ status: 500 }) };
  const w = world({ ...down, cached: { '2026-09-25': older } });
  const res = await w.handler(post({ to: 'TRY' }));
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.stale, true);
  assert.equal(body.rateDate, '2026-09-25');
  assert.equal(body.meta.cache, 'stale');
  assert.equal(body.rate, 55.8);

  const none = world(down);
  const res2 = await none.handler(post({ to: 'TRY' }));
  assert.equal(res2.status, 503);
  assert.equal((await json(res2)).error.code, 'rates_unavailable');
});

test('per-user fill quota: 429 when nothing is cached, cached data still served; unavailable fails closed', async () => {
  const w = world({ userFills: 'exceeded' });
  const res = await w.handler(post({ to: 'TRY' }));
  assert.equal(res.status, 429);
  const body = await json(res);
  assert.equal(body.error.code, 'quota_exceeded');
  assert.equal(body.error.kind, 'fx_fills');
  assert.ok(Number(res.headers.get('Retry-After')) > 0);
  assert.equal(w.calls.length, 0);

  // Stale-but-present today (7 h old) + exhausted quota: serve what we have.
  const cached = snap('2026-09-29', [row('TRY', 55.7, '2026-09-28')], NOW - 7 * HOUR);
  const w2 = world({ userFills: 'exceeded', cached: { '2026-09-29': cached } });
  const ok = await w2.handler(post({ to: 'TRY' }));
  assert.equal(ok.status, 200);
  assert.equal((await json(ok)).rate, 55.7);
  assert.equal(w2.calls.length, 0);

  const w3 = world({ userFills: 'unavailable' });
  const res3 = await w3.handler(post({ to: 'TRY' }));
  assert.equal(res3.status, 503);
  assert.equal((await json(res3)).error.code, 'quota_unavailable');
});

test('concurrent requests for one date share a single upstream fill', async () => {
  const w = world();
  const [a, b, c] = await Promise.all([
    w.handler(post({ date: '2026-09-24', to: 'TRY' })),
    w.handler(post({ date: '2026-09-24', to: 'USD' })),
    w.handler(post({ date: '2026-09-24', to: 'GBP' })),
  ]);
  assert.deepEqual([a.status, b.status, c.status], [200, 200, 200]);
  for (const r of [a, b, c]) await r.body?.cancel();
  // All ECB codes on a past day: one ECB call, one quota charge.
  assert.equal(w.calls.length, 1);
  assert.equal(w.userFillCalls, 1);
});

test('a request that joined a fill planned for other codes tops up its own code', async () => {
  const w = world({ ecb: (d) => ({ status: 200, body: wideEcb(d) }), blend: (d) => ({ status: 200, body: wideBlend(d) }) });
  const [a, b] = await Promise.all([
    w.handler(post({ date: '2026-09-24', to: 'TRY' })), // ECB-only plan (initiator)
    w.handler(post({ date: '2026-09-24', to: 'AED' })), // joins, then needs the blend
  ]);
  assert.equal(a.status, 200);
  await a.body?.cancel();
  assert.equal(b.status, 200);
  assert.ok((await json(b)).rate > 0);
  assert.deepEqual(
    w.calls.map((c) => c.url),
    ['https://api.frankfurter.dev/v2/providers/ecb/rates?date=2026-09-24', 'https://api.frankfurter.dev/v2/rates?date=2026-09-24'],
  );
  assert.equal(w.userFillCalls, 2, 'the joiner paid for its own top-up');
  assert.deepEqual(w.saves[1]!.rows.map((r) => r.quote), ['AED']);
});

test('currencies action lists EUR + every cached code with the ECB flag', async () => {
  const w = world();
  const body = await json(await w.handler(post({ action: 'currencies' })));
  assert.deepEqual(body.currencies, [
    { code: 'AED', ecb: false },
    { code: 'EUR', ecb: true },
    { code: 'GBP', ecb: true },
    { code: 'TRY', ecb: true },
    { code: 'USD', ecb: true },
  ]);
  assert.equal(body.meta.contractVersion, 1);
});
