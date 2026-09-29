/**
 * memories.ts — M5 Y2.1 memories data layer: journal, personal place
 * reviews, photos (hooks for the Wave-3 UI, Y3.1).
 *
 * TWO TIERS (0036 "SYNC CONTRACT FOR Y2.1", binding):
 *   - OWN items (author_id = me) come from the Tier-1 store when the engine
 *     is active (offline-first; writes queue offline) — src/sync/memories.ts.
 *   - OTHER members' SHARED items (visibility='trip', live, photos ready)
 *     come from a Tier-2 TanStack query that is REFETCHED and NEVER
 *     persisted (its key root `trip-memories` is not in the persister
 *     allowlist, src/api/offline.*). An un-share or delete by the author
 *     simply disappears on the next refetch — no ghost copies.
 *   - Flag off / not hydrated yet: everything (own included) comes from the
 *     Tier-2 query and writes go straight to PostgREST (online only).
 *
 * PHOTOS: pick → preparePhoto (re-encode, EXIF/GPS stripped, verified) →
 * durable upload queue (memories.upload-queue.ts) → row pending → 2 files →
 * ready. Grids show thumbnails through 1 h signed URLs cached in memory only.
 *
 * PRIVATE BY DEFAULT: every create defaults to visibility 'only_me'.
 * Errors: MemoryError (memories.errors.ts) with stable codes/scopes — keep
 * the code in UI state and translate at render.
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { use$ } from '@legendapp/state/react';
import { z } from 'zod';
import { supabase } from './supabase';
import { tripsKeys } from './_keys';
import type { Trip, TripPlace, Uuid } from './types';
import { useTripPlaces } from './trip-places';
import { TIER1_MUTATION_NETWORK_MODE } from './_tier1Facade';
import { MemoryError, toMemoryErrorInfo } from './memories.errors';
import {
  OBJECT_DELETE_GRACE_MS,
  PHOTO_BUCKET,
  getPhotoUploadQueue,
  onPhotoUploadSettled,
  type PhotoUploadQueueSnapshot,
} from './memories.upload-queue';
import type {
  MemoryDayGroup,
  MemoryErrorInfo,
  MemoryItem,
  MemoryKind,
  MemoryQuota,
  MemoryVisibility,
  PhotoUploadJobView,
  PickedPhoto,
  TripJournalEntry,
  TripMemoriesView,
  TripPhoto,
  TripPlaceReview,
} from './memories.types';
import { preparePhoto } from '../lib/photos/pipeline';
import { tier1SelectColumns } from '@/sync/allowlist';
import { getTier1SyncUserId, resyncTier1, tier1RootLoaded$ } from '@/sync/hydrate';
import { isTier1SyncActive, mintId } from '@/sync/mutations';
import {
  createJournalEntry as syncCreateJournalEntry,
  createPlaceReview as syncCreatePlaceReview,
  findOwnLiveReview,
  hasOwnMemoryRow,
  setMemoryVisibility as syncSetMemoryVisibility,
  tombstoneJournalEntry as syncTombstoneJournalEntry,
  tombstonePhoto as syncTombstonePhoto,
  tombstonePlaceReview as syncTombstonePlaceReview,
  updateJournalEntry as syncUpdateJournalEntry,
  updatePhoto as syncUpdatePhoto,
  updatePlaceReview as syncUpdatePlaceReview,
  type MemoryRef,
} from '@/sync/memories';
import { tier1Store$ } from '@/sync/store';
import { getSessionUndoStack } from '@/sync/undo';

export type {
  MemoryDayGroup,
  MemoryErrorCode,
  MemoryErrorInfo,
  MemoryItem,
  MemoryJournalItem,
  MemoryKind,
  MemoryPhotoItem,
  MemoryQuota,
  MemoryQuotaScope,
  MemoryReviewItem,
  MemoryVisibility,
  PhotoUploadJobView,
  PhotoUploadState,
  PickedPhoto,
  TripJournalEntry,
  TripMemoriesView,
  TripPhoto,
  TripPhotoStatus,
  TripPlaceReview,
} from './memories.types';
export { MemoryError, toMemoryErrorInfo } from './memories.errors';
export type { MemoryRef } from '@/sync/memories';

// ===========================================================================
// Query keys (local — Wave-2 shared-file rule; root NOT persisted)
// ===========================================================================

export const memoryKeys = {
  all: ['trip-memories'] as const,
  /** Tier-2: every row of the trip the caller can see (own + others' shared). */
  trip: (tripId: Uuid) => ['trip-memories', 'trip', tripId] as const,
  quota: (tripId: Uuid | null) => ['trip-memories', 'quota', tripId ?? 'me'] as const,
  signedUrl: (path: string) => ['trip-memories', 'signed-url', path] as const,
};

/** Signed URL lifetime (ADR-0014: 1 h) and the cache margin before expiry. */
export const MEMORY_SIGNED_URL_TTL_S = 3600;
const SIGNED_URL_STALE_MS = 50 * 60_000;
const SIGNED_URL_GC_MS = 55 * 60_000;
const SHARED_STALE_MS = 30_000;

const JOURNAL_COLS = tier1SelectColumns('trip_journal_entries');
const REVIEW_COLS = tier1SelectColumns('trip_place_reviews');
const PHOTO_COLS = tier1SelectColumns('trip_photos');

// ===========================================================================
// Zod (client mirrors of the 0036 CHECKs — friendly errors before the trip)
// ===========================================================================

const uuid = z.string().uuid();
const visibilitySchema = z.enum(['only_me', 'trip']);
const dayIndexSchema = z.number().int().min(0).max(999);

const saveJournalSchema = z.object({
  tripId: uuid,
  dayIndex: dayIndexSchema,
  body: z.string().max(20000),
  visibility: visibilitySchema.optional(),
  /** Edit this entry; omit to create a new one. */
  id: uuid.optional(),
});
export type SaveJournalEntryInput = z.infer<typeof saveJournalSchema>;

const upsertReviewSchema = z.object({
  tripId: uuid,
  tripPlaceId: uuid,
  rating: z.number().int().min(1).max(5).nullable().optional(),
  body: z.string().max(4000).optional(),
  visibility: visibilitySchema.optional(),
});
export type UpsertPlaceReviewInput = z.infer<typeof upsertReviewSchema>;

const updatePhotoSchema = z.object({
  id: uuid,
  tripId: uuid,
  caption: z.string().max(500).nullable().optional(),
  dayIndex: dayIndexSchema.nullable().optional(),
  takenAt: z.string().datetime({ offset: true }).nullable().optional(),
  /** Re-attach to a place (online only — see allowlist.ts trip_photos note). */
  tripPlaceId: uuid.nullable().optional(),
});
export type UpdatePhotoInput = z.infer<typeof updatePhotoSchema>;

// ===========================================================================
// Tier-2 fetch (all rows the caller may see for a trip)
// ===========================================================================

export interface TripMemoryRows {
  /** Session user at fetch time (null = signed out). */
  userId: string | null;
  journal: TripJournalEntry[];
  reviews: TripPlaceReview[];
  photos: TripPhoto[];
}

async function sessionUserId(): Promise<string | null> {
  const engineUser = isTier1SyncActive() ? getTier1SyncUserId() : null;
  if (engineUser) return engineUser;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

async function fetchTripMemoryRows(tripId: Uuid): Promise<TripMemoryRows> {
  const [userId, j, r, p] = await Promise.all([
    sessionUserId(),
    supabase.from('trip_journal_entries').select(JOURNAL_COLS).eq('trip_id', tripId).eq('deleted', false),
    supabase.from('trip_place_reviews').select(REVIEW_COLS).eq('trip_id', tripId).eq('deleted', false),
    supabase.from('trip_photos').select(PHOTO_COLS).eq('trip_id', tripId).eq('deleted', false),
  ]);
  for (const res of [j, r, p]) {
    if (res.error) throw new MemoryError(toMemoryErrorInfo(res.error));
  }
  return {
    userId,
    journal: (j.data ?? []) as unknown as TripJournalEntry[],
    reviews: (r.data ?? []) as unknown as TripPlaceReview[],
    photos: (p.data ?? []) as unknown as TripPhoto[],
  };
}

// ===========================================================================
// Tier-1 (own rows) — reactive selectors
// ===========================================================================

type MemoryStoreKey = 'tripJournalEntries' | 'tripPlaceReviews' | 'tripPhotos';

function rootServing(key: MemoryStoreKey): boolean {
  if (!isTier1SyncActive()) return false;
  const record = tier1Store$[key].peek();
  const hasRows = record != null && Object.keys(record).length > 0;
  return hasRows || tier1RootLoaded$[key].peek() === true;
}

export interface OwnMemoryRows {
  userId: string;
  /** null = that root is not serving yet (use the Tier-2 rows). */
  journal: TripJournalEntry[] | null;
  reviews: TripPlaceReview[] | null;
  photos: TripPhoto[] | null;
}

/** The session user's OWN rows of a trip from Tier-1 (null when the engine is inactive). */
function useOwnTier1Memories(tripId: Uuid | undefined): OwnMemoryRows | null {
  return use$((): OwnMemoryRows | null => {
    const journal = tier1Store$.tripJournalEntries.get();
    const reviews = tier1Store$.tripPlaceReviews.get();
    const photos = tier1Store$.tripPhotos.get();
    const loaded = tier1RootLoaded$.get();
    if (!tripId || !isTier1SyncActive()) return null;
    const userId = getTier1SyncUserId();
    if (!userId) return null;
    const pick = <T extends { trip_id: string; author_id: string }>(
      record: Record<string, T> | undefined,
      rootLoaded: boolean,
    ): T[] | null => {
      const hasRows = record != null && Object.keys(record).length > 0;
      if (!hasRows && !rootLoaded) return null;
      const out: T[] = [];
      for (const row of Object.values(record ?? {})) {
        if (row && row.trip_id === tripId && row.author_id === userId) out.push({ ...row });
      }
      return out;
    };
    return {
      userId,
      journal: pick(journal, loaded.tripJournalEntries === true),
      reviews: pick(reviews, loaded.tripPlaceReviews === true),
      photos: pick(photos, loaded.tripPhotos === true),
    };
  });
}

// ===========================================================================
// Upload queue subscription
// ===========================================================================

const EMPTY_SNAPSHOT: PhotoUploadQueueSnapshot = { userId: null, jobs: [], pendingDeletions: 0, durable: true };

function useQueueSnapshot(): PhotoUploadQueueSnapshot {
  const queue = useMemo(() => {
    try {
      return getPhotoUploadQueue();
    } catch {
      return null;
    }
  }, []);
  const subscribe = useCallback((cb: () => void) => (queue ? queue.subscribe(cb) : () => undefined), [queue]);
  const get = useCallback(() => (queue ? queue.getSnapshot() : EMPTY_SNAPSHOT), [queue]);
  return useSyncExternalStore(subscribe, get, get);
}

function invalidateTripMemories(qc: QueryClient, tripId: Uuid): void {
  void qc.invalidateQueries({ queryKey: memoryKeys.trip(tripId) });
  void qc.invalidateQueries({ queryKey: ['trip-memories', 'quota'] });
}

/** Refresh reads when an upload lands (Tier-1 pull + Tier-2 refetch). */
function useUploadSettledRefresh(): void {
  const qc = useQueryClient();
  useEffect(
    () =>
      onPhotoUploadSettled(
        ({ tripId }) => {
          resyncTier1();
          invalidateTripMemories(qc, tripId);
        },
        ({ tripId }) => invalidateTripMemories(qc, tripId),
      ),
    [qc],
  );
}

// ===========================================================================
// Pure merge (exported for tests)
// ===========================================================================

export interface BuildTripMemoriesInput {
  tripId: Uuid;
  userId: string | null;
  own: OwnMemoryRows | null;
  shared: TripMemoryRows | undefined;
  jobs: readonly PhotoUploadJobView[];
  /** trip_place_id → the place's day_index (reviews inherit it). */
  placeDay: ReadonlyMap<string, number | null>;
}

const KIND_ORDER: Record<MemoryKind, number> = { journal: 0, photo: 1, review: 2 };

function mergeRows<T extends { id: string; trip_id: string; author_id: string; deleted: boolean }>(
  tripId: Uuid,
  userId: string | null,
  ownRows: T[] | null,
  sharedRows: T[] | undefined,
): Array<{ row: T; isOwn: boolean }> {
  const out: Array<{ row: T; isOwn: boolean }> = [];
  if (ownRows) {
    for (const row of ownRows) if (row.trip_id === tripId && !row.deleted) out.push({ row, isOwn: true });
  }
  for (const row of sharedRows ?? []) {
    if (row.deleted || row.trip_id !== tripId) continue;
    const mine = userId !== null && row.author_id === userId;
    // Tier-1 serves own rows: the Tier-2 copy of them is ignored.
    if (mine && ownRows) continue;
    out.push({ row, isOwn: mine });
  }
  return out;
}

/**
 * Merge own Tier-1 rows, others' Tier-2 rows and this device's upload jobs
 * into the day-grouped memories view. Pure.
 *   - own photos still pending WITHOUT a local job (uploading from another
 *     device, or abandoned) are hidden until ready;
 *   - a queued photo with no row yet shows from its job (local preview);
 *   - days ascending, undated (null) last; items oldest first per day.
 */
export function buildTripMemoriesView(input: BuildTripMemoriesInput): TripMemoriesView {
  const { tripId, userId, own, shared, jobs, placeDay } = input;
  const items: MemoryItem[] = [];
  const tripJobs = jobs.filter((j) => j.tripId === tripId);
  const jobById = new Map(tripJobs.map((j) => [j.id, j]));
  const photoIds = new Set<string>();

  for (const { row, isOwn } of mergeRows(tripId, userId, own?.journal ?? null, shared?.journal)) {
    items.push({
      kind: 'journal',
      id: row.id,
      tripId,
      dayIndex: row.day_index,
      at: row.created_at ?? new Date(8.64e15).toISOString(),
      isOwn,
      visibility: row.visibility,
      entry: row,
    });
  }
  for (const { row, isOwn } of mergeRows(tripId, userId, own?.reviews ?? null, shared?.reviews)) {
    items.push({
      kind: 'review',
      id: row.id,
      tripId,
      dayIndex: row.trip_place_id ? (placeDay.get(row.trip_place_id) ?? null) : null,
      at: row.created_at ?? new Date(8.64e15).toISOString(),
      isOwn,
      visibility: row.visibility,
      review: row,
    });
  }
  for (const { row, isOwn } of mergeRows(tripId, userId, own?.photos ?? null, shared?.photos)) {
    const upload = jobById.get(row.id) ?? null;
    if (isOwn && row.status !== 'ready' && !upload) continue;
    photoIds.add(row.id);
    items.push({
      kind: 'photo',
      id: row.id,
      tripId,
      dayIndex: row.day_index,
      at: row.taken_at ?? row.created_at ?? new Date(upload?.createdAt ?? 8.64e15).toISOString(),
      isOwn,
      visibility: row.visibility,
      photo: row,
      upload,
    });
  }
  for (const job of tripJobs) {
    if (photoIds.has(job.id)) continue;
    items.push({
      kind: 'photo',
      id: job.id,
      tripId,
      dayIndex: job.dayIndex,
      at: job.takenAt ?? new Date(job.createdAt).toISOString(),
      isOwn: true,
      visibility: job.visibility,
      photo: null,
      upload: job,
    });
  }

  items.sort((a, b) => {
    const da = a.dayIndex ?? Number.POSITIVE_INFINITY;
    const db = b.dayIndex ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return a.id.localeCompare(b.id);
  });

  const days: MemoryDayGroup[] = [];
  for (const item of items) {
    const last = days[days.length - 1];
    if (last && last.dayIndex === item.dayIndex) last.items.push(item);
    else days.push({ dayIndex: item.dayIndex, items: [item] });
  }

  let latestPhoto: TripPhoto | null = null;
  const counts = { photos: 0, journal: 0, reviews: 0, uploading: 0, failed: 0 };
  for (const item of items) {
    if (item.kind === 'journal') counts.journal++;
    else if (item.kind === 'review') counts.reviews++;
    else {
      counts.photos++;
      if (item.upload?.state === 'failed') counts.failed++;
      else if (item.upload) counts.uploading++;
      const p = item.photo;
      if (p && p.status === 'ready' && (!latestPhoto || (p.created_at ?? '') > (latestPhoto.created_at ?? ''))) {
        latestPhoto = p;
      }
    }
  }
  return { days, items, counts, latestPhoto };
}

// ===========================================================================
// Reads
// ===========================================================================

export interface TripMemoriesResult {
  /** undefined only while nothing is known yet (no Tier-1 rows, Tier-2 loading). */
  data: TripMemoriesView | undefined;
  userId: string | null;
  isLoading: boolean;
  /** Other members' items failed to load (offline) — own items may still show. */
  error: Error | null;
  isRefetching: boolean;
  refetch: () => Promise<unknown>;
}

/**
 * THE memories read for a trip: own items (Tier-1, offline) + other members'
 * shared items (Tier-2, refetched) + this device's queued uploads, grouped by
 * day. Drives the Memories screen, the hub card (`counts`, `latestPhoto`) and
 * Today's quick actions.
 */
export function useTripMemories(tripId: Uuid | undefined): TripMemoriesResult {
  useUploadSettledRefresh();
  const own = useOwnTier1Memories(tripId);
  const snapshot = useQueueSnapshot();
  const places = useTripPlaces(tripId);
  const query = useQuery<TripMemoryRows>({
    queryKey: tripId ? memoryKeys.trip(tripId) : ['trip-memories', 'trip', 'none'],
    enabled: Boolean(tripId),
    queryFn: () => fetchTripMemoryRows(tripId as Uuid),
    staleTime: SHARED_STALE_MS,
  });

  const placeDay = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const p of (places.data ?? []) as TripPlace[]) m.set(p.id, p.day_index ?? null);
    return m;
  }, [places.data]);

  const userId = own?.userId ?? query.data?.userId ?? null;
  const ownServing = own !== null && own.journal !== null && own.reviews !== null && own.photos !== null;
  const data = useMemo(() => {
    if (!tripId) return undefined;
    if (!query.data && !ownServing) return undefined;
    return buildTripMemoriesView({
      tripId,
      userId,
      own,
      shared: query.data,
      jobs: snapshot.jobs,
      placeDay,
    });
  }, [tripId, userId, own, ownServing, query.data, snapshot.jobs, placeDay]);

  return {
    data,
    userId,
    isLoading: data === undefined && Boolean(tripId) && (query.isLoading || query.isFetching),
    error: (query.error as Error | null) ?? null,
    isRefetching: query.isRefetching,
    refetch: async () => {
      resyncTier1();
      return query.refetch();
    },
  };
}

export interface JournalEntryResult {
  /** The day's primary own entry (most recently written), or null. */
  data: TripJournalEntry | null;
  /** Every own live entry of the day, oldest first (two offline devices may both create one). */
  entries: TripJournalEntry[];
  isLoading: boolean;
}

function newestFirst<T extends { updated_at: string; created_at: string }>(a: T, b: T): number {
  // Unacked local rows (no timestamps) are the newest.
  const au = (a.updated_at as string | undefined) ?? '￿';
  const bu = (b.updated_at as string | undefined) ?? '￿';
  return au < bu ? 1 : au > bu ? -1 : 0;
}

/** The signed-in user's journal for one day of a trip (own entries only). */
export function useJournalEntry(tripId: Uuid | undefined, dayIndex: number | null | undefined): JournalEntryResult {
  const own = useOwnTier1Memories(tripId);
  const query = useQuery<TripMemoryRows>({
    queryKey: tripId ? memoryKeys.trip(tripId) : ['trip-memories', 'trip', 'none'],
    enabled: Boolean(tripId) && (own === null || own.journal === null),
    queryFn: () => fetchTripMemoryRows(tripId as Uuid),
    staleTime: SHARED_STALE_MS,
  });
  return useMemo(() => {
    if (!tripId || dayIndex === null || dayIndex === undefined) return { data: null, entries: [], isLoading: false };
    let rows: TripJournalEntry[] | null = null;
    if (own?.journal) rows = own.journal;
    else if (query.data) rows = query.data.journal.filter((r) => r.author_id === query.data?.userId);
    if (!rows) return { data: null, entries: [], isLoading: true };
    const entries = rows.filter((r) => !r.deleted && r.day_index === dayIndex);
    const byCreated = [...entries].sort((a, b) => ((a.created_at ?? '￿') < (b.created_at ?? '￿') ? -1 : 1));
    const primary = [...entries].sort(newestFirst)[0] ?? null;
    return { data: primary, entries: byCreated, isLoading: false };
  }, [tripId, dayIndex, own, query.data]);
}

export interface PlaceReviewsResult {
  /** The signed-in user's live review of the place, or null. */
  mine: TripPlaceReview | null;
  /** Other members' SHARED reviews (Tier-2). Never Google reviews. */
  others: TripPlaceReview[];
  isLoading: boolean;
}

/** "Your rating & review" + trip-mates' shared reviews for a trip place. */
export function usePlaceReviews(tripId: Uuid | undefined, tripPlaceId: Uuid | undefined): PlaceReviewsResult {
  const own = useOwnTier1Memories(tripId);
  const query = useQuery<TripMemoryRows>({
    queryKey: tripId ? memoryKeys.trip(tripId) : ['trip-memories', 'trip', 'none'],
    enabled: Boolean(tripId),
    queryFn: () => fetchTripMemoryRows(tripId as Uuid),
    staleTime: SHARED_STALE_MS,
  });
  return useMemo(() => {
    if (!tripId || !tripPlaceId) return { mine: null, others: [], isLoading: false };
    const userId = own?.userId ?? query.data?.userId ?? null;
    const ownRows = own?.reviews ?? query.data?.reviews.filter((r) => r.author_id === userId) ?? null;
    const mineList = (ownRows ?? []).filter((r) => !r.deleted && r.trip_place_id === tripPlaceId).sort(newestFirst);
    const others = (query.data?.reviews ?? []).filter(
      (r) => !r.deleted && r.trip_place_id === tripPlaceId && r.author_id !== userId,
    );
    return { mine: mineList[0] ?? null, others, isLoading: ownRows === null && query.isLoading };
  }, [tripId, tripPlaceId, own, query.data, query.isLoading]);
}

/** Photo quota for the Profile screen / pre-upload hints (rpc get_memory_quota). */
export function useMemoryQuota(tripId?: Uuid | null) {
  return useQuery<MemoryQuota>({
    queryKey: memoryKeys.quota(tripId ?? null),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_memory_quota', { p_trip_id: tripId ?? null });
      if (error) throw new MemoryError(toMemoryErrorInfo(error));
      return data as MemoryQuota;
    },
    staleTime: 30_000,
  });
}

// ---- signed URLs (memory-only, batched) ------------------------------------

let pendingSigned = new Map<string, Array<{ resolve: (u: string) => void; reject: (e: unknown) => void }>>();
let signedFlushScheduled = false;

async function flushSignedUrls(): Promise<void> {
  signedFlushScheduled = false;
  const batch = pendingSigned;
  pendingSigned = new Map();
  const paths = [...batch.keys()];
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    try {
      const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(chunk, MEMORY_SIGNED_URL_TTL_S);
      if (error) throw error;
      const byPath = new Map<string, string>();
      for (const d of data ?? []) {
        if (d.path && d.signedUrl && !d.error) byPath.set(d.path, d.signedUrl);
      }
      for (const p of chunk) {
        const url = byPath.get(p);
        for (const w of batch.get(p) ?? []) {
          if (url) w.resolve(url);
          else w.reject(new MemoryError({ code: 'not_found', message: `no signed URL for ${p}` }));
        }
      }
    } catch (e) {
      for (const p of chunk) for (const w of batch.get(p) ?? []) w.reject(new MemoryError(toMemoryErrorInfo(e)));
    }
  }
}

function requestSignedUrl(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const waiters = pendingSigned.get(path) ?? [];
    waiters.push({ resolve, reject });
    pendingSigned.set(path, waiters);
    if (!signedFlushScheduled) {
      signedFlushScheduled = true;
      setTimeout(() => void flushSignedUrls(), 0);
    }
  });
}

/**
 * Signed URLs (1 h) for memory photo paths — pass `photo.thumb_path` for
 * grids, `photo.storage_path` for the lightbox. Batched into one
 * createSignedUrls call per tick; cached in MEMORY only (50 min), never
 * persisted. Returns `{ [path]: url }` for the paths resolved so far.
 */
export function useMemoryPhotoUrls(paths: ReadonlyArray<string | null | undefined>): {
  urls: Record<string, string>;
  isLoading: boolean;
} {
  const unique = useMemo(
    () => [...new Set(paths.filter((p): p is string => typeof p === 'string' && p.length > 0))],
    [paths],
  );
  const results = useQueries({
    queries: unique.map((path) => ({
      queryKey: memoryKeys.signedUrl(path),
      queryFn: () => requestSignedUrl(path),
      staleTime: SIGNED_URL_STALE_MS,
      gcTime: SIGNED_URL_GC_MS,
      retry: 1,
    })),
  });
  const urls: Record<string, string> = {};
  let isLoading = false;
  results.forEach((r, i) => {
    const path = unique[i] as string;
    if (r.data) urls[path] = r.data;
    else if (r.isLoading) isLoading = true;
  });
  return { urls, isLoading };
}

/** Single-path convenience over useMemoryPhotoUrls. */
export function useMemoryPhotoUrl(path: string | null | undefined): { url: string | null; isLoading: boolean } {
  const paths = useMemo(() => [path], [path]);
  const { urls, isLoading } = useMemoryPhotoUrls(paths);
  return { url: path ? (urls[path] ?? null) : null, isLoading };
}

// ===========================================================================
// Photos: add + queue state
// ===========================================================================

export interface AddPhotosInput {
  tripId: Uuid;
  /** expo-image-picker `result.assets` (pass `exif: true` for the capture date) or web files. */
  assets: readonly PickedPhoto[];
  /**
   * Day to file the photos under. `undefined` = derive from each photo's
   * capture date and the trip's start date (null when outside the trip);
   * `null` = undated.
   */
  dayIndex?: number | null;
  tripPlaceId?: Uuid | null;
  caption?: string | null;
  /** Defaults to 'only_me' (PRIVATE BY DEFAULT). */
  visibility?: MemoryVisibility;
}

export interface AddPhotosResult {
  /** Queued photo ids (= future trip_photos ids), in input order of the successes. */
  ids: Uuid[];
  /** Assets that could not be prepared (unsupported format, …). */
  failed: Array<{ index: number; error: MemoryErrorInfo }>;
}

const DAY_MS = 86_400_000;

/**
 * 0-based trip day of a capture time, from the trip's start_date
 * ('YYYY-MM-DD', the traveller's calendar). The capture instant is read in
 * the DEVICE's local calendar (photos are normally added on the trip).
 * Outside [start, end] → null. Exported for tests.
 */
export function dayIndexForCapture(
  takenAt: string | null,
  trip: Pick<Trip, 'start_date' | 'end_date'> | null | undefined,
): number | null {
  if (!takenAt || !trip?.start_date) return null;
  const t = new Date(takenAt);
  if (Number.isNaN(t.getTime())) return null;
  const [y, m, d] = trip.start_date.split('-').map(Number) as [number, number, number];
  const startLocal = Date.UTC(y, m - 1, d);
  const capLocal = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  const idx = Math.round((capLocal - startLocal) / DAY_MS);
  if (idx < 0 || idx > 999) return null;
  if (trip.end_date) {
    const [ey, em, ed] = trip.end_date.split('-').map(Number) as [number, number, number];
    const last = Math.round((Date.UTC(ey, em - 1, ed) - startLocal) / DAY_MS);
    if (idx > last) return null;
  }
  return idx;
}

function knownTrip(qc: QueryClient, tripId: Uuid): Pick<Trip, 'start_date' | 'end_date'> | null {
  const fromStore = isTier1SyncActive() ? tier1Store$.trips[tripId]?.peek() : undefined;
  if (fromStore) return fromStore;
  return qc.getQueryData<Trip | null>(tripsKeys.detail(tripId)) ?? null;
}

/**
 * Pre-flight quota check (best-effort: skipped offline). Refuses early with
 * the server's vocabulary so the UI can explain before any work is done.
 */
async function precheckQuota(tripId: Uuid, count: number): Promise<void> {
  let q: MemoryQuota | null = null;
  try {
    const { data, error } = await supabase.rpc('get_memory_quota', { p_trip_id: tripId });
    if (error) return;
    q = data as MemoryQuota;
  } catch {
    return;
  }
  if (!q) return;
  if (q.storage_full) throw new MemoryError({ code: 'storage_full', scope: 'global' });
  if (q.user_used + count > q.user_cap) {
    throw new MemoryError({ code: 'quota_exceeded', scope: 'user', limit: q.user_cap, used: q.user_used });
  }
  if (q.trip_cap !== null && q.trip_used !== null && q.trip_used + count > q.trip_cap) {
    throw new MemoryError({ code: 'quota_exceeded', scope: 'trip', limit: q.trip_cap, used: q.trip_used });
  }
  if (q.user_bytes >= q.user_bytes_cap) {
    throw new MemoryError({ code: 'quota_exceeded', scope: 'user_bytes', limit: q.user_bytes_cap, used: q.user_bytes });
  }
}

/**
 * Add photos to a trip: each asset is re-encoded on device (EXIF/GPS
 * stripped, ≤ ~350 KB + thumbnail, verified) and put on the durable upload
 * queue. Works OFFLINE (the queue uploads when back online and survives
 * restarts). Progress / failures: usePhotoUploads(tripId).
 */
export function useAddPhotos() {
  const qc = useQueryClient();
  return useMutation<AddPhotosResult, Error, AddPhotosInput>({
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async (input) => {
      uuid.parse(input.tripId);
      if (input.tripPlaceId) uuid.parse(input.tripPlaceId);
      if (input.dayIndex !== undefined && input.dayIndex !== null) dayIndexSchema.parse(input.dayIndex);
      if (input.caption) z.string().max(500).parse(input.caption);
      const visibility = input.visibility ?? 'only_me';
      visibilitySchema.parse(visibility);
      if (input.assets.length === 0) return { ids: [], failed: [] };

      const queue = getPhotoUploadQueue();
      if (!queue.getSnapshot().userId) {
        const userId = await sessionUserId();
        if (!userId) throw new MemoryError({ code: 'not_authenticated' });
        await queue.start(userId);
      }
      await precheckQuota(input.tripId, input.assets.length);

      const trip = knownTrip(qc, input.tripId);
      const ids: Uuid[] = [];
      const failed: AddPhotosResult['failed'] = [];
      // Sequential: bounds memory (one decoded bitmap at a time).
      for (let index = 0; index < input.assets.length; index++) {
        const asset = input.assets[index] as PickedPhoto;
        try {
          const prepared = await preparePhoto(asset);
          const dayIndex =
            input.dayIndex !== undefined ? input.dayIndex : dayIndexForCapture(prepared.takenAt, trip);
          const id = await queue.enqueue({
            id: mintId(),
            tripId: input.tripId,
            dayIndex,
            tripPlaceId: input.tripPlaceId ?? null,
            caption: input.caption ?? null,
            visibility,
            prepared,
          });
          ids.push(id);
        } catch (e) {
          failed.push({ index, error: toMemoryErrorInfo(e) });
        }
      }
      if (ids.length === 0 && failed.length > 0) throw new MemoryError(failed[0]!.error);
      return { ids, failed };
    },
    onSuccess: (_r, { tripId }) => {
      void qc.invalidateQueries({ queryKey: ['trip-memories', 'quota'] });
      void qc.invalidateQueries({ queryKey: memoryKeys.trip(tripId) });
    },
  });
}

export interface PhotoUploadsResult {
  /** This device's queued/uploading/failed photos (of `tripId`, or all trips). */
  jobs: readonly PhotoUploadJobView[];
  /** Put a failed upload back in line. */
  retry: (photoId: Uuid) => void;
  /** Drop a queued/failed upload (removes its pending row + files). */
  cancel: (photoId: Uuid) => Promise<void>;
  /** false = the queue could not store bytes durably (lost on restart). */
  durable: boolean;
}

/** Upload queue state for progress / "waiting for connection" / failure UI. */
export function usePhotoUploads(tripId?: Uuid): PhotoUploadsResult {
  useUploadSettledRefresh();
  const snapshot = useQueueSnapshot();
  const jobs = useMemo(
    () => (tripId ? snapshot.jobs.filter((j) => j.tripId === tripId) : snapshot.jobs),
    [snapshot.jobs, tripId],
  );
  return {
    jobs,
    retry: (id) => getPhotoUploadQueue().retry(id),
    cancel: (id) => getPhotoUploadQueue().cancel(id),
    durable: snapshot.durable,
  };
}

/** Edit an own photo's caption / day / capture time (offline via Tier-1) or place (online). */
export function useUpdatePhoto() {
  const qc = useQueryClient();
  return useMutation<void, Error, UpdatePhotoInput>({
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async (input) => {
      const p = updatePhotoSchema.parse(input);
      const patch: Record<string, unknown> = {};
      if (p.caption !== undefined) patch['caption'] = p.caption;
      if (p.dayIndex !== undefined) patch['day_index'] = p.dayIndex;
      if (p.takenAt !== undefined) patch['taken_at'] = p.takenAt;
      const tier1 = hasOwnMemoryRow({ kind: 'photo', id: p.id });
      if (!tier1 && p.tripPlaceId === undefined && p.takenAt === undefined) {
        const queuedPatch: { caption?: string | null; dayIndex?: number | null } = {};
        if (p.caption !== undefined) queuedPatch.caption = p.caption;
        if (p.dayIndex !== undefined) queuedPatch.dayIndex = p.dayIndex;
        // Still waiting in this device's queue (no row yet): edit the job.
        if (getPhotoUploadQueue().updateQueuedJob(p.id, queuedPatch)) return;
      }
      if (tier1 && Object.keys(patch).length > 0) {
        syncUpdatePhoto(p.id, patch);
      }
      const online: Record<string, unknown> = tier1 ? {} : { ...patch };
      if (p.tripPlaceId !== undefined) online['trip_place_id'] = p.tripPlaceId;
      if (Object.keys(online).length > 0) {
        const { error } = await supabase.from('trip_photos').update(online).eq('id', p.id);
        if (error) throw new MemoryError(toMemoryErrorInfo(error));
      }
    },
    onSuccess: (_r, { tripId }) => invalidateTripMemories(qc, tripId),
  });
}

// ===========================================================================
// Journal
// ===========================================================================

/**
 * Create (no `id`) or edit (`id`) an own journal entry. Offline-safe through
 * Tier-1; online PostgREST otherwise. Returns the entry id.
 */
export function useSaveJournalEntry() {
  const qc = useQueryClient();
  return useMutation<Uuid, Error, SaveJournalEntryInput>({
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async (input) => {
      const p = saveJournalSchema.parse(input);
      if (p.id) {
        if (hasOwnMemoryRow({ kind: 'journal', id: p.id })) {
          const patch: Parameters<typeof syncUpdateJournalEntry>[1] = { body: p.body, day_index: p.dayIndex };
          if (p.visibility) patch.visibility = p.visibility;
          syncUpdateJournalEntry(p.id, patch);
          return p.id;
        }
        const payload: Record<string, unknown> = { body: p.body, day_index: p.dayIndex };
        if (p.visibility) payload['visibility'] = p.visibility;
        const { error } = await supabase.from('trip_journal_entries').update(payload).eq('id', p.id);
        if (error) throw new MemoryError(toMemoryErrorInfo(error));
        return p.id;
      }
      if (rootServing('tripJournalEntries')) {
        return syncCreateJournalEntry({
          trip_id: p.tripId,
          day_index: p.dayIndex,
          body: p.body,
          visibility: p.visibility ?? 'only_me',
        });
      }
      const id = mintId();
      const { error } = await supabase.from('trip_journal_entries').insert({
        id,
        trip_id: p.tripId,
        day_index: p.dayIndex,
        body: p.body,
        visibility: p.visibility ?? 'only_me',
      });
      if (error) throw new MemoryError(toMemoryErrorInfo(error));
      return id;
    },
    onSuccess: (_id, { tripId }) => invalidateTripMemories(qc, tripId),
  });
}

// ===========================================================================
// Reviews
// ===========================================================================

/**
 * Set the user's own rating/review of a place: updates the existing live
 * review, or creates one (one live review per place and author). Offline-safe
 * through Tier-1. Returns the review id.
 */
export function useUpsertPlaceReview() {
  const qc = useQueryClient();
  return useMutation<Uuid, Error, UpsertPlaceReviewInput>({
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async (input) => {
      const p = upsertReviewSchema.parse(input);
      const patch: { rating?: number | null; body?: string; visibility?: MemoryVisibility } = {};
      if (p.rating !== undefined) patch.rating = p.rating;
      if (p.body !== undefined) patch.body = p.body;
      if (p.visibility !== undefined) patch.visibility = p.visibility;

      if (rootServing('tripPlaceReviews')) {
        const existing = findOwnLiveReview(p.tripPlaceId);
        if (existing) {
          syncUpdatePlaceReview(existing.id, patch);
          return existing.id;
        }
        return syncCreatePlaceReview({
          trip_id: p.tripId,
          trip_place_id: p.tripPlaceId,
          rating: patch.rating ?? null,
          body: patch.body ?? '',
          visibility: patch.visibility ?? 'only_me',
        });
      }
      const userId = await sessionUserId();
      if (!userId) throw new MemoryError({ code: 'not_authenticated' });
      const { data: rows, error: selErr } = await supabase
        .from('trip_place_reviews')
        .select('id')
        .eq('trip_place_id', p.tripPlaceId)
        .eq('author_id', userId)
        .eq('deleted', false)
        .limit(1);
      if (selErr) throw new MemoryError(toMemoryErrorInfo(selErr));
      const existingId = (rows as Array<{ id: string }> | null)?.[0]?.id;
      if (existingId) {
        const { error } = await supabase.from('trip_place_reviews').update(patch).eq('id', existingId);
        if (error) throw new MemoryError(toMemoryErrorInfo(error));
        return existingId;
      }
      const id = mintId();
      const { error } = await supabase.from('trip_place_reviews').insert({
        id,
        trip_id: p.tripId,
        trip_place_id: p.tripPlaceId,
        rating: patch.rating ?? null,
        body: patch.body ?? '',
        visibility: patch.visibility ?? 'only_me',
      });
      if (error) throw new MemoryError(toMemoryErrorInfo(error));
      return id;
    },
    onSuccess: (_id, { tripId }) => invalidateTripMemories(qc, tripId),
  });
}

// ===========================================================================
// Visibility + delete (all kinds)
// ===========================================================================

const TABLE_FOR_KIND: Record<MemoryKind, 'trip_journal_entries' | 'trip_place_reviews' | 'trip_photos'> = {
  journal: 'trip_journal_entries',
  review: 'trip_place_reviews',
  photo: 'trip_photos',
};

export interface SetMemoryVisibilityInput {
  tripId: Uuid;
  /** One item, or many for "share this day / whole trip". Own items only. */
  items: readonly MemoryRef[];
  visibility: MemoryVisibility;
}

/**
 * Share with the trip / make private — own items only (others' items are
 * skipped by RLS). Offline-safe via Tier-1; one undo entry for the batch.
 */
export function useSetMemoryVisibility() {
  const qc = useQueryClient();
  return useMutation<void, Error, SetMemoryVisibilityInput>({
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async ({ items, visibility }) => {
      visibilitySchema.parse(visibility);
      let remaining: readonly MemoryRef[] = items;
      if (isTier1SyncActive()) {
        const { undo, applied, skipped } = syncSetMemoryVisibility(items, visibility);
        if (applied.length > 0) getSessionUndoStack().push(undo);
        remaining = skipped;
      }
      // Photos still waiting in this device's queue (no row yet): change the
      // visibility they will be inserted with.
      remaining = remaining.filter(
        (r) => !(r.kind === 'photo' && getPhotoUploadQueue().updateQueuedJob(r.id, { visibility })),
      );
      for (const kind of ['journal', 'review', 'photo'] as const) {
        const ids = remaining.filter((r) => r.kind === kind).map((r) => r.id);
        if (ids.length === 0) continue;
        const { error } = await supabase.from(TABLE_FOR_KIND[kind]).update({ visibility }).in('id', ids);
        if (error) throw new MemoryError(toMemoryErrorInfo(error));
      }
    },
    onSuccess: (_r, { tripId }) => invalidateTripMemories(qc, tripId),
  });
}

export interface DeleteMemoryInput extends MemoryRef {
  tripId: Uuid;
}

function scheduleFilesFor(photo: Pick<TripPhoto, 'id' | 'storage_path' | 'thumb_path'>, graceMs: number): void {
  try {
    getPhotoUploadQueue().scheduleObjectDeletion(photo, graceMs);
  } catch {
    // queue unavailable: the orphan sweep never covers tombstones, so this
    // photo's files stay until account/trip deletion (logged by telemetry)
  }
}

/**
 * Delete an OWN memory (tombstone; offline-safe via Tier-1, with an undo
 * entry on the session stack). Photos: an unfinished upload is cancelled; a
 * finished photo's two files are removed after a short undo window
 * (OBJECT_DELETE_GRACE_MS), which frees the storage quota (0038).
 * Trip OWNERS removing someone else's shared item use useRemoveTripMemory.
 */
export function useDeleteMemory() {
  const qc = useQueryClient();
  return useMutation<void, Error, DeleteMemoryInput>({
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async ({ kind, id }) => {
      if (kind === 'photo') {
        const queue = getPhotoUploadQueue();
        const storeRow = isTier1SyncActive() ? tier1Store$.tripPhotos[id]?.peek() : undefined;
        if (queue.hasJob(id) && (!storeRow || storeRow.status !== 'ready')) {
          await queue.cancel(id);
          return;
        }
        if (storeRow && hasOwnMemoryRow({ kind, id })) {
          const undo = syncTombstonePhoto(id, 'Remove photo', {
            // Restorable only while the files are still there: cancelling
            // the pending deletion IS the check (false once removed).
            canRestore: () => queue.cancelObjectDeletion(id),
          });
          scheduleFilesFor(storeRow, OBJECT_DELETE_GRACE_MS);
          getSessionUndoStack().push(undo);
          return;
        }
        const { data, error } = await supabase
          .from('trip_photos')
          .update({ deleted: true })
          .eq('id', id)
          .select('id, storage_path, thumb_path')
          .maybeSingle();
        if (error) throw new MemoryError(toMemoryErrorInfo(error));
        if (!data) throw new MemoryError({ code: 'not_found' });
        scheduleFilesFor(data as Pick<TripPhoto, 'id' | 'storage_path' | 'thumb_path'>, OBJECT_DELETE_GRACE_MS);
        return;
      }
      if (hasOwnMemoryRow({ kind, id })) {
        const undo = kind === 'journal' ? syncTombstoneJournalEntry(id) : syncTombstonePlaceReview(id);
        getSessionUndoStack().push(undo);
        return;
      }
      const { data, error } = await supabase
        .from(TABLE_FOR_KIND[kind])
        .update({ deleted: true })
        .eq('id', id)
        .select('id')
        .maybeSingle();
      if (error) throw new MemoryError(toMemoryErrorInfo(error));
      if (!data) throw new MemoryError({ code: 'not_found' });
    },
    onSuccess: (_r, { tripId }) => invalidateTripMemories(qc, tripId),
  });
}

export interface RemoveTripMemoryInput extends MemoryRef {
  tripId: Uuid;
  /** Photos: the row's paths (from the item) — the files are deleted FIRST. */
  storagePath?: string | null;
  thumbPath?: string | null;
}

/**
 * Trip OWNER moderation of someone else's SHARED memory (0036 §3e):
 * photos → delete both files first (the owner can only while the row is
 * still visible), then rpc('remove_trip_memory'). Online only.
 */
export function useRemoveTripMemory() {
  const qc = useQueryClient();
  return useMutation<boolean, Error, RemoveTripMemoryInput>({
    mutationFn: async ({ kind, id, storagePath, thumbPath }) => {
      if (kind === 'photo') {
        const paths = [storagePath, thumbPath].filter((p): p is string => typeof p === 'string' && p.length > 0);
        if (paths.length > 0) {
          const { error } = await supabase.storage.from(PHOTO_BUCKET).remove(paths);
          if (error) throw new MemoryError(toMemoryErrorInfo(error));
        }
      }
      const { data, error } = await supabase.rpc('remove_trip_memory', { p_kind: kind, p_id: id });
      if (error) throw new MemoryError(toMemoryErrorInfo(error));
      return data === true;
    },
    onSuccess: (_r, { tripId }) => invalidateTripMemories(qc, tripId),
  });
}
