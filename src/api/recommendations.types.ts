// M5 Y2.5 — types for the recommendations ergonomics consumed by Y3.4
// (Discover screen): trip-aware search centre + "add a POI card to the trip".
// The poi-recommend wire types (PoiItem, RecommendationsResponse, …) stay in
// ./recommendations.ts; new types live here (Wave-2 file-ownership rule).

import type { ApiLang } from './_lang';
import type { Interest, PoiItem } from './recommendations';
import type { TripPlace, Uuid } from './types';

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Trip-aware recommendation query (alternative to the raw `{ lat, lng }`
 * params). Centre precedence: `center` → the centroid of `dayIndex`'s places
 * → the trip's centroid. Holds (no request) until a centre is known and at
 * least one interest is picked.
 */
export interface RecommendationQuery {
  tripId?: Uuid;
  /** 0-based day whose places define the centre (falls back to the whole trip). */
  dayIndex?: number | null;
  /** Explicit centre (current location / map centre); wins over the trip. */
  center?: LatLng | null;
  interests: Interest[];
  /** Defaults to the app language. */
  lang?: ApiLang | string;
  /** Metres; the server clamps to 100..5000 (default 1500). */
  radiusM?: number;
  limit?: number;
  enrich?: boolean;
}

/**
 * Where the search centre came from:
 *   explicit — `center` was given; day — the chosen day's places;
 *   trip — all the trip's places; none — nothing to centre on yet.
 */
export type RecommendationCenterSource = 'explicit' | 'day' | 'trip' | 'none';

export interface RecommendationCenter {
  center: LatLng | null;
  source: RecommendationCenterSource;
  /** Places the centre was computed from (0 for explicit / none). */
  placeCount: number;
  /** True while the trip's places are still loading. */
  loading: boolean;
}

/** The fields of a POI card the add flow needs (a `PoiItem` fits). */
export type PoiForAdd = Pick<PoiItem, 'name' | 'lat' | 'lng'> &
  Partial<Pick<PoiItem, 'originalName' | 'kind' | 'interests'>>;

export interface AddPoiToTripInput {
  poi: PoiForAdd;
  /** Defaults to the hook's `tripId`. */
  tripId?: Uuid;
  /** 0-based day to schedule on; null / undefined = the Ideas bucket. */
  dayIndex?: number | null;
  /**
   * `google_place_id`s already in the trip (e.g. from `useTripPlaces`). A
   * match on one of them fails with `already_in_trip` instead of adding a
   * duplicate.
   */
  existingGooglePlaceIds?: Iterable<string>;
  /** Autocomplete session token (a fresh one per add when omitted). */
  sessionToken?: string;
  /**
   * A match already resolved for this card (e.g. by the detail sheet via
   * `resolvePoiGooglePlace`): skips the autocomplete call, so "tap → details
   * → add" costs one metered search, not two.
   */
  match?: PoiGoogleMatch;
  /** Result language for the Google match (default: the app language). */
  lang?: ApiLang;
}

export interface AddPoiToTripResult {
  place: TripPlace;
  googlePlaceId: string;
  /** Google's name for the match; show it when it differs from the card. Not stored. */
  matchedName: string;
  /**
   * null = no day asked. true = scheduled on `dayIndex`. false = created in
   * Ideas but the move to the day failed (tell the user to move it; same as
   * the add-place screen).
   */
  scheduled: boolean | null;
}

/**
 * `AddPoiError.code`, stable keys for the UI (map to `discover:` strings):
 *   no_match            Google found nothing for the card name near its location
 *   quota_exceeded      the daily Places search quota is spent (resets 00:00 UTC)
 *   places_unavailable  Places not configured / Google error / offline
 *   not_authenticated   no session
 *   already_in_trip     the match is already a place of this trip
 *   create_failed       the trip place could not be created
 *   invalid_input       no trip id, bad coordinates or day index
 * trip_places.google_place_id is NOT NULL, so there is no "custom place"
 * fallback: without a Google match the card cannot be added (yet).
 */
export type AddPoiErrorCode =
  | 'no_match'
  | 'quota_exceeded'
  | 'places_unavailable'
  | 'not_authenticated'
  | 'already_in_trip'
  | 'create_failed'
  | 'invalid_input';

/** The Google autocomplete match chosen for a POI card. */
export interface PoiGoogleMatch {
  placeId: string;
  mainText: string;
  secondaryText: string;
  /** The name that produced the match (the card name or its local name). */
  query: string;
}
