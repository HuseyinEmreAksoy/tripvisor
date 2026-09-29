/**
 * allowlist.ts — the Tier-1 ToS firewall (v2 S2.3, risk condition C3).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * v1 keeps Google-restricted Place content (ratings, reviews, photos,
 * opening hours, phone, website, attributions) off disk with the TanStack
 * persister's `shouldDehydrateQuery` allowlist. The Legend-State SQLite
 * store is a SECOND persistence engine that allowlist does NOT govern
 * (docs/v2/risks-and-decisions.md C3 — "the second door"). This module is
 * that second door's lock:
 *
 *   - `TIER1_FIELDS` is a typed, default-deny column allowlist per synced
 *     table: durable USER fields + the only durable Google pointers
 *     (`google_place_id`, lat/lng) may enter the store. Compile-time bound
 *     to the row types in `src/api` — listing a column that doesn't exist
 *     on the TS row type is a type error.
 *   - `sanitizeForTier1(table, row)` is applied at the hydration boundary
 *     (see hydrate.ts `transform.load`): unknown fields are DROPPED
 *     (default-deny), and fields matching a known Google-restricted name
 *     THROW `SyncTosViolationError` (mode 'throw', the default) or are
 *     stripped with telemetry (mode 'strip' — what the hydration boundary
 *     falls back to so a violation never bricks sync).
 *
 * Defence-in-depth order (both layers ship in Wave 1):
 *   1. hydrate.ts SELECTs only allowlisted columns → restricted data never
 *      even crosses the network into the sync engine.
 *   2. This sanitize runs on every row the engine loads anyway → a future
 *      code path that feeds richer objects into the store (the C3 scenario:
 *      an AI "suggested place" card carrying a live rating/photo) fails
 *      loudly instead of persisting restricted data.
 *
 * Suggestion cards and any live Place data stay in Tier-2 (TanStack Query,
 * memory-only) until the user accepts — at which point only
 * google_place_id + lat/lng + user-authored fields survive into Tier-1.
 *
 * An ESLint rule reinforcing this is deliberately Wave 2 (lint infra is
 * broken repo-wide); this runtime guard + the jest suite in
 * `__tests__/allowlist.test.ts` are the real gate.
 */

import type {
  Trip,
  TripAccommodation,
  TripDay,
  TripExpense,
  TripPlace,
  TripPlaceReaction,
} from '../api/types';
import type { TripPlaceComment } from '../api/trip-place-comments';
import type { TripPackingItem } from '../api/trip-packing';
import type { TripJournalEntry, TripPhoto, TripPlaceReview } from '../api/memories.types';

// ===========================================================================
// Table → row-type binding (compile-time half of the C3 test)
// ===========================================================================

/** The Tier-1 synced roots: the eight of migration 0027 plus the three M5
 * memory roots (0036, author-scoped). trip_legs is deliberately
 * absent: legs are server-authoritative optimizer output (C1) with a 30-day
 * Google ToS TTL — they must never enter a client persistence engine that
 * could re-sync them (risk R4). Offline leg rendering, if/when wanted, needs
 * its own read-only TTL-respecting cache, not Tier-1. */
export interface Tier1RowTypes {
  trips: Trip;
  trip_places: TripPlace;
  trip_days: TripDay;
  trip_expenses: TripExpense;
  trip_accommodations: TripAccommodation;
  trip_place_reactions: TripPlaceReaction;
  trip_place_comments: TripPlaceComment;
  trip_packing_items: TripPackingItem;
  // M5 Y2.1 (0036/0038): memory roots. AUTHOR-SCOPED — see
  // TIER1_AUTHOR_SCOPED_TABLES below: only the signed-in user's OWN rows
  // ever enter Tier-1; other members' shared items are Tier-2 (memory-only).
  trip_journal_entries: TripJournalEntry;
  trip_place_reviews: TripPlaceReview;
  trip_photos: TripPhoto;
}

export type Tier1Table = keyof Tier1RowTypes;

type FieldsOf<T> = ReadonlyArray<Extract<keyof T, string>>;

/**
 * Exact column allowlists, default-deny. Every entry MUST be a key of the
 * corresponding TS row type (enforced by the type annotation below — a typo
 * or a column that doesn't exist is a compile error), and every entry MUST
 * be ToS-durable: user-authored content, structural ids/timestamps, or the
 * permitted Google pointers (google_place_id + lat/lng).
 *
 * NEVER add: rating, user_rating_count, reviews, photos, price_level,
 * opening hours (any variant), phone numbers, website/maps URIs,
 * formatted_address, display_name, editorial_summary, attributions — those
 * live in Tier-2 (TanStack Query, memory-only) under the 30-day Google ToS
 * ceiling. `isRestrictedFieldName` below tripwires them at runtime and the
 * jest suite asserts the two layers stay consistent.
 */
export const TIER1_FIELDS: { readonly [K in Tier1Table]: FieldsOf<Tier1RowTypes[K]> } = {
  // `isOwner` / `collaboratorRole` (client-derived, useTrips-only) are
  // intentionally absent: the store holds server rows, not view models.
  // `cover_photo_google_place_id` is allowed — it is a durable PLACE ID
  // pointer (the photo bytes are fetched live via the place-photo Edge
  // Function), not Google photo content.
  trips: [
    'id',
    'user_id',
    'title',
    'start_date',
    'end_date',
    'daily_hours_budget',
    'anchor_place_id',
    'transport_mode',
    'timezone',
    'archived_at',
    'currency',
    'total_budget',
    'route_render_mode',
    'cover_photo_google_place_id',
    'created_at',
    'updated_at',
  ],
  // day_index / order_in_day are optimizer-COMPUTED (C1: server-only
  // writers) but they flow server→client as reads, so they belong in the
  // hydration allowlist. Wave 2's write path must use a separate
  // client-writable subset that EXCLUDES them (manual_rank is the only
  // client-writable order field).
  trip_places: [
    'id',
    'trip_id',
    'google_place_id',
    'user_title',
    'category',
    'lat',
    'lng',
    'visit_duration_minutes',
    'day_index',
    'order_in_day',
    'notes',
    'details_refreshed_at',
    'arrive_after',
    'leave_before',
    'pinned_start',
    'manual_rank',
    'deleted',
    // M5 (0035): the user's per-leg mode override for the leg ARRIVING here.
    'arrival_mode',
    'arrival_minutes',
    'created_at',
    'updated_at',
  ],
  trip_days: [
    'id',
    'trip_id',
    'day_index',
    'day_start_place_id',
    'day_end_place_id',
    'notes',
    'start_time',
    'deleted',
    // M5 (0035): per-day default leg mode (read-only root: written online).
    'transport_mode',
    'created_at',
    'updated_at',
  ],
  // M5 (0034, ADR-0012): original currency + the rate frozen at entry. FX
  // rates are public ECB data, not Google content — durable by design.
  trip_expenses: [
    'id',
    'trip_id',
    'category',
    'amount',
    'kind',
    'day_index',
    'label',
    'deleted',
    'currency',
    'fx_rate',
    'fx_date',
    'fx_home_currency',
    'created_at',
    'updated_at',
  ],
  // `address` is USER free-text (Airbnb, friend's flat), not Google's
  // formatted_address — allowed. lat/lng are the permitted denormalized
  // coordinates tied to google_place_id (same ToS posture as trip_places).
  trip_accommodations: [
    'id',
    'trip_id',
    'name',
    'google_place_id',
    'address',
    'lat',
    'lng',
    'check_in_date',
    'check_out_date',
    'notes',
    'deleted',
    'created_at',
    'updated_at',
  ],
  trip_place_reactions: [
    'id',
    'trip_place_id',
    'user_id',
    'reaction',
    'deleted',
    'created_at',
    'updated_at',
  ],
  trip_place_comments: [
    'id',
    'trip_id',
    'trip_place_id',
    'author_id',
    'body',
    'deleted',
    'created_at',
    'updated_at',
  ],
  trip_packing_items: [
    'id',
    'trip_id',
    'label',
    'category',
    'checked',
    'auto',
    'deleted',
    'created_at',
    'updated_at',
  ],
  // M5 Y2.1 — memories (0036). User content only; no Google data.
  trip_journal_entries: [
    'id',
    'trip_id',
    'author_id',
    'day_index',
    'body',
    'visibility',
    'deleted',
    'created_at',
    'updated_at',
  ],
  // `rating` is the USER'S own 1–5 stars — the one documented exception to
  // the restricted-name tripwire (TIER1_USER_CONTENT_EXCEPTIONS below).
  // The two *_snapshot columns are server-owned (0038 §3): hydrated, never
  // written. place_google_id_snapshot is a place-ID pointer (ToS-durable).
  trip_place_reviews: [
    'id',
    'trip_id',
    'trip_place_id',
    'author_id',
    'rating',
    'body',
    'visibility',
    'place_name_snapshot',
    'place_google_id_snapshot',
    'deleted',
    'created_at',
    'updated_at',
  ],
  // Photo index rows. storage_path/thumb_path/bytes/thumb_bytes/status are
  // server-owned (stamped by the 0036 guard): hydrated, never written.
  trip_photos: [
    'id',
    'trip_id',
    'author_id',
    'day_index',
    'trip_place_id',
    'storage_path',
    'thumb_path',
    'width',
    'height',
    'bytes',
    'thumb_bytes',
    'caption',
    'taken_at',
    'status',
    'visibility',
    'deleted',
    'created_at',
    'updated_at',
  ],
};

/**
 * M5 Y2.1 — the ONE documented exception to the restricted-name tripwire:
 * `trip_place_reviews.rating` is the USER'S OWN 1–5 rating of a place they
 * visited (0036 §1b comment), shown apart from and never averaged with
 * Google ratings. It is allowlisted for THIS table only; `rating` on any
 * other table (trip_places, suggestion cards, …) still throws
 * SyncTosViolationError. The allowlist self-consistency test asserts that
 * every allowlisted field that trips isRestrictedFieldName is listed here,
 * and nothing else.
 */
export const TIER1_USER_CONTENT_EXCEPTIONS: {
  readonly [K in Tier1Table]?: FieldsOf<Tier1RowTypes[K]>;
} = {
  trip_place_reviews: ['rating'],
};

/**
 * M5 Y2.1 (0036 "SYNC CONTRACT"): roots whose Tier-1 replica holds ONLY the
 * signed-in user's own rows (`author_id = auth.uid()`). RLS alone would also
 * return other members' SHARED items, but when such an item is un-shared or
 * tombstoned it silently leaves our RLS view — an incremental
 * `updated_at > lastSync` pull or a realtime event can never deliver the
 * fact, so a persisted replica would keep a private ghost copy forever.
 * hydrate.ts therefore adds `author_id = <session user>` to the pull AND the
 * realtime channel filter for these roots and drops any foreign row that
 * still reaches the boundary. Other members' items are Tier-2 (TanStack,
 * refetched, never persisted) — src/api/memories.ts.
 */
export const TIER1_AUTHOR_SCOPED_TABLES: ReadonlySet<Tier1Table> = new Set<Tier1Table>([
  'trip_journal_entries',
  'trip_place_reviews',
  'trip_photos',
]);

export function isTier1AuthorScopedTable(table: Tier1Table): boolean {
  return TIER1_AUTHOR_SCOPED_TABLES.has(table);
}

/** Frozen Set per table for O(1) sanitize lookups. */
const TIER1_FIELD_SETS: { [K in Tier1Table]: ReadonlySet<string> } = Object.fromEntries(
  (Object.keys(TIER1_FIELDS) as Tier1Table[]).map((t) => [t, new Set<string>(TIER1_FIELDS[t])]),
  // Object.fromEntries widens keys to string — the keys are provably
  // Tier1Table (mapped straight from TIER1_FIELDS), hence the unknown bridge.
) as unknown as { [K in Tier1Table]: ReadonlySet<string> };

export const TIER1_TABLES = Object.keys(TIER1_FIELDS) as readonly Tier1Table[];

// ===========================================================================
// Restricted-name tripwire
// ===========================================================================

/**
 * Exact field names (checked case-insensitively after stripping `_`) known
 * to carry Google-restricted Place content — both the snake_case wire shape
 * and the camelCase `PlaceDetails` shape from `src/api/types.ts`.
 */
const RESTRICTED_EXACT = new Set<string>([
  // PlaceDetails / Places API (New) restricted content
  'rating',
  'userratingcount',
  'reviews',
  'review',
  'photos',
  'photo',
  'pricelevel',
  'regularopeninghours',
  'currentopeninghours',
  'openinghours',
  'opennow',
  'weekdaydescriptions',
  'nationalphonenumber',
  'internationalphonenumber',
  'phone',
  'phonenumber',
  'website',
  'websiteuri',
  'googlemapsuri',
  'mapsuri',
  'formattedaddress',
  'shortformattedaddress',
  'displayname',
  'editorialsummary',
  'attributions',
  'authorattribution',
  'photouri',
  'types',
]);

/**
 * Substring tripwires for variants the exact set misses (e.g.
 * `place_rating`, `review_count`, `photo_reference`). Curated against the
 * actual durable schema so no legitimate column matches — verified by the
 * jest suite's self-consistency check. Note `daily_hours_budget` is safe:
 * 'opening_hour' (not bare 'hour') is the pattern.
 */
const RESTRICTED_SUBSTRINGS = ['rating', 'review', 'attribution', 'opening_hour', 'photo'] as const;

/**
 * Is this field name a known Google-restricted content carrier?
 *
 * One deliberate exception: anything ending in `google_place_id` is the
 * sanctioned durable pointer (e.g. trips.cover_photo_google_place_id, which
 * would otherwise trip the 'photo' substring) — place IDs are exempt from
 * the 30-day ceiling and are exactly what we're ALLOWED to persist.
 */
export function isRestrictedFieldName(field: string): boolean {
  const lower = field.toLowerCase();
  if (lower.endsWith('google_place_id') || lower.endsWith('googleplaceid')) return false;
  const collapsed = lower.replace(/_/g, '');
  if (RESTRICTED_EXACT.has(collapsed)) return true;
  return RESTRICTED_SUBSTRINGS.some((s) => lower.includes(s) || collapsed.includes(s.replace(/_/g, '')));
}

/** Thrown (mode 'throw') when a Google-restricted field reaches the Tier-1
 * boundary — i.e. some upstream code tried to put ToS-restricted data into
 * the persistent store. Loud by design. */
export class SyncTosViolationError extends Error {
  readonly table: Tier1Table;
  readonly field: string;

  constructor(table: Tier1Table, field: string) {
    super(
      `[sync] ToS violation: restricted Google field "${field}" reached the Tier-1 boundary for table "${table}". ` +
        'Google Place content (ratings/reviews/photos/hours/phone/website/attributions) must stay in Tier-2 (memory-only). ' +
        'See docs/v2/risks-and-decisions.md C3.',
    );
    this.name = 'SyncTosViolationError';
    this.table = table;
    this.field = field;
  }
}

export interface SanitizeOptions {
  /**
   * 'throw' (default): a restricted field name raises SyncTosViolationError
   *   — used directly by tests and as the first pass at the hydration
   *   boundary so violations are loud.
   * 'strip': restricted fields are silently removed (reported via the
   *   onDrop callback) — the hydration boundary's fallback so a violation
   *   degrades to "field lost + telemetry", never "sync bricked".
   */
  mode?: 'throw' | 'strip';
  /** Invoked for every dropped field (both unknown and restricted). */
  onDrop?: (field: string, restricted: boolean) => void;
}

/**
 * Default-deny projection of `row` onto the table's Tier-1 allowlist.
 *
 * - Allowlisted fields are copied through untouched (including null/false —
 *   only `undefined` values are skipped, since PostgREST never sends them
 *   and `undefined` would clobber merges).
 * - Unknown fields are dropped (and reported via onDrop).
 * - Restricted fields throw or are dropped per `options.mode`.
 *
 * Pure function: no I/O, never mutates `row`.
 */
export function sanitizeForTier1<K extends Tier1Table>(
  table: K,
  row: Record<string, unknown>,
  options?: SanitizeOptions,
): Tier1RowTypes[K] {
  const mode = options?.mode ?? 'throw';
  const allowed = TIER1_FIELD_SETS[table];
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (allowed.has(key)) {
      if (row[key] !== undefined) out[key] = row[key];
      continue;
    }
    const restricted = isRestrictedFieldName(key);
    if (restricted && mode === 'throw') {
      throw new SyncTosViolationError(table, key);
    }
    options?.onDrop?.(key, restricted);
  }
  // Intentionally partial: the projection keeps only allowlisted fields that
  // were present — downstream merges treat absent keys as "unchanged".
  return out as unknown as Tier1RowTypes[K];
}

/**
 * The PostgREST select() projection for a table — the network half of the
 * firewall (restricted columns are never requested, so they can never
 * arrive). Derived from the same allowlist so the two layers cannot drift.
 */
export function tier1SelectColumns(table: Tier1Table): string {
  return TIER1_FIELDS[table].join(',');
}

// ===========================================================================
// Tier-1 WRITE firewall (v2 S2.4, risk condition C1)
// ===========================================================================
//
// Reads and writes have DIFFERENT allowlists. TIER1_FIELDS above answers
// "what may enter the store from the server"; TIER1_WRITE_FIELDS answers the
// stricter question "what may the CLIENT send back". The gap between the two
// is exactly the C1 refinement (docs/v2/risks-and-decisions.md):
//
//   ORDER IS TWO FIELDS WITH TWO OWNERS. `manual_rank` is USER-intent order —
//   client-writable, LWW-synced, written by offline drag, never reverted.
//   `day_index` / `order_in_day` are OPTIMIZER-computed order — written ONLY
//   by the optimize-trip Edge Function's mutex path, server → client, one
//   way. They flow INTO the store as reads (they're in TIER1_FIELDS) but a
//   client write carrying them must be stripped before it reaches PostgREST:
//   under per-field LWW a stale offline client replaying day_index would
//   overwrite a fresher server optimize, which is precisely the conflict C1
//   exists to prevent. Same posture for `details_refreshed_at` (stamped by
//   the place-details refresh path) and `created_at`/`updated_at`
//   (handle_times() server-stamps both; updated_at IS the conflict clock —
//   a client must never supply its own).
//
// This matters doubly because the syncedSupabase plugin hard-codes
// `updatePartial: false`: every UPDATE sends the FULL store row, so hydrated
// server-only fields (day_index, updated_at, …) ride along on every routine
// write and MUST be stripped here — their presence in a patch is expected,
// not a bug, which is why they're dropped (with telemetry) rather than
// thrown on.

/** The write-enabled slice: trips + trip_places (S2.4), plus trip_expenses +
 * trip_packing_items (M4 X2.5 — offline expense entry and packing ticks),
 * plus the M5 Y2.1 memory roots (journal + reviews create/update; photos
 * update-only). trip_days, trip_accommodations, trip_place_reactions and
 * trip_place_comments stay read-only until a later slice widens them. */
export type Tier1WriteTable = Extract<
  Tier1Table,
  | 'trips'
  | 'trip_places'
  | 'trip_expenses'
  | 'trip_packing_items'
  | 'trip_journal_entries'
  | 'trip_place_reviews'
  | 'trip_photos'
>;

/**
 * Client-writable column subsets, default-deny, compile-bound to the row
 * types exactly like TIER1_FIELDS (a typo or non-existent column is a type
 * error). Every entry MUST be user-authored content or a user-intent flag.
 *
 * NEVER add (C1 — server-only writers):
 *   - trip_places.day_index / order_in_day  — optimizer-computed order
 *   - trip_places.details_refreshed_at      — server refresh stamp
 *   - created_at / updated_at (any table)   — handle_times() server-stamps;
 *     updated_at is the LWW conflict clock
 *   - trips.user_id                         — ownership; the sync engine
 *     stamps it from the authenticated session on CREATE (see hydrate.ts),
 *     and RLS WITH CHECK (auth.uid() = user_id) verifies it server-side
 */
export const TIER1_WRITE_FIELDS: { readonly [K in Tier1WriteTable]: FieldsOf<Tier1RowTypes[K]> } = {
  // trips has NO `deleted` (archive via archived_at IS its lifecycle — 0027
  // header) and no tombstone field here by design.
  trips: [
    'title',
    'start_date',
    'end_date',
    'daily_hours_budget',
    'anchor_place_id',
    'transport_mode',
    'timezone',
    'archived_at',
    'currency',
    'total_budget',
    'route_render_mode',
    'cover_photo_google_place_id',
  ],
  // `manual_rank` is the ONLY client-writable order field (C1 refinement).
  // `deleted` is writable: tombstoning (`deleted: true`) IS the Wave-2
  // delete path — hard DELETEs don't replicate through incremental pulls.
  // M5 (0035): `arrival_mode` / `arrival_minutes` are USER intent (which mode
  // the leg into this stop uses) — C1-safe: they never write order, and the
  // legs they influence stay server-computed (trip_legs is never Tier-1).
  trip_places: [
    'google_place_id',
    'user_title',
    'category',
    'lat',
    'lng',
    'visit_duration_minutes',
    'notes',
    'arrive_after',
    'leave_before',
    'pinned_start',
    'manual_rank',
    'deleted',
    'arrival_mode',
    'arrival_minutes',
  ],
  // X2.5. `day_index` HERE is NOT optimizer order: on trip_expenses it is the
  // user's optional "which day was this spent on" label (0010), authored in
  // the expense sheet. C1's server-only day_index/order_in_day rule is about
  // trip_places ORDER and stays enforced there (it is absent from the
  // trip_places list above). `deleted` = the tombstone delete path.
  // M5 (0034): the four money fields are user-entered (currency) or captured
  // client-side at entry (the frozen rate, its date and home currency — an
  // offline entry saves fx_rate = null and the Y2.2 reconciler fills it).
  trip_expenses: [
    'category',
    'amount',
    'kind',
    'day_index',
    'label',
    'deleted',
    'currency',
    'fx_rate',
    'fx_date',
    'fx_home_currency',
  ],
  // X2.5. `auto` (seeded-by-template flag) is CREATE-only — see
  // TIER1_WRITE_STRUCTURAL: an existing row's provenance is not re-writable.
  trip_packing_items: ['label', 'category', 'checked', 'deleted'],
  // M5 Y2.1 (0036). Author-only writes (RLS + guard). `day_index` here is
  // the journal's own "which day" label, not optimizer order (C1 concerns
  // trip_places order only). `deleted` = tombstone.
  trip_journal_entries: ['day_index', 'body', 'visibility', 'deleted'],
  // `rating` = the user's own stars (TIER1_USER_CONTENT_EXCEPTIONS).
  // trip_place_id is CREATE-only (immutable server-side: immutable_column).
  trip_place_reviews: ['rating', 'body', 'visibility', 'deleted'],
  // trip_photos is UPDATE-only through the store (TIER1_UPDATE_ONLY_TABLES):
  // rows are born through the upload queue (online INSERT → server-stamped
  // paths → upload → ready). These user fields may change offline.
  // `trip_place_id` is deliberately NOT here: the plugin sends FULL rows, so
  // a stale place id (place hard-deleted server-side → SET NULL) would ride
  // along on every caption/visibility edit and fail the FK/RLS check forever
  // (infinite-retry wedge). Re-attaching a photo to a place is an online
  // PostgREST update (src/api/memories.ts useUpdatePhoto).
  trip_photos: ['day_index', 'caption', 'taken_at', 'visibility', 'deleted'],
};

/**
 * M5 Y2.1: write-enabled roots whose rows are NEVER created through the
 * store — the engine gets `actions: ['read','update']` (no create). A
 * trip_photos row must be INSERTed online by the upload queue so the server
 * can stamp its storage paths before the files are uploaded to them.
 */
export const TIER1_UPDATE_ONLY_TABLES: ReadonlySet<Tier1WriteTable> = new Set<Tier1WriteTable>([
  'trip_photos',
]);

export const TIER1_WRITE_TABLES = Object.keys(TIER1_WRITE_FIELDS) as readonly Tier1WriteTable[];

export function isTier1WriteTable(table: Tier1Table): table is Tier1WriteTable {
  return Object.prototype.hasOwnProperty.call(TIER1_WRITE_FIELDS, table);
}

const TIER1_WRITE_FIELD_SETS: { [K in Tier1WriteTable]: ReadonlySet<string> } = Object.fromEntries(
  TIER1_WRITE_TABLES.map((t) => [t, new Set<string>(TIER1_WRITE_FIELDS[t])]),
  // Same unknown-bridge as TIER1_FIELD_SETS (Object.fromEntries widens keys).
) as unknown as { [K in Tier1WriteTable]: ReadonlySet<string> };

/**
 * Structural identity fields the sync ENGINE requires in write payloads —
 * allowed through not because the client "owns" them but because the
 * machinery cannot function without them:
 *
 *   - `id` (always): the syncedSupabase plugin's update() builds
 *     `.eq('id', input.id)` FROM the payload — stripping id would break
 *     every update — and a create's insert must carry the client-generated
 *     id so the returned row matches the store key. (The S2.4 spec said
 *     "id on CREATE only"; update retention is engine-mandated. Re-setting
 *     a PK to its own value is a no-op, and RLS re-checks the row.)
 *   - `trip_id` (CREATE only): a new child row must declare its parent;
 *     RLS WITH CHECK validates the caller can write that trip. On UPDATE it
 *     is dropped (server_only) — the parent of an existing row is not
 *     client-reassignable through sync.
 *
 * Create-vs-update is detected the same way the plugin itself does it
 * (fieldCreatedAt presence): hydrated rows ALWAYS carry created_at (NOT
 * NULL, in the select projection), locally-created rows must not (the
 * server stamps it). This is also why app code must never set created_at on
 * a new row — it would make the engine misclassify the create as an update.
 */
const TIER1_WRITE_STRUCTURAL: {
  readonly [K in Tier1WriteTable]: { always: ReadonlySet<string>; createOnly: ReadonlySet<string> };
} = {
  trips: { always: new Set(['id']), createOnly: new Set() },
  trip_places: { always: new Set(['id']), createOnly: new Set(['trip_id']) },
  trip_expenses: { always: new Set(['id']), createOnly: new Set(['trip_id']) },
  // `auto` rides along on the CREATE only (seed provenance: true from the
  // template seeder, false for manual adds) and is dropped as server_only on
  // every later full-row update — nothing re-labels a row's origin.
  trip_packing_items: { always: new Set(['id']), createOnly: new Set(['trip_id', 'auto']) },
  // M5 Y2.1: `author_id` rides on the CREATE so the unacked local row is
  // attributable (the author-scoped facades filter on it); the 0036 guard
  // verifies it equals auth.uid() (author_mismatch otherwise) and it is
  // immutable afterwards, so updates drop it as server_only.
  trip_journal_entries: { always: new Set(['id']), createOnly: new Set(['trip_id', 'author_id']) },
  // trip_place_id: a new review names its place; immutable afterwards
  // (0036 guard immutable_column; 0038 lets only the FK action null it).
  trip_place_reviews: {
    always: new Set(['id']),
    createOnly: new Set(['trip_id', 'author_id', 'trip_place_id']),
  },
  // Update-only root (TIER1_UPDATE_ONLY_TABLES): nothing is create-only.
  trip_photos: { always: new Set(['id']), createOnly: new Set() },
};

/** Why a field was dropped from a write payload:
 *  - 'restricted'  — Google-restricted content name (C3): a bug upstream.
 *  - 'server_only' — in the READ allowlist but not client-writable (C1:
 *    day_index, order_in_day, updated_at, …). Expected on every full-row
 *    update (updatePartial: false), stripped loudly-but-deduped.
 *  - 'unknown'     — not in any allowlist (default-deny). */
export type Tier1WriteDropKind = 'restricted' | 'server_only' | 'unknown';

export interface WriteSanitizeOptions {
  /** Same contract as SanitizeOptions.mode — 'throw' (default) raises
   * SyncTosViolationError on restricted names; 'strip' drops them. */
  mode?: 'throw' | 'strip';
  /** Invoked for every dropped field with its classification. */
  onDrop?: (field: string, kind: Tier1WriteDropKind) => void;
}

/**
 * Default-deny projection of a CLIENT WRITE onto the table's write subset —
 * the C1 mirror of sanitizeForTier1. Wired into the sync engine's
 * `transform.save` (hydrate.ts) so every create/update the plugin emits
 * passes through here before reaching PostgREST.
 *
 * - Write-allowlisted fields copy through (undefined skipped — PostgREST
 *   must not receive explicit undefined).
 * - Structural ids pass per TIER1_WRITE_STRUCTURAL above.
 * - Restricted Google names THROW (default) or strip per options.mode (C3).
 * - Server-only fields (read-allowlisted, not writable) are DROPPED and
 *   reported — a client write attempting day_index is stripped, never sent.
 * - Unknown fields are dropped (default-deny).
 *
 * Pure function: no I/O, never mutates `patch`.
 */
export function sanitizeForTier1Write<K extends Tier1WriteTable>(
  table: K,
  patch: Record<string, unknown>,
  options?: WriteSanitizeOptions,
): Partial<Tier1RowTypes[K]> {
  if (!isTier1WriteTable(table)) {
    // Runtime guard for untyped callers (the engine wires save only for
    // write-enabled roots, but a JS caller could bypass the types).
    throw new Error(
      `[sync] sanitizeForTier1Write: table "${table as string}" is not write-enabled (write slice = ${TIER1_WRITE_TABLES.join(', ')})`,
    );
  }
  const mode = options?.mode ?? 'throw';
  const writable = TIER1_WRITE_FIELD_SETS[table];
  const structural = TIER1_WRITE_STRUCTURAL[table];
  const readAllowed = TIER1_FIELD_SETS[table];
  // Mirror the plugin's own create detection (fieldCreatedAt falsy ⇒ create).
  const isCreate = !patch['created_at'];
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    const isStructural = structural.always.has(key) || (isCreate && structural.createOnly.has(key));
    if (writable.has(key) || isStructural) {
      if (patch[key] !== undefined) out[key] = patch[key];
      continue;
    }
    if (isRestrictedFieldName(key)) {
      if (mode === 'throw') throw new SyncTosViolationError(table, key);
      options?.onDrop?.(key, 'restricted');
      continue;
    }
    options?.onDrop?.(key, readAllowed.has(key) ? 'server_only' : 'unknown');
  }
  return out as Partial<Tier1RowTypes[K]>;
}
