export type Uuid = string;

export type TransportMode = 'driving' | 'walking' | 'transit';

/**
 * Currencies supported by the Phase 8 cost rollup. Matches the
 * `trips_currency_check` constraint in `0005_trip_cost_meta.sql`. If the
 * constraint list grows, widen this union in lockstep.
 */
export type TripCurrency = 'USD' | 'EUR' | 'GBP' | 'TRY' | 'JPY';

export interface Trip {
  id: Uuid;
  user_id: Uuid;
  title: string;
  start_date: string | null;
  end_date: string | null;
  daily_hours_budget: number;
  anchor_place_id: Uuid | null;
  transport_mode: TransportMode;
  timezone: string | null;
  /** ISO timestamp; null means "active". Set by archive / unarchive (Phase 7). */
  archived_at: string | null;
  /** Phase 8: unit-of-account for the per-trip cost rollup (ADR-0007). */
  currency: TripCurrency;
  /** Phase 8: per-kilometer rate the client multiplies against trip_legs.distance_meters (ADR-0007). */
  cost_per_km: number;
  created_at: string;
  updated_at: string;
}

export interface TripPlace {
  id: Uuid;
  trip_id: Uuid;
  google_place_id: string;
  user_title: string | null;
  category: string | null;
  lat: number;
  lng: number;
  visit_duration_minutes: number;
  day_index: number | null;
  order_in_day: number | null;
  notes: string | null;
  details_refreshed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TripDay {
  id: Uuid;
  trip_id: Uuid;
  day_index: number;
  day_start_place_id: Uuid | null;
  day_end_place_id: Uuid | null;
  /** Phase 9: free-text per-day journal entry (Markdown, rendered client-side per ADR-0008). */
  notes: string | null;
}

export interface TripLeg {
  id: Uuid;
  trip_id: Uuid;
  from_place_id: Uuid;
  to_place_id: Uuid;
  day_index: number;
  transport_mode: TransportMode;
  duration_seconds: number;
  distance_meters: number;
  polyline: string | null;
  computed_at: string;
}

export interface PlaceAutocompleteSuggestion {
  placeId: string;
  mainText: string;
  secondaryText: string;
}

export interface PlacePhoto {
  name: string;
  widthPx: number;
  heightPx: number;
  attributions: Array<{ displayName: string; uri?: string; photoUri?: string }>;
}

export interface PlaceReview {
  name: string;
  rating: number;
  text: { text: string; languageCode?: string } | null;
  authorAttribution: {
    displayName: string;
    uri?: string;
    photoUri?: string;
  };
  publishTime: string;
  relativePublishTimeDescription: string;
}

export interface PlaceOpeningHours {
  openNow: boolean;
  weekdayDescriptions: string[];
}

export interface PlaceDetails {
  placeId: string;
  displayName: string;
  formattedAddress: string;
  location: { latitude: number; longitude: number };
  types: string[];
  rating: number | null;
  userRatingCount: number | null;
  priceLevel: string | null;
  photos: PlacePhoto[];
  reviews: PlaceReview[];
  regularOpeningHours: PlaceOpeningHours | null;
  nationalPhoneNumber: string | null;
  websiteUri: string | null;
  googleMapsUri: string | null;
}

export type CreateTripInput = {
  title: string;
  start_date?: string | null;
  end_date?: string | null;
  daily_hours_budget?: number;
  transport_mode?: TransportMode;
  timezone?: string | null;
};

export type CreateTripPlaceInput = {
  trip_id: Uuid;
  google_place_id: string;
  user_title?: string | null;
  category?: string | null;
  lat: number;
  lng: number;
  visit_duration_minutes?: number;
  notes?: string | null;
};

// ============================================================
// Share links (Phase 4)
// ============================================================

/**
 * A trip returned by the anonymous share-trip:read path.
 * Excludes `user_id` and all Google-ToS-restricted content. Only ToS-safe
 * persistable fields are present on places (no reviews/photos/rating/etc).
 */
export interface SharedTrip {
  trip: Pick<
    Trip,
    | 'id'
    | 'title'
    | 'start_date'
    | 'end_date'
    | 'daily_hours_budget'
    | 'transport_mode'
    | 'timezone'
  >;
  places: Array<
    Pick<
      TripPlace,
      | 'id'
      | 'google_place_id'
      | 'user_title'
      | 'category'
      | 'lat'
      | 'lng'
      | 'visit_duration_minutes'
      | 'day_index'
      | 'order_in_day'
      | 'notes'
    >
  >;
  legs: Array<
    Pick<
      TripLeg,
      | 'id'
      | 'from_place_id'
      | 'to_place_id'
      | 'day_index'
      | 'transport_mode'
      | 'duration_seconds'
      | 'distance_meters'
      | 'polyline'
      | 'computed_at'
    >
  >;
}

export interface CreateShareResult {
  token: string;
}

export interface RevokeShareResult {
  revoked: number;
}

// ============================================================
// Account export (Phase 10)
// ============================================================

/**
 * Response shape from the `export-account` Edge Function (ADR-0009).
 *
 * The function reads `trips` filtered by the JWT-derived user id, then reads
 * `trip_places` / `trip_legs` / `trip_days` filtered by `trip_id in (<owned
 * trips>)`. The result is a flat dump — clients re-aggregate by `trip_id` if
 * needed.
 *
 * `exported_at` is the server-side ISO8601 timestamp at which the export was
 * generated. `user_id` matches the caller's auth.uid().
 */
export interface AccountExport {
  user_id: Uuid;
  exported_at: string;
  trips: Trip[];
  trip_places: TripPlace[];
  trip_legs: TripLeg[];
  trip_days: TripDay[];
}
