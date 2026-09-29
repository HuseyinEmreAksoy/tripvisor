// poi-recommend/poi.ts: Overpass query building, response trimming, and
// ranking. Pure (no I/O, no Deno globals); the handler does the fetching.

import {
  filterMatches,
  type Interest,
  INTEREST_FILTERS,
  interestWeight,
  qlFiltersFor,
  type TagFilter,
  // @ts-ignore -- Deno `.ts`-suffixed import (unresolvable under the Expo tsconfig)
} from '../_shared/interests.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { type Bbox, geohashBbox, haversineM, roundTo } from './geo.ts';

// ---------------------------------------------------------------------------
// Cached element shape (poi_cache payload for one tile × interest)
// ---------------------------------------------------------------------------

export type OsmType = 'node' | 'way' | 'relation';

/** One trimmed OSM feature, as stored in poi_cache and ranked per request. */
export interface OsmPoi {
  type: OsmType;
  id: number;
  lat: number;
  lon: number;
  /** Trimmed to KEEP_TAGS; values capped at MAX_TAG_VALUE chars. */
  tags: Record<string, string>;
}

/**
 * Tags kept from Overpass. Names (for lang-aware display), notability links,
 * the classifying tags, and a few practical ones the card can show. OSM data
 * is ODbL: storing it with attribution is allowed (unlike Google content).
 */
export const KEEP_TAGS: ReadonlySet<string> = new Set([
  'name',
  'name:en',
  'name:tr',
  'int_name',
  'wikidata',
  'wikipedia',
  'historic',
  'tourism',
  'amenity',
  'leisure',
  'natural',
  'shop',
  'man_made',
  'boundary',
  'museum',
  'heritage',
  'tower:type',
  'religion',
  'cuisine',
  'opening_hours',
  'website',
  'wheelchair',
  'fee',
  'start_date',
]);

/** Tags echoed to clients (everything kept except names and wiki links, which have their own fields). */
const RESPONSE_TAG_EXCLUDE: ReadonlySet<string> = new Set([
  'name',
  'name:en',
  'name:tr',
  'int_name',
  'wikidata',
  'wikipedia',
]);

const MAX_TAG_VALUE = 200;

/**
 * Per tile × interest caps in the Overpass output (see buildOverpassQuery).
 * Overpass prints a set as nodes, then ways, then relations (by id), so a
 * single notable cap fills up with memorial plaques (nodes) and cuts the big
 * landmarks, which are mapped as buildings (ways/relations: Istanbul's Blue
 * Mosque is a relation, and Topkapı's ~40 notable pavilions are ways). So
 * notable relations, ways and nodes each get their own cap, relations first.
 */
export const NOTABLE_RELATIONS_PER_BLOCK = 20;
export const NOTABLE_WAYS_PER_BLOCK = 40;
export const NOTABLE_NODES_PER_BLOCK = 30;
/**
 * The non-notable rest is an arbitrary (id-ordered) sample of the tile, so it
 * must be dense enough that a 1–2 km search still finds nearby restaurants:
 * 60 per ~18 km² tile (measured in Sultanahmet: 20 left only 11 food results
 * within 1.5 km).
 */
export const OTHER_PER_BLOCK = 60;

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

export interface OverpassBlock {
  tile: string;
  interest: Interest;
}

function bboxQl(b: Bbox): string {
  return [b.s, b.w, b.n, b.e].map((v) => roundTo(v, 7)).join(',');
}

/**
 * One Overpass QL request covering every (tile, interest) block.
 *
 * Per block: every named feature matching the interest's filters inside the
 * tile, split into "notable" (has wikidata or wikipedia) and the rest, each
 * with its own output cap. Without the caps a food query over one tile of
 * central Istanbul returns thousands of restaurants (megabytes), which is
 * exactly the load the public instances ask apps not to create. Notable
 * features are what the ranking prefers anyway; the capped rest is a sample.
 *
 * `[timeout:]` is the server-side budget; keep it below the client abort so
 * the server gives up (and frees its slot) before we do. `[maxsize:]` well
 * below the 512 MiB default gets the query scheduled earlier under load.
 */
export function buildOverpassQuery(
  blocks: readonly OverpassBlock[],
  opts: { serverTimeoutS: number; maxsizeBytes?: number },
): string {
  const maxsize = opts.maxsizeBytes ?? 32 * 1024 * 1024;
  const parts: string[] = [`[out:json][timeout:${opts.serverTimeoutS}][maxsize:${maxsize}];`];
  for (const block of blocks) {
    const bbox = bboxQl(geohashBbox(block.tile));
    const statements = qlFiltersFor(block.interest)
      .map((f) => `nwr${f}(${bbox});`)
      .join('');
    parts.push(
      `(${statements})->.a;`,
      `(nwr.a["wikidata"];nwr.a["wikipedia"];)->.b;`,
      `rel.b->.br;`,
      `.br out tags center ${NOTABLE_RELATIONS_PER_BLOCK};`,
      `way.b->.bw;`,
      `.bw out tags center ${NOTABLE_WAYS_PER_BLOCK};`,
      `node.b->.bn;`,
      `.bn out tags center ${NOTABLE_NODES_PER_BLOCK};`,
      `(.a; - .b;)->.c;`,
      `.c out tags center ${OTHER_PER_BLOCK};`,
    );
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

export class OverpassResponseError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'OverpassResponseError';
  }
}

interface RawElement {
  type?: unknown;
  id?: unknown;
  lat?: unknown;
  lon?: unknown;
  center?: { lat?: unknown; lon?: unknown };
  tags?: unknown;
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function trimTags(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (KEEP_TAGS.has(k) && typeof v === 'string' && v.length > 0) {
      out[k] = v.slice(0, MAX_TAG_VALUE);
    }
  }
  return out;
}

/**
 * Parse an Overpass JSON body into trimmed, de-duplicated features.
 *
 * Overpass answers HTTP 200 with a `remark` like "runtime error: Query timed
 * out" when the server-side budget ran out mid-query; the element list is
 * then silently partial. That is treated as a failure (throws), so a partial
 * answer is never cached for 30 days as if it were complete.
 */
export function parseOverpassResponse(body: unknown): OsmPoi[] {
  if (!body || typeof body !== 'object') throw new OverpassResponseError('not_json_object');
  const { elements, remark } = body as { elements?: unknown; remark?: unknown };
  if (typeof remark === 'string' && /runtime (error|remark)/i.test(remark)) {
    throw new OverpassResponseError(`remark: ${remark.slice(0, 160)}`);
  }
  if (!Array.isArray(elements)) throw new OverpassResponseError('missing_elements');
  const seen = new Set<string>();
  const out: OsmPoi[] = [];
  for (const el of elements as RawElement[]) {
    const type = el.type;
    if (type !== 'node' && type !== 'way' && type !== 'relation') continue;
    if (!isFiniteNum(el.id)) continue;
    const lat = isFiniteNum(el.lat) ? el.lat : el.center?.lat;
    const lon = isFiniteNum(el.lon) ? el.lon : el.center?.lon;
    if (!isFiniteNum(lat) || !isFiniteNum(lon)) continue;
    const tags = trimTags(el.tags);
    if (!tags.name) continue;
    const key = `${type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, id: el.id, lat: roundTo(lat, 6), lon: roundTo(lon, 6), tags });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Presentation + ranking
// ---------------------------------------------------------------------------

export type Lang = 'en' | 'tr';

/** Lang-aware display name: name:<lang>, then int_name for English, then name. */
export function displayName(tags: Readonly<Record<string, string>>, lang: Lang): string {
  return tags[`name:${lang}`] ?? (lang === 'en' ? tags['int_name'] : undefined) ?? tags.name ?? '';
}

const KIND_KEYS = ['historic', 'amenity', 'tourism', 'leisure', 'natural', 'shop', 'man_made', 'boundary'];

/**
 * The classifying tag as `key=value`, or null. With `interest`, the tag comes
 * from the filter that matched it best (a hotel with a restaurant is
 * `amenity=restaurant` for food, not `tourism=hotel`); ties between that
 * filter's keys go by KIND_KEYS order (`historic=cistern` over
 * `tourism=attraction`).
 */
export function primaryKind(tags: Readonly<Record<string, string>>, interest?: Interest): string | null {
  if (interest) {
    let best: TagFilter | null = null;
    for (const f of INTEREST_FILTERS[interest]) {
      if ((best === null || f.weight > best.weight) && filterMatches(tags, f)) best = f;
    }
    if (best) {
      const keys = Object.keys(best.tags).sort((a, b) => kindRank(a) - kindRank(b));
      const k = keys[0];
      if (k && tags[k]) return `${k}=${tags[k]}`;
    }
  }
  for (const k of KIND_KEYS) {
    const v = tags[k];
    if (v) return `${k}=${v}`;
  }
  return null;
}

function kindRank(key: string): number {
  const i = KIND_KEYS.indexOf(key);
  return i === -1 ? KIND_KEYS.length : i;
}

export function responseTags(tags: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags)) if (!RESPONSE_TAG_EXCLUDE.has(k)) out[k] = v;
  return out;
}

/** Wikidata ids look like Q123. Anything else in the tag is ignored. */
export function wikidataId(tags: Readonly<Record<string, string>>): string | null {
  const v = tags.wikidata?.trim();
  return v && /^Q[1-9]\d{0,11}$/.test(v) ? v : null;
}

export interface RankedPoi {
  poi: OsmPoi;
  distanceM: number;
  /** Matched requested interests, best weight first. */
  interests: Interest[];
  score: number;
}

/**
 * How much a Wikipedia/Wikidata link says about a place, per interest. For
 * restaurants and bars it says little (a famous old bazaar has one, the best
 * meyhane round the corner does not), so the link only nudges food and
 * nightlife and distance decides. The Google rating on tap does the rest.
 */
export const NOTABILITY_FACTOR: Readonly<Record<Interest, number>> = {
  history: 1,
  food: 0.3,
  nature: 1,
  museums: 1,
  nightlife: 0.3,
  shopping: 1,
  kids: 1,
  viewpoints: 1,
};

/**
 * Score = 0.5·notability + 0.3·proximity + 0.2·tagWeight, in 0..1.
 *   notability  1 with wikidata, 0.8 with only a wikipedia link, else 0,
 *               times NOTABILITY_FACTOR of the item's best interest
 *   proximity   1 at the centre, 0 at the search radius (linear)
 *   tagWeight   the best INTEREST_FILTERS weight among requested interests
 * The weights make "has a wikidata/wikipedia link" dominate, then distance,
 * then the kind of place (ADR-0013 §2).
 */
export function scorePoi(n: number, proximity: number, tagWeight: number): number {
  return roundTo(0.5 * n + 0.3 * proximity + 0.2 * tagWeight, 3);
}

/**
 * Distance-filter, classify and rank candidates, then pick up to `limit`.
 *
 * Fair share: with several interests selected, a notable-heavy interest
 * (history) would otherwise crowd out the rest (food). Each interest first
 * gets up to ceil(limit / k) of its best items; remaining slots go to the
 * best leftovers by score. The final list is sorted by score.
 */
export function rankPois(
  pois: readonly OsmPoi[],
  opts: { lat: number; lng: number; radiusM: number; interests: readonly Interest[]; limit: number },
): RankedPoi[] {
  const seen = new Set<string>();
  const ranked: RankedPoi[] = [];
  for (const poi of pois) {
    const key = `${poi.type}/${poi.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const distanceM = haversineM(opts.lat, opts.lng, poi.lat, poi.lon);
    if (distanceM > opts.radiusM) continue;
    const matches = opts.interests
      .map((interest) => ({ interest, weight: interestWeight(poi.tags, interest) }))
      .filter((m) => m.weight > 0)
      .sort((a, b) => b.weight - a.weight);
    if (matches.length === 0) continue;
    const notability =
      (wikidataId(poi.tags) ? 1 : poi.tags.wikipedia ? 0.8 : 0) * NOTABILITY_FACTOR[matches[0]!.interest];
    const proximity = opts.radiusM > 0 ? Math.max(0, 1 - distanceM / opts.radiusM) : 1;
    ranked.push({
      poi,
      distanceM: Math.round(distanceM),
      interests: matches.map((m) => m.interest),
      score: scorePoi(notability, proximity, matches[0]!.weight),
    });
  }
  const byScore = (a: RankedPoi, b: RankedPoi) =>
    b.score - a.score || a.distanceM - b.distanceM || a.poi.id - b.poi.id;
  ranked.sort(byScore);

  if (opts.interests.length <= 1 || ranked.length <= opts.limit) return ranked.slice(0, opts.limit);

  const share = Math.ceil(opts.limit / opts.interests.length);
  const picked = new Set<RankedPoi>();
  for (const interest of opts.interests) {
    let n = 0;
    for (const r of ranked) {
      if (n >= share || picked.size >= opts.limit) break;
      if (r.interests[0] === interest && !picked.has(r)) {
        picked.add(r);
        n++;
      }
    }
  }
  for (const r of ranked) {
    if (picked.size >= opts.limit) break;
    picked.add(r);
  }
  return [...picked].sort(byScore);
}
