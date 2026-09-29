// Tripvisor M5 Y1.3 — interest-based recommendations client for the
// `poi-recommend` Edge Function (ADR-0013). Candidates come from free
// OpenStreetMap (Overpass) data, with Wikipedia summaries for notable places.
// Nothing here is Google data: the Google rating/reviews of a card are
// fetched only on tap, through the existing place-details hook.
//
// Tier-2, MEMORY-ONLY: the 'recommendations' key root is deliberately NOT in
// the persister allowlist (src/api/offline.*.ts default-deny), so results
// never reach disk. Query keys are local (shared-file rule for parallel
// waves); Y2.5 extends this module (e.g. resolve-to-Google on "add").
//
// ATTRIBUTION (required): any list rendering these items must show
// `response.attribution.osm` ("© OpenStreetMap contributors", linking
// `osmUrl`), and every card with `wiki` must link `wiki.url` and show the
// `attribution.wikipedia` licence note (CC BY-SA).

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from './supabase';
import { EdgeFunctionError, tryParseEdgeFunctionError } from './_errors';

// ===========================================================================
// Types (mirror supabase/functions/poi-recommend/handler.ts, contractVersion 1)
// ===========================================================================

export const RECOMMENDATIONS_CONTRACT_VERSION = 1;

/** Interest keys (owned by supabase/functions/_shared/interests.ts; same set as user_preferences.interests). */
export const INTERESTS = [
  'history',
  'food',
  'nature',
  'museums',
  'nightlife',
  'shopping',
  'kids',
  'viewpoints',
] as const;
export type Interest = (typeof INTERESTS)[number];

export function isInterest(v: unknown): v is Interest {
  return typeof v === 'string' && (INTERESTS as readonly string[]).includes(v);
}

export interface WikiSummary {
  lang: 'en' | 'tr';
  title: string;
  extract: string | null;
  description: string | null;
  thumbUrl: string | null;
  url: string;
}

export interface PoiItem {
  /** Stable id: 'osm:node/123' | 'osm:way/…' | 'osm:relation/…' | 'wiki:Q123' | 'wiki:en/456'. */
  id: string;
  source: 'osm' | 'wikipedia';
  osm: { type: 'node' | 'way' | 'relation'; id: number } | null;
  /** Display name in the requested language when OSM has one. */
  name: string;
  /** The local-language name when it differs from `name`. */
  originalName: string | null;
  lat: number;
  lng: number;
  distanceM: number;
  /** Matched requested interests, best first ([] for Wikipedia fallback items). */
  interests: Interest[];
  /** Primary OSM tag as 'key=value' (e.g. 'historic=castle'), or null. */
  kind: string | null;
  /** Trimmed OSM tags (cuisine, opening_hours, website, wheelchair, …). */
  tags: Record<string, string>;
  wikidata: string | null;
  wiki: WikiSummary | null;
  /** 0..1 ranking score (notability > distance > kind). */
  score: number;
}

export type RecommendationsDegraded =
  | 'partial'
  | 'user_quota'
  | 'global_cap'
  | 'overpass_unavailable'
  | 'cache_only';

export interface RecommendationsResponse {
  items: PoiItem[];
  center: { lat: number; lng: number };
  radiusM: number;
  interests: Interest[];
  lang: 'en' | 'tr';
  attribution: { osm: string; osmUrl: string; wikipedia: string | null; wikipediaUrl: string | null };
  /** null = full results. Otherwise show a soft banner (see the codes). */
  degraded: RecommendationsDegraded | null;
  meta: {
    contractVersion: number;
    cache: 'hit' | 'miss' | 'partial';
    tiles: number;
    upstream: 'overpass' | 'wikipedia' | null;
    instance: string | null;
  };
}

export interface RecommendationParams {
  lat: number;
  lng: number;
  /** Metres; the server clamps to 100..5000 (default 1500). */
  radiusM?: number;
  interests: Interest[];
  /** App language ('tr', 'en', 'tr-TR' …); anything not Turkish is English. */
  lang?: string;
  /** 1..30 (default 30). */
  limit?: number;
  /** Wikipedia summaries for the top cards (default true). */
  enrich?: boolean;
}

/**
 * Typed error for the `poi-recommend` envelope. Known codes:
 *   invalid_input 400 · not_authenticated 401 · quota_exceeded 429 (daily
 *   new-area searches; resets 00:00 UTC) · quota_unavailable 503 ·
 *   recommendations_disabled 503 (kill switch) · internal_error 500
 */
export class RecommendationsError extends EdgeFunctionError {
  constructor(code: string, message: string, status: number) {
    super(code, message, status);
    this.name = 'RecommendationsError';
  }
}

const NON_RETRYABLE = new Set(['invalid_input', 'not_authenticated', 'quota_exceeded', 'recommendations_disabled']);

// ===========================================================================
// Request normalisation + keys
// ===========================================================================

/** ~110 m: the request AND the cache key use it, so they always agree. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function normalizeRecommendationParams(p: RecommendationParams) {
  const lang: 'en' | 'tr' = (p.lang ?? '').toLowerCase().startsWith('tr') ? 'tr' : 'en';
  return {
    lat: round3(p.lat),
    lng: round3(p.lng),
    radiusM: Math.round(p.radiusM ?? 1500),
    interests: [...new Set(p.interests)].sort() as Interest[],
    lang,
    limit: p.limit ?? 30,
    enrich: p.enrich ?? true,
  };
}

export const recommendationKeys = {
  all: ['recommendations'] as const,
  search: (p: RecommendationParams) => {
    const n = normalizeRecommendationParams(p);
    return [
      ...recommendationKeys.all,
      'search',
      n.lat,
      n.lng,
      n.radiusM,
      n.interests.join(','),
      n.lang,
      n.limit,
      n.enrich,
    ] as const;
  },
};

// ===========================================================================
// Response validation (contract drift fails loudly; additive fields pass)
// ===========================================================================

const wikiSchema = z.object({
  lang: z.enum(['en', 'tr']),
  title: z.string(),
  extract: z.string().nullable(),
  description: z.string().nullable(),
  thumbUrl: z.string().nullable(),
  url: z.string(),
});

const itemSchema = z.object({
  id: z.string(),
  source: z.enum(['osm', 'wikipedia']),
  osm: z.object({ type: z.enum(['node', 'way', 'relation']), id: z.number() }).nullable(),
  name: z.string(),
  originalName: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  distanceM: z.number(),
  // Unknown future interest keys are dropped rather than failing the list.
  interests: z.array(z.string()).transform((a) => a.filter(isInterest)),
  kind: z.string().nullable(),
  tags: z.record(z.string()),
  wikidata: z.string().nullable(),
  wiki: wikiSchema.nullable(),
  score: z.number(),
});

const responseSchema = z.object({
  items: z.array(itemSchema),
  center: z.object({ lat: z.number(), lng: z.number() }),
  radiusM: z.number(),
  interests: z.array(z.string()).transform((a) => a.filter(isInterest)),
  lang: z.enum(['en', 'tr']),
  attribution: z.object({
    osm: z.string(),
    osmUrl: z.string(),
    wikipedia: z.string().nullable(),
    wikipediaUrl: z.string().nullable(),
  }),
  degraded: z.enum(['partial', 'user_quota', 'global_cap', 'overpass_unavailable', 'cache_only']).nullable(),
  meta: z.object({
    contractVersion: z.number(),
    cache: z.enum(['hit', 'miss', 'partial']),
    tiles: z.number(),
    upstream: z.enum(['overpass', 'wikipedia']).nullable(),
    instance: z.string().nullable(),
  }),
});

// ===========================================================================
// Fetcher + hook
// ===========================================================================

export async function fetchRecommendations(params: RecommendationParams): Promise<RecommendationsResponse> {
  const body = { action: 'search', ...normalizeRecommendationParams(params) };
  const { data, error } = await supabase.functions.invoke('poi-recommend', { body });
  if (error) {
    const typed = await tryParseEdgeFunctionError(error, RecommendationsError);
    if (typed) throw typed;
    throw error;
  }
  return responseSchema.parse(data) as RecommendationsResponse;
}

/**
 * Recommendations around a point for the selected interests. Pass
 * `undefined` (or no interests) to hold the query, e.g. while the trip
 * centroid loads. Results are memory-only (never persisted) and fresh for
 * 1 h, matching the server's Cache-Control.
 */
export function useRecommendations(params: RecommendationParams | undefined, options: { enabled?: boolean } = {}) {
  const ready = !!params && params.interests.length > 0;
  return useQuery<RecommendationsResponse, RecommendationsError | Error>({
    queryKey: ready ? recommendationKeys.search(params!) : [...recommendationKeys.all, 'none'],
    enabled: (options.enabled ?? true) && ready,
    staleTime: 60 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error instanceof RecommendationsError && NON_RETRYABLE.has(error.code)) return false;
      return failureCount < 1; // one retry: a search can already take ~25 s server-side
    },
    queryFn: () => fetchRecommendations(params!),
  });
}
