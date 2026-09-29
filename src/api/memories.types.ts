/**
 * memories.types.ts — row types + view contracts for M5 memories (Y2.1).
 *
 * Wave-2 file-ownership rule: memory types live HERE, not in ./types.ts.
 * Keep the row interfaces in lockstep with:
 *   - supabase/migrations/0036_v2_m5_memories.sql (tables, CHECKs, RLS)
 *   - supabase/migrations/0038_v2_m5_wave1_fixes.sql (review snapshots,
 *     byte quota, get_memory_quota keys)
 *
 * VISIBILITY (user decision 2026-09-29, PRIVATE BY DEFAULT):
 *   'only_me' (default) = the author only; 'trip' = every accepted member.
 *   The author always sees every own row (tombstones and pending photos
 *   included). Other members see only visibility='trip' AND NOT deleted
 *   (AND status='ready' for photos).
 *
 * STATE TIERS (0036 "SYNC CONTRACT FOR Y2.1"):
 *   - Tier-1 (offline, persisted): the SIGNED-IN USER'S OWN rows only
 *     (author_id = auth.uid()). src/sync scopes the pulls AND the realtime
 *     channel to the author, because an un-share or tombstone by another
 *     member makes their row disappear from our RLS view and an incremental
 *     pull could never evict it (ghost rows).
 *   - Tier-2 (TanStack Query, memory-only, never persisted): other members'
 *     shared items, refetched.
 *
 * User content only: nothing here is Google Places data. `rating` on a
 * review is the USER'S own 1–5 stars (never mixed with Google ratings);
 * `place_google_id_snapshot` is the one durable Google pointer.
 */

import type { Uuid } from './types';

// ===========================================================================
// Enums
// ===========================================================================

export type MemoryVisibility = 'only_me' | 'trip';
export const MEMORY_VISIBILITIES: readonly MemoryVisibility[] = ['only_me', 'trip'] as const;

/** The three memory kinds. Matches `remove_trip_memory(p_kind)` (0036 §3e). */
export type MemoryKind = 'journal' | 'review' | 'photo';

/** trip_photos.status (0036): pending = row created, upload in flight. */
export type TripPhotoStatus = 'pending' | 'ready';

// ===========================================================================
// Rows (server shape; also the Tier-1 store shape)
// ===========================================================================

/** public.trip_journal_entries. Many entries per (trip, author, day) are allowed. */
export interface TripJournalEntry {
  id: Uuid;
  trip_id: Uuid;
  author_id: Uuid;
  /** 0-based trip day (0..999). */
  day_index: number;
  /** May be '' (autosave). <= 20 000 chars. */
  body: string;
  visibility: MemoryVisibility;
  /** Server-stamped; ABSENT on an unacked local create (never set it client-side). */
  created_at: string;
  /** Server-stamped LWW clock (handle_times). */
  updated_at: string;
  deleted: boolean;
}

/** public.trip_place_reviews. One LIVE review per (trip_place_id, author). */
export interface TripPlaceReview {
  id: Uuid;
  trip_id: Uuid;
  /** NULL = the place was removed from the trip (0038: ON DELETE SET NULL). Immutable for clients. */
  trip_place_id: Uuid | null;
  author_id: Uuid;
  /** The user's own stars 1–5; NULL = text written, stars not picked yet. */
  rating: number | null;
  /** <= 4 000 chars; may be ''. */
  body: string;
  visibility: MemoryVisibility;
  /** Server-owned (0038): trip_places.user_title copy, frozen when the place is removed. Read-only. */
  place_name_snapshot: string | null;
  /** Server-owned (0038): trip_places.google_place_id copy (re-resolve on tap, Tier-2). Read-only. */
  place_google_id_snapshot: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

/** public.trip_photos — the index row of one memory photo (bytes live in Storage). */
export interface TripPhoto {
  id: Uuid;
  trip_id: Uuid;
  author_id: Uuid;
  day_index: number | null;
  trip_place_id: Uuid | null;
  /** Server-stamped `<trip>/<author>/<id>.jpg` in bucket `trip-memories`. Read-only. */
  storage_path: string;
  /** Server-stamped `<trip>/<author>/<id>_t.jpg`. Read-only. */
  thumb_path: string;
  width: number | null;
  height: number | null;
  /** Server-stamped from Storage metadata on pending → ready. Read-only. */
  bytes: number | null;
  thumb_bytes: number | null;
  caption: string | null;
  /** From the picker EXIF date, read on device before the re-encode strips EXIF. */
  taken_at: string | null;
  /** Server-owned: forced 'pending' on insert; the upload queue flips it to 'ready'. */
  status: TripPhotoStatus;
  visibility: MemoryVisibility;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

// ===========================================================================
// Quota (rpc get_memory_quota, 0038 §2f)
// ===========================================================================

export interface MemoryQuota {
  /** Live photos + photos whose objects are still stored (a tombstone frees the slot once its files are gone). */
  user_used: number;
  user_cap: number;
  /** Bytes of the caller's trip-memories objects (tombstoned / orphaned included). */
  user_bytes: number;
  user_bytes_cap: number;
  /** Photos currently pending (uploading) for the caller, any device. */
  user_pending: number;
  user_pending_cap: number;
  /** Live photos by current members of the trip; null without a trip id. */
  trip_used: number | null;
  trip_cap: number | null;
  /** The project-wide Storage guard is reached: new photos are refused. */
  storage_full: boolean;
}

// ===========================================================================
// Errors
// ===========================================================================

/**
 * Stable error codes for the UI (keep error KEYS in state, translate at
 * render — i18n rule 3). Server tokens (0036/0038) + client pipeline codes.
 */
export type MemoryErrorCode =
  // server tokens (PostgREST `message`)
  | 'quota_exceeded'
  | 'storage_full'
  | 'upload_incomplete'
  | 'not_author'
  | 'immutable_column'
  | 'author_mismatch'
  | 'not_found'
  | 'invalid_status_transition'
  | 'not_authenticated'
  // client pipeline
  | 'unsupported_image'
  | 'image_too_large'
  | 'exif_strip_failed'
  | 'invalid_value'
  | 'forbidden'
  | 'trip_not_found'
  | 'network'
  | 'unknown';

/**
 * `details.scope` of quota errors (0038):
 *   user        photos holding a slot >= memories_user_cap (300)
 *   user_bytes  author bytes >= memories_user_bytes_cap (100 MiB)
 *   pending     pending photos >= memories_user_pending_cap (20) — TRANSIENT: wait
 *   trip        live photos by current members >= memories_trip_cap (500)
 *   global      storage_full: all buckets >= the 900 MiB guard
 */
export type MemoryQuotaScope = 'user' | 'user_bytes' | 'pending' | 'trip' | 'global';

/** Serializable error info (queue jobs persist it). */
export interface MemoryErrorInfo {
  code: MemoryErrorCode;
  scope?: MemoryQuotaScope;
  limit?: number;
  used?: number;
  /** Developer detail (never shown verbatim to users). */
  message?: string;
}

// ===========================================================================
// Photo upload queue (durable, survives restarts)
// ===========================================================================

/**
 * UI-facing state of one queued photo:
 *   queued     waiting for an upload slot
 *   uploading  row insert / file upload / finalize in flight
 *   waiting    paused: `waitingFor` says why (pending-slot cap, network)
 *   failed     needs the user: retry or cancel (see `error`)
 */
export type PhotoUploadState = 'queued' | 'uploading' | 'waiting' | 'failed';

export interface PhotoUploadJobView {
  /** = the trip_photos id (client-minted UUID). */
  id: Uuid;
  tripId: Uuid;
  dayIndex: number | null;
  tripPlaceId: Uuid | null;
  caption: string | null;
  visibility: MemoryVisibility;
  takenAt: string | null;
  width: number;
  height: number;
  /** Bytes of the re-encoded (EXIF-free) full image + thumbnail. */
  bytes: number;
  state: PhotoUploadState;
  /** Coarse 0..1: row 0.15, full file 0.7, thumb 0.85, ready 1. */
  progress: number;
  waitingFor: 'pending_slot' | 'network' | null;
  error: MemoryErrorInfo | null;
  /** Local preview of the re-encoded image (file:// on native, blob: on web); null until resolved. */
  previewUri: string | null;
  /** Epoch ms of enqueue. */
  createdAt: number;
}

// ===========================================================================
// Picker input (picker-agnostic; matches expo-image-picker's ImagePickerAsset)
// ===========================================================================

/**
 * One picked image. Structurally compatible with expo-image-picker's
 * `ImagePickerAsset` (pass `result.assets` straight through) and with a web
 * `<input type=file>` File (`{ uri: URL.createObjectURL(file), file }`).
 *
 * PRIVACY: the original file is only ever READ locally to decode pixels
 * (and the EXIF capture date). It is never uploaded or persisted: the
 * pipeline re-encodes, strips every metadata segment and verifies the
 * result before anything leaves the device.
 */
export interface PickedPhoto {
  uri: string;
  width?: number;
  height?: number;
  mimeType?: string | null;
  fileName?: string | null;
  /** Picker EXIF (native, `exif: true`). ONLY the capture date is read from it. */
  exif?: Record<string, unknown> | null;
  /** Web: the picked File/Blob (preferred over fetching `uri`). */
  file?: Blob | null;
}

// ===========================================================================
// Merged read model (useTripMemories)
// ===========================================================================

export interface MemoryPhotoItem {
  kind: 'photo';
  id: Uuid;
  tripId: Uuid;
  dayIndex: number | null;
  /** Sort key within a day: taken_at ?? created_at (ISO) ?? enqueue time. */
  at: string;
  isOwn: boolean;
  visibility: MemoryVisibility;
  /** The server row; null while the photo exists only in the local upload queue. */
  photo: TripPhoto | null;
  /** Present while this device still uploads it. */
  upload: PhotoUploadJobView | null;
}

export interface MemoryJournalItem {
  kind: 'journal';
  id: Uuid;
  tripId: Uuid;
  dayIndex: number;
  at: string;
  isOwn: boolean;
  visibility: MemoryVisibility;
  entry: TripJournalEntry;
}

export interface MemoryReviewItem {
  kind: 'review';
  id: Uuid;
  tripId: Uuid;
  /** Reviews have no day of their own: the reviewed place's day_index (null when unscheduled / detached). */
  dayIndex: number | null;
  at: string;
  isOwn: boolean;
  visibility: MemoryVisibility;
  review: TripPlaceReview;
}

export type MemoryItem = MemoryPhotoItem | MemoryJournalItem | MemoryReviewItem;

export interface MemoryDayGroup {
  /** null = undated (photos without a day, reviews of unscheduled places). Sorted last. */
  dayIndex: number | null;
  items: MemoryItem[];
}

export interface TripMemoriesView {
  /** Day groups ascending by dayIndex (null last); items oldest first within a day. */
  days: MemoryDayGroup[];
  /** Flat list in the same order. */
  items: MemoryItem[];
  counts: { photos: number; journal: number; reviews: number; uploading: number; failed: number };
  /** Newest ready photo (hub card thumbnail); own uploads without a row excluded. */
  latestPhoto: TripPhoto | null;
}
