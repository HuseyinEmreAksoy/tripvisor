/**
 * memories.upload-queue.ts — the DURABLE photo upload queue (M5 Y2.1).
 *
 * Contract (0036 "PHOTO UPLOAD CONTRACT" + 0038 §2):
 *   1. INSERT the trip_photos row (client-minted id; the server forces
 *      status='pending' and stamps storage_path / thumb_path).
 *   2. Upload BOTH files to EXACTLY the returned paths, bucket
 *      `trip-memories`, upsert:false. A 409 "already exists" on a retry means
 *      the object is there → done.
 *   3. UPDATE status='ready' (the guard verifies both objects; a missing one
 *      raises `upload_incomplete` → re-upload).
 *   A row still pending after 24 h is purged server-side; a job that wakes up
 *   later re-INSERTs the same id and uploads again.
 *
 * Durability: the manifest (jobs + pending file deletions) lives in
 * AsyncStorage under `tripvisor/photo-queue/v1/<userId>`; the bytes (ONLY the
 * re-encoded, metadata-stripped JPEGs from src/lib/photos/pipeline.ts — never
 * an original) live in the platform blob store (files on native, IndexedDB on
 * web). Each job persists a checkpoint after every step, so a restart
 * resumes where it stopped. Jobs are per user; sign-out pauses the queue and
 * the next sign-in of the same user resumes it.
 *
 * Bounded concurrency (0038 pending cap): at most MAX_CONCURRENT_UPLOADS jobs
 * run at once, rows are only inserted while this device holds fewer than
 * `user_pending_cap` pending rows, and jobs that already hold a pending row
 * are finished first. `quota_exceeded {scope:'pending'}` (other devices /
 * stale pending rows) is NOT a failure: the job waits for a slot.
 * Permanent errors (quota user / user_bytes / trip, storage_full, forbidden,
 * trip gone) park the job as `failed` until the user retries or cancels.
 *
 * File deletion (0038: a tombstoned photo keeps its quota until its FILES are
 * gone): `scheduleObjectDeletion` queues the removal of a photo's two objects
 * after a grace period (so an undo can still restore it), durably and with
 * retries. Deleting a missing object is not an error (idempotent).
 *
 * Framework-free: React hooks (src/api/memories.ts) subscribe through
 * `subscribe` / `getSnapshot` (useSyncExternalStore). Dependencies are
 * injected so jest and `npm run sync:validate` drive the real class.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PhotoBlobStore } from '../lib/photos/blobStore.types';
import { createMemoryBlobStore } from '../lib/photos/blobStore.types';
import { toArrayBuffer } from '../lib/photos/base64';
import type { PreparedPhoto } from '../lib/photos/pipeline';
import { isStorageAlreadyExists, toMemoryErrorInfo } from './memories.errors';
import type {
  MemoryErrorInfo,
  MemoryQuota,
  MemoryVisibility,
  PhotoUploadJobView,
} from './memories.types';

export const PHOTO_BUCKET = 'trip-memories';
export const MAX_CONCURRENT_UPLOADS = 2;
/** 0038 default memories_user_pending_cap. */
export const DEFAULT_PENDING_CAP = 20;
/** How long a tombstoned photo keeps its files (undo window) before they are removed. */
export const OBJECT_DELETE_GRACE_MS = 2 * 60_000;
/** Give up (job `failed`, code unknown/forbidden) after this many non-network failures. */
export const MAX_HARD_ATTEMPTS = 6;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 5 * 60_000;
const SLOT_WAIT_MS = 20_000;
const MANIFEST_PREFIX = 'tripvisor/photo-queue/v1/';

/** Minimal key-value surface (AsyncStorage). */
export interface QueueKv {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
}

/** The supabase-js surface the queue uses. */
export type QueueClient = Pick<SupabaseClient, 'from' | 'storage' | 'rpc'>;

type Stage = 'queued' | 'row_created' | 'full_uploaded' | 'uploaded';

interface StoredJob {
  id: string;
  userId: string;
  tripId: string;
  dayIndex: number | null;
  tripPlaceId: string | null;
  caption: string | null;
  visibility: MemoryVisibility;
  takenAt: string | null;
  width: number;
  height: number;
  fullBytes: number;
  thumbBytes: number;
  createdAt: number;
  stage: Stage;
  storagePath: string | null;
  thumbPath: string | null;
  attempts: number;
  nextAttemptAt: number;
  waitingFor: 'pending_slot' | 'network' | null;
  error: MemoryErrorInfo | null;
}

interface StoredDeletion {
  photoId: string;
  paths: string[];
  notBefore: number;
  attempts: number;
}

interface Manifest {
  v: 1;
  jobs: StoredJob[];
  deletions: StoredDeletion[];
}

export interface EnqueuePhotoInput {
  /** Client-minted trip_photos id (uuid). */
  id: string;
  tripId: string;
  dayIndex?: number | null;
  tripPlaceId?: string | null;
  caption?: string | null;
  /** Defaults to 'only_me' (PRIVATE BY DEFAULT). */
  visibility?: MemoryVisibility;
  prepared: PreparedPhoto;
}

export interface PhotoUploadQueueSnapshot {
  userId: string | null;
  jobs: readonly PhotoUploadJobView[];
  /** Tombstoned photos whose files are still waiting to be removed. */
  pendingDeletions: number;
  /** false = the bytes only live in memory (lost on restart). */
  durable: boolean;
}

export interface PhotoUploadQueueDeps {
  client: QueueClient;
  kv: QueueKv;
  blobs: PhotoBlobStore;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Subscribe to "connectivity came back"; returns an unsubscribe. */
  onReconnect?: (cb: () => void) => () => void;
  /** A photo reached status 'ready' (the hooks resync Tier-1 + invalidate Tier-2). */
  onPhotoReady?: (photo: { id: string; tripId: string }) => void;
  /** A job was dropped because its row was removed elsewhere, or cancelled. */
  onJobRemoved?: (photo: { id: string; tripId: string }) => void;
  maxConcurrent?: number;
  random?: () => number;
}

/** What a failed step tells the scheduler to do. */
type StepOutcome =
  | { kind: 'retry'; info: MemoryErrorInfo; network: boolean }
  | { kind: 'wait_slot'; info: MemoryErrorInfo }
  | { kind: 'fail'; info: MemoryErrorInfo }
  | { kind: 'restart' }
  | { kind: 'done' }
  | { kind: 'cancelled' };

class StepSignal extends Error {
  constructor(readonly outcome: StepOutcome) {
    super(`[photo-queue] ${outcome.kind}`);
  }
}

const PROGRESS: Record<Stage, number> = { queued: 0, row_created: 0.15, full_uploaded: 0.7, uploaded: 0.85 };
const STAGE_ORDER: Record<Stage, number> = { queued: 0, row_created: 1, full_uploaded: 2, uploaded: 3 };

const PERMANENT_CODES: ReadonlySet<string> = new Set([
  'storage_full',
  'forbidden',
  'trip_not_found',
  'not_author',
  'author_mismatch',
  'immutable_column',
  'not_found',
  'image_too_large',
  'invalid_value',
]);

function blobKey(userId: string, photoId: string, which: 'full' | 'thumb'): string {
  return which === 'full' ? `${userId}/${photoId}` : `${userId}/${photoId}_t`;
}

/** Classify a server/storage error into the scheduler's next move. */
export function outcomeFor(info: MemoryErrorInfo): StepOutcome {
  if (info.code === 'quota_exceeded') {
    return info.scope === 'pending' ? { kind: 'wait_slot', info } : { kind: 'fail', info };
  }
  if (PERMANENT_CODES.has(info.code)) return { kind: 'fail', info };
  return { kind: 'retry', info, network: info.code === 'network' };
}

export class PhotoUploadQueue {
  private readonly deps: Required<Omit<PhotoUploadQueueDeps, 'onReconnect' | 'onPhotoReady' | 'onJobRemoved'>> &
    Pick<PhotoUploadQueueDeps, 'onReconnect' | 'onPhotoReady' | 'onJobRemoved'>;
  private userId: string | null = null;
  /** Bumped on start/stop: continuations of an older generation go quiet. */
  private generation = 0;
  private jobs: StoredJob[] = [];
  private deletions: StoredDeletion[] = [];
  private readonly inFlight = new Set<string>();
  private readonly deletingNow = new Set<string>();
  /** In-flight jobs the user cancelled; their step stops at the next checkpoint. */
  private readonly userCancelled = new Set<string>();
  /** Photos whose objects this session already removed (undo guard). */
  private readonly deletedObjects = new Set<string>();
  private readonly previews = new Map<string, string>();
  /** Bytes kept in memory when the blob store refused them (degraded durability). */
  private readonly memoryBlobs = createMemoryBlobStore();
  private pendingCap = DEFAULT_PENDING_CAP;
  private timer: unknown = null;
  private timerAt = Infinity;
  private saveChain: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private snapshot: PhotoUploadQueueSnapshot;
  private unsubscribeReconnect: (() => void) | null = null;
  private idleWaiters: Array<() => void> = [];

  constructor(deps: PhotoUploadQueueDeps) {
    this.deps = {
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      maxConcurrent: MAX_CONCURRENT_UPLOADS,
      random: Math.random,
      ...deps,
    };
    this.snapshot = { userId: null, jobs: [], pendingDeletions: 0, durable: deps.blobs.durable };
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  /** Load (or resume) the queue of `userId` and start processing. Idempotent. */
  async start(userId: string): Promise<void> {
    if (this.userId === userId) {
      this.pump();
      return;
    }
    if (this.userId !== null) this.stop();
    const gen = ++this.generation;
    this.userId = userId;
    let manifest: Manifest = { v: 1, jobs: [], deletions: [] };
    try {
      const raw = await this.deps.kv.getItem(MANIFEST_PREFIX + userId);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Manifest>;
        if (parsed && parsed.v === 1) {
          manifest = {
            v: 1,
            jobs: Array.isArray(parsed.jobs) ? parsed.jobs.filter((j) => j && j.userId === userId) : [],
            deletions: Array.isArray(parsed.deletions) ? parsed.deletions : [],
          };
        }
      }
    } catch {
      // unreadable manifest → start empty (the server purges stale pending rows)
    }
    if (gen !== this.generation) return;
    const now = this.deps.now();
    // Every restart retries once immediately (connectivity may be back).
    this.jobs = manifest.jobs.map((j) => ({ ...j, nextAttemptAt: j.error ? j.nextAttemptAt : now, waitingFor: null }));
    this.deletions = manifest.deletions;
    this.unsubscribeReconnect = this.deps.onReconnect?.(() => this.wake()) ?? null;
    this.emit();
    void this.cleanupOrphanBlobs(userId, gen);
    void this.refreshPendingCap(gen);
    for (const job of this.jobs) void this.resolvePreview(job, gen);
    this.pump();
  }

  /** Sign-out: pause (the manifest stays on disk for the next sign-in). */
  stop(): void {
    this.generation++;
    this.userId = null;
    this.jobs = [];
    this.deletions = [];
    this.inFlight.clear();
    this.deletingNow.clear();
    this.previews.clear();
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    this.timerAt = Infinity;
    this.unsubscribeReconnect?.();
    this.unsubscribeReconnect = null;
    this.emit();
    this.resolveIdle();
  }

  /**
   * ACCOUNT DELETION only: forget `userId`'s queue on this device — the
   * manifest and every queued image. Nothing is uploaded or deleted
   * server-side (delete-account removes the rows and the bucket folders).
   * Best-effort, never throws.
   */
  async wipe(userId: string): Promise<void> {
    if (this.userId === userId) this.stop();
    try {
      if (this.deps.kv.removeItem) await this.deps.kv.removeItem(MANIFEST_PREFIX + userId);
      else await this.deps.kv.setItem(MANIFEST_PREFIX + userId, JSON.stringify({ v: 1, jobs: [], deletions: [] }));
    } catch {
      // best-effort
    }
    try {
      for (const k of await this.deps.blobs.keys()) {
        if (k.startsWith(`${userId}/`)) await this.deps.blobs.remove(k);
      }
    } catch {
      // best-effort
    }
  }

  /** Retry everything that is waiting for the network now (reconnect / app foreground). */
  wake(): void {
    const now = this.deps.now();
    for (const j of this.jobs) {
      if (!j.error && j.nextAttemptAt > now) j.nextAttemptAt = now;
    }
    for (const d of this.deletions) {
      if (d.attempts > 0) d.notBefore = Math.min(d.notBefore, now);
    }
    this.pump();
  }

  // ── public API ──────────────────────────────────────────────────────────

  /** Queue a prepared (re-encoded, EXIF-free) photo. Resolves once it is durable. */
  async enqueue(input: EnqueuePhotoInput): Promise<string> {
    const userId = this.userId;
    if (!userId) throw new Error('[photo-queue] not started (no signed-in user)');
    const gen = this.generation;
    const { prepared } = input;
    for (const [which, bytes] of [
      ['full', prepared.full.bytes],
      ['thumb', prepared.thumb.bytes],
    ] as const) {
      const key = blobKey(userId, input.id, which);
      try {
        await this.deps.blobs.put(key, bytes);
      } catch {
        // Blob store refused (IndexedDB quota / private mode): keep this
        // photo in memory for the session rather than losing it.
        await this.memoryBlobs.put(key, bytes);
      }
    }
    if (gen !== this.generation) throw new Error('[photo-queue] signed out while queuing');
    const job: StoredJob = {
      id: input.id,
      userId,
      tripId: input.tripId,
      dayIndex: input.dayIndex ?? null,
      tripPlaceId: input.tripPlaceId ?? null,
      caption: input.caption ?? null,
      visibility: input.visibility ?? 'only_me',
      takenAt: prepared.takenAt,
      width: prepared.full.width,
      height: prepared.full.height,
      fullBytes: prepared.full.bytes.length,
      thumbBytes: prepared.thumb.bytes.length,
      createdAt: this.deps.now(),
      stage: 'queued',
      storagePath: null,
      thumbPath: null,
      attempts: 0,
      nextAttemptAt: 0,
      waitingFor: null,
      error: null,
    };
    this.jobs.push(job);
    await this.persist();
    this.emit();
    void this.resolvePreview(job, gen);
    this.pump();
    return job.id;
  }

  /** Put a failed job back in line. */
  retry(photoId: string): void {
    const job = this.jobs.find((j) => j.id === photoId);
    if (!job) return;
    job.error = null;
    job.attempts = 0;
    job.nextAttemptAt = 0;
    job.waitingFor = null;
    void this.persist();
    this.emit();
    this.pump();
  }

  /**
   * Drop a job. If its row already exists server-side it is tombstoned and
   * its files queued for removal; offline, the server's 24 h pending purge +
   * the orphan sweep clean up instead.
   */
  async cancel(photoId: string): Promise<void> {
    const job = this.jobs.find((j) => j.id === photoId);
    if (!job) return;
    this.jobs = this.jobs.filter((j) => j.id !== photoId);
    if (this.inFlight.has(photoId)) {
      // The running step notices at its next checkpoint (assertAlive) and
      // runs the same cleanup with the paths it knows by then.
      this.userCancelled.add(photoId);
      await this.persist();
      this.emit();
      return;
    }
    await this.cleanupCancelled(job, this.generation);
  }

  /**
   * Remove a user-cancelled job's traces: local bytes, the pending row, uploaded
   * files. The row is TOMBSTONED (not hard-deleted) so the fact replicates to
   * the author's Tier-1 replica (a hard DELETE is invisible to incremental
   * pulls); the hourly pending purge hard-deletes it later.
   */
  private async cleanupCancelled(job: StoredJob, gen: number): Promise<void> {
    this.userCancelled.delete(job.id);
    await this.dropBlobs(job);
    if (job.stage !== 'queued') {
      try {
        await this.deps.client.from('trip_photos').update({ deleted: true }).eq('id', job.id);
      } catch {
        // offline: the pending purge (24 h) removes the row, the sweep its files
      }
      if (job.storagePath && job.thumbPath && gen === this.generation) {
        this.addDeletion(job.id, [job.storagePath, job.thumbPath], 0);
      }
    }
    if (gen !== this.generation) return;
    await this.persist();
    this.emit();
    this.deps.onJobRemoved?.({ id: job.id, tripId: job.tripId });
    this.pump();
  }

  /**
   * Remove a (tombstoned) photo's two Storage objects after `graceMs`.
   * Durable and retried; idempotent.
   */
  scheduleObjectDeletion(photo: { id: string; storage_path: string; thumb_path: string }, graceMs = OBJECT_DELETE_GRACE_MS): void {
    if (!this.userId) return;
    this.addDeletion(photo.id, [photo.storage_path, photo.thumb_path], graceMs);
    void this.persist();
    this.emit();
    this.pump();
  }

  /** Undo support: cancel a not-yet-executed deletion. false = files already gone (or going). */
  cancelObjectDeletion(photoId: string): boolean {
    if (this.deletedObjects.has(photoId) || this.deletingNow.has(photoId)) return false;
    const before = this.deletions.length;
    this.deletions = this.deletions.filter((d) => d.photoId !== photoId);
    if (this.deletions.length !== before) {
      void this.persist();
      this.emit();
    }
    return true;
  }

  /** Can a tombstoned photo still be restored (its files not removed yet)? */
  canRestore(photoId: string): boolean {
    return !this.deletedObjects.has(photoId) && !this.deletingNow.has(photoId);
  }

  /** Is this photo still being uploaded by this device? */
  hasJob(photoId: string): boolean {
    return this.jobs.some((j) => j.id === photoId);
  }

  /**
   * Change what a job whose row does NOT exist yet will be inserted with.
   * false = no such job, or its row is already created / being created (the
   * caller then updates the row instead).
   */
  updateQueuedJob(
    photoId: string,
    patch: { visibility?: MemoryVisibility; caption?: string | null; dayIndex?: number | null },
  ): boolean {
    const job = this.jobs.find((j) => j.id === photoId);
    if (!job || job.stage !== 'queued' || this.inFlight.has(photoId)) return false;
    if (patch.visibility !== undefined) job.visibility = patch.visibility;
    if (patch.caption !== undefined) job.caption = patch.caption;
    if (patch.dayIndex !== undefined) job.dayIndex = patch.dayIndex;
    void this.persist();
    this.emit();
    return true;
  }

  getSnapshot = (): PhotoUploadQueueSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Resolves when nothing is runnable right now (tests / validate script). */
  waitForIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  // ── scheduling ──────────────────────────────────────────────────────────

  private isIdle(): boolean {
    if (this.inFlight.size > 0 || this.deletingNow.size > 0) return false;
    const now = this.deps.now();
    const slotsFull = this.jobs.filter((j) => j.stage !== 'queued').length >= this.pendingCap;
    const runnableJob = this.jobs.some(
      (j) => !j.error && j.nextAttemptAt <= now && !(j.stage === 'queued' && slotsFull),
    );
    const runnableDeletion = this.deletions.some((d) => d.notBefore <= now);
    return !runnableJob && !runnableDeletion;
  }

  private resolveIdle(): void {
    if (!this.isIdle() && this.userId !== null) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of waiters) w();
  }

  private pump(): void {
    if (!this.userId) return;
    const gen = this.generation;
    const now = this.deps.now();
    let nextWake = Infinity;
    // Finish jobs that already hold a pending row first (frees slots), then FIFO.
    const ordered = [...this.jobs].sort(
      (a, b) => STAGE_ORDER[b.stage] - STAGE_ORDER[a.stage] || a.createdAt - b.createdAt,
    );
    let pendingHeld = this.jobs.filter((j) => j.stage !== 'queued').length;
    for (const job of ordered) {
      if (this.inFlight.size >= this.deps.maxConcurrent) break;
      if (this.inFlight.has(job.id) || job.error) continue;
      if (job.nextAttemptAt > now) {
        nextWake = Math.min(nextWake, job.nextAttemptAt);
        continue;
      }
      if (job.stage === 'queued') {
        if (pendingHeld >= this.pendingCap) {
          job.waitingFor = 'pending_slot';
          continue;
        }
        pendingHeld++;
      }
      this.inFlight.add(job.id);
      job.waitingFor = null;
      void this.process(job, gen).finally(() => {
        if (gen !== this.generation) return;
        this.inFlight.delete(job.id);
        this.emit();
        this.pump();
      });
    }
    for (const d of this.deletions) {
      if (this.deletingNow.has(d.photoId)) continue;
      if (d.notBefore > now) {
        nextWake = Math.min(nextWake, d.notBefore);
        continue;
      }
      this.deletingNow.add(d.photoId);
      void this.runDeletion(d, gen).finally(() => {
        if (gen !== this.generation) return;
        this.deletingNow.delete(d.photoId);
        this.emit();
        this.pump();
      });
    }
    this.armTimer(nextWake);
    this.emit();
    this.resolveIdle();
  }

  private armTimer(at: number): void {
    if (at === Infinity) return;
    if (this.timer !== null && this.timerAt <= at) return;
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timerAt = at;
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      this.timerAt = Infinity;
      this.pump();
    }, Math.max(0, at - this.deps.now()));
  }

  private backoff(attempts: number): number {
    const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
    return exp + Math.floor(this.deps.random() * 1000);
  }

  // ── one job ─────────────────────────────────────────────────────────────

  /** Throw (quietly) when the queue was stopped or the user cancelled this job mid-step. */
  private assertAlive(job: StoredJob, gen: number): void {
    if (gen !== this.generation || this.userCancelled.has(job.id)) throw new StepSignal({ kind: 'cancelled' });
  }

  private async process(job: StoredJob, gen: number): Promise<void> {
    try {
      if (job.stage === 'queued') await this.insertRow(job, gen);
      if (job.stage === 'row_created') await this.uploadObject(job, 'full', gen);
      if (job.stage === 'full_uploaded') await this.uploadObject(job, 'thumb', gen);
      if (job.stage === 'uploaded') await this.finalize(job, gen);
      this.assertAlive(job, gen);
      await this.complete(job, gen, 'done');
    } catch (err) {
      if (gen !== this.generation) return;
      if (this.userCancelled.has(job.id)) {
        await this.cleanupCancelled(job, gen);
        return;
      }
      const outcome: StepOutcome =
        err instanceof StepSignal ? err.outcome : { kind: 'retry', info: toMemoryErrorInfo(err), network: false };
      await this.apply(job, outcome, gen);
    }
  }

  private async apply(job: StoredJob, outcome: StepOutcome, gen: number): Promise<void> {
    const now = this.deps.now();
    switch (outcome.kind) {
      case 'done':
      case 'cancelled':
        await this.complete(job, gen, outcome.kind);
        return;
      case 'restart':
        job.stage = 'queued';
        job.storagePath = null;
        job.thumbPath = null;
        job.attempts += 1;
        job.nextAttemptAt = job.attempts > MAX_HARD_ATTEMPTS ? now + this.backoff(job.attempts) : now;
        break;
      case 'wait_slot':
        job.waitingFor = 'pending_slot';
        job.nextAttemptAt = now + SLOT_WAIT_MS;
        break;
      case 'retry':
        job.attempts += 1;
        if (!outcome.network && job.attempts >= MAX_HARD_ATTEMPTS) {
          job.error = outcome.info;
          job.waitingFor = null;
        } else {
          job.waitingFor = outcome.network ? 'network' : null;
          job.nextAttemptAt = now + this.backoff(job.attempts);
        }
        break;
      case 'fail':
        job.error = outcome.info;
        job.waitingFor = null;
        break;
    }
    if (gen !== this.generation) return;
    await this.persist();
    this.emit();
  }

  private async complete(job: StoredJob, gen: number, how: 'done' | 'cancelled'): Promise<void> {
    if (gen !== this.generation) return;
    this.jobs = this.jobs.filter((j) => j.id !== job.id);
    await this.dropBlobs(job);
    if (how === 'cancelled' && job.storagePath && job.thumbPath) {
      // The row was removed elsewhere: its (possibly uploaded) files must go too.
      this.addDeletion(job.id, [job.storagePath, job.thumbPath], 0);
    }
    await this.persist();
    this.emit();
    if (how === 'done') this.deps.onPhotoReady?.({ id: job.id, tripId: job.tripId });
    else this.deps.onJobRemoved?.({ id: job.id, tripId: job.tripId });
  }

  private checkpoint(job: StoredJob, gen: number, stage: Stage): Promise<void> {
    job.stage = stage; // recorded first so a cancel cleanup knows the row / files exist
    this.assertAlive(job, gen);
    job.error = null;
    this.emit();
    return this.persist();
  }

  private async fetchRow(id: string): Promise<{ status: string; deleted: boolean; storage_path: string; thumb_path: string } | null> {
    const { data, error } = await this.deps.client
      .from('trip_photos')
      .select('id, status, deleted, storage_path, thumb_path')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new StepSignal(outcomeFor(toMemoryErrorInfo(error)));
    return (data as { status: string; deleted: boolean; storage_path: string; thumb_path: string } | null) ?? null;
  }

  private async insertRow(job: StoredJob, gen: number): Promise<void> {
    const payload = {
      id: job.id,
      trip_id: job.tripId,
      day_index: job.dayIndex,
      trip_place_id: job.tripPlaceId,
      caption: job.caption,
      taken_at: job.takenAt,
      width: job.width,
      height: job.height,
      visibility: job.visibility,
      // created_at is never sent (server default); author_id defaults to auth.uid().
    };
    const { data, error } = await this.deps.client
      .from('trip_photos')
      .insert(payload)
      .select('id, storage_path, thumb_path, status')
      .single();
    if (error) {
      const code = (error as { code?: string }).code;
      const text = `${error.message ?? ''} ${(error as { details?: string }).details ?? ''}`;
      if (code === '23505') {
        // Our own earlier insert landed but the response was lost.
        const row = await this.fetchRow(job.id);
        if (!row) throw new StepSignal({ kind: 'fail', info: { code: 'forbidden', message: 'photo id taken' } });
        if (row.deleted) throw new StepSignal({ kind: 'cancelled' });
        if (row.status === 'ready') throw new StepSignal({ kind: 'done' });
        job.storagePath = row.storage_path;
        job.thumbPath = row.thumb_path;
        await this.checkpoint(job, gen, 'row_created');
        return;
      }
      if (code === '23503' && /trip_place_id|trip_places/.test(text) && job.tripPlaceId) {
        // The place was removed meanwhile: keep the photo, drop the link.
        job.tripPlaceId = null;
        throw new StepSignal({ kind: 'restart' });
      }
      throw new StepSignal(outcomeFor(toMemoryErrorInfo(error)));
    }
    const row = data as { storage_path: string; thumb_path: string };
    job.storagePath = row.storage_path;
    job.thumbPath = row.thumb_path;
    await this.checkpoint(job, gen, 'row_created');
  }

  private async readBlob(job: StoredJob, which: 'full' | 'thumb'): Promise<Uint8Array | null> {
    const key = blobKey(job.userId, job.id, which);
    try {
      const b = await this.deps.blobs.get(key);
      if (b) return b;
    } catch {
      // fall through to the memory copy
    }
    return this.memoryBlobs.get(key);
  }

  private async uploadObject(job: StoredJob, which: 'full' | 'thumb', gen: number): Promise<void> {
    const path = which === 'full' ? job.storagePath : job.thumbPath;
    if (!path) throw new StepSignal({ kind: 'restart' });
    const bytes = await this.readBlob(job, which);
    if (!bytes) {
      throw new StepSignal({
        kind: 'fail',
        info: { code: 'unknown', message: 'local_copy_lost: the queued image is no longer on this device' },
      });
    }
    const { error } = await this.deps.client.storage.from(PHOTO_BUCKET).upload(path, toArrayBuffer(bytes), {
      contentType: 'image/jpeg',
      upsert: false,
      cacheControl: '31536000',
    });
    if (error && !isStorageAlreadyExists(error)) {
      const info = toMemoryErrorInfo(error);
      if (info.code === 'forbidden') throw new StepSignal(await this.diagnoseForbidden(job, bytes.length));
      throw new StepSignal(outcomeFor(info));
    }
    await this.checkpoint(job, gen, which === 'full' ? 'full_uploaded' : 'uploaded');
  }

  /**
   * Storage answered 403: the INSERT policy refused. Find out why (0038 §2g:
   * row not pending/missing, byte cap, global guard) so the user sees the
   * right message instead of a generic failure.
   */
  private async diagnoseForbidden(job: StoredJob, incoming: number): Promise<StepOutcome> {
    const row = await this.fetchRow(job.id);
    if (!row) return { kind: 'restart' }; // purged (24 h) → re-insert the same id
    if (row.deleted) return { kind: 'cancelled' };
    if (row.status === 'ready') return { kind: 'done' };
    try {
      const { data } = await this.deps.client.rpc('get_memory_quota', { p_trip_id: job.tripId });
      const q = data as Partial<MemoryQuota> | null;
      if (q?.storage_full) return { kind: 'fail', info: { code: 'storage_full', scope: 'global' } };
      if (
        typeof q?.user_bytes === 'number' &&
        typeof q.user_bytes_cap === 'number' &&
        q.user_bytes + incoming > q.user_bytes_cap
      ) {
        return {
          kind: 'fail',
          info: { code: 'quota_exceeded', scope: 'user_bytes', limit: q.user_bytes_cap, used: q.user_bytes },
        };
      }
    } catch {
      // quota unknown → generic retry below
    }
    return { kind: 'retry', info: { code: 'forbidden', message: 'storage refused the upload' }, network: false };
  }

  private async finalize(job: StoredJob, gen: number): Promise<void> {
    const { data, error } = await this.deps.client
      .from('trip_photos')
      .update({ status: 'ready' })
      .eq('id', job.id)
      .select('id, status')
      .maybeSingle();
    if (error) {
      const info = toMemoryErrorInfo(error);
      if (info.code === 'upload_incomplete') {
        // A file is missing server-side: upload both again (409 = already there).
        await this.checkpoint(job, gen, 'row_created');
        throw new StepSignal({ kind: 'retry', info, network: false });
      }
      throw new StepSignal(outcomeFor(info));
    }
    if (!data) {
      const row = await this.fetchRow(job.id);
      if (!row) throw new StepSignal({ kind: 'restart' });
      if (row.deleted) throw new StepSignal({ kind: 'cancelled' });
      if (row.status !== 'ready') throw new StepSignal({ kind: 'retry', info: { code: 'unknown' }, network: false });
    }
  }

  // ── deletions ───────────────────────────────────────────────────────────

  private addDeletion(photoId: string, paths: string[], graceMs: number): void {
    const clean = paths.filter((p) => typeof p === 'string' && p.length > 0);
    if (clean.length === 0) return;
    this.deletedObjects.delete(photoId);
    const notBefore = this.deps.now() + Math.max(0, graceMs);
    const existing = this.deletions.find((d) => d.photoId === photoId);
    if (existing) {
      existing.paths = [...new Set([...existing.paths, ...clean])];
      existing.notBefore = Math.min(existing.notBefore, notBefore);
    } else {
      this.deletions.push({ photoId, paths: clean, notBefore, attempts: 0 });
    }
  }

  private async runDeletion(d: StoredDeletion, gen: number): Promise<void> {
    let error: unknown = null;
    try {
      ({ error } = await this.deps.client.storage.from(PHOTO_BUCKET).remove(d.paths));
    } catch (e) {
      error = e;
    }
    if (gen !== this.generation) return;
    if (error) {
      const info = toMemoryErrorInfo(error);
      d.attempts += 1;
      if (info.code === 'network' || d.attempts < MAX_HARD_ATTEMPTS) {
        d.notBefore = this.deps.now() + this.backoff(d.attempts);
        await this.persist();
        return;
      }
      // Permanently refused (e.g. no longer a member): the trip owner's
      // delete-trip / delete-account sweep owns these objects now.
    }
    this.deletions = this.deletions.filter((x) => x !== d);
    this.deletedObjects.add(d.photoId);
    await this.persist();
  }

  // ── storage helpers ─────────────────────────────────────────────────────

  private async dropBlobs(job: StoredJob): Promise<void> {
    for (const which of ['full', 'thumb'] as const) {
      const key = blobKey(job.userId, job.id, which);
      try {
        await this.deps.blobs.remove(key);
      } catch {
        // best-effort; orphan cleanup at the next start
      }
      await this.memoryBlobs.remove(key);
    }
    this.previews.delete(job.id);
  }

  private async cleanupOrphanBlobs(userId: string, gen: number): Promise<void> {
    try {
      const keys = await this.deps.blobs.keys();
      if (gen !== this.generation) return;
      const live = new Set<string>();
      for (const j of this.jobs) {
        live.add(blobKey(userId, j.id, 'full'));
        live.add(blobKey(userId, j.id, 'thumb'));
      }
      for (const k of keys) {
        if (k.startsWith(`${userId}/`) && !live.has(k)) await this.deps.blobs.remove(k);
      }
    } catch {
      // best-effort
    }
  }

  private async refreshPendingCap(gen: number): Promise<void> {
    try {
      const { data, error } = await this.deps.client.rpc('get_memory_quota', { p_trip_id: null });
      if (error || gen !== this.generation) return;
      const cap = (data as Partial<MemoryQuota> | null)?.user_pending_cap;
      if (typeof cap === 'number' && cap > 0) {
        this.pendingCap = cap;
        this.pump();
      }
    } catch {
      // offline: keep the default
    }
  }

  private async resolvePreview(job: StoredJob, gen: number): Promise<void> {
    if (this.previews.has(job.id)) return;
    try {
      const uri = await this.deps.blobs.previewUri(blobKey(job.userId, job.id, 'full'));
      if (uri && gen === this.generation && this.jobs.some((j) => j.id === job.id)) {
        this.previews.set(job.id, uri);
        this.emit();
      }
    } catch {
      // no preview — the UI shows a placeholder tile
    }
  }

  private persist(): Promise<void> {
    const userId = this.userId;
    if (!userId) return this.saveChain;
    const manifest: Manifest = { v: 1, jobs: this.jobs, deletions: this.deletions };
    const payload = JSON.stringify(manifest);
    this.saveChain = this.saveChain
      .then(() => this.deps.kv.setItem(MANIFEST_PREFIX + userId, payload))
      .catch(() => {
        // storage full / unavailable: the in-memory queue keeps working
      });
    return this.saveChain;
  }

  // ── snapshot ────────────────────────────────────────────────────────────

  private emit(): void {
    const now = this.deps.now();
    const jobs: PhotoUploadJobView[] = this.jobs.map((j) => {
      const running = this.inFlight.has(j.id);
      const state: PhotoUploadJobView['state'] = j.error
        ? 'failed'
        : running
          ? 'uploading'
          : j.waitingFor || j.nextAttemptAt > now
            ? 'waiting'
            : 'queued';
      return {
        id: j.id,
        tripId: j.tripId,
        dayIndex: j.dayIndex,
        tripPlaceId: j.tripPlaceId,
        caption: j.caption,
        visibility: j.visibility,
        takenAt: j.takenAt,
        width: j.width,
        height: j.height,
        bytes: j.fullBytes + j.thumbBytes,
        state,
        progress: PROGRESS[j.stage],
        waitingFor: state === 'waiting' ? (j.waitingFor ?? 'network') : null,
        error: j.error,
        previewUri: this.previews.get(j.id) ?? null,
        createdAt: j.createdAt,
      };
    });
    this.snapshot = {
      userId: this.userId,
      jobs,
      pendingDeletions: this.deletions.length,
      durable: this.deps.blobs.durable,
    };
    for (const l of this.listeners) l();
  }
}

// ===========================================================================
// App singleton (lazy: keeps RN modules off the import graph of node tools)
// ===========================================================================

let singleton: PhotoUploadQueue | null = null;
const readyListeners = new Set<(photo: { id: string; tripId: string }) => void>();
const removedListeners = new Set<(photo: { id: string; tripId: string }) => void>();

function defaultReconnect(cb: () => void): () => void {
  let unsubs: Array<() => void> = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const NetInfo = (require('@react-native-community/netinfo') as typeof import('@react-native-community/netinfo')).default;
    let was: boolean | null = null;
    unsubs.push(
      NetInfo.addEventListener((s) => {
        const now = s.isConnected === true;
        if (now && was === false) cb();
        was = now;
      }),
    );
  } catch {
    // fall through to DOM
  }
  if (unsubs.length === 0 && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const h = () => cb();
    window.addEventListener('online', h);
    unsubs.push(() => window.removeEventListener('online', h));
  }
  return () => {
    for (const u of unsubs) u();
    unsubs = [];
  };
}

/** The app-wide queue (created on first use). */
export function getPhotoUploadQueue(): PhotoUploadQueue {
  if (singleton) return singleton;
  const { supabase } = require('./supabase') as typeof import('./supabase');
  const AsyncStorage = (require('@react-native-async-storage/async-storage') as {
    default: QueueKv;
  }).default;
  const { createPhotoBlobStore } = require('../lib/photos/blobStore') as typeof import('../lib/photos/blobStore');
  singleton = new PhotoUploadQueue({
    client: supabase,
    kv: AsyncStorage,
    blobs: createPhotoBlobStore(),
    onReconnect: defaultReconnect,
    onPhotoReady: (p) => {
      for (const l of readyListeners) l(p);
    },
    onJobRemoved: (p) => {
      for (const l of removedListeners) l(p);
    },
  });
  return singleton;
}

/** Hooks subscribe here to refresh reads when an upload lands / a job disappears. */
export function onPhotoUploadSettled(
  onReady: (photo: { id: string; tripId: string }) => void,
  onRemoved?: (photo: { id: string; tripId: string }) => void,
): () => void {
  readyListeners.add(onReady);
  if (onRemoved) removedListeners.add(onRemoved);
  return () => {
    readyListeners.delete(onReady);
    if (onRemoved) removedListeners.delete(onRemoved);
  };
}

/** Auth seam (src/api/auth.ts): resume this user's queue. Never throws. */
export function startPhotoUploads(userId: string): void {
  try {
    void getPhotoUploadQueue()
      .start(userId)
      .catch(() => undefined);
  } catch {
    // queue unavailable (e.g. storage module missing) — uploads resume later
  }
}

/** Auth seam: sign-out pauses the queue (jobs stay on disk for this user). */
export function stopPhotoUploads(): void {
  singleton?.stop();
}

/** Account deletion (src/sync/wipe.ts): drop this user's queued photos from the device. Never throws. */
export async function wipePhotoUploadQueue(userId: string): Promise<void> {
  try {
    await getPhotoUploadQueue().wipe(userId);
  } catch {
    // queue unavailable — nothing was queued through it this process
  }
}
