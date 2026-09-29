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
 * M5 (migration 0035): every mode a single LEG can have — the 4 routable
 * {@link TransportMode}s plus `flight` and `ferry`, which no routing API
 * computes (optimize-trip uses the user's `arrival_minutes` or a distance
 * estimate, Y2.3). Mirrors `trip_places_arrival_mode_check`.
 *
 * Trip-level and day-level defaults stay {@link TransportMode} (routable
 * modes only); flight/ferry exist only as a per-leg override.
 */
export type LegTransportMode = TransportMode | 'flight' | 'ferry';

/**
 * M5 (migration 0035): who produced a `trip_legs` row. Mirrors
 * `trip_legs_source_check`.
 *   - 'ors' / 'google' — a routing API answer (Google-derived legs carry the
 *     30-day ToS TTL like every leg).
 *   - 'estimate' — a distance-based fallback (transit without Google, ferry
 *     without minutes, …). The UI marks its duration with "≈".
 *   - 'user' — the duration came from `trip_places.arrival_minutes`.
 */
export type TripLegSource = 'ors' | 'google' | 'estimate' | 'user';

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
 * M5 (migration 0034): an ISO 4217 alphabetic currency code, e.g. 'EUR',
 * 'TRY', 'JPY'. The DB checks only the SHAPE (`^[A-Z]{3}$`) on
 * `trips.currency`, `trip_expenses.currency`, `trip_expenses.fx_home_currency`
 * and `fx_rates.base/quote`; the picker lists what the `fx-rates` Edge
 * Function supports. A plain string alias (not a union) because the set is
 * open-ended. Validate user input against `/^[A-Z]{3}$/` before writing.
 */
export type CurrencyCode = string;

/**
 * The trip's HOME currency (`trips.currency`): the unit of `total_budget`
 * and of every converted expense total. Owner-only on the server (editors
 * get 42501 from enforce_trips_column_restrictions_fn).
 *
 * M5 transition (deliberate, Y1.1): migration 0034 widened the DB CHECK from
 * these 5 codes to any ISO code (`^[A-Z]{3}$`), but this union stays the set
 * the CURRENT pickers offer (`trip/new.tsx` zod enum, TripSettingsSheet), so
 * in practice no client writes anything else yet. The step that ships the
 * widened home-currency picker (Y3.2) flips this line to
 * `export type TripCurrency = CurrencyCode;` in the same change as those
 * pickers (widening it earlier breaks `trip/new.tsx`'s zod-enum form type).
 * Code that only READS a trip currency should already take
 * {@link CurrencyCode} (money lib, formatters), and must not assume the value
 * is one of these 5 at runtime (another client or the dashboard may have
 * stored any ISO code).
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
  /**
   * T1 editable timeline (migration 0025): user-pinned arrival time for this
   * stop (`'HH:MM:SS'`). NULL = arrival is computed from the day flow. The
   * timeline cursor jumps to a reachable pin; an unreachable pin renders the
   * non-blocking 'pinned_tight' warning chip. USER-AUTHORED ONLY — same ToS
   * invariant as {@link TripPlace.arrive_after} (never auto-filled from
   * Google data). Display-layer anchor; the optimizer ignores it.
   */
  pinned_start: string | null;
  /**
   * v2 S2.1 (migration 0027, C1 refinement): USER-intent order as a
   * fractional-index key (lexicographic text, e.g. 'a0' < 'a0V' < 'a1').
   * Client-writable + LWW-synced + offline-safe; the optimizer NEVER writes
   * it (optimizer-computed order stays in `day_index`/`order_in_day`).
   * Optional: pre-S2 read paths don't select it. NULL = never hand-ordered.
   */
  manual_rank?: string | null;
  /**
   * v2 S2.1 (migration 0027): soft-delete tombstone for the offline sync
   * engine. Optional: nothing writes `true` until S2 Wave 2 enables Tier-1
   * writes; from then on reads must filter it.
   */
  deleted?: boolean;
  /**
   * M5 (migration 0035): the user's mode override for the leg that ARRIVES
   * at this place (from its predecessor in the day). NULL/absent = inherit.
   * Effective leg mode (optimize-trip, Y2.3):
   *   `arrival_mode ?? tripDay.transport_mode ?? trip.transport_mode`.
   * USER intent: client-writable (owner + editors), Tier-1 synced, LWW
   * (C1-safe — it never writes order; legs stay server-computed). Optional
   * because pre-0035 servers and narrow selects don't return it.
   */
  arrival_mode?: LegTransportMode | null;
  /**
   * M5 (migration 0035): optional user-given duration of the arriving leg in
   * minutes (1–1440, DB CHECK), for flight/ferry/transit. Only meaningful
   * when {@link TripPlace.arrival_mode} is set — consumers ignore it
   * otherwise (the DB deliberately does not couple the two columns; clear
   * both together). NULL = compute or estimate.
   */
  arrival_minutes?: number | null;
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
  /**
   * v2 S2.1 (migration 0027): trip_days had NO timestamps until 0027 added
   * them for the sync engine (`updated_at` is the LWW conflict clock,
   * server-stamped by `handle_times()`). Optional: pre-S2 read paths don't
   * select them; pre-0027 rows were backfilled with the migration time.
   */
  created_at?: string;
  updated_at?: string;
  /** v2 S2.1 (migration 0027): soft-delete tombstone — see {@link TripPlace.deleted}. */
  deleted?: boolean;
  /**
   * M5 (migration 0035): per-day default leg mode (the 4 routable modes;
   * flight/ferry are per-leg only, via {@link TripPlace.arrival_mode}).
   * NULL/absent = inherit `trips.transport_mode`. Hydrated into Tier-1;
   * trip_days is a READ-ONLY Tier-1 root, so the Y3.3 day-mode control writes
   * it through the online trip-days path (owner + editors; viewers get RLS
   * denials).
   */
  transport_mode?: TransportMode | null;
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
  /** v2 S2.1 (migration 0027): soft-delete tombstone — see {@link TripPlace.deleted}. */
  deleted?: boolean;
  /*
   * ── M5 multi-currency (migration 0034, ADR-0012) ─────────────────────────
   * `amount` is ALWAYS the original amount in `currency`, never pre-converted.
   * All four fields are optional on the type (pre-0034 servers and narrow
   * selects omit them) and nullable in the DB. Round only at display.
   *
   * NULL semantics (the Y1.1 risk mitigation, used everywhere):
   *   currency NULL          → legacy row = the trip's home currency, rate 1.
   *                            (0034 backfilled existing rows and fills
   *                            currency-less INSERTs from older clients, so
   *                            this is rare; still handle it.)
   *   fx_rate NULL           → "rate pending" (entered offline with no known
   *                            rate); the Y2.2 reconciler fills it.
   *
   * Converting ONE expense into the trip's CURRENT home currency
   * (`trip.currency`) — the same precedence as the 0034 analytics MV, so the
   * live client totals and the nightly rollup agree:
   *   1. currency NULL or === trip.currency              → × 1
   *   2. fx_rate != null && fx_home_currency === trip.currency → × fx_rate
   *   3. else re-derive on fx_date from fx_rates (base EUR):
   *        × rate(trip.currency) / rate(currency), with rate('EUR') = 1
   *   4. still unknown → pending (the MV falls back to × (fx_rate ?? 1))
   *
   * DB CHECKs (mirrored by src/sync/mutations.ts before any Tier-1 write,
   * because a server-rejected sync write is retried forever):
   *   - currency / fx_home_currency match /^[A-Z]{3}$/ (or are null)
   *   - fx_rate > 0 (or null)
   *   - fx_rate != null ⇒ currency, fx_date and fx_home_currency are all set
   *
   * Roles: owner + editors may write all four; viewers are read-only (RLS).
   * `trips.currency` (the home currency) stays owner-only.
   */
  /** M5 (0034): original ISO 4217 code of `amount`. NULL = legacy (trip home currency). */
  currency?: CurrencyCode | null;
  /**
   * M5 (0034): home-currency units per 1 unit of `currency`, FROZEN when the
   * expense was entered (e.g. 35.2 for EUR→TRY). NULL = rate pending.
   * PostgREST returns Postgres `numeric` as a JSON number.
   */
  fx_rate?: number | null;
  /** M5 (0034): the rate's date, 'YYYY-MM-DD' (or the wanted date while pending). */
  fx_date?: string | null;
  /**
   * M5 (0034): the home currency `fx_rate` converts INTO. When it differs from
   * the trip's current `currency` (the owner changed the home currency), the
   * frozen rate no longer applies — re-derive (step 3 above).
   */
  fx_home_currency?: CurrencyCode | null;
  created_at: string;
  updated_at: string;
}

/**
 * M5 (migration 0034, ADR-0012): one row of the `fx_rates` cache, written only
 * by the `fx-rates` Edge Function (service role) and readable by any signed-in
 * user. Always EUR-based: `rate` = `quote` units per 1 `base` (EUR) unit.
 * Cross rate X→Y on a day = rate(Y) / rate(X), with rate('EUR') = 1. A
 * weekend/holiday is stored under the requested date too (exact-date lookups).
 * Non-Google public data, so it MAY be persisted client-side (ADR-0012 §4).
 */
export interface FxRateRow {
  /** Always 'EUR' by convention (DB default). */
  base: CurrencyCode;
  quote: CurrencyCode;
  /** 'YYYY-MM-DD'. */
  rate_date: string;
  rate: number;
  /** Provider tag, e.g. 'frankfurter' or 'currency-api'. */
  source: string;
  fetched_at: string;
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
  /** v2 S2.1 (migration 0027): soft-delete tombstone — see {@link TripPlace.deleted}. */
  deleted?: boolean;
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
  /**
   * The mode this leg was computed for. M5 (0035/Y2.3): the effective per-leg
   * mode, so it may be `flight`/`ferry` (no polyline — the client draws an
   * arc) as well as the 4 routable modes.
   */
  transport_mode: LegTransportMode;
  duration_seconds: number;
  distance_meters: number;
  /**
   * M5 (migration 0035): leg provenance; `'estimate'` renders with "≈".
   * Optional: pre-0035 servers and the public share payload omit it
   * (treat absent as a routed leg). Written only by optimize-trip (C1).
   */
  source?: TripLegSource;
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

/**
 * Short-lived HMAC signature set for one photo (security audit #3). It is
 * minted by `place-details` on the authenticated path. `sig` is keyed by
 * the allowed widths as strings ('200' | '400' | '800' | '1600'), and all
 * widths share one `exp` (unix seconds, at most 24h out). Tier-2 only, like
 * the rest of PlaceDetails. Consumed by `usePlacePhotoUrl`. Never persist it.
 */
export interface PlacePhotoSignature {
  exp: number;
  sig: Record<string, string>;
}

export interface PlacePhoto {
  name: string;
  widthPx: number;
  heightPx: number;
  attributions: Array<{ displayName: string; uri?: string; photoUri?: string }>;
  /**
   * ADDITIVE (audit #3): present when the server has PHOTO_URL_SECRET set.
   * Absent on older servers, or when the secret is missing. The photo hook
   * then falls back to the POST place-photo signer.
   */
  signature?: PlacePhotoSignature;
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
 *
 * Contract v2 (security audit #12, 2026-09-29 — allow-list lives in
 * supabase/functions/share-trip/public-fields.ts):
 *   - `trip.id` is no longer returned (nothing on the public page needs it).
 *   - `places[].notes` is no longer returned: notes are PRIVATE by default.
 *     It stays on the type as OPTIONAL so older cached payloads still type,
 *     and so the planned M5 per-trip "show notes on the public link" toggle
 *     can re-enable it without another type change. Consumers must treat it
 *     as absent-by-default (`SharedTimeline` already guards `place.notes ?`).
 */
export interface SharedTrip {
  trip: Pick<
    Trip,
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
    > & {
      /** Omitted by contract v2 unless a future owner opt-in enables it. */
      notes?: TripPlace['notes'];
    }
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
  /** `contractVersion: 2` from the audit-#12 server on; v1 servers sent no `meta`. */
  meta?: { contractVersion: number };
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
  /**
   * v2 S2.1 (migration 0027): soft-delete tombstone. Wave 2 note: the v1
   * "clear reaction" path hard-DELETEs the row — it must become
   * `set deleted = true` once Tier-1 writes are enabled (incremental
   * `updated_at > last-sync` pulls cannot observe hard DELETEs).
   */
  deleted?: boolean;
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
