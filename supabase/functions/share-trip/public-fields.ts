// share-trip — allow-lists for the ANONYMOUS `op: "read"` payload.
//
// Pure module (no Deno / network imports) so the allow-lists can be unit
// tested in isolation and type-checked by the repo-root tsc.
//
// Why an explicit allow-list (and not just the PostgREST `select` string):
// the read runs under the service-role client, so the response shape is the
// ONLY thing standing between a stranger holding a link and the trip's
// private data. The same key lists drive both the `select` (least data
// fetched) and `pickPublic` (least data returned), so a future edit to one
// cannot silently widen the other.
//
// contractVersion history (`meta.contractVersion` on the read response):
//   1 (implicit — v1 responses carried no `meta`):
//       trip.id + places[].notes were returned.
//   2 (security audit #12, 2026-09-29):
//       - `trip.id` REMOVED — the public page never needed it, and the trip
//         uuid is the key of every RLS/Storage path; no reason to hand it to
//         anonymous viewers.
//       - `places[].notes` REMOVED — product decision: notes are PRIVATE by
//         default ("memories are private by default"). Day notes
//         (`trip_days.notes`) were never part of the payload and stay out.
//   Removing fields is normally a parallel-version change, but this is a
//   data-exposure fix: keeping v1 alive for old binaries would keep the leak
//   alive. Every shipped consumer already tolerates the missing fields
//   (`SharedTimeline` guards `place.notes ?`, nothing reads `trip.id`,
//   `functions/share/[token].ts` reads only title/dates + places.length).
//   3 (M5 Y2.5, ADDITIVE — every v2 field keeps its name, type and meaning):
//       - `sections: { itinerary, expenses, memories }` — the owner's per-link
//         toggles (trip_shares.show_*, migration 0037), so the page can tell
//         "hidden by the owner" from "empty".
//       - `places` / `legs` are still ALWAYS arrays; they are EMPTY when the
//         owner turned the itinerary off (a v2 page renders "no places").
//       - `expenses` (present only when show_expenses): a SUMMARY — home-
//         currency totals by category + the per-currency breakdown of the
//         original amounts + pending rows per currency. Never line items,
//         labels, days or ids (./expense-summary.ts).
//       - `memories` (present only when show_memories): journal entries,
//         personal reviews and photos, and ONLY rows with
//         visibility = 'trip' AND deleted = false (+ status = 'ready' for
//         photos). `only_me` items are never public: the query filters them
//         AND `isPublicMemoryRow` re-checks every row (defense in depth).
//         No author ids or names. Photos carry 1 h signed URLs from the
//         private `trip-memories` bucket (never a public bucket).
//       Notes (`places[].notes`, `trip_days.notes`) stay private: there is
//       no "show notes" toggle in v3.

export const SHARE_READ_CONTRACT_VERSION = 3 as const;

export const PUBLIC_TRIP_KEYS = [
  'title',
  'start_date',
  'end_date',
  'daily_hours_budget',
  'transport_mode',
  'timezone',
] as const;

export const PUBLIC_PLACE_KEYS = [
  'id',
  'google_place_id',
  'user_title',
  'category',
  'lat',
  'lng',
  'visit_duration_minutes',
  'day_index',
  'order_in_day',
] as const;

export const PUBLIC_LEG_KEYS = [
  'id',
  'from_place_id',
  'to_place_id',
  'day_index',
  'transport_mode',
  'duration_seconds',
  'distance_meters',
  'polyline',
  'computed_at',
] as const;

/** Keys that must NEVER appear on the anonymous read payload (regression guard). */
export const FORBIDDEN_PUBLIC_KEYS = ['user_id', 'notes'] as const;

export const TRIP_FIELDS = PUBLIC_TRIP_KEYS.join(', ');
export const PLACE_FIELDS = PUBLIC_PLACE_KEYS.join(', ');
export const LEG_FIELDS = PUBLIC_LEG_KEYS.join(', ');

type Row = Record<string, unknown>;

/**
 * Copy only `keys` from `row`. Keys absent on the row are omitted (not set to
 * undefined) so the JSON shape mirrors what the DB returned.
 */
export function pickPublic<K extends string>(row: Row, keys: readonly K[]): Partial<Record<K, unknown>> {
  const out: Partial<Record<K, unknown>> = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(row, k)) out[k] = row[k];
  }
  return out;
}

// ===========================================================================
// Per-link toggles (trip_shares.show_*, migration 0037)
// ===========================================================================

export interface ShareSettings {
  showItinerary: boolean;
  showExpenses: boolean;
  showMemories: boolean;
}

/** Column defaults of 0037: existing links keep today's behavior, the rest is opt-in. */
export const DEFAULT_SHARE_SETTINGS: Readonly<ShareSettings> = Object.freeze({
  showItinerary: true,
  showExpenses: false,
  showMemories: false,
});

export const SHARE_SETTINGS_COLUMNS = 'show_itinerary, show_expenses, show_memories';

/**
 * DB row -> settings, FAIL-CLOSED: expenses and memories open only on an
 * explicit `true`; the itinerary stays on unless explicitly `false` (its
 * column default, and the pre-M5 behavior).
 */
export function settingsFromRow(row: Row): ShareSettings {
  return {
    showItinerary: row.show_itinerary !== false,
    showExpenses: row.show_expenses === true,
    showMemories: row.show_memories === true,
  };
}

/** Settings patch -> DB columns (only the keys that are set). */
export function settingsToColumns(patch: Partial<ShareSettings>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (typeof patch.showItinerary === 'boolean') out.show_itinerary = patch.showItinerary;
  if (typeof patch.showExpenses === 'boolean') out.show_expenses = patch.showExpenses;
  if (typeof patch.showMemories === 'boolean') out.show_memories = patch.showMemories;
  return out;
}

// ===========================================================================
// Memories (0036 + 0038). Least data fetched AND least data returned.
// `visibility` / `deleted` / `status` are fetched only for the re-check.
// ===========================================================================

export const PUBLIC_JOURNAL_FIELDS = 'id, day_index, body, created_at, visibility, deleted';
export const PUBLIC_REVIEW_FIELDS =
  'id, trip_place_id, rating, body, created_at, place_name_snapshot, visibility, deleted';
export const PUBLIC_PHOTO_FIELDS =
  'id, day_index, trip_place_id, storage_path, thumb_path, width, height, caption, taken_at, created_at, visibility, deleted, status';

/** Row caps per section (payload size + signing work per anonymous read). */
export const MAX_PUBLIC_JOURNAL = 200;
export const MAX_PUBLIC_REVIEWS = 300;
export const MAX_PUBLIC_PHOTOS = 100;

export type MemoryKind = 'journal' | 'review' | 'photo';

/**
 * THE public-memory predicate (0036 visibility model). Only shared, live
 * rows; photos also need status = 'ready'. Anything else (`only_me`,
 * tombstones, pending uploads, a missing column) is private.
 */
export function isPublicMemoryRow(row: Row, kind: MemoryKind): boolean {
  if (row.visibility !== 'trip') return false;
  if (row.deleted !== false) return false;
  if (kind === 'photo' && row.status !== 'ready') return false;
  return true;
}

export interface PublicJournalEntry {
  id: string;
  /** 0-based trip day. */
  dayIndex: number;
  body: string;
  createdAt: string;
}

export interface PublicReview {
  id: string;
  /** A `places[].id` when that place is on the public itinerary, else null. */
  placeId: string | null;
  /** The live place title, else the 0038 snapshot (place removed), else null. */
  placeName: string | null;
  /** The author's own 1-5 stars (never Google data), null = not picked. */
  rating: number | null;
  body: string;
  createdAt: string;
}

export interface PublicPhoto {
  id: string;
  dayIndex: number | null;
  /** A `places[].id` when that place is on the public itinerary, else null. */
  placeId: string | null;
  caption: string | null;
  takenAt: string | null;
  width: number | null;
  height: number | null;
  /** Signed URL of the ~400 px thumbnail (expires at `memories.photoUrlExpiresAt`). */
  thumbUrl: string;
  /** Signed URL of the full image (same expiry). */
  url: string;
}

export interface PublicMemories {
  journal: PublicJournalEntry[];
  reviews: PublicReview[];
  photos: PublicPhoto[];
  /** ISO time the photo URLs stop working (null when there are no photos). */
  photoUrlExpiresAt: string | null;
  /** True when a section hit its row cap (older items were left out). */
  truncated: boolean;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function intOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

/** Path -> signed URL, from Storage `createSignedUrls` (entries with an error are absent). */
export type SignedUrlMap = ReadonlyMap<string, string>;

/**
 * Photo rows -> the storage paths to sign. Runs the public predicate first:
 * an `only_me` / tombstoned / pending photo's path is never even signed.
 */
export function photoPathsToSign(photos: readonly Row[]): string[] {
  const out: string[] = [];
  for (const p of photos) {
    if (!isPublicMemoryRow(p, 'photo')) continue;
    const full = str(p.storage_path);
    const thumb = str(p.thumb_path);
    if (full && thumb) out.push(thumb, full);
  }
  return out;
}

/**
 * Shape the `memories` section from raw rows (already filtered by the
 * query; filtered AGAIN here). `places` = live trip places (id + title), used
 * for review names; `publicPlaceIds` = the ids on the public itinerary
 * (empty when the itinerary is hidden), the only ids a row may reference.
 */
export function buildPublicMemories(input: {
  journal: readonly Row[];
  reviews: readonly Row[];
  photos: readonly Row[];
  places: readonly Row[];
  publicPlaceIds: ReadonlySet<string>;
  signed: SignedUrlMap;
  photoUrlExpiresAt: string | null;
  truncated: boolean;
}): PublicMemories {
  const titleById = new Map<string, string | null>();
  for (const p of input.places) {
    const id = str(p.id);
    if (id) titleById.set(id, str(p.user_title));
  }
  const publicPlace = (id: unknown): string | null => {
    const s = str(id);
    return s && input.publicPlaceIds.has(s) ? s : null;
  };

  const journal: PublicJournalEntry[] = [];
  for (const j of input.journal) {
    if (!isPublicMemoryRow(j, 'journal')) continue;
    const id = str(j.id);
    const dayIndex = intOrNull(j.day_index);
    const body = str(j.body) ?? '';
    // Empty bodies are autosave drafts, not something to publish.
    if (!id || dayIndex === null || body.trim() === '') continue;
    journal.push({ id, dayIndex, body, createdAt: str(j.created_at) ?? '' });
  }

  const reviews: PublicReview[] = [];
  for (const r of input.reviews) {
    if (!isPublicMemoryRow(r, 'review')) continue;
    const id = str(r.id);
    if (!id) continue;
    const rating = intOrNull(r.rating);
    const body = str(r.body) ?? '';
    if (rating === null && body.trim() === '') continue;
    const linked = str(r.trip_place_id);
    // Live title while the place exists (and is not tombstoned); the 0038
    // snapshot once it was removed (trip_place_id NULL) or tombstoned.
    const liveTitle = linked && titleById.has(linked) ? titleById.get(linked) ?? null : null;
    reviews.push({
      id,
      placeId: publicPlace(linked),
      placeName: liveTitle ?? str(r.place_name_snapshot),
      rating: rating !== null && rating >= 1 && rating <= 5 ? rating : null,
      body,
      createdAt: str(r.created_at) ?? '',
    });
  }

  const photos: PublicPhoto[] = [];
  for (const p of input.photos) {
    if (!isPublicMemoryRow(p, 'photo')) continue;
    const id = str(p.id);
    const full = str(p.storage_path);
    const thumb = str(p.thumb_path);
    const url = full ? input.signed.get(full) : undefined;
    const thumbUrl = thumb ? input.signed.get(thumb) : undefined;
    // No URL = nothing to show (signing failed for this object).
    if (!id || !url || !thumbUrl) continue;
    photos.push({
      id,
      dayIndex: intOrNull(p.day_index),
      placeId: publicPlace(p.trip_place_id),
      caption: str(p.caption),
      takenAt: str(p.taken_at),
      width: intOrNull(p.width),
      height: intOrNull(p.height),
      thumbUrl,
      url,
    });
  }

  return {
    journal,
    reviews,
    photos,
    photoUrlExpiresAt: photos.length > 0 ? input.photoUrlExpiresAt : null,
    truncated: input.truncated,
  };
}

// ===========================================================================
// The payload
// ===========================================================================

export interface PublicSharePayload<E = unknown> {
  trip: Partial<Record<(typeof PUBLIC_TRIP_KEYS)[number], unknown>>;
  places: Array<Partial<Record<(typeof PUBLIC_PLACE_KEYS)[number], unknown>>>;
  legs: Array<Partial<Record<(typeof PUBLIC_LEG_KEYS)[number], unknown>>>;
  sections: { itinerary: boolean; expenses: boolean; memories: boolean };
  expenses?: E;
  memories?: PublicMemories;
  meta: { contractVersion: typeof SHARE_READ_CONTRACT_VERSION };
}

/**
 * Shape the anonymous read response from raw DB rows (allow-list only).
 * `settings` defaults to the pre-M5 behavior (itinerary only). A section's
 * key is present ONLY when its toggle is on AND the caller supplied it, so a
 * missing toggle can never leak a section that was fetched by mistake.
 */
export function buildPublicSharePayload<E = unknown>(input: {
  trip: Row;
  places: readonly Row[] | null | undefined;
  legs: readonly Row[] | null | undefined;
  settings?: ShareSettings;
  expenses?: E | null;
  memories?: PublicMemories | null;
}): PublicSharePayload<E> {
  const settings = input.settings ?? DEFAULT_SHARE_SETTINGS;
  const payload: PublicSharePayload<E> = {
    trip: pickPublic(input.trip, PUBLIC_TRIP_KEYS),
    places: settings.showItinerary ? (input.places ?? []).map((p) => pickPublic(p, PUBLIC_PLACE_KEYS)) : [],
    legs: settings.showItinerary ? (input.legs ?? []).map((l) => pickPublic(l, PUBLIC_LEG_KEYS)) : [],
    sections: {
      itinerary: settings.showItinerary,
      expenses: settings.showExpenses,
      memories: settings.showMemories,
    },
    meta: { contractVersion: SHARE_READ_CONTRACT_VERSION },
  };
  if (settings.showExpenses && input.expenses) payload.expenses = input.expenses;
  if (settings.showMemories && input.memories) payload.memories = input.memories;
  return payload;
}
