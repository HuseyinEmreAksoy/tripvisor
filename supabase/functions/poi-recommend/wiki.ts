// poi-recommend/wiki.ts: Wikipedia / Wikidata URL builders and parsers.
// Pure (no I/O); the handler fetches with the Tripvisor User-Agent.
//
// Enrichment is deliberately cheap (ADR-0013 "lazy, top N cards only"):
//   1. ONE Wikidata call resolves the article titles of up to 50 items:
//      wbgetentities&ids=Q1|Q2&props=sitelinks&sitefilter=trwiki|enwiki
//   2. ONE Wikipedia call per language fetches intro extract + thumbnail +
//      short description for up to 20 titles (the `exlimit` ceiling).
//   Results are cached per wikidata × lang in poi_cache for 30 days.
// The GeoSearch fallback (Overpass down or over budget) is ONE call:
//   generator=geosearch + coordinates/pageprops/pageimages/description/extracts.
//
// Text: CC BY-SA 4.0, images: per-file licences on Commons. Clients must
// link each card to `url` and show the attribution the response carries.

// @ts-ignore -- Deno `.ts`-suffixed import (unresolvable under the Expo tsconfig)
import type { Lang } from './poi.ts';

export interface WikiSummary {
  lang: Lang;
  title: string;
  /** Plain-text intro, at most 2 sentences / MAX_EXTRACT chars. */
  extract: string | null;
  /** Wikidata short description ("Ottoman-era mosque in Istanbul"). */
  description: string | null;
  /** Wikimedia thumbnail, ~320 px wide. */
  thumbUrl: string | null;
  url: string;
}

/** poi_cache payload for 'wiki:v1:<qid>:<lang>'. summary null = "no article" (negative cache). */
export interface WikiCacheEntry {
  v: 1;
  summary: WikiSummary | null;
}

export const MAX_EXTRACT = 400;
export const EXTRACTS_PER_CALL = 20;
export const SITELINKS_PER_CALL = 50;

const API = (lang: string) => `https://${lang}.wikipedia.org/w/api.php`;

export function articleUrl(lang: string, title: string): string {
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

export function sitelinksUrl(qids: readonly string[], langs: readonly Lang[]): string {
  const p = new URLSearchParams({
    action: 'wbgetentities',
    format: 'json',
    formatversion: '2',
    props: 'sitelinks',
    ids: qids.slice(0, SITELINKS_PER_CALL).join('|'),
    sitefilter: [...new Set(langs)].map((l) => `${l}wiki`).join('|'),
  });
  return `https://www.wikidata.org/w/api.php?${p.toString()}`;
}

/** qid -> { tr?: title, en?: title } */
export function parseSitelinks(body: unknown): Map<string, Partial<Record<Lang, string>>> {
  const out = new Map<string, Partial<Record<Lang, string>>>();
  const entities = (body as { entities?: unknown } | null)?.entities;
  if (!entities || typeof entities !== 'object') return out;
  for (const [qid, ent] of Object.entries(entities as Record<string, unknown>)) {
    const links = (ent as { sitelinks?: Record<string, { title?: unknown }> } | null)?.sitelinks;
    const titles: Partial<Record<Lang, string>> = {};
    for (const lang of ['en', 'tr'] as const) {
      const t = links?.[`${lang}wiki`]?.title;
      if (typeof t === 'string' && t) titles[lang] = t;
    }
    out.set(qid, titles);
  }
  return out;
}

const SUMMARY_PROPS = {
  prop: 'extracts|pageimages|pageprops|description',
  exintro: '1',
  explaintext: '1',
  exsentences: '2',
  exlimit: String(EXTRACTS_PER_CALL),
  piprop: 'thumbnail',
  pithumbsize: '320',
  pilimit: String(EXTRACTS_PER_CALL),
  ppprop: 'wikibase_item',
};

export function extractsUrl(lang: Lang, titles: readonly string[]): string {
  const p = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    redirects: '1',
    titles: titles.slice(0, EXTRACTS_PER_CALL).join('|'),
    ...SUMMARY_PROPS,
  });
  return `${API(lang)}?${p.toString()}`;
}

interface RawPage {
  pageid?: unknown;
  title?: unknown;
  missing?: unknown;
  extract?: unknown;
  description?: unknown;
  thumbnail?: { source?: unknown };
  pageprops?: { wikibase_item?: unknown };
  coordinates?: Array<{ lat?: unknown; lon?: unknown }>;
}

function clip(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

function pageToSummary(p: RawPage, lang: Lang): WikiSummary | null {
  if (typeof p.title !== 'string' || p.missing !== undefined) return null;
  const extract = typeof p.extract === 'string' && p.extract.trim() ? clip(p.extract, MAX_EXTRACT) : null;
  const description = typeof p.description === 'string' && p.description.trim() ? clip(p.description, 160) : null;
  const thumb = p.thumbnail?.source;
  const thumbUrl = typeof thumb === 'string' && thumb.startsWith('https://') ? thumb : null;
  return { lang, title: p.title, extract, description, thumbUrl, url: articleUrl(lang, p.title) };
}

/**
 * Summaries keyed by Wikidata id (from pageprops.wikibase_item). Keying by
 * the item, not the title, sidesteps title normalization and redirects.
 */
export function parseExtracts(body: unknown, lang: Lang): Map<string, WikiSummary> {
  const out = new Map<string, WikiSummary>();
  const pages = (body as { query?: { pages?: unknown } } | null)?.query?.pages;
  if (!Array.isArray(pages)) return out;
  for (const p of pages as RawPage[]) {
    const qid = p.pageprops?.wikibase_item;
    const summary = pageToSummary(p, lang);
    if (typeof qid === 'string' && summary) out.set(qid, summary);
  }
  return out;
}

// ---------------------------------------------------------------------------
// GeoSearch fallback
// ---------------------------------------------------------------------------

/** Wikipedia caps GeoSearch at 10 km. */
export const GEOSEARCH_MAX_RADIUS_M = 10_000;
export const GEOSEARCH_LIMIT = 50;

export function geoSearchUrl(lang: Lang, lat: number, lng: number, radiusM: number): string {
  const p = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'geosearch',
    ggscoord: `${lat.toFixed(6)}|${lng.toFixed(6)}`,
    ggsradius: String(Math.min(GEOSEARCH_MAX_RADIUS_M, Math.max(10, Math.round(radiusM)))),
    ggslimit: String(GEOSEARCH_LIMIT),
    ...SUMMARY_PROPS,
    prop: `coordinates|${SUMMARY_PROPS.prop}`,
    colimit: String(GEOSEARCH_LIMIT),
    pilimit: String(GEOSEARCH_LIMIT),
  });
  return `${API(lang)}?${p.toString()}`;
}

/** One geotagged article (poi_cache 'wgeo:v1:<gh5>:<lang>' stores an array of these). */
export interface GeoArticle {
  pageid: number;
  lat: number;
  lon: number;
  wikidata: string | null;
  summary: WikiSummary;
}

export function parseGeoSearch(body: unknown, lang: Lang): GeoArticle[] {
  const pages = (body as { query?: { pages?: unknown } } | null)?.query?.pages;
  if (!Array.isArray(pages)) return [];
  const out: GeoArticle[] = [];
  for (const p of pages as RawPage[]) {
    const c = p.coordinates?.[0];
    const lat = c?.lat;
    const lon = c?.lon;
    if (typeof p.pageid !== 'number' || typeof lat !== 'number' || typeof lon !== 'number') continue;
    const summary = pageToSummary(p, lang);
    if (!summary) continue;
    const qid = p.pageprops?.wikibase_item;
    out.push({
      pageid: p.pageid,
      lat,
      lon,
      wikidata: typeof qid === 'string' && /^Q\d+$/.test(qid) ? qid : null,
      summary,
    });
  }
  return out;
}
