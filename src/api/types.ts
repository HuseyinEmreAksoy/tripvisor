export type Uuid = string;

/**
 * Transport modes the route optimizer + Routes API support. Values must
 * stay in lockstep with:
 *   - the `trips_transport_mode_check` CHECK constraint
 *     (`supabase/migrations/0016_trips_route_render_mode.sql`),
 *   - the Zod enum + MODE_MAP in
 *     `supabase/functions/distance-matrix/index.ts`, and
 *   - the Zod enum + MODE_MAP in
 *     `supabase/functions/directions-polyline/index.ts`.
 *
 * Phase 23 widens the set from `driving | walking | transit` to also
 * include `bicycling` (Routes API exposes BICYCLE as a first-class
 * travelMode). 'transit' returns polyline = null because the Routes API
 * computeRoutes response is multi-leg / vehicle-typed for transit; the
 * UI falls back to dashed straight-line segments + a Google Maps deep
 * link in that case.
 */
export type TransportMode = 'driving' | 'walking' | 'transit' | 'bicycling';

/**
 * Phase 23 Step 23.1: per-trip render-mode toggle.
 *
 *   - 'optimized' — k-means + 2-opt clusters places into days and orders
 *                   them within each day. Default for every trip.
 *   - 'manual'    — keep the user's hand-arranged (day_index,
 *                   order_in_day) and only re-render polylines along
 *                   that chain.
 *
 * Stored on `trips.route_render_mode` (NOT NULL default 'optimized') —
 * see migration 0016. The `optimize-trip` Edge Function branches on this
 * value; flipping the toggle re-runs the function with the new mode so
 * the polyline updates without a manual re-optimize.
 */
export type RouteRenderMode = 'optimized' | 'manual';

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
  /**
   * Unit-of-account for trip budgets / expenses (`total_budget`,
   * `trip_expenses.amount`). Originally added for the Phase 8 cost rollup
   * (ADR-0007); the per-km cost model was retired in v2 Phase 0.1 in favor
   * of time-first planning + the category-based budget model. The legacy
   * per-km rate column still exists on `public.trips` (drop deferred to v2
   * Phase 15.1) but the client no longer reads or writes it.
   */
  currency: TripCurrency;
  /**
   * Phase 20 Step 6: optional total-trip budget ceiling. Unit is `currency`.
   * Null means "no ceiling configured" — the per-category sum from
   * trip_expenses is still meaningful on its own.
   */
  total_budget: number | null;
  /**
   * Phase 23 Step 23.1: optimized vs manual route rendering. NOT NULL with
   * default 'optimized' on the data layer — every existing trip predates
   * Phase 23 and continues to receive optimizer-driven layouts. The Phase
   * 23 UI flips this via `useUpdateRouteRenderMode` and immediately re-
   * triggers the optimize Edge Function with the new mode.
   */
  route_render_mode: RouteRenderMode;
  /**
   * Phase 25 Step 25.2: pointer to which Google Place provides the trip's
   * cover photo. NULL = no cover (UI renders the gradient placeholder).
   *
   * We intentionally store ONLY the place id (not the photo resource
   * name) because the resource name has a Google ToS TTL while the
   * place id does not. The cover image is fetched live via the
   * `place-photo` Edge Function — which re-resolves `photos[].name`
   * from `place-details` and proxies the bytes server-side so the
   * Google API key never ships to the client.
   *
   * Editor collaborators may update this column — see migration 0018
   * for the trigger allow-list expansion.
   */
  cover_photo_google_place_id: string | null;
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
  /**
   * v2 P1.1 (migration 0023): earliest time-of-day the user wants to
   * arrive at this place. PostgREST returns Postgres `time` as
   * `'HH:MM:SS'`. NULL = no constraint.
   *
   * ToS invariant: user-confirmed values only — NEVER auto-filled from
   * Google opening hours (live hours are Tier-2 memory-only; persisting
   * them violates the project's Google ToS posture; see
   * docs/v2/risks-and-decisions.md). The itinerary conflict warnings
   * compare these columns against live hours CLIENT-SIDE, in memory.
   *
   * P1 scoping: warning layer only — the optimizer does not consume time
   * windows (hard solver constraints deferred to S2/post-GA).
   */
  arrive_after: string | null;
  /**
   * v2 P1.1 (migration 0023): latest time-of-day the user wants to leave
   * this place (`'HH:MM:SS'`). NULL = no constraint. When both ends are
   * set the DB enforces `leave_before > arrive_after`
   * (trip_places_time_window_check). Same ToS invariant as
   * {@link TripPlace.arrive_after}: user-confirmed values only — never
   * auto-filled from Google opening hours.
   */
  leave_before: string | null;
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
  /**
   * v2 N3 (migration 0020 §a): per-day itinerary start. PostgREST returns
   * Postgres `time` as `'HH:MM:SS'`. `null` (or absent, pre-migration) means
   * the client default of 09:00 — the default deliberately lives client-side
   * so changing it never needs a backfill. Feeds the timeline's computed
   * per-stop arrival/departure (pure client math over visit minutes +
   * trip_legs).
   */
  start_time?: string | null;
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

/**
 * v2 P1.2: one rendered step of a multi-leg transit route, as returned by
 * the `directions-polyline` Edge Function's OPTIONAL `transitSteps` field
 * and persisted verbatim into `trip_legs.transit_steps` (jsonb, migration
 * 0023). Canonical definition lives in
 * `supabase/functions/directions-polyline/index.ts` — keep in lockstep.
 *
 * - `polyline` — polyline5 (Google encoding, precision 1e5), decoded by
 *   `src/components/Map/polyline.ts`. Typed nullable for forward-compat,
 *   but the server currently never emits null (geometry-less steps are
 *   skipped) — render code should still null-check.
 * - `travelMode` — collapsed binary: `'TRANSIT'` rides a vehicle and
 *   carries line metadata; everything else is a `'WALK'` connector.
 * - `lineName` — short line name preferred ("M2" over "Metro Linea 2");
 *   null for WALK steps.
 * - `vehicleType` — Google's vehicle.type enum verbatim (`'SUBWAY'`,
 *   `'BUS'`, `'TRAM'`, `'HEAVY_RAIL'`, ...); null for WALK steps.
 */
export interface TransitStep {
  polyline: string | null;
  travelMode: 'WALK' | 'TRANSIT';
  lineName: string | null;
  vehicleType: string | null;
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
  /**
   * v2 P1.2 (migration 0023): per-step transit geometry/metadata for
   * `transport_mode = 'transit'` legs; null for every other mode and for
   * pre-P1 rows. Written only by the `optimize-trip` Edge Function.
   * Google-derived → covered by the nightly 30-day TTL purge (it deletes
   * whole `trip_legs` rows), so never re-add a purged value from a
   * client-side cache.
   */
  transit_steps: TransitStep[] | null;
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
// Trip place reactions (Phase 24 Step 24.1)
// ============================================================

/**
 * Phase 24: per-user, per-place like/dislike reactions. Each collaborator
 * (viewer or editor) may set a single reaction per `trip_place`. Mirrors
 * the `reaction` CHECK constraint in `0017_trip_place_reactions.sql`. To
 * "clear" a reaction the client DELETEs the row — there is no nullable
 * third state at the DB layer.
 */
export type TripPlaceReactionType = 'liked' | 'disliked';

export interface TripPlaceReaction {
  id: Uuid;
  trip_place_id: Uuid;
  user_id: Uuid;
  reaction: TripPlaceReactionType;
  created_at: string;
  updated_at: string;
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
