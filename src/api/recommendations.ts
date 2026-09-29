// Tripvisor M5 Y1.3 — interest-based recommendations client for the
// `poi-recommend` Edge Function (ADR-0013). Candidates come from free
// OpenStreetMap (Overpass) data, with Wikipedia summaries for notable places.
// Nothing here is Google data: the Google rating/reviews of a card are
// fetched only on tap, through the existing place-details hook.
//
// Tier-2, MEMORY-ONLY: the 'recommendations' key root is deliberately NOT in
// the persister allowlist (src/api/offline.*.ts default-deny), so results
// never reach disk. Query keys are local (shared-file rule for parallel
// waves).
//
// M5 Y2.5 ergonomics for the Discover screen (Y3.4):
//   - `lang` defaults to the app language (`appLanguage()`).
//   - `useRecommendations({ tripId, dayIndex?, center?, interests })` centres
//     the search on an explicit point, else the day's / trip's places
//     (`useRecommendationCenter` exposes the same centre + its source).
//     The raw `useRecommendations({ lat, lng, interests })` form is unchanged.
//   - `useAddPoiToTrip(tripId)` adds a card to the trip: it resolves a
//     `google_place_id` with ONE metered `places-autocomplete` call (card
//     name + a 1 km location bias, optional retry with the local name), then
//     creates the place through the normal create hook (OSM coordinates and
//     the card name as title: no Google content is stored) and, when a day
//     is given, schedules it through the existing move-to-day path. There is
//     NO Google `resolve` in poi-recommend (handoff rule).
//
// ATTRIBUTION (required): any list rendering these items must show
// `response.attribution.osm` ("© OpenStreetMap contributors", linking
// `osmUrl`), and every card with `wiki` must link `wiki.url` and show the
// `attribution.wikipedia` licence note (CC BY-SA).

import { useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from './supabase';
import { EdgeFunctionError, tryParseEdgeFunctionError } from './_errors';
import { toApiLang } from './_lang';
import { fetchPlacesAutocomplete, newAutocompleteSessionToken, PlacesError } from './places';
import { useCreateTripPlace, useMoveToDay, useTripPlaces } from './trip-places';
import { inferCategoryDefault } from '@/lib/categoryDurations';
import type { PlaceAutocompleteSuggestion, TripPlace, Uuid } from './types';
import type {
  AddPoiErrorCode,
  AddPoiToTripInput,
  AddPoiToTripResult,
  LatLng,
  PoiForAdd,
  PoiGoogleMatch,
  RecommendationCenter,
  RecommendationQuery,
} from './recommendations.types';

export type {
  AddPoiErrorCode,
  AddPoiToTripInput,
  AddPoiToTripResult,
  LatLng,
  PoiForAdd,
  PoiGoogleMatch,
  RecommendationCenter,
  RecommendationCenterSource,
  RecommendationQuery,
} from './recommendations.types';

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
  /**
   * 'tr', 'en', 'tr-TR' …; anything not Turkish is English. Omitted = the
   * app language (M5 Y2.5).
   */
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
  const lang: 'en' | 'tr' = toApiLang(p.lang);
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

function isPointParams(p: RecommendationParams | RecommendationQuery): p is RecommendationParams {
  const q = p as Partial<RecommendationParams>;
  return typeof q.lat === 'number' && typeof q.lng === 'number';
}

/**
 * Recommendations for the selected interests, around either
 *   - a point: `{ lat, lng, interests, … }` (the Y1.3 form, unchanged), or
 *   - a trip: `{ tripId, dayIndex?, center?, interests, … }` (M5 Y2.5):
 *     `center` wins, else the centroid of `dayIndex`'s places, else of the
 *     whole trip (see `useRecommendationCenter` for the centre + its source).
 * Pass `undefined` (or no interests) to hold the query; a trip without
 * placed stops holds too (offer "current location" / "map centre" then).
 * `lang` defaults to the app language. Results are memory-only (never
 * persisted) and fresh for 1 h, matching the server's Cache-Control.
 */
export function useRecommendations(
  params: RecommendationParams | RecommendationQuery | undefined,
  options: { enabled?: boolean } = {},
) {
  const tripQuery = params && !isPointParams(params) ? params : undefined;
  const resolved = useRecommendationCenter({
    tripId: tripQuery?.tripId,
    dayIndex: tripQuery?.dayIndex,
    center: tripQuery?.center,
  });
  let effective: RecommendationParams | undefined;
  if (params && isPointParams(params)) {
    effective = params;
  } else if (tripQuery && resolved.center) {
    effective = {
      lat: resolved.center.lat,
      lng: resolved.center.lng,
      interests: tripQuery.interests,
      lang: tripQuery.lang,
      radiusM: tripQuery.radiusM,
      limit: tripQuery.limit,
      enrich: tripQuery.enrich,
    };
  }
  const ready = !!effective && effective.interests.length > 0;
  return useQuery<RecommendationsResponse, RecommendationsError | Error>({
    queryKey: ready ? recommendationKeys.search(effective!) : [...recommendationKeys.all, 'none'],
    enabled: (options.enabled ?? true) && ready,
    staleTime: 60 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error instanceof RecommendationsError && NON_RETRYABLE.has(error.code)) return false;
      return failureCount < 1; // one retry: a search can already take ~25 s server-side
    },
    queryFn: () => fetchRecommendations(effective!),
  });
}

// ===========================================================================
// M5 Y2.5 — search centre from the trip (pure + hook)
// ===========================================================================

/** Beyond this spread (m from the mean) the mean is meaningless: use the medoid. */
export const COMPACT_SPREAD_M = 25_000;
/** Medoid search is O(n²): cap the points considered. */
const MEDOID_MAX_POINTS = 200;

function haversineM(a: LatLng, b: LatLng): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The point to search around for a set of stops: their mean when they are
 * compact (a city), otherwise the MEDOID (the stop closest to all others),
 * so a two-city trip centres on the busier city instead of the empty space
 * between them. Handles the antimeridian.
 */
export function centerOfPoints(points: readonly LatLng[]): LatLng | null {
  if (points.length === 0) return null;
  const lngs = points.map((p) => p.lng);
  const unwrap = Math.max(...lngs) - Math.min(...lngs) > 180;
  const unwrapped = unwrap ? lngs.map((l) => (l < 0 ? l + 360 : l)) : lngs;
  let meanLng = unwrapped.reduce((s, l) => s + l, 0) / points.length;
  if (meanLng > 180) meanLng -= 360;
  const mean = { lat: points.reduce((s, p) => s + p.lat, 0) / points.length, lng: meanLng };
  const spread = Math.max(...points.map((p) => haversineM(mean, p)));
  if (spread <= COMPACT_SPREAD_M) return mean;
  const pool = points.slice(0, MEDOID_MAX_POINTS);
  let best = pool[0]!;
  let bestSum = Infinity;
  for (const p of pool) {
    let sum = 0;
    for (const q of pool) sum += haversineM(p, q);
    if (sum < bestSum) {
      bestSum = sum;
      best = p;
    }
  }
  return { lat: best.lat, lng: best.lng };
}

type PlaceLike = Pick<TripPlace, 'lat' | 'lng'> & { day_index?: number | null; deleted?: boolean };

/**
 * Pure: the search centre from a trip's places. With `dayIndex`, that day's
 * live stops when it has any (source 'day'); otherwise every live stop
 * (source 'trip'); none → null.
 */
export function recommendationCenterFromPlaces(
  places: readonly PlaceLike[],
  dayIndex?: number | null,
): Omit<RecommendationCenter, 'loading'> {
  const live = places.filter(
    (p) => p.deleted !== true && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90,
  );
  if (dayIndex !== undefined && dayIndex !== null) {
    const day = live.filter((p) => p.day_index === dayIndex);
    const c = centerOfPoints(day);
    if (c) return { center: c, source: 'day', placeCount: day.length };
  }
  const c = centerOfPoints(live);
  return c ? { center: c, source: 'trip', placeCount: live.length } : { center: null, source: 'none', placeCount: 0 };
}

function isLatLng(v: LatLng | null | undefined): v is LatLng {
  return !!v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180;
}

/**
 * Where Discover searches: `center` when given, else the day's / trip's
 * stops (reads the trip's places through `useTripPlaces`, Tier-1 aware).
 */
export function useRecommendationCenter(q: {
  tripId?: Uuid;
  dayIndex?: number | null;
  center?: LatLng | null;
}): RecommendationCenter {
  const explicit = isLatLng(q.center) ? q.center : null;
  // Always called (hook order); idle when a centre is given or no trip.
  const places = useTripPlaces(explicit ? undefined : q.tripId);
  const explicitLat = explicit?.lat;
  const explicitLng = explicit?.lng;
  const loading = !explicit && !!q.tripId && places.isLoading;
  const data = places.data;
  return useMemo<RecommendationCenter>(() => {
    if (explicitLat !== undefined && explicitLng !== undefined) {
      return { center: { lat: explicitLat, lng: explicitLng }, source: 'explicit', placeCount: 0, loading: false };
    }
    if (!q.tripId || loading) return { center: null, source: 'none', placeCount: 0, loading };
    return { ...recommendationCenterFromPlaces(data ?? [], q.dayIndex), loading: false };
  }, [explicitLat, explicitLng, q.tripId, q.dayIndex, loading, data]);
}

// ===========================================================================
// M5 Y2.5 — add a POI card to the trip
// ===========================================================================

/** Typed failure of `useAddPoiToTrip` / `resolvePoiGooglePlace`; branch on `.code`. */
export class AddPoiError extends Error {
  constructor(
    public readonly code: AddPoiErrorCode,
    message: string,
    /** The underlying error (PlacesError, PostgREST error, …), for logs. */
    public readonly underlying?: unknown,
  ) {
    super(message);
    this.name = 'AddPoiError';
  }
}

/** Location bias around the card: Google prefers matches within ~1 km. */
const POI_MATCH_RADIUS_M = 1000;
/** Same schedule as the add-place screen (a just-created row may not be on the server yet). */
const MOVE_RETRY_DELAYS_MS = [0, 800, 2000];

function mapPlacesError(err: unknown): AddPoiError {
  if (err instanceof PlacesError) {
    if (err.code === 'quota_exceeded') return new AddPoiError('quota_exceeded', err.message, err);
    if (err.code === 'not_authenticated') return new AddPoiError('not_authenticated', err.message, err);
    if (err.code === 'invalid_input') return new AddPoiError('invalid_input', err.message, err);
    return new AddPoiError('places_unavailable', err.message, err);
  }
  return new AddPoiError('places_unavailable', err instanceof Error ? err.message : 'Places request failed', err);
}

/**
 * Comparison key: case/diacritics-insensitive, punctuation-insensitive.
 * (No `\p{…}` regex: keep it portable across Hermes versions; any script's
 * letters survive, only spacing and ASCII-ish punctuation are folded.)
 */
function matchKey(s: string): string {
  const decomposed = typeof s.normalize === 'function' ? s.normalize('NFD') : s;
  return decomposed
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .replace(/[\s\-_.,;:'"`’‘“”()[\]{}/\\&+!?|·–—]+/g, ' ')
    .trim();
}

/**
 * The suggestion to use for a card: an exact (normalised) name match, else
 * one whose name contains / is contained in the card name, else Google's
 * first suggestion (the location bias already ranks nearby places first).
 */
export function pickPoiSuggestion(
  suggestions: readonly PlaceAutocompleteSuggestion[],
  names: readonly string[],
): PlaceAutocompleteSuggestion | null {
  if (suggestions.length === 0) return null;
  const keys = names.map(matchKey).filter(Boolean);
  const exact = suggestions.find((s) => keys.includes(matchKey(s.mainText)));
  if (exact) return exact;
  const partial = suggestions.find((s) => {
    const k = matchKey(s.mainText);
    return !!k && keys.some((n) => k.includes(n) || n.includes(k));
  });
  return partial ?? suggestions[0]!;
}

/**
 * Resolve a POI card to a Google place id with the quota-metered
 * `places-autocomplete` (card name, then its local name if different; 1 km
 * location bias; one session token). Throws `AddPoiError`.
 */
export async function resolvePoiGooglePlace(
  poi: PoiForAdd,
  opts: { sessionToken?: string; lang?: 'en' | 'tr' } = {},
): Promise<PoiGoogleMatch> {
  if (!isLatLng(poi)) throw new AddPoiError('invalid_input', 'The card has no valid location');
  const names = [...new Set([poi.name, poi.originalName].map((n) => (n ?? '').trim()).filter(Boolean))];
  if (names.length === 0) throw new AddPoiError('invalid_input', 'The card has no name');
  const sessionToken = opts.sessionToken ?? newAutocompleteSessionToken();
  for (const name of names.slice(0, 2)) {
    let suggestions: PlaceAutocompleteSuggestion[];
    try {
      suggestions = await fetchPlacesAutocomplete({
        input: name.slice(0, 200),
        sessionToken,
        locationBias: { lat: poi.lat, lng: poi.lng, radiusMeters: POI_MATCH_RADIUS_M },
        lang: opts.lang,
      });
    } catch (err) {
      throw mapPlacesError(err);
    }
    const pick = pickPoiSuggestion(suggestions, names);
    if (pick) {
      return { placeId: pick.placeId, mainText: pick.mainText, secondaryText: pick.secondaryText, query: name };
    }
  }
  throw new AddPoiError('no_match', `No map place found for "${names[0]}"`);
}

/** OSM `kind` ('key=value') → Google-like types for `inferCategoryDefault`. */
function poiTypes(poi: PoiForAdd): string[] {
  const [key = '', value = ''] = (poi.kind ?? '').split('=');
  if (key === 'tourism' && value === 'museum') return ['museum'];
  if (key === 'tourism' && (value === 'gallery' || value === 'artwork')) return ['art_gallery'];
  if (key === 'amenity' && ['restaurant', 'cafe', 'fast_food', 'food_court', 'ice_cream'].includes(value)) {
    return ['restaurant'];
  }
  if (key === 'amenity' && ['bar', 'pub', 'biergarten', 'nightclub'].includes(value)) return ['bar'];
  if (key === 'leisure' && (value === 'park' || value === 'garden')) return ['park'];
  if (key === 'natural' && value === 'beach') return ['beach'];
  if (key === 'natural' || key === 'boundary' || (key === 'leisure' && value === 'nature_reserve')) {
    return ['natural_feature'];
  }
  if (key === 'amenity' && value === 'place_of_worship') return ['church'];
  if (key === 'historic' && value === 'mosque') return ['mosque'];
  if (key === 'historic' && (value === 'church' || value === 'monastery')) return ['church'];
  if (key === 'shop' || (key === 'amenity' && value === 'marketplace')) return ['store'];
  if ((key === 'tourism' && ['zoo', 'aquarium', 'theme_park'].includes(value)) || (key === 'leisure' && ['water_park', 'playground'].includes(value))) {
    return ['zoo'];
  }
  if (key === 'historic' || key === 'man_made' || (key === 'tourism' && ['attraction', 'viewpoint'].includes(value))) {
    return ['tourist_attraction'];
  }
  switch (poi.interests?.[0]) {
    case 'food':
      return ['restaurant'];
    case 'nature':
      return ['natural_feature'];
    case 'museums':
      return ['museum'];
    case 'nightlife':
      return ['bar'];
    case 'shopping':
      return ['store'];
    case 'kids':
      return ['zoo'];
    case 'history':
    case 'viewpoints':
      return ['tourist_attraction'];
    default:
      return [];
  }
}

/** Category + visit minutes for a card, on the same scale as the add-place screen. */
export function poiCategoryDefault(poi: PoiForAdd): { category: string; durationMinutes: number } {
  return inferCategoryDefault(poiTypes(poi));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * "Add to Ideas / Day N" from a recommendation card:
 *   `const add = useAddPoiToTrip(tripId);`
 *   `add.mutate({ poi: item, dayIndex: 0, existingGooglePlaceIds })`
 * Steps: resolve a Google place id (ONE metered autocomplete call, maybe a
 * second with the card's local name) → create the trip place through
 * `useCreateTripPlace` (Tier-1 aware; title = the card name, coordinates =
 * the card's OSM point; no Google content stored) → when `dayIndex` is set,
 * move it there through `useMoveToDay` (online path, retried like add.tsx).
 * Pass `match` (from `resolvePoiGooglePlace`, e.g. done by the detail sheet
 * with the same session token as its place-details call) to skip the search.
 * Fails with `AddPoiError` (see `AddPoiErrorCode`). Online-only by nature
 * (the Google match needs the network), so it pauses offline.
 */
export function useAddPoiToTrip(tripId?: Uuid) {
  const createPlace = useCreateTripPlace();
  const moveToDay = useMoveToDay();
  return useMutation<AddPoiToTripResult, AddPoiError, AddPoiToTripInput>({
    retry: false,
    mutationFn: async (input) => {
      const targetTrip = input.tripId ?? tripId;
      if (!targetTrip) throw new AddPoiError('invalid_input', 'tripId is required');
      const dayIndex = input.dayIndex ?? null;
      if (dayIndex !== null && (!Number.isInteger(dayIndex) || dayIndex < 0)) {
        throw new AddPoiError('invalid_input', 'dayIndex must be a 0-based integer');
      }

      if (!isLatLng(input.poi)) throw new AddPoiError('invalid_input', 'The card has no valid location');
      const match =
        input.match ??
        (await resolvePoiGooglePlace(input.poi, { sessionToken: input.sessionToken, lang: input.lang }));
      if (input.existingGooglePlaceIds && new Set(input.existingGooglePlaceIds).has(match.placeId)) {
        throw new AddPoiError('already_in_trip', 'This place is already in the trip');
      }

      const defaults = poiCategoryDefault(input.poi);
      let place: TripPlace;
      try {
        place = await createPlace.mutateAsync({
          trip_id: targetTrip,
          google_place_id: match.placeId,
          user_title: input.poi.name.slice(0, 200),
          category: defaults.category,
          visit_duration_minutes: defaults.durationMinutes,
          lat: input.poi.lat,
          lng: input.poi.lng,
        });
      } catch (err) {
        throw new AddPoiError('create_failed', err instanceof Error ? err.message : 'Could not add the place', err);
      }

      let scheduled: boolean | null = null;
      if (dayIndex !== null) {
        scheduled = false;
        for (const delay of MOVE_RETRY_DELAYS_MS) {
          if (delay) await wait(delay);
          try {
            await moveToDay.mutateAsync({ id: place.id, tripId: targetTrip, toDayIndex: dayIndex });
            scheduled = true;
            break;
          } catch {
            // retried; a final failure leaves the place in Ideas (scheduled: false)
          }
        }
      }
      return { place, googlePlaceId: match.placeId, matchedName: match.mainText, scheduled };
    },
  });
}
