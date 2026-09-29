// poi-recommend — interest-based place recommendations from OpenStreetMap
// (Overpass) + Wikipedia/Wikidata (ADR-0013, M5 Y1.3). NEVER calls Google:
// candidates are free, cacheable OSM data; the Google rating/reviews appear
// only when the user taps a card, through the existing place-details path.
//
// Contract (contractVersion 1):
//   POST { action?: 'search',
//          lat, lng,                      // search centre
//          radiusM?: number,              // clamped to 100..5000, default 1500
//          interests: Interest[],         // 1..8 of history, food, nature,
//                                         // museums, nightlife, shopping, kids, viewpoints
//          lang?: string,                 // 'tr…' -> Turkish names/articles, else English
//          limit?: 1..30 (default 30),
//          enrich?: boolean (default true) }   // Wikipedia summaries for the top 20
//   -> { items: PoiItem[], center: { lat, lng }, radiusM, interests, lang,
//        attribution: { osm, osmUrl, wikipedia: string | null, wikipediaUrl: string | null },
//        degraded: null | 'partial' | 'user_quota' | 'global_cap' |
//                  'overpass_unavailable' | 'cache_only',
//        meta: { contractVersion: 1, cache: 'hit' | 'miss' | 'partial',
//                tiles, upstream: 'overpass' | 'wikipedia' | null, instance: host | null } }
//   PoiItem = { id ('osm:node/123' | 'wiki:Q123' | 'wiki:en/456'),
//               source: 'osm' | 'wikipedia', osm: { type, id } | null,
//               name (lang-aware), originalName (local name when different) | null,
//               lat, lng, distanceM (int), interests: Interest[] (best first),
//               kind ('historic=castle' …) | null, tags (trimmed subset),
//               wikidata: 'Q…' | null, wiki: WikiSummary | null, score (0..1) }
//   GET ?ping -> { ok: true, fn: 'poi-recommend' }
//
// `resolve` (Google Text Search) from the M5 plan is NOT implemented here:
// the Y1.3 brief forbids Google calls in this function. Matching an OSM
// card to a google_place_id is a Wave-2 decision (see the Y1.3 report).
//
// Errors: invalid_input 400 · not_authenticated 401 · method_not_allowed 405 ·
//   quota_exceeded 429 (kind poi_requests; only when nothing is cached) ·
//   quota_unavailable 503 · recommendations_disabled 503 · internal_error 500
//
// Caching + fair use (ADR-0013 §3; OSM wiki "Overpass API" usage policy,
// checked 2026-09-29):
//   - poi_cache 'ovp:v<TAGMAP_VERSION>:<geohash5>:<interest>' per tile ×
//     interest, 30-day TTL, empty results cached too. A search reads every
//     tile its circle touches (nearest MAX_TILES) and fetches ONLY the missing
//     tile × interest blocks, in ONE Overpass request (MAX_BLOCKS_PER_QUERY
//     nearest; the rest arrive with later searches: degraded 'partial').
//   - Upstream Overpass calls: global cap 2,000/day (service_usage 'overpass')
//     and a separate budget for the FOSSGIS instance (overpass-api.de), whose
//     policy for apps is < 100 queries and < 10 MB per day summed over all
//     users: 'overpass_fossgis' counts ESTIMATED KB (50 per block, at least
//     100 per call) against 10,000/day, i.e. <= 100 calls and ~10 MB. When it
//     runs out the chain simply moves on to the next instance.
//     Per user: 40 searches/day that NEED Overpass (consume_poi_quota);
//     searches served from cache are free.
//   - Failover: OVERPASS_URLS in order (default: overpass-api.de ->
//     overpass.private.coffee -> maps.mail.ru), 25 s total, 15 s per attempt,
//     server-side [timeout:] below that, a per-isolate breaker after a
//     429/5xx/timeout. Then Wikipedia GeoSearch ('wgeo:v1:<gh5>:<lang>').
//   - Kill switch: app_config 'recommendations' = 'off' (503) or 'cache_only'
//     (serve caches, call nothing upstream).
//   - Every upstream request carries the descriptive Tripvisor User-Agent.
//
// Pure w.r.t. I/O: side effects go through PoiDeps (deps.ts); tests fake them.

// @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { requireUser, secondsUntilUtcMidnight } from '../_shared/auth.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { handlePreflight } from '../_shared/cors.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { type Interest, INTERESTS, interestWeight, TAGMAP_VERSION } from '../_shared/interests.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { log, newRequestId } from '../_shared/logger.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { Breaker, type FetchFn, fetchJson, userAgent } from '../_shared/upstream.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { geohashBbox, geohashEncode, haversineM, roundTo, TILE_PRECISION, tilesForCircle } from './geo.ts';
import {
  buildOverpassQuery,
  displayName,
  type Lang,
  type OsmPoi,
  type OverpassBlock,
  OverpassResponseError,
  parseOverpassResponse,
  primaryKind,
  type RankedPoi,
  rankPois,
  responseTags,
  scorePoi,
  wikidataId,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from './poi.ts';
import {
  type GeoArticle,
  GEOSEARCH_MAX_RADIUS_M,
  geoSearchUrl,
  extractsUrl,
  parseExtracts,
  parseGeoSearch,
  parseSitelinks,
  sitelinksUrl,
  type WikiCacheEntry,
  type WikiSummary,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from './wiki.ts';

const FN = 'poi-recommend';

export const POI_CONTRACT_VERSION = 1 as const;

export const DEFAULT_RADIUS_M = 1500;
export const MIN_RADIUS_M = 100;
export const MAX_RADIUS_M = 5000;
export const MAX_LIMIT = 30;

export const POI_USER_DAILY_CAP = 40;
export const OVERPASS_GLOBAL_DAILY_CAP = 2000;
/** FOSSGIS budget in estimated KB per UTC day (see the header). */
export const FOSSGIS_DAILY_KB = 10_000;
const FOSSGIS_KB_PER_BLOCK = 50;
const FOSSGIS_MIN_KB_PER_CALL = 100;
export const WIKIPEDIA_DAILY_CAP = 5000;

export const DEFAULT_OVERPASS_URLS: readonly string[] = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const CACHE_TTL_MS = 30 * 86_400_000;
const MAX_TILES = 16;
const MAX_BLOCKS_PER_QUERY = 24;
const OVERPASS_BUDGET_MS = 25_000;
const OVERPASS_ATTEMPT_MS = 15_000;
const OVERPASS_MAX_BYTES = 8 * 1024 * 1024;
const WIKI_TIMEOUT_MS = 3_000;
/** = EXTRACTS_PER_CALL: enriching 20 cards costs the same 2–3 calls as 10. */
const ENRICH_TOP_N = 20;
/** 0037 caps a poi_cache payload at 256 KiB; stay safely below it. */
const MAX_CACHE_PAYLOAD_CHARS = 240_000;
/**
 * Geohash length for the search area in logs: a 4-char cell spans
 * 0.35° × 0.18° (about 39 × 20 km at the equator, ~29 × 20 km in Istanbul),
 * enough to tell which city the cache is serving but not where anyone
 * stood. The ~5 km tile keys (TILE_PRECISION) are never logged.
 */
export const LOG_AREA_PRECISION = 4;

const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
const WIKIPEDIA_ATTRIBUTION = 'Wikipedia (CC BY-SA 4.0)';
const WIKIPEDIA_LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';

export type UsageOutcome = 'ok' | 'exceeded' | 'unavailable';
export type Degraded = 'partial' | 'user_quota' | 'global_cap' | 'overpass_unavailable' | 'cache_only';

export interface PoiDeps {
  /** Fresh or not: the handler applies the 30-day TTL itself. */
  cacheGet(keys: string[]): Promise<{ rows: Map<string, { payload: unknown; fetchedAt: number }>; error: string | null }>;
  cachePut(rows: Array<{ key: string; payload: unknown }>): Promise<{ error: string | null }>;
  readConfig(key: string): Promise<string | null>;
  consumeService(service: string, units: number, cap: number): Promise<UsageOutcome>;
  consumeUserQuota(userId: string, units: number, cap: number): Promise<UsageOutcome>;
  fetch: FetchFn;
  now(): number;
  overpassUrls: readonly string[];
  contact?: string;
}

export interface PoiItem {
  id: string;
  source: 'osm' | 'wikipedia';
  osm: { type: OsmPoi['type']; id: number } | null;
  name: string;
  originalName: string | null;
  lat: number;
  lng: number;
  distanceM: number;
  interests: Interest[];
  kind: string | null;
  tags: Record<string, string>;
  wikidata: string | null;
  wiki: WikiSummary | null;
  score: number;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const InputSchema = z
  .object({
    action: z.literal('search').default('search'),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radiusM: z.number().finite().optional(),
    interests: z.array(z.enum(INTERESTS)).min(1).max(INTERESTS.length),
    lang: z.string().max(35).optional(),
    limit: z.number().int().min(1).max(MAX_LIMIT).default(MAX_LIMIT),
    enrich: z.boolean().default(true),
  })
  .strict();

export function normalizeLang(v: string | undefined): Lang {
  return typeof v === 'string' && v.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

export function clampRadius(v: number | undefined): number {
  const r = v === undefined ? DEFAULT_RADIUS_M : Math.round(v);
  return Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, r));
}

export function tileKey(tile: string, interest: Interest): string {
  return `ovp:v${TAGMAP_VERSION}:${tile}:${interest}`;
}
export function wikiKey(qid: string, lang: Lang): string {
  return `wiki:v1:${qid}:${lang}`;
}
export function geoKey(tile: string, lang: Lang): string {
  return `wgeo:v1:${tile}:${lang}`;
}

// ---------------------------------------------------------------------------
// Cache payload validation (defensive: the table is ours, but shapes evolve)
// ---------------------------------------------------------------------------

function asPoiList(payload: unknown): OsmPoi[] | null {
  const items = (payload as { v?: unknown; items?: unknown } | null)?.items;
  if ((payload as { v?: unknown } | null)?.v !== 1 || !Array.isArray(items)) return null;
  return (items as OsmPoi[]).filter(
    (p) =>
      p &&
      (p.type === 'node' || p.type === 'way' || p.type === 'relation') &&
      typeof p.id === 'number' &&
      typeof p.lat === 'number' &&
      typeof p.lon === 'number' &&
      !!p.tags &&
      typeof p.tags === 'object',
  );
}

function asWikiEntry(payload: unknown): WikiCacheEntry | null {
  const p = payload as WikiCacheEntry | null;
  if (!p || p.v !== 1 || !('summary' in p)) return null;
  if (p.summary !== null && (typeof p.summary !== 'object' || typeof p.summary.title !== 'string')) return null;
  return p;
}

function asGeoList(payload: unknown): GeoArticle[] | null {
  const p = payload as { v?: unknown; articles?: unknown } | null;
  if (!p || p.v !== 1 || !Array.isArray(p.articles)) return null;
  return p.articles as GeoArticle[];
}

// ---------------------------------------------------------------------------
// Overpass with failover
// ---------------------------------------------------------------------------

const breaker = new Breaker();

/** Test-only: reset per-isolate state (breaker). */
export function _resetPoiStateForTests(): void {
  breaker.clear();
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The FOSSGIS instances (overpass-api.de and its lz4/z mirrors) share one
 * small budget: their policy for apps is < 100 queries and < 10 MB a day.
 */
export function instanceBudget(
  host: string,
  blocks: number,
): { service: string; units: number; cap: number } | null {
  if (host !== 'overpass-api.de' && !host.endsWith('.overpass-api.de')) return null;
  return {
    service: 'overpass_fossgis',
    units: Math.max(FOSSGIS_MIN_KB_PER_CALL, blocks * FOSSGIS_KB_PER_BLOCK),
    cap: FOSSGIS_DAILY_KB,
  };
}

type OverpassOutcome =
  | { ok: true; pois: OsmPoi[]; host: string }
  | { ok: false; reason: 'global_cap' | 'budget_unavailable' | 'bad_query' | 'all_failed' };

async function runOverpass(
  deps: PoiDeps,
  blocks: readonly OverpassBlock[],
  requestId: string,
): Promise<OverpassOutcome> {
  const deadline = deps.now() + OVERPASS_BUDGET_MS;
  const ua = userAgent(FN, deps.contact);
  for (const url of deps.overpassUrls) {
    const host = hostOf(url);
    if (breaker.isOpen(host)) {
      log({ requestId, fn: FN, level: 'info', stage: 'overpass', host, skipped: 'breaker_open' });
      continue;
    }
    const remaining = deadline - deps.now();
    if (remaining < 3_000) break;
    const sub = instanceBudget(host, blocks.length);
    if (sub) {
      const o = await deps.consumeService(sub.service, sub.units, sub.cap);
      if (o !== 'ok') {
        log({ requestId, fn: FN, level: 'info', stage: 'overpass', host, skipped: `instance_cap_${o}` });
        continue;
      }
    }
    const g = await deps.consumeService('overpass', 1, OVERPASS_GLOBAL_DAILY_CAP);
    if (g !== 'ok') {
      log({ requestId, fn: FN, level: 'warn', stage: 'overpass', host, skipped: `global_cap_${g}` });
      return { ok: false, reason: g === 'exceeded' ? 'global_cap' : 'budget_unavailable' };
    }
    const timeoutMs = Math.min(OVERPASS_ATTEMPT_MS, remaining);
    const query = buildOverpassQuery(blocks, { serverTimeoutS: Math.max(5, Math.floor(timeoutMs / 1000) - 3) });
    const res = await fetchJson(url, {
      fetchFn: deps.fetch,
      method: 'POST',
      timeoutMs,
      retries: 0, // failover to the next instance instead of re-hitting a busy one
      headers: {
        'User-Agent': ua,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: `data=${encodeURIComponent(query)}`,
      maxBytes: OVERPASS_MAX_BYTES,
    });
    if (res.ok) {
      try {
        const pois = parseOverpassResponse(res.data);
        breaker.reset(host);
        log({
          requestId,
          fn: FN,
          level: 'info',
          stage: 'overpass',
          host,
          blocks: blocks.length,
          elements: pois.length,
          bytes: res.bytes,
          duration_ms: res.durationMs,
        });
        return { ok: true, pois, host };
      } catch (e) {
        const reason = e instanceof OverpassResponseError ? e.reason : String(e);
        log({ requestId, fn: FN, level: 'warn', stage: 'overpass', host, err: reason, duration_ms: res.durationMs });
        breaker.trip(host, 60_000);
        continue;
      }
    }
    log({ requestId, fn: FN, level: 'warn', stage: 'overpass', host, err: res.reason, duration_ms: res.durationMs });
    if (res.reason === 'http_400') {
      // Our query is malformed: every instance would say the same.
      log({ requestId, fn: FN, level: 'error', stage: 'overpass', err: 'bad_query' });
      return { ok: false, reason: 'bad_query' };
    }
    // Overpass asks for ~30 s of back-off after 429/504; a dead host gets longer.
    breaker.trip(host, res.reason === 'timeout' || res.reason === 'network' ? 120_000 : 60_000);
  }
  return { ok: false, reason: 'all_failed' };
}

/**
 * Split fetched features into the requested (tile, interest) blocks by each
 * feature's own centre tile. Every block gets an entry, empty included, so
 * "nothing here" is cached too. Features centred outside the fetched tiles
 * (long ways reaching in) are returned as `extra`, used for this response only.
 */
export function classify(
  pois: readonly OsmPoi[],
  blocks: readonly OverpassBlock[],
): { byKey: Map<string, OsmPoi[]>; extra: OsmPoi[] } {
  const byKey = new Map<string, OsmPoi[]>();
  for (const b of blocks) byKey.set(tileKey(b.tile, b.interest), []);
  const interests = [...new Set(blocks.map((b) => b.interest))];
  const extra: OsmPoi[] = [];
  for (const p of pois) {
    const tile = geohashEncode(p.lat, p.lon, TILE_PRECISION);
    let placed = false;
    for (const interest of interests) {
      if (interestWeight(p.tags, interest) <= 0) continue;
      const list = byKey.get(tileKey(tile, interest));
      if (list) {
        list.push(p);
        placed = true;
      }
    }
    if (!placed) extra.push(p);
  }
  return { byKey, extra };
}

// ---------------------------------------------------------------------------
// Wikipedia: enrichment + GeoSearch fallback
// ---------------------------------------------------------------------------

async function enrich(
  deps: PoiDeps,
  items: PoiItem[],
  lang: Lang,
  allowUpstream: boolean,
  requestId: string,
): Promise<void> {
  const targets = items.filter((i) => i.source === 'osm' && i.wikidata).slice(0, ENRICH_TOP_N);
  if (targets.length === 0) return;
  const qids = [...new Set(targets.map((t) => t.wikidata!))];
  const cached = await deps.cacheGet(qids.map((q) => wikiKey(q, lang)));
  const now = deps.now();
  const found = new Map<string, WikiSummary | null>();
  for (const q of qids) {
    const row = cached.rows.get(wikiKey(q, lang));
    if (!row || now - row.fetchedAt > CACHE_TTL_MS) continue;
    const entry = asWikiEntry(row.payload);
    if (entry) found.set(q, entry.summary);
  }
  const misses = qids.filter((q) => !found.has(q));
  if (misses.length > 0 && allowUpstream) {
    const budget = await deps.consumeService('wikipedia', lang === 'en' ? 2 : 3, WIKIPEDIA_DAILY_CAP);
    if (budget === 'ok') {
      const fetched = await fetchSummaries(deps, misses, lang, requestId);
      const rows: Array<{ key: string; payload: unknown }> = [];
      for (const [q, summary] of fetched) {
        found.set(q, summary);
        rows.push({ key: wikiKey(q, lang), payload: { v: 1, summary } satisfies WikiCacheEntry });
      }
      if (rows.length > 0) await putCache(deps, rows, requestId);
    } else {
      log({ requestId, fn: FN, level: 'info', stage: 'wiki', skipped: budget });
    }
  }
  for (const item of targets) {
    const s = found.get(item.wikidata!);
    if (s) item.wiki = s;
  }
}

/**
 * Summaries for `qids` in `lang`, falling back to English when the item has
 * no article in `lang`. The returned map holds only answers we are sure of
 * (null = "no article in either language"); anything a failed call left
 * unknown is absent, so it is not negatively cached.
 */
async function fetchSummaries(
  deps: PoiDeps,
  qids: readonly string[],
  lang: Lang,
  requestId: string,
): Promise<Map<string, WikiSummary | null>> {
  const out = new Map<string, WikiSummary | null>();
  const headers = { 'User-Agent': userAgent(FN, deps.contact), Accept: 'application/json' };
  const common = { fetchFn: deps.fetch, timeoutMs: WIKI_TIMEOUT_MS, retries: 1, headers, maxBytes: 1024 * 1024 };
  const langs: Lang[] = lang === 'en' ? ['en'] : [lang, 'en'];
  const links = await fetchJson(sitelinksUrl(qids, langs), common);
  if (!links.ok) {
    log({ requestId, fn: FN, level: 'warn', stage: 'wiki', call: 'sitelinks', err: links.reason });
    return out;
  }
  const titles = parseSitelinks(links.data);
  const byLang = new Map<Lang, Array<{ qid: string; title: string }>>();
  for (const q of qids) {
    const t = titles.get(q);
    const pick: Lang | null = t?.[lang] ? lang : t?.en ? 'en' : null;
    if (!pick) {
      if (titles.has(q)) out.set(q, null); // the item exists but has no article we can show
      continue;
    }
    const list = byLang.get(pick) ?? [];
    list.push({ qid: q, title: t![pick]! });
    byLang.set(pick, list);
  }
  await Promise.all(
    [...byLang.entries()].map(async ([l, list]) => {
      const res = await fetchJson(extractsUrl(l, list.map((x) => x.title)), common);
      if (!res.ok) {
        log({ requestId, fn: FN, level: 'warn', stage: 'wiki', call: 'extracts', lang: l, err: res.reason });
        return;
      }
      const summaries = parseExtracts(res.data, l);
      for (const { qid } of list) out.set(qid, summaries.get(qid) ?? null);
    }),
  );
  return out;
}

async function geoFallback(
  deps: PoiDeps,
  lat: number,
  lng: number,
  lang: Lang,
  allowUpstream: boolean,
  requestId: string,
): Promise<{ articles: GeoArticle[]; fetched: boolean }> {
  const tile = geohashEncode(lat, lng, TILE_PRECISION);
  const key = geoKey(tile, lang);
  const cached = await deps.cacheGet([key]);
  const row = cached.rows.get(key);
  if (row && deps.now() - row.fetchedAt <= CACHE_TTL_MS) {
    const list = asGeoList(row.payload);
    if (list) return { articles: list, fetched: false };
  }
  if (!allowUpstream) return { articles: [], fetched: false };
  const budget = await deps.consumeService('wikipedia', 1, WIKIPEDIA_DAILY_CAP);
  if (budget !== 'ok') return { articles: [], fetched: false };
  // Query around the TILE centre with the 10 km maximum so the cached list
  // serves any search centre in the tile (half-diagonal + 5 km < 10 km).
  const b = geohashBbox(tile);
  const res = await fetchJson(geoSearchUrl(lang, (b.s + b.n) / 2, (b.w + b.e) / 2, GEOSEARCH_MAX_RADIUS_M), {
    fetchFn: deps.fetch,
    timeoutMs: 5_000,
    retries: 1,
    headers: { 'User-Agent': userAgent(FN, deps.contact), Accept: 'application/json' },
    maxBytes: 2 * 1024 * 1024,
  });
  if (!res.ok) {
    log({ requestId, fn: FN, level: 'warn', stage: 'wiki', call: 'geosearch', err: res.reason });
    return { articles: [], fetched: false };
  }
  const articles = parseGeoSearch(res.data, lang);
  await putCache(deps, [{ key, payload: { v: 1, articles } }], requestId);
  return { articles, fetched: true };
}

async function putCache(deps: PoiDeps, rows: Array<{ key: string; payload: unknown }>, requestId: string) {
  const ok = rows.filter((r) => JSON.stringify(r.payload).length <= MAX_CACHE_PAYLOAD_CHARS);
  if (ok.length < rows.length) {
    log({ requestId, fn: FN, level: 'warn', stage: 'cache_write', skipped_oversize: rows.length - ok.length });
  }
  if (ok.length === 0) return;
  const { error } = await deps.cachePut(ok);
  if (error) log({ requestId, fn: FN, level: 'error', stage: 'cache_write', rows: ok.length, err: error });
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function osmItem(r: RankedPoi, lang: Lang): PoiItem {
  const name = displayName(r.poi.tags, lang);
  const local = r.poi.tags.name ?? name;
  return {
    id: `osm:${r.poi.type}/${r.poi.id}`,
    source: 'osm',
    osm: { type: r.poi.type, id: r.poi.id },
    name,
    originalName: local !== name ? local : null,
    lat: r.poi.lat,
    lng: r.poi.lon,
    distanceM: r.distanceM,
    interests: r.interests,
    kind: primaryKind(r.poi.tags, r.interests[0]),
    tags: responseTags(r.poi.tags),
    wikidata: wikidataId(r.poi.tags),
    wiki: null,
    score: r.score,
  };
}

function geoItems(
  articles: readonly GeoArticle[],
  opts: { lat: number; lng: number; radiusM: number; exclude: ReadonlySet<string> },
): PoiItem[] {
  const out: PoiItem[] = [];
  for (const a of articles) {
    if (a.wikidata && opts.exclude.has(a.wikidata)) continue;
    const d = haversineM(opts.lat, opts.lng, a.lat, a.lon);
    if (d > opts.radiusM) continue;
    out.push({
      id: a.wikidata ? `wiki:${a.wikidata}` : `wiki:${a.summary.lang}/${a.pageid}`,
      source: 'wikipedia',
      osm: null,
      name: a.summary.title,
      originalName: null,
      lat: roundTo(a.lat, 6),
      lng: roundTo(a.lon, 6),
      distanceM: Math.round(d),
      interests: [],
      kind: null,
      tags: {},
      wikidata: a.wikidata,
      wiki: a.summary,
      score: scorePoi(1, Math.max(0, 1 - d / opts.radiusM), 0),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function createHandler(deps: PoiDeps): (req: Request) => Promise<Response> {
  return async function handler(req: Request): Promise<Response> {
    const origin = req.headers.get('origin');
    const requestId = newRequestId();
    const startedAt = deps.now();

    const preflight = handlePreflight(req);
    if (preflight) return preflight;

    const url = new URL(req.url);
    if (url.searchParams.has('ping')) return jsonResponse({ ok: true, fn: FN }, { origin });
    if (req.method !== 'POST') return errorResponse('method_not_allowed', 'Only POST is allowed', 405, origin);

    const auth = await requireUser(req, { fn: FN, requestId, origin });
    if (!auth.ok) return auth.response;
    const userId: string = auth.user.id;

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return errorResponse('invalid_input', 'Invalid JSON', 400, origin);
    }
    const parsed = InputSchema.safeParse(json);
    if (!parsed.success) {
      const msg = parsed.error.issues
        .map((i: { path: Array<string | number>; message: string }) => `${i.path.join('.') || 'body'}: ${i.message}`)
        .join('; ');
      return errorResponse('invalid_input', msg, 400, origin);
    }
    const body = parsed.data as {
      lat: number;
      lng: number;
      radiusM?: number;
      interests: Interest[];
      lang?: string;
      limit: number;
      enrich: boolean;
    };
    const interests = [...new Set(body.interests)];
    const radiusM = clampRadius(body.radiusM);
    const lang = normalizeLang(body.lang);
    const lat = body.lat;
    const lng = body.lng;

    try {
      const switchValue = await deps.readConfig('recommendations');
      if (switchValue === 'off') {
        return errorResponse('recommendations_disabled', 'Recommendations are turned off for now.', 503, origin);
      }
      const cacheOnly = switchValue === 'cache_only';

      // 1. Tiles × interests, nearest tiles first.
      const tiles = tilesForCircle(lat, lng, radiusM).slice(0, MAX_TILES);
      const blocks: OverpassBlock[] = tiles.flatMap((tile) => interests.map((interest) => ({ tile, interest })));
      const cached = await deps.cacheGet(blocks.map((b) => tileKey(b.tile, b.interest)));
      if (cached.error) log({ requestId, fn: FN, level: 'error', stage: 'cache_read', err: cached.error });
      const now = deps.now();
      const fresh = new Map<string, OsmPoi[]>();
      for (const b of blocks) {
        const key = tileKey(b.tile, b.interest);
        const row = cached.rows.get(key);
        if (!row || now - row.fetchedAt > CACHE_TTL_MS) continue;
        const list = asPoiList(row.payload);
        if (list) fresh.set(key, list);
      }
      const missing = blocks.filter((b) => !fresh.has(tileKey(b.tile, b.interest)));

      // 2. Upstream for the missing blocks (metered).
      let degraded: Degraded | null = null;
      let upstream: 'overpass' | 'wikipedia' | null = null;
      let instance: string | null = null;
      const extra: OsmPoi[] = [];
      if (missing.length > 0) {
        if (cacheOnly) {
          degraded = 'cache_only';
        } else {
          const quota = await deps.consumeUserQuota(userId, 1, POI_USER_DAILY_CAP);
          if (quota === 'unavailable') {
            return jsonResponse(
              { error: { code: 'quota_unavailable', message: 'Usage check is temporarily unavailable. Please retry shortly.' } },
              { status: 503, origin, headers: { 'Retry-After': '5' } },
            );
          }
          if (quota === 'exceeded') {
            if (fresh.size === 0) {
              log({ requestId, fn: FN, level: 'info', stage: 'quota', userId, outcome: 'exceeded' });
              return jsonResponse(
                {
                  error: {
                    code: 'quota_exceeded',
                    message: `Daily recommendation limit reached (${POI_USER_DAILY_CAP} new-area searches/day). It resets at 00:00 UTC.`,
                    kind: 'poi_requests',
                    limit: POI_USER_DAILY_CAP,
                  },
                },
                { status: 429, origin, headers: { 'Retry-After': String(secondsUntilUtcMidnight(deps.now())) } },
              );
            }
            degraded = 'user_quota';
          } else {
            const batch = missing.slice(0, MAX_BLOCKS_PER_QUERY);
            const res = await runOverpass(deps, batch, requestId);
            if (res.ok) {
              upstream = 'overpass';
              instance = res.host;
              const { byKey, extra: outside } = classify(res.pois, batch);
              for (const [k, list] of byKey) fresh.set(k, list);
              extra.push(...outside);
              await putCache(
                deps,
                [...byKey.entries()].map(([key, items]) => ({ key, payload: { v: 1, items } })),
                requestId,
              );
              if (missing.length > batch.length) degraded = 'partial';
            } else {
              degraded = res.reason === 'global_cap' ? 'global_cap' : 'overpass_unavailable';
            }
          }
        }
      }

      // 3. Rank.
      const candidates = [...fresh.values()].flat().concat(extra);
      let items = rankPois(candidates, { lat, lng, radiusM, interests, limit: body.limit }).map((r) =>
        osmItem(r, lang),
      );

      // 4. Wikipedia GeoSearch when Overpass could not cover the area.
      if (degraded !== null && degraded !== 'partial' && items.length < body.limit) {
        const allowUpstream = degraded === 'overpass_unavailable' || degraded === 'global_cap';
        const geo = await geoFallback(deps, lat, lng, lang, allowUpstream, requestId);
        if (geo.fetched) upstream = upstream ?? 'wikipedia';
        const exclude = new Set(items.map((i) => i.wikidata).filter((q): q is string => !!q));
        const more = geoItems(geo.articles, { lat, lng, radiusM, exclude });
        items = items
          .concat(more)
          .sort((a, b) => b.score - a.score || a.distanceM - b.distanceM)
          .slice(0, body.limit);
      }

      // 5. Wikipedia summaries for the top cards (cached; cheap; optional).
      if (body.enrich) await enrich(deps, items, lang, !cacheOnly && degraded !== 'user_quota', requestId);

      const hasWiki = items.some((i) => i.wiki !== null);
      const cache: 'hit' | 'miss' | 'partial' =
        missing.length === 0 ? 'hit' : missing.length === blocks.length ? 'miss' : 'partial';
      log({
        requestId,
        fn: FN,
        level: 'info',
        stage: 'done',
        // Privacy (Wave-1 review #10): the search centre is where someone
        // is or plans to be, so this line carries no userId and only a
        // coarse geohash cell (see LOG_AREA_PRECISION), never coordinates.
        area: geohashEncode(lat, lng, LOG_AREA_PRECISION),
        radiusM,
        interests,
        tiles: tiles.length,
        missing_blocks: missing.length,
        cache,
        degraded,
        upstream,
        instance,
        items: items.length,
        duration_ms: deps.now() - startedAt,
      });
      return jsonResponse(
        {
          items,
          center: { lat, lng },
          radiusM,
          interests,
          lang,
          attribution: {
            osm: OSM_ATTRIBUTION,
            osmUrl: OSM_COPYRIGHT_URL,
            wikipedia: hasWiki ? WIKIPEDIA_ATTRIBUTION : null,
            wikipediaUrl: hasWiki ? WIKIPEDIA_LICENSE_URL : null,
          },
          degraded,
          meta: { contractVersion: POI_CONTRACT_VERSION, cache, tiles: tiles.length, upstream, instance },
        },
        { origin, headers: { 'Cache-Control': 'private, max-age=3600' } },
      );
    } catch (err) {
      log({ requestId, fn: FN, level: 'error', stage: 'unexpected', userId, err: String(err), duration_ms: deps.now() - startedAt });
      return errorResponse('internal_error', 'poi-recommend failed', 500, origin);
    }
  };
}
