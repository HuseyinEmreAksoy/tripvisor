/**
 * memories.ts — Tier-1 write API for the M5 memory roots (Y2.1):
 * trip_journal_entries + trip_place_reviews (create/update/tombstone) and
 * trip_photos (update/tombstone only — rows are born through the online
 * upload queue, src/api/memories.upload-queue.ts).
 *
 * Same engine rules as ./mutations.ts (read its header):
 *   - client-minted UUIDs (mintId); created_at/updated_at NEVER set (the
 *     plugin's create/update discriminator + the LWW clock);
 *   - COMPLETE creates (every allowlisted column explicit, nulls included);
 *   - delete = TOMBSTONE (`deleted: true`), replicated by incremental pulls;
 *   - every update/tombstone captures prior values and returns an UndoEntry;
 *   - values the DB CHECKs would reject throw SyncWriteError('invalid_value')
 *     BEFORE the store write (a server-rejected write retries forever).
 *
 * Memory-specific rules (0036 "SYNC CONTRACT FOR Y2.1"):
 *   - The memory roots are AUTHOR-SCOPED: the store holds only the session
 *     user's own rows, so "row in the store" means "I authored it" (asserted
 *     again on author_id). Other members' items are never writable here.
 *   - `author_id` is stamped from the engine's session user on create (the
 *     0036 guard re-checks it against auth.uid()).
 *   - Server-owned columns are never written: updated_at, status, bytes,
 *     thumb_bytes, storage_path, thumb_path, place_*_snapshot (the write
 *     allowlist strips them anyway).
 *   - Reviews: one LIVE review per (place, author). The server supersedes an
 *     older one on create (0036 §4b); createPlaceReview mirrors that locally
 *     so the store never shows two.
 *
 * Callers branch on isTier1SyncActive() first (the src/api/memories.ts
 * facades do) and use the online PostgREST path otherwise.
 */

import type {
  MemoryKind,
  MemoryVisibility,
  TripJournalEntry,
  TripPhoto,
  TripPlaceReview,
} from '../api/memories.types';
import { getTier1SyncUserId } from './hydrate';
import { SyncWriteError, isTier1SyncActive, mintId } from './mutations';
import { tier1Store$ } from './store';
import type { UndoEntry } from './undo';

// Record nodes always exist at runtime (see mutations.ts `node`).
function node<T>(maybe: T | undefined): T {
  return maybe as T;
}

// ───────────────────────────────────────────────────────────────────────────
// Gate + value guards (client mirrors of the 0036 CHECKs)
// ───────────────────────────────────────────────────────────────────────────

/** 0036 §1a: char_length(body) <= 20000. */
export const JOURNAL_BODY_MAX = 20000;
/** 0036 §1b: char_length(body) <= 4000. */
export const REVIEW_BODY_MAX = 4000;
/** 0036 §1c: char_length(caption) <= 500. */
export const PHOTO_CAPTION_MAX = 500;
/** 0036: day_index between 0 and 999. */
export const MEMORY_DAY_INDEX_MAX = 999;

const VISIBILITIES: ReadonlySet<string> = new Set(['only_me', 'trip']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(message: string): never {
  throw new SyncWriteError('invalid_value', message);
}

/** The engine is active AND bound to a session user (author of every create). */
function sessionAuthor(): string {
  const userId = isTier1SyncActive() ? getTier1SyncUserId() : null;
  if (!userId) {
    throw new SyncWriteError(
      'sync_inactive',
      'Tier-1 sync is not active — use the online memory mutations (src/api/memories.ts branches on isTier1SyncActive()).',
    );
  }
  return userId;
}

function assertUuid(field: string, v: unknown): void {
  if (typeof v !== 'string' || !UUID_RE.test(v)) invalid(`${field} must be a uuid (got ${JSON.stringify(v)})`);
}

function assertVisibility(v: unknown): void {
  if (typeof v !== 'string' || !VISIBILITIES.has(v)) {
    invalid(`visibility must be 'only_me' or 'trip' (got ${JSON.stringify(v)})`);
  }
}

function assertDayIndex(field: string, v: unknown, nullable: boolean): void {
  if (v === null && nullable) return;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MEMORY_DAY_INDEX_MAX) {
    invalid(`${field} must be an integer 0–${MEMORY_DAY_INDEX_MAX}${nullable ? ' or null' : ''} (got ${JSON.stringify(v)})`);
  }
}

function assertText(field: string, v: unknown, max: number, nullable: boolean): void {
  if (v === null && nullable) return;
  if (typeof v !== 'string' || v.length > max) {
    invalid(`${field} must be a string of at most ${max} characters${nullable ? ' or null' : ''}`);
  }
}

function assertRating(v: unknown): void {
  if (v === null) return;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) {
    invalid(`rating must be an integer 1–5 or null (got ${JSON.stringify(v)})`);
  }
}

function assertTimestamp(field: string, v: unknown): void {
  if (v === null) return;
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) {
    invalid(`${field} must be an ISO timestamp or null (got ${JSON.stringify(v)})`);
  }
}

/**
 * Project a patch onto `allowed` (undefined skipped), capturing prior values
 * for the inverse (absent prior → explicit null, like mutations.capturePatch).
 */
function capture(
  patch: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  prev: Record<string, unknown>,
): { clean: Record<string, unknown>; prior: Record<string, unknown> } {
  const clean: Record<string, unknown> = {};
  const prior: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key) || patch[key] === undefined) continue;
    clean[key] = patch[key];
    prior[key] = prev[key] === undefined ? null : prev[key];
  }
  return { clean, prior };
}

/** A row the engine user authored (the store is author-scoped; checked anyway). */
function ownRow<T extends { author_id: string }>(
  row: T | undefined,
  what: string,
  id: string,
  userId: string,
): T {
  if (!row) throw new SyncWriteError('row_not_found', `${what} "${id}" is not in the local store`);
  if (row.author_id !== userId) {
    // Unreachable with the author-scoped hydration; loud if it ever is.
    throw new SyncWriteError('row_not_found', `${what} "${id}" is not authored by the session user`);
  }
  return row;
}

// ───────────────────────────────────────────────────────────────────────────
// Journal
// ───────────────────────────────────────────────────────────────────────────

export interface CreateJournalEntryInput {
  trip_id: string;
  day_index: number;
  /** Defaults to '' (an autosaving editor may create before typing). */
  body?: string;
  /** Defaults to 'only_me' (PRIVATE BY DEFAULT). */
  visibility?: MemoryVisibility;
}

type JournalCreateRow = Omit<TripJournalEntry, 'created_at' | 'updated_at'>;

/** Create an own journal entry; returns the minted id (row is in the store synchronously). */
export function createJournalEntry(input: CreateJournalEntryInput): string {
  const author = sessionAuthor();
  const id = mintId();
  const row: JournalCreateRow = {
    id,
    trip_id: input.trip_id,
    author_id: author,
    day_index: input.day_index,
    body: input.body ?? '',
    visibility: input.visibility ?? 'only_me',
    deleted: false,
  };
  assertUuid('trip_id', row.trip_id);
  assertDayIndex('day_index', row.day_index, false);
  assertText('body', row.body, JOURNAL_BODY_MAX, false);
  assertVisibility(row.visibility);
  node(tier1Store$.tripJournalEntries[id]).set(row as TripJournalEntry);
  return id;
}

export type JournalEntryWritePatch = Partial<Pick<TripJournalEntry, 'day_index' | 'body' | 'visibility'>>;
const JOURNAL_PATCH_FIELDS: ReadonlySet<string> = new Set(['day_index', 'body', 'visibility']);

export function updateJournalEntry(
  id: string,
  patch: JournalEntryWritePatch,
  label = 'Edit journal',
): UndoEntry {
  const author = sessionAuthor();
  const prev = ownRow(node(tier1Store$.tripJournalEntries[id]).peek(), 'journal entry', id, author);
  const { clean, prior } = capture(patch as Record<string, unknown>, JOURNAL_PATCH_FIELDS, prev as unknown as Record<string, unknown>);
  if ('day_index' in clean) assertDayIndex('day_index', clean['day_index'], false);
  if ('body' in clean) assertText('body', clean['body'], JOURNAL_BODY_MAX, false);
  if ('visibility' in clean) assertVisibility(clean['visibility']);
  node(tier1Store$.tripJournalEntries[id]).assign(clean as JournalEntryWritePatch);
  return {
    label,
    inverse: () => {
      sessionAuthor();
      node(tier1Store$.tripJournalEntries[id]).assign(prior as JournalEntryWritePatch);
    },
  };
}

export function tombstoneJournalEntry(id: string, label = 'Remove journal entry'): UndoEntry {
  const author = sessionAuthor();
  const prev = ownRow(node(tier1Store$.tripJournalEntries[id]).peek(), 'journal entry', id, author);
  const snapshot: TripJournalEntry = { ...prev };
  node(tier1Store$.tripJournalEntries[id]).deleted.set(true);
  return {
    label,
    inverse: () => {
      sessionAuthor();
      const current = node(tier1Store$.tripJournalEntries[id]).peek();
      if (current) node(tier1Store$.tripJournalEntries[id]).deleted.set(false);
      else node(tier1Store$.tripJournalEntries[id]).set({ ...snapshot, deleted: false });
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Place reviews (the user's own 1–5 + text; never Google data)
// ───────────────────────────────────────────────────────────────────────────

export interface CreatePlaceReviewInput {
  trip_id: string;
  /** A NEW review needs an existing place of the same trip (0036/0038 INSERT policy). */
  trip_place_id: string;
  /** 1–5 or null (text first, stars later). Defaults to null. */
  rating?: number | null;
  body?: string;
  visibility?: MemoryVisibility;
}

type ReviewCreateRow = Omit<TripPlaceReview, 'created_at' | 'updated_at'>;

/** The session user's live review of a place in the store (at most one after supersede). */
export function findOwnLiveReview(tripPlaceId: string): TripPlaceReview | undefined {
  const userId = isTier1SyncActive() ? getTier1SyncUserId() : null;
  if (!userId) return undefined;
  const all = tier1Store$.tripPlaceReviews.peek() ?? {};
  let best: TripPlaceReview | undefined;
  for (const row of Object.values(all)) {
    if (!row || row.deleted === true || row.author_id !== userId || row.trip_place_id !== tripPlaceId) continue;
    // Newest wins (unacked local creates — no updated_at — are the newest).
    if (!best || (best.updated_at && (!row.updated_at || row.updated_at > best.updated_at))) best = row;
  }
  return best ? { ...best } : undefined;
}

/**
 * Create an own review. Mirrors the server's supersede trigger (0036 §4b):
 * any other own live review of the same place is tombstoned locally in the
 * same tick, so the store never shows two live reviews of one place.
 * Prefer the API's upsert (useUpsertPlaceReview), which UPDATES the existing
 * review instead of creating a second one.
 */
export function createPlaceReview(input: CreatePlaceReviewInput): string {
  const author = sessionAuthor();
  const id = mintId();
  const row: ReviewCreateRow = {
    id,
    trip_id: input.trip_id,
    trip_place_id: input.trip_place_id,
    author_id: author,
    rating: input.rating ?? null,
    body: input.body ?? '',
    visibility: input.visibility ?? 'only_me',
    // Server-owned (0038 §3): the create-ack merges the real values back.
    place_name_snapshot: null,
    place_google_id_snapshot: null,
    deleted: false,
  };
  assertUuid('trip_id', row.trip_id);
  assertUuid('trip_place_id', row.trip_place_id);
  assertRating(row.rating);
  assertText('body', row.body, REVIEW_BODY_MAX, false);
  assertVisibility(row.visibility);
  // A place row we DO know about must belong to the same trip, or the INSERT
  // policy would reject the create forever (infinite retry).
  const place = tier1Store$.tripPlaces[row.trip_place_id as string]?.peek();
  if (place && place.trip_id !== row.trip_id) {
    invalid('trip_place_id belongs to another trip');
  }
  const all = tier1Store$.tripPlaceReviews.peek() ?? {};
  for (const other of Object.values(all)) {
    if (other && !other.deleted && other.author_id === author && other.trip_place_id === row.trip_place_id) {
      node(tier1Store$.tripPlaceReviews[other.id]).deleted.set(true);
    }
  }
  node(tier1Store$.tripPlaceReviews[id]).set(row as TripPlaceReview);
  return id;
}

export type PlaceReviewWritePatch = Partial<Pick<TripPlaceReview, 'rating' | 'body' | 'visibility'>>;
const REVIEW_PATCH_FIELDS: ReadonlySet<string> = new Set(['rating', 'body', 'visibility']);

export function updatePlaceReview(id: string, patch: PlaceReviewWritePatch, label = 'Edit review'): UndoEntry {
  const author = sessionAuthor();
  const prev = ownRow(node(tier1Store$.tripPlaceReviews[id]).peek(), 'review', id, author);
  const { clean, prior } = capture(patch as Record<string, unknown>, REVIEW_PATCH_FIELDS, prev as unknown as Record<string, unknown>);
  if ('rating' in clean) assertRating(clean['rating']);
  if ('body' in clean) assertText('body', clean['body'], REVIEW_BODY_MAX, false);
  if ('visibility' in clean) assertVisibility(clean['visibility']);
  node(tier1Store$.tripPlaceReviews[id]).assign(clean as PlaceReviewWritePatch);
  return {
    label,
    inverse: () => {
      sessionAuthor();
      node(tier1Store$.tripPlaceReviews[id]).assign(prior as PlaceReviewWritePatch);
    },
  };
}

export function tombstonePlaceReview(id: string, label = 'Remove review'): UndoEntry {
  const author = sessionAuthor();
  const prev = ownRow(node(tier1Store$.tripPlaceReviews[id]).peek(), 'review', id, author);
  const snapshot: TripPlaceReview = { ...prev };
  node(tier1Store$.tripPlaceReviews[id]).deleted.set(true);
  return {
    label,
    inverse: () => {
      sessionAuthor();
      // Un-deleting supersedes any newer live review of the place server-side
      // (0036 §4b); mirror it locally like createPlaceReview does.
      const all = tier1Store$.tripPlaceReviews.peek() ?? {};
      for (const other of Object.values(all)) {
        if (
          other &&
          other.id !== id &&
          !other.deleted &&
          other.author_id === author &&
          snapshot.trip_place_id !== null &&
          other.trip_place_id === snapshot.trip_place_id
        ) {
          node(tier1Store$.tripPlaceReviews[other.id]).deleted.set(true);
        }
      }
      const current = node(tier1Store$.tripPlaceReviews[id]).peek();
      if (current) node(tier1Store$.tripPlaceReviews[id]).deleted.set(false);
      else node(tier1Store$.tripPlaceReviews[id]).set({ ...snapshot, deleted: false });
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Photos (update-only root)
// ───────────────────────────────────────────────────────────────────────────

export type PhotoWritePatch = Partial<Pick<TripPhoto, 'day_index' | 'caption' | 'taken_at' | 'visibility'>>;
const PHOTO_PATCH_FIELDS: ReadonlySet<string> = new Set(['day_index', 'caption', 'taken_at', 'visibility']);

export function updatePhoto(id: string, patch: PhotoWritePatch, label = 'Edit photo'): UndoEntry {
  const author = sessionAuthor();
  const prev = ownRow(node(tier1Store$.tripPhotos[id]).peek(), 'photo', id, author);
  const { clean, prior } = capture(patch as Record<string, unknown>, PHOTO_PATCH_FIELDS, prev as unknown as Record<string, unknown>);
  if ('day_index' in clean) assertDayIndex('day_index', clean['day_index'], true);
  if ('caption' in clean) assertText('caption', clean['caption'], PHOTO_CAPTION_MAX, true);
  if ('taken_at' in clean) assertTimestamp('taken_at', clean['taken_at']);
  if ('visibility' in clean) assertVisibility(clean['visibility']);
  node(tier1Store$.tripPhotos[id]).assign(clean as PhotoWritePatch);
  return {
    label,
    inverse: () => {
      sessionAuthor();
      node(tier1Store$.tripPhotos[id]).assign(prior as PhotoWritePatch);
    },
  };
}

export interface TombstonePhotoOptions {
  /**
   * Undo guard: returns false once the photo's Storage objects are gone
   * (the queue deletes them after a grace period). Restoring a row whose
   * files were removed would show a broken photo, so the inverse then throws
   * SyncWriteError('row_not_found') and the undo is dropped (undo.ts).
   */
  canRestore?: () => boolean;
  /** Called after a successful restore (the caller cancels the pending file deletion). */
  onRestore?: () => void;
}

/**
 * Tombstone an own photo. The caller (src/api/memories.ts) schedules the
 * deletion of its two Storage objects (0038: a tombstoned photo keeps its
 * quota until its FILES are gone).
 */
export function tombstonePhoto(id: string, label = 'Remove photo', options: TombstonePhotoOptions = {}): UndoEntry {
  const author = sessionAuthor();
  const prev = ownRow(node(tier1Store$.tripPhotos[id]).peek(), 'photo', id, author);
  const snapshot: TripPhoto = { ...prev };
  node(tier1Store$.tripPhotos[id]).deleted.set(true);
  return {
    label,
    inverse: () => {
      sessionAuthor();
      if (options.canRestore && !options.canRestore()) {
        throw new SyncWriteError('row_not_found', `photo "${id}" can no longer be restored: its files were removed`);
      }
      const current = node(tier1Store$.tripPhotos[id]).peek();
      if (current) node(tier1Store$.tripPhotos[id]).deleted.set(false);
      else node(tier1Store$.tripPhotos[id]).set({ ...snapshot, deleted: false });
      options.onRestore?.();
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Visibility (single + bulk "share this day / whole trip")
// ───────────────────────────────────────────────────────────────────────────

export interface MemoryRef {
  kind: MemoryKind;
  id: string;
}

function rootFor(kind: MemoryKind) {
  switch (kind) {
    case 'journal':
      return tier1Store$.tripJournalEntries;
    case 'review':
      return tier1Store$.tripPlaceReviews;
    case 'photo':
      return tier1Store$.tripPhotos;
  }
}

/** Is this own memory row in the Tier-1 store (i.e. writable offline)? */
export function hasOwnMemoryRow(ref: MemoryRef): boolean {
  const userId = isTier1SyncActive() ? getTier1SyncUserId() : null;
  if (!userId) return false;
  const row = rootFor(ref.kind)[ref.id]?.peek() as { author_id?: string } | undefined;
  return !!row && row.author_id === userId;
}

/**
 * Set `visibility` on one or many OWN memories in one tick; ONE UndoEntry
 * restores every prior value. Rows not in the store are skipped and reported
 * in `skipped` (the caller sends those through the online path).
 * Tombstoned rows are skipped too (sharing a deleted item is meaningless).
 */
export function setMemoryVisibility(
  refs: readonly MemoryRef[],
  visibility: MemoryVisibility,
  label = visibility === 'trip' ? 'Share with trip' : 'Make private',
): { undo: UndoEntry; applied: MemoryRef[]; skipped: MemoryRef[] } {
  const author = sessionAuthor();
  assertVisibility(visibility);
  const applied: Array<MemoryRef & { prior: MemoryVisibility }> = [];
  const skipped: MemoryRef[] = [];
  for (const ref of refs) {
    const root = rootFor(ref.kind);
    const row = root[ref.id]?.peek() as { author_id: string; visibility: MemoryVisibility; deleted: boolean } | undefined;
    if (!row || row.author_id !== author || row.deleted) {
      skipped.push(ref);
      continue;
    }
    applied.push({ ...ref, prior: row.visibility });
    if (row.visibility !== visibility) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the three roots share the `visibility` column; the union of node types is not callable as one
      (root[ref.id] as any).visibility.set(visibility);
    }
  }
  return {
    applied: applied.map(({ kind, id }) => ({ kind, id })),
    skipped,
    undo: {
      label,
      inverse: () => {
        sessionAuthor();
        for (const { kind, id, prior } of applied) {
          const n = rootFor(kind)[id];
          if (!n?.peek()) continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
          (n as any).visibility.set(prior);
        }
      },
    },
  };
}
