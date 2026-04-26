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
  /**
   * Phase 8: per-kilometer rate the client multiplies against trip_legs.distance_meters (ADR-0007).
   * @deprecated 2026-04-25 (Phase 20 Step 6) — replaced by the category-based
   * budget model (`total_budget` + `trip_expenses` table). Kept on the row
   * for back-compat until Phase 21 Step 4 migrates the UI; future migration
   * will drop the column.
   */
  cost_per_km: number;
  /**
   * Phase 20 Step 6: optional total-trip budget ceiling. Unit is `currency`.
   * Null means "no ceiling configured" — the per-category sum from
   * trip_expenses is still meaningful on its own.
   */
  total_budget: number | null;
  created_at: string;
  updated_at: string;
  /**
   * Phase 22 Step 22.3: derived, NOT stored in the trips table.
   * `useTrips()` returns the UNION of owner-trips and accepted-
   * collaborator trips and tags each row so the UI can render
   * "Shared with me" / role badges without an extra round-trip.
   *
   * - `isOwner = true` AND `collaboratorRole = null` → caller is the trip owner.
   * - `isOwner = false` AND `collaboratorRole !== null` → caller is an accepted collaborator.
   *
   * Both populated client-side by `useTrips`. Other read paths
   * (`useTrip(id)` for the detail screen, RPCs, the share Edge Function)
   * may leave these undefined; consumers should be defensive.
   */
  isOwner?: boolean;
  collaboratorRole?: TripCollaboratorRole | null;
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

/**
 * Phase 20 Step 6: category enum for `trip_expenses.category`. Mirrors the
 * `trip_expenses_category_check` constraint in
 * `0010_trip_budget_categories.sql`. If the constraint list grows, widen
 * this union in lockstep.
 */
export type TripExpenseCategory =
  | 'accommodation'
  | 'food'
  | 'transport'
  | 'shopping'
  | 'activities'
  | 'other';

/**
 * Phase 20 Step 6: estimated rows are pre-trip / planning entries; actual
 * rows are recorded after the fact. Both can coexist for the same
 * trip/category — Phase 21 will surface variance.
 */
export type TripExpenseKind = 'estimated' | 'actual';

export interface TripExpense {
  id: Uuid;
  trip_id: Uuid;
  category: TripExpenseCategory;
  amount: number;
  kind: TripExpenseKind;
  /** Optional pinning to a specific day (`null` = trip-level). */
  day_index: number | null;
  /** Free-text label for the line item (e.g. "Hotel night 2"). NOT a place reference. */
  label: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Phase 21 Steps 21.8 / 21.9: per-trip lodging entries with date-range
 * semantics. Anchored to a Google Place when available (`google_place_id`
 * + denormalized `lat`/`lng`), or falls back to a free-text `address`.
 *
 * Cost is recorded SEPARATELY in `trip_expenses` (`category = 'accommodation'`).
 * The two tables are intentionally not back-linked in v1 — the per-stay
 * cost breakdown is a future feature if product asks for it.
 *
 * CHECK invariants enforced server-side (see `0012_trip_accommodations.sql`):
 *   - `check_out_date > check_in_date` (strictly greater; zero-night stays rejected)
 *   - if `google_place_id` is set, both `lat` and `lng` MUST be set
 */
export interface TripAccommodation {
  id: Uuid;
  trip_id: Uuid;
  /** User-facing label, e.g. "Hilton Rome" or "Sarah's flat". */
  name: string;
  /** Optional Google Place anchor. When set, lat/lng are also set. */
  google_place_id: string | null;
  /** Free-text address fallback when no Google place. */
  address: string | null;
  /** Denormalized from the Google Place, only present when google_place_id is set. */
  lat: number | null;
  lng: number | null;
  check_in_date: string;
  check_out_date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
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
// Trip collaborators (Phase 21 Step 21.5)
// ============================================================

/**
 * Roles a collaborator may hold on a trip.
 *
 * `viewer` — read-only on every trip-scoped table (trip_places, trip_days,
 *   trip_legs, trip_expenses). Cannot manage collaborators or delete the
 *   trip; cannot edit the trip itself.
 * `editor` — read + write on every trip-scoped child table. Cannot manage
 *   collaborators or delete the trip; cannot edit the trip itself in v1.
 *
 * Mirrors the role CHECK constraint in `0011_trip_collaborators.sql`.
 */
export type TripCollaboratorRole = 'viewer' | 'editor';

/**
 * Lifecycle states for a `trip_collaborators` row.
 *
 * `pending`  — owner sent an invite; invitee has not accepted yet
 * `accepted` — invitee bound `user_id` and gained access
 * `declined` — invitee declined; access never granted
 * `revoked`  — owner removed the collaborator; access removed
 *
 * RLS treats only `accepted` rows as active access; the other three are
 * audit / history.
 */
export type TripCollaboratorStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

export interface TripCollaborator {
  id: Uuid;
  trip_id: Uuid;
  invitee_email: string;
  /** Bound on accept; null while the invite is pending. */
  user_id: Uuid | null;
  role: TripCollaboratorRole;
  status: TripCollaboratorStatus;
  created_at: string;
  /** Set by the trigger on status -> accepted. */
  accepted_at: string | null;
  /** Set by the trigger on status -> revoked. */
  revoked_at: string | null;
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
