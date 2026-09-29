// poi-recommend — Deno tests (pure geo/interests/poi/wiki modules + the
// handler over fake deps and a fake upstream `fetch`).
//
// Run with:
//   deno test --allow-env --allow-net=127.0.0.1 supabase/functions/poi-recommend/index.test.ts
//
// node:test / node:assert like _shared/auth.test.ts, so the repo-level tsc
// resolves them through @types/node; `.ts` imports carry @ts-ignore for it.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore -- Deno `.ts`-suffixed import (unresolvable under the Expo tsconfig)
import { _setTokenVerifierForTests } from '../_shared/auth.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { interestWeight, matchInterests, qlCondition, qlFiltersFor } from '../_shared/interests.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { geohashBbox, geohashEncode, haversineM, tilesForCircle } from './geo.ts';
import {
  _resetPoiStateForTests,
  classify,
  clampRadius,
  createHandler,
  instanceBudget,
  LOG_AREA_PRECISION,
  normalizeLang,
  type PoiDeps,
  tileKey,
  type UsageOutcome,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from './handler.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { parseOverpassUrls } from './deps.ts';
import {
  buildOverpassQuery,
  displayName,
  type OsmPoi,
  parseOverpassResponse,
  primaryKind,
  rankPois,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from './poi.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { parseExtracts, parseGeoSearch, parseSitelinks, sitelinksUrl } from './wiki.ts';

const USER = '00000000-0000-4000-8000-0000000000b2';
_setTokenVerifierForTests((token: string) =>
  Promise.resolve(token === 'bad' ? { ok: false, status: 401, code: 'not_authenticated', message: 'nope' } : { ok: true, userId: USER }),
);
function seg(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const USER_JWT = `${seg({ alg: 'HS256' })}.${seg({ sub: USER, role: 'authenticated' })}.sig`;

// Sultanahmet (Blue Mosque square), Istanbul.
const LAT = 41.0054;
const LNG = 28.9768;
const NOW = Date.parse('2026-09-29T10:00:00Z');
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Pure modules
// ---------------------------------------------------------------------------

test('geohash: encode/bbox agree; Sultanahmet is tile sxk97', () => {
  assert.equal(geohashEncode(LAT, LNG, 5), 'sxk97');
  const b = geohashBbox('sxk97');
  assert.ok(b.s <= LAT && LAT <= b.n && b.w <= LNG && LNG <= b.e);
  assert.ok(Math.abs(b.n - b.s - 0.0439453125) < 1e-12);
  assert.equal(geohashEncode(57.64911, 10.40744, 11), 'u4pruydqqvj'); // the Wikipedia example
  assert.throws(() => geohashBbox('sxka'));
});

test('tilesForCircle: nearest tile first, drops corners the circle misses, grows with radius', () => {
  const small = tilesForCircle(LAT, LNG, 100);
  assert.deepEqual(small, ['sxk97']);
  const mid = tilesForCircle(LAT, LNG, 1500);
  assert.equal(mid[0], 'sxk97');
  assert.equal(mid.length, 4);
  const big = tilesForCircle(LAT, LNG, 5000);
  assert.ok(big.length > mid.length && big.length <= 16);
  for (const t of big) {
    const b = geohashBbox(t);
    const cLat = Math.min(Math.max(LAT, b.s), b.n);
    const cLng = Math.min(Math.max(LNG, b.w), b.e);
    assert.ok(haversineM(LAT, LNG, cLat, cLng) <= 5000);
  }
});

test('interests: filters need a name, match by AND within a filter, OR across filters', () => {
  assert.equal(interestWeight({ historic: 'castle' }, 'history'), 0);
  assert.equal(interestWeight({ historic: 'castle', name: 'Rumeli Hisarı' }, 'history'), 0.9);
  assert.equal(interestWeight({ historic: 'cistern', tourism: 'attraction', name: 'Yerebatan' }, 'history'), 0.8);
  assert.equal(interestWeight({ man_made: 'tower', name: 'Water tower' }, 'viewpoints'), 0);
  assert.equal(interestWeight({ man_made: 'tower', 'tower:type': 'observation', name: 'Galata' }, 'viewpoints'), 0.9);
  assert.deepEqual(
    matchInterests({ amenity: 'marketplace', name: 'Mısır Çarşısı' }).map((m) => m.interest),
    ['food', 'shopping'],
  );
  assert.equal(qlCondition('amenity', ['bar', 'pub']), '["amenity"~"^(bar|pub)$"]');
  assert.equal(qlCondition('heritage', true), '["heritage"]');
  assert.equal(qlCondition('na"me', 'x\\y'), '["na\\"me"="x\\\\y"]');
  for (const f of qlFiltersFor('food')) assert.ok(f.endsWith('["name"]'));
});

test('buildOverpassQuery: server timeout, bbox per block, notable-first caps', () => {
  const q = buildOverpassQuery([{ tile: 'sxk97', interest: 'viewpoints' }], { serverTimeoutS: 12 });
  assert.ok(q.startsWith('[out:json][timeout:12][maxsize:33554432];'));
  assert.ok(q.includes('nwr["tourism"="viewpoint"]["name"](41.0009766,28.9599609,41.0449219,29.0039063);'));
  assert.ok(q.includes('rel.b->.br;'));
  assert.ok(q.includes('.br out tags center 20;'));
  assert.ok(q.includes('.bw out tags center 40;'));
  assert.ok(q.includes('.bn out tags center 30;'));
  assert.ok(q.includes('.c out tags center 60;'));
});

test('parseOverpassResponse: trims tags, needs a name + coords, dedupes, rejects runtime-error remarks', () => {
  const pois = parseOverpassResponse({
    elements: [
      { type: 'node', id: 1, lat: 41.1, lon: 29.1, tags: { name: 'A', amenity: 'cafe', phone: '+90', 'addr:street': 'x' } },
      { type: 'way', id: 2, center: { lat: 41.2, lon: 29.2 }, tags: { name: 'B', historic: 'castle', wikidata: 'Q1' } },
      { type: 'node', id: 1, lat: 41.1, lon: 29.1, tags: { name: 'A dup', amenity: 'cafe' } },
      { type: 'node', id: 3, lat: 41.3, lon: 29.3, tags: { amenity: 'cafe' } },
      { type: 'way', id: 4, tags: { name: 'no geometry' } },
      { type: 'area', id: 5, lat: 1, lon: 1, tags: { name: 'x' } },
    ],
  });
  assert.deepEqual(pois, [
    { type: 'node', id: 1, lat: 41.1, lon: 29.1, tags: { name: 'A', amenity: 'cafe' } },
    { type: 'way', id: 2, lat: 41.2, lon: 29.2, tags: { name: 'B', historic: 'castle', wikidata: 'Q1' } },
  ]);
  assert.throws(() => parseOverpassResponse({ elements: [], remark: 'runtime error: Query timed out in "query" at line 3' }));
  assert.throws(() => parseOverpassResponse('<html>'));
});

function poi(id: number, lat: number, lon: number, tags: Record<string, string>, type: OsmPoi['type'] = 'node'): OsmPoi {
  return { type, id, lat, lon, tags };
}

test('rankPois: radius filter, notability > distance > tag weight, fair share across interests', () => {
  const near = 0.002; // ~220 m north
  const pois = [
    poi(1, LAT + near, LNG, { name: 'Castle', historic: 'castle', wikidata: 'Q1' }),
    poi(2, LAT + near / 4, LNG, { name: 'Plaque', historic: 'memorial' }),
    poi(3, LAT + near, LNG, { name: 'Tomb', historic: 'tomb', wikidata: 'Q3' }),
    poi(4, LAT + near / 2, LNG, { name: 'Lokanta', amenity: 'restaurant', cuisine: 'turkish' }),
    poi(5, LAT + 0.05, LNG, { name: 'Far castle', historic: 'castle', wikidata: 'Q5' }), // ~5.5 km
    poi(6, LAT + near, LNG, { name: 'Pub', amenity: 'pub' }), // not requested
  ];
  const ranked = rankPois(pois, { lat: LAT, lng: LNG, radiusM: 1500, interests: ['history', 'food'], limit: 2 });
  // limit 2 with two interests: the best of each, even though Tomb outscores Lokanta.
  assert.deepEqual(ranked.map((r) => r.poi.id), [1, 4]);
  const all = rankPois(pois, { lat: LAT, lng: LNG, radiusM: 1500, interests: ['history', 'food'], limit: 30 });
  assert.deepEqual(all.map((r) => r.poi.id), [1, 3, 4, 2]);
  assert.ok(all.every((r) => r.score > 0 && r.score <= 1 && Number.isInteger(r.distanceM)));
});

test('displayName is lang-aware; primaryKind follows the matched filter', () => {
  const tags = { name: 'Sultanahmet Camii', 'name:en': 'Blue Mosque', historic: 'mosque' };
  assert.equal(displayName(tags, 'en'), 'Blue Mosque');
  assert.equal(displayName(tags, 'tr'), 'Sultanahmet Camii');
  assert.equal(displayName({ name: 'Yerebatan', int_name: 'Basilica Cistern' }, 'en'), 'Basilica Cistern');
  assert.equal(primaryKind({ name: 'Inn', tourism: 'hotel', amenity: 'restaurant' }, 'food'), 'amenity=restaurant');
  assert.equal(primaryKind({ name: 'C', tourism: 'attraction', historic: 'cistern' }, 'history'), 'historic=cistern');
  assert.equal(primaryKind({ leisure: 'park' }), 'leisure=park');
});

test('classify: by centre tile, empty blocks kept (negative cache), outsiders returned separately', () => {
  const inTile = poi(1, LAT, LNG, { name: 'Castle', historic: 'castle' });
  const elsewhere = poi(2, 41.1, 29.1, { name: 'Far', historic: 'castle' });
  const { byKey, extra } = classify([inTile, elsewhere], [
    { tile: 'sxk97', interest: 'history' },
    { tile: 'sxk97', interest: 'food' },
  ]);
  assert.deepEqual(byKey.get(tileKey('sxk97', 'history')), [inTile]);
  assert.deepEqual(byKey.get(tileKey('sxk97', 'food')), []);
  assert.deepEqual(extra, [elsewhere]);
});

test('wiki parsers: sitelinks per language, extracts keyed by wikidata id, geosearch articles', () => {
  const links = parseSitelinks({
    entities: {
      Q12506: { sitelinks: { enwiki: { title: 'Hagia Sophia' }, trwiki: { title: 'Ayasofya' } } },
      Q999: { sitelinks: {} },
    },
  });
  assert.deepEqual(links.get('Q12506'), { en: 'Hagia Sophia', tr: 'Ayasofya' });
  assert.deepEqual(links.get('Q999'), {});
  const ex = parseExtracts(
    {
      query: {
        pages: [
          { pageid: 1, title: 'Ayasofya', extract: 'Ayasofya bir camidir.', description: 'cami', thumbnail: { source: 'https://upload.wikimedia.org/a.jpg' }, pageprops: { wikibase_item: 'Q12506' } },
          { title: 'Nope', missing: true },
        ],
      },
    },
    'tr',
  );
  assert.deepEqual(ex.get('Q12506'), {
    lang: 'tr',
    title: 'Ayasofya',
    extract: 'Ayasofya bir camidir.',
    description: 'cami',
    thumbUrl: 'https://upload.wikimedia.org/a.jpg',
    url: 'https://tr.wikipedia.org/wiki/Ayasofya',
  });
  const geo = parseGeoSearch(
    { query: { pages: [{ pageid: 7, title: 'Hippodrome', coordinates: [{ lat: 41.006, lon: 28.975 }], pageprops: { wikibase_item: 'Q387548' } }, { pageid: 8, title: 'No coords' }] } },
    'en',
  );
  assert.equal(geo.length, 1);
  assert.equal(geo[0]!.wikidata, 'Q387548');
  assert.ok(sitelinksUrl(['Q1', 'Q2'], ['tr', 'en']).includes('sitefilter=trwiki%7Cenwiki'));
});

test('input helpers: radius clamp, lang normalisation, OVERPASS_URLS parsing, FOSSGIS budget', () => {
  assert.equal(clampRadius(undefined), 1500);
  assert.equal(clampRadius(12), 100);
  assert.equal(clampRadius(99_999), 5000);
  assert.equal(normalizeLang('tr-TR'), 'tr');
  assert.equal(normalizeLang('de'), 'en');
  assert.deepEqual(parseOverpassUrls('http://insecure/x, https://a.example/api/interpreter ,nonsense'), ['https://a.example/api/interpreter']);
  assert.equal(parseOverpassUrls(undefined).length, 3);
  assert.deepEqual(instanceBudget('overpass-api.de', 8), { service: 'overpass_fossgis', units: 400, cap: 10_000 });
  assert.deepEqual(instanceBudget('lz4.overpass-api.de', 1), { service: 'overpass_fossgis', units: 100, cap: 10_000 });
  assert.equal(instanceBudget('overpass.private.coffee', 8), null);
});

// ---------------------------------------------------------------------------
// Handler over fakes
// ---------------------------------------------------------------------------

const OVP_A = 'https://ovp-a.test/api/interpreter';
const OVP_B = 'https://ovp-b.test/api/interpreter';
const FOSSGIS = 'https://overpass-api.de/api/interpreter';

type Reply = { status: number; body?: unknown; hang?: boolean };

interface WorldOpts {
  urls?: string[];
  overpass?: Record<string, Reply | ((body: string) => Reply)>;
  cache?: Record<string, { payload: unknown; fetchedAt?: number }>;
  config?: Record<string, string>;
  userQuota?: UsageOutcome;
  service?: Record<string, UsageOutcome>;
  wiki?: (url: string) => Reply;
}

const SAMPLE_ELEMENTS = [
  { type: 'relation', id: 18055570, center: { lat: 41.00538, lon: 28.97682 }, tags: { name: 'Sultanahmet Camii', 'name:en': 'Blue Mosque', historic: 'mosque', wikidata: 'Q80541', amenity: 'place_of_worship' } },
  { type: 'way', id: 109862851, center: { lat: 41.00858, lon: 28.98 }, tags: { name: 'Ayasofya', 'name:en': 'Hagia Sophia', historic: 'church', tourism: 'attraction', amenity: 'place_of_worship', wikidata: 'Q12506' } },
  { type: 'node', id: 4242, lat: 41.0066, lon: 28.9757, tags: { name: 'Tarihi Sultanahmet Köftecisi', amenity: 'restaurant', cuisine: 'turkish' } },
];

function world(opts: WorldOpts = {}) {
  const calls: Array<{ url: string; method: string; headers: Headers; body: string }> = [];
  const cache = new Map<string, { payload: unknown; fetchedAt: number }>();
  for (const [k, v] of Object.entries(opts.cache ?? {})) cache.set(k, { payload: v.payload, fetchedAt: v.fetchedAt ?? NOW - DAY });
  const puts: string[] = [];
  const consumed: Array<{ service: string; units: number; cap: number }> = [];
  let userQuotaCalls = 0;
  const respond = (r: Reply) =>
    new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {}), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });

  const deps: PoiDeps = {
    cacheGet: (keys: string[]) => {
      const rows = new Map<string, { payload: unknown; fetchedAt: number }>();
      for (const k of keys) {
        const v = cache.get(k);
        if (v) rows.set(k, v);
      }
      return Promise.resolve({ rows, error: null });
    },
    cachePut: (rows: Array<{ key: string; payload: unknown }>) => {
      for (const r of rows) {
        puts.push(r.key);
        cache.set(r.key, { payload: r.payload, fetchedAt: NOW });
      }
      return Promise.resolve({ error: null });
    },
    readConfig: (key: string) => Promise.resolve(opts.config?.[key] ?? null),
    consumeService: (service: string, units: number, cap: number) => {
      consumed.push({ service, units, cap });
      return Promise.resolve(opts.service?.[service] ?? 'ok');
    },
    consumeUserQuota: () => {
      userQuotaCalls++;
      return Promise.resolve(opts.userQuota ?? 'ok');
    },
    fetch: (input: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      calls.push({ url: input, method: init?.method ?? 'GET', headers: new Headers(init?.headers), body });
      const base = input.split('?')[0]!;
      const ovp = opts.overpass?.[base];
      if (ovp !== undefined || base.includes('interpreter')) {
        const r = typeof ovp === 'function' ? ovp(body) : ovp ?? { status: 200, body: { elements: SAMPLE_ELEMENTS } };
        if (r.hang) {
          return new Promise<Response>((_, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
          );
        }
        return Promise.resolve(respond(r));
      }
      if (input.includes('wikipedia.org') || input.includes('wikidata.org')) {
        return Promise.resolve(respond(opts.wiki?.(input) ?? { status: 200, body: {} }));
      }
      return Promise.resolve(respond({ status: 404 }));
    },
    now: () => NOW,
    overpassUrls: opts.urls ?? [OVP_A, OVP_B],
    contact: 'https://example.test/contact',
  };
  _resetPoiStateForTests();
  return {
    handler: createHandler(deps),
    calls,
    puts,
    consumed,
    cache,
    get userQuotaCalls() {
      return userQuotaCalls;
    },
  };
}

function search(body: Record<string, unknown>, token = USER_JWT): Request {
  return new Request('http://localhost/poi-recommend', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ lat: LAT, lng: LNG, interests: ['history', 'food'], enrich: false, ...body }),
  });
}

// deno-lint-ignore no-explicit-any -- test helper reads loosely-typed JSON bodies
async function json(res: Response): Promise<any> {
  return await res.json();
}

const overpassCalls = (w: ReturnType<typeof world>) => w.calls.filter((c) => c.url.includes('interpreter'));

test('?ping public; GET 405; no/invalid token 401 before any work', async () => {
  const w = world();
  assert.deepEqual(await json(await w.handler(new Request('http://localhost/?ping'))), { ok: true, fn: 'poi-recommend' });
  assert.equal((await w.handler(new Request('http://localhost/'))).status, 405);
  assert.equal((await w.handler(new Request('http://localhost/', { method: 'POST', body: '{}' }))).status, 401);
  assert.equal((await w.handler(search({}, 'bad'))).status, 401);
  assert.equal(w.calls.length, 0);
});

test('invalid input -> 400', async () => {
  const w = world();
  for (const body of [{ interests: [] }, { interests: ['casinos'] }, { lat: 91 }, { lat: 'x' }, { limit: 31 }, { extra: 1 }, { action: 'resolve' }]) {
    const res = await w.handler(search(body));
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal(w.calls.length, 0);
});

test('kill switch: off -> 503; cache_only -> no upstream, no quota, degraded', async () => {
  const off = world({ config: { recommendations: 'off' } });
  const r = await off.handler(search({}));
  assert.equal(r.status, 503);
  assert.equal((await json(r)).error.code, 'recommendations_disabled');

  const co = world({ config: { recommendations: 'cache_only' } });
  const body = await json(await co.handler(search({})));
  assert.equal(body.degraded, 'cache_only');
  assert.deepEqual(body.items, []);
  assert.equal(co.calls.length, 0);
  assert.equal(co.userQuotaCalls, 0);
});

test('cache miss: one Overpass call with UA + [timeout:], blocks cached (empty too), ranked OSM items, never Google', async () => {
  const w = world({ urls: [OVP_A] });
  const res = await w.handler(search({ lang: 'en' }));
  assert.equal(res.status, 200);
  const body = await json(res);
  const ovp = overpassCalls(w);
  assert.equal(ovp.length, 1);
  assert.equal(ovp[0]!.method, 'POST');
  assert.equal(ovp[0]!.headers.get('User-Agent'), 'Tripvisor/1.0 (https://example.test/contact) poi-recommend');
  const q = decodeURIComponent(ovp[0]!.body.replace(/^data=/, ''));
  assert.ok(q.startsWith('[out:json][timeout:12]'));
  assert.equal(w.userQuotaCalls, 1);
  assert.deepEqual(
    w.consumed.filter((c) => c.service === 'overpass'),
    [{ service: 'overpass', units: 1, cap: 2000 }],
  );
  // 4 tiles × 2 interests, every block cached (the sea tiles as empty lists).
  assert.equal(w.puts.filter((k) => k.startsWith('ovp:v1:')).length, 8);
  assert.deepEqual((w.cache.get(tileKey('sxk95', 'history'))!.payload as { items: unknown[] }).items, []);

  assert.equal(body.meta.contractVersion, 1);
  assert.equal(body.meta.cache, 'miss');
  assert.equal(body.meta.upstream, 'overpass');
  assert.equal(body.meta.instance, 'ovp-a.test');
  assert.equal(body.degraded, null);
  assert.equal(body.attribution.osm, '© OpenStreetMap contributors');
  assert.equal(body.radiusM, 1500);
  const blue = body.items[0];
  assert.equal(blue.id, 'osm:relation/18055570');
  assert.deepEqual(blue.osm, { type: 'relation', id: 18055570 });
  assert.equal(blue.name, 'Blue Mosque');
  assert.equal(blue.originalName, 'Sultanahmet Camii');
  assert.equal(blue.kind, 'historic=mosque');
  assert.equal(blue.wikidata, 'Q80541');
  assert.deepEqual(blue.interests, ['history']);
  assert.ok(blue.distanceM < 20);
  assert.equal(blue.tags.name, undefined); // names live in name/originalName
  const food = body.items.find((i: { interests: string[] }) => i.interests[0] === 'food');
  assert.equal(food.kind, 'amenity=restaurant');
  assert.equal(food.tags.cuisine, 'turkish');
  assert.ok(!w.calls.some((c) => c.url.includes('google')));
});

test('the done log line has no userId and no coordinates, only a geohash-4 area', async () => {
  const w = world({ urls: [OVP_A] });
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    const res = await w.handler(search({ lang: 'en' }));
    assert.equal(res.status, 200);
    await res.body?.cancel();
  } finally {
    console.log = original;
  }
  const entries = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  const done = entries.find((e) => e.fn === 'poi-recommend' && e.stage === 'done');
  assert.ok(done, 'a done line is logged');
  assert.equal(done!.userId, undefined);
  assert.equal(done!.lat, undefined);
  assert.equal(done!.lng, undefined);
  assert.equal(done!.area, 'sxk9');
  assert.equal(done!.area, geohashEncode(LAT, LNG, LOG_AREA_PRECISION));
  // Nothing in the whole request's log output ties the user to the spot.
  assert.ok(!lines.join('\n').includes(USER), 'no line carries the user id');
  for (const e of entries) {
    assert.ok(!('lat' in e) && !('lng' in e) && !('lon' in e), `no coordinates: ${JSON.stringify(e)}`);
  }
});

test('all blocks cached: no upstream, no quota; Turkish names', async () => {
  const w = world();
  const pois = parseOverpassResponse({ elements: SAMPLE_ELEMENTS });
  const cache: Record<string, { payload: unknown }> = {};
  for (const t of tilesForCircle(LAT, LNG, 1500)) {
    for (const i of ['history', 'food'] as const) {
      cache[tileKey(t, i)] = { payload: { v: 1, items: t === 'sxk97' ? pois : [] } };
    }
  }
  const w2 = world({ cache });
  const body = await json(await w2.handler(search({ lang: 'tr-TR' })));
  assert.equal(body.meta.cache, 'hit');
  assert.equal(body.lang, 'tr');
  assert.equal(body.items[0].name, 'Sultanahmet Camii');
  assert.equal(body.items[0].originalName, null);
  assert.equal(w2.calls.length, 0);
  assert.equal(w2.userQuotaCalls, 0);
  assert.equal(w.calls.length, 0);
});

test('expired cache rows (> 30 days) count as missing', async () => {
  const cache: Record<string, { payload: unknown; fetchedAt: number }> = {};
  for (const t of tilesForCircle(LAT, LNG, 1500)) {
    for (const i of ['history', 'food'] as const) cache[tileKey(t, i)] = { payload: { v: 1, items: [] }, fetchedAt: NOW - 31 * DAY };
  }
  const w = world({ cache, urls: [OVP_A] });
  const body = await json(await w.handler(search({})));
  assert.equal(body.meta.cache, 'miss');
  assert.equal(overpassCalls(w).length, 1);
});

test('failover: a 504 instance is skipped for the next request (breaker); runtime-error remark also fails over', async () => {
  const w = world({ overpass: { [OVP_A]: { status: 504, body: '<html>busy</html>' } } });
  const body = await json(await w.handler(search({})));
  assert.equal(body.meta.instance, 'ovp-b.test');
  assert.deepEqual(overpassCalls(w).map((c) => c.url), [OVP_A, OVP_B]);
  // New area (fresh blocks), same isolate: A's breaker is open.
  await w.handler(search({ lat: 39.93, lng: 32.85 }));
  assert.deepEqual(overpassCalls(w).map((c) => c.url), [OVP_A, OVP_B, OVP_B]);

  const r = world({ overpass: { [OVP_A]: { status: 200, body: { elements: [], remark: 'runtime error: Query timed out' } } } });
  const b2 = await json(await r.handler(search({})));
  assert.equal(b2.meta.instance, 'ovp-b.test');
});

test('Overpass 400 (our malformed query) does not fail over', async () => {
  const w = world({ overpass: { [OVP_A]: { status: 400, body: { error: 'parse error' } } } });
  const body = await json(await w.handler(search({})));
  // A 400 is OUR bad query: no failover (every instance would say the same).
  assert.equal(overpassCalls(w).length, 1);
  assert.equal(body.degraded, 'overpass_unavailable');
});

test('everything down -> Wikipedia GeoSearch fallback (cached per tile), degraded overpass_unavailable', async () => {
  const geoBody = {
    query: {
      pages: [
        { pageid: 1, title: 'Hippodrome of Constantinople', coordinates: [{ lat: 41.0064, lon: 28.9758 }], pageprops: { wikibase_item: 'Q387548' }, extract: 'A circus.' },
        { pageid: 2, title: 'Far away', coordinates: [{ lat: 41.1, lon: 29.1 }] },
      ],
    },
  };
  const w = world({
    overpass: { [OVP_A]: { status: 429 }, [OVP_B]: { status: 503 } },
    wiki: (url) => (url.includes('generator=geosearch') ? { status: 200, body: geoBody } : { status: 404 }),
  });
  const body = await json(await w.handler(search({})));
  assert.equal(body.degraded, 'overpass_unavailable');
  assert.equal(body.meta.upstream, 'wikipedia');
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].source, 'wikipedia');
  assert.equal(body.items[0].id, 'wiki:Q387548');
  assert.equal(body.items[0].osm, null);
  assert.equal(body.items[0].wiki.url, 'https://en.wikipedia.org/wiki/Hippodrome_of_Constantinople');
  assert.equal(body.attribution.wikipedia, 'Wikipedia (CC BY-SA 4.0)');
  const geo = w.calls.find((c) => c.url.includes('generator=geosearch'))!;
  assert.equal(geo.headers.get('User-Agent'), 'Tripvisor/1.0 (https://example.test/contact) poi-recommend');
  assert.ok(w.puts.includes('wgeo:v1:sxk97:en'));
  // Nothing from the failed Overpass call was cached.
  assert.equal(w.puts.filter((k) => k.startsWith('ovp:')).length, 0);
});

test('global Overpass cap reached -> degraded global_cap without calling Overpass', async () => {
  const w = world({ service: { overpass: 'exceeded' } });
  const body = await json(await w.handler(search({})));
  assert.equal(body.degraded, 'global_cap');
  assert.equal(overpassCalls(w).length, 0);
});

test('FOSSGIS over its own budget is skipped, the next instance serves', async () => {
  const w = world({ urls: [FOSSGIS, OVP_B], service: { overpass_fossgis: 'exceeded' } });
  const body = await json(await w.handler(search({})));
  assert.equal(body.meta.instance, 'ovp-b.test');
  assert.deepEqual(overpassCalls(w).map((c) => c.url), [OVP_B]);
  assert.deepEqual(w.consumed[0], { service: 'overpass_fossgis', units: 400, cap: 10_000 });
});

test('per-user quota: 429 with nothing cached; partial cache -> degraded user_quota; unavailable -> 503', async () => {
  const w = world({ userQuota: 'exceeded' });
  const res = await w.handler(search({}));
  assert.equal(res.status, 429);
  const err = (await json(res)).error;
  assert.equal(err.code, 'quota_exceeded');
  assert.equal(err.kind, 'poi_requests');
  assert.equal(err.limit, 40);
  assert.equal(w.calls.length, 0);

  const pois = parseOverpassResponse({ elements: SAMPLE_ELEMENTS });
  const w2 = world({ userQuota: 'exceeded', cache: { [tileKey('sxk97', 'history')]: { payload: { v: 1, items: pois } } } });
  const body = await json(await w2.handler(search({})));
  assert.equal(body.degraded, 'user_quota');
  assert.equal(body.meta.cache, 'partial');
  assert.ok(body.items.length >= 2);
  assert.equal(w2.calls.length, 0);

  const w3 = world({ userQuota: 'unavailable' });
  const r3 = await w3.handler(search({}));
  assert.equal(r3.status, 503);
  assert.equal((await json(r3)).error.code, 'quota_unavailable');
});

test('enrichment: one sitelinks call + one extracts call per language, tr -> en fallback, cached per wikidata × lang', async () => {
  const wiki = (url: string): Reply => {
    if (url.includes('wikidata.org')) {
      return {
        status: 200,
        body: { entities: { Q80541: { sitelinks: { trwiki: { title: 'Sultanahmet Camii' }, enwiki: { title: 'Blue Mosque, Istanbul' } } }, Q12506: { sitelinks: { enwiki: { title: 'Hagia Sophia' } } } } },
      };
    }
    if (url.startsWith('https://tr.wikipedia.org')) {
      return { status: 200, body: { query: { pages: [{ pageid: 1, title: 'Sultanahmet Camii', extract: 'Bir cami.', pageprops: { wikibase_item: 'Q80541' } }] } } };
    }
    if (url.startsWith('https://en.wikipedia.org')) {
      return { status: 200, body: { query: { pages: [{ pageid: 2, title: 'Hagia Sophia', extract: 'A mosque.', pageprops: { wikibase_item: 'Q12506' } }] } } };
    }
    return { status: 404 };
  };
  const w = world({ urls: [OVP_A], wiki });
  const body = await json(await w.handler(search({ lang: 'tr', enrich: true })));
  const blue = body.items.find((i: { wikidata: string }) => i.wikidata === 'Q80541');
  const hagia = body.items.find((i: { wikidata: string }) => i.wikidata === 'Q12506');
  assert.equal(blue.wiki.lang, 'tr');
  assert.equal(blue.wiki.extract, 'Bir cami.');
  assert.equal(hagia.wiki.lang, 'en'); // no Turkish article in this fake: English fallback
  assert.equal(body.attribution.wikipedia, 'Wikipedia (CC BY-SA 4.0)');
  assert.equal(w.calls.filter((c) => c.url.includes('wikidata.org')).length, 1);
  assert.equal(w.calls.filter((c) => c.url.includes('wikipedia.org')).length, 2);
  assert.ok(w.puts.includes('wiki:v1:Q80541:tr') && w.puts.includes('wiki:v1:Q12506:tr'));
  assert.deepEqual(w.consumed.find((c) => c.service === 'wikipedia'), { service: 'wikipedia', units: 3, cap: 5000 });

  // Same search again: tiles and summaries both from cache, zero upstream.
  const before = w.calls.length;
  const again = await json(await w.handler(search({ lang: 'tr', enrich: true })));
  assert.equal(again.meta.cache, 'hit');
  assert.equal(again.items.find((i: { wikidata: string }) => i.wikidata === 'Q80541').wiki.extract, 'Bir cami.');
  assert.equal(w.calls.length, before);
});

test('enrichment failure degrades silently (no wiki, nothing negatively cached)', async () => {
  const w = world({ urls: [OVP_A], wiki: () => ({ status: 500 }) });
  const res = await w.handler(search({ enrich: true }));
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.ok(body.items.every((i: { wiki: unknown }) => i.wiki === null));
  assert.equal(body.attribution.wikipedia, null);
  assert.equal(w.puts.filter((k) => k.startsWith('wiki:')).length, 0);
});

test('radius is clamped and echoed; limit respected', async () => {
  const w = world({ urls: [OVP_A] });
  const body = await json(await w.handler(search({ radiusM: 50_000, limit: 1 })));
  assert.equal(body.radiusM, 5000);
  assert.equal(body.items.length, 1);
  assert.ok(body.meta.tiles <= 16);
});
