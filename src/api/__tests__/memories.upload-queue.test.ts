/**
 * M5 Y2.1 — the durable photo upload queue against an in-memory fake of the
 * 0036/0038 server contract (row pending → 2 uploads to the RETURNED paths →
 * ready; 409 = already there; quota scopes; upload_incomplete; 403 diagnosis;
 * pending purge; file deletion after tombstone).
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { PhotoUploadQueue, type QueueClient, type QueueKv } from '../memories.upload-queue';
import { createMemoryBlobStore, type PhotoBlobStore } from '../../lib/photos/blobStore.types';
import { inspectJpeg, stripJpegMetadata } from '../../lib/photos/exif';
import type { PreparedPhoto } from '../../lib/photos/pipeline';

const USER = '11111111-1111-4111-8111-111111111111';
const TRIP = '22222222-2222-4222-8222-222222222222';
const FIXTURE = new Uint8Array(fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'photos', '__tests__', 'fixtures', 'gps-exif.jpg')));
const CLEAN = stripJpegMetadata(FIXTURE);

interface Row {
  id: string;
  trip_id: string;
  author_id: string;
  status: 'pending' | 'ready';
  deleted: boolean;
  storage_path: string;
  thumb_path: string;
  visibility: string;
  [k: string]: unknown;
}

type Fail = { error: Record<string, unknown>; times: number };

/** In-memory stand-in for PostgREST + Storage with the 0036/0038 rules the queue relies on. */
class FakeServer {
  rows = new Map<string, Row>();
  objects = new Map<string, Uint8Array>();
  inserts: Array<Record<string, unknown>> = [];
  uploads: Array<{ path: string; bytes: Uint8Array; opts: Record<string, unknown> }> = [];
  removed: string[] = [];
  fail: Partial<Record<'insert' | 'upload' | 'finalize' | 'remove', Fail>> = {};
  pendingCap = 20;
  quota: Record<string, unknown> = { user_bytes: 0, user_bytes_cap: 104857600, storage_full: false, user_pending_cap: 20 };
  /** Inserts that land server-side but whose response is "lost" (network error returned). */
  loseInsertResponse = 0;
  maxConcurrentSeen = 0;
  inFlight = 0;

  private takeFail(op: keyof FakeServer['fail']): Record<string, unknown> | null {
    const f = this.fail[op];
    if (!f || f.times <= 0) return null;
    f.times -= 1;
    return f.error;
  }

  private async track<T>(fn: () => T): Promise<T> {
    this.inFlight++;
    this.maxConcurrentSeen = Math.max(this.maxConcurrentSeen, this.inFlight);
    await Promise.resolve();
    try {
      return fn();
    } finally {
      this.inFlight--;
    }
  }

  client(): QueueClient {
    const server = this;
    const from = (table: string) => {
      const st: { op: string | null; payload: Record<string, unknown> | null; filters: Array<[string, unknown]> } = {
        op: null,
        payload: null,
        filters: [],
      };
      const exec = () => server.handle(table, st);
      const api: Record<string, unknown> = {
        insert(p: Record<string, unknown>) {
          st.op = 'insert';
          st.payload = p;
          return api;
        },
        update(p: Record<string, unknown>) {
          st.op = 'update';
          st.payload = p;
          return api;
        },
        delete() {
          st.op = 'delete';
          return api;
        },
        select() {
          if (!st.op) st.op = 'select';
          return api;
        },
        eq(c: string, v: unknown) {
          st.filters.push([c, v]);
          return api;
        },
        single: exec,
        maybeSingle: exec,
        then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
          return exec().then(res, rej);
        },
      };
      return api;
    };
    const storage = {
      from: () => ({
        upload: (p: string, body: ArrayBuffer, opts: Record<string, unknown>) =>
          server.track(() => server.upload(p, new Uint8Array(body), opts)),
        remove: async (paths: string[]) => server.remove(paths),
      }),
    };
    const rpc = async (name: string) => {
      if (name === 'get_memory_quota') return { data: server.quota, error: null };
      return { data: null, error: { message: 'unknown rpc' } };
    };
    return { from, storage, rpc } as unknown as QueueClient;
  }

  async handle(table: string, st: { op: string | null; payload: Record<string, unknown> | null; filters: Array<[string, unknown]> }) {
    expect(table).toBe('trip_photos');
    const id = (st.filters.find(([c]) => c === 'id')?.[1] as string | undefined) ?? (st.payload?.['id'] as string);
    return this.track(() => {
      if (st.op === 'insert') {
        const f = this.takeFail('insert');
        if (f) return { data: null, error: f };
        const p = st.payload as Record<string, unknown>;
        this.inserts.push(p);
        if (this.rows.has(id)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "trip_photos_pkey"' } };
        const pending = [...this.rows.values()].filter((r) => r.status === 'pending' && !r.deleted).length;
        if (pending >= this.pendingCap) {
          return {
            data: null,
            error: { code: 'P0001', message: 'quota_exceeded', details: JSON.stringify({ scope: 'pending', limit: this.pendingCap, used: pending }) },
          };
        }
        const row: Row = {
          ...(p as object),
          id,
          trip_id: p['trip_id'] as string,
          author_id: USER,
          status: 'pending',
          deleted: false,
          visibility: (p['visibility'] as string) ?? 'only_me',
          storage_path: `${p['trip_id']}/${USER}/${id}.jpg`,
          thumb_path: `${p['trip_id']}/${USER}/${id}_t.jpg`,
        };
        this.rows.set(id, row);
        if (this.loseInsertResponse > 0) {
          this.loseInsertResponse--;
          return { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } };
        }
        return { data: { ...row }, error: null };
      }
      if (st.op === 'select') {
        const row = this.rows.get(id);
        return { data: row ? { ...row } : null, error: null };
      }
      if (st.op === 'update') {
        const row = this.rows.get(id);
        const patch = st.payload as Record<string, unknown>;
        if (patch['status'] === 'ready') {
          const f = this.takeFail('finalize');
          if (f) return { data: null, error: f };
          if (!row) return { data: null, error: null };
          if (!this.objects.has(row.storage_path) || !this.objects.has(row.thumb_path)) {
            return { data: null, error: { code: 'P0001', message: 'upload_incomplete' } };
          }
        }
        if (!row) return { data: null, error: null };
        Object.assign(row, patch);
        return { data: { id: row.id, status: row.status }, error: null };
      }
      if (st.op === 'delete') {
        this.rows.delete(id);
        return { data: null, error: null };
      }
      throw new Error(`unhandled op ${st.op}`);
    });
  }

  upload(p: string, bytes: Uint8Array, opts: Record<string, unknown>) {
    const f = this.takeFail('upload');
    if (f) return { data: null, error: f };
    this.uploads.push({ path: p, bytes, opts });
    if (this.objects.has(p)) {
      return { data: null, error: { name: 'StorageApiError', status: 400, statusCode: '409', message: 'The resource already exists' } };
    }
    const photoId = p.split('/')[2]?.replace(/(_t)?\.jpg$/, '');
    const row = photoId ? this.rows.get(photoId) : undefined;
    if (!row || row.status !== 'pending' || row.deleted || (row.storage_path !== p && row.thumb_path !== p)) {
      return { data: null, error: { name: 'StorageApiError', status: 403, statusCode: '403', message: 'new row violates row-level security policy' } };
    }
    this.objects.set(p, bytes);
    return { data: { path: p }, error: null };
  }

  remove(paths: string[]) {
    const f = this.takeFail('remove');
    if (f) return { data: null, error: f };
    for (const p of paths) {
      this.removed.push(p);
      this.objects.delete(p);
    }
    return { data: paths.map((name) => ({ name })), error: null };
  }
}

function memoryKv(): QueueKv & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async getItem(k) {
      return data.get(k) ?? null;
    },
    async setItem(k, v) {
      data.set(k, v);
    },
  };
}

function prepared(): PreparedPhoto {
  return {
    full: { bytes: CLEAN, width: 320, height: 240, quality: 0.75 },
    thumb: { bytes: CLEAN.slice(), width: 160, height: 120, quality: 0.7 },
    takenAt: '2026-07-14T12:30:00.000Z',
  };
}

let seq = 0;
function uuid(): string {
  seq++;
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(seq).padStart(12, '0')}`;
}

interface Harness {
  server: FakeServer;
  kv: ReturnType<typeof memoryKv>;
  blobs: PhotoBlobStore;
  clock: { now: number };
  timers: Array<{ at: number; fn: () => void; cancelled: boolean }>;
  ready: string[];
  removedJobs: string[];
  make: () => PhotoUploadQueue;
  advance: (ms: number) => Promise<void>;
}

function harness(): Harness {
  const server = new FakeServer();
  const kv = memoryKv();
  const blobs = createMemoryBlobStore();
  const clock = { now: 1_000_000 };
  const timers: Harness['timers'] = [];
  const ready: string[] = [];
  const removedJobs: string[] = [];
  const h: Harness = {
    server,
    kv,
    blobs,
    clock,
    timers,
    ready,
    removedJobs,
    make: () =>
      new PhotoUploadQueue({
        client: server.client(),
        kv,
        blobs,
        now: () => clock.now,
        random: () => 0,
        setTimer: (fn, ms) => {
          const t = { at: clock.now + ms, fn, cancelled: false };
          timers.push(t);
          return t;
        },
        clearTimer: (t) => {
          (t as { cancelled: boolean }).cancelled = true;
        },
        onPhotoReady: ({ id }) => ready.push(id),
        onJobRemoved: ({ id }) => removedJobs.push(id),
      }),
    advance: async (ms) => {
      clock.now += ms;
      for (const t of [...timers]) {
        if (!t.cancelled && t.at <= clock.now) {
          t.cancelled = true;
          t.fn();
        }
      }
      await settle();
    },
  };
  return h;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

async function idle(q: PhotoUploadQueue): Promise<void> {
  await settle();
  await q.waitForIdle();
  await settle();
}

beforeEach(() => {
  seq = 0;
});

describe('happy path', () => {
  it('row pending → both files to the RETURNED paths → ready; local bytes dropped', async () => {
    const h = harness();
    const q = h.make();
    await q.start(USER);
    const id = uuid();
    await q.enqueue({ id, tripId: TRIP, dayIndex: 2, prepared: prepared() });
    await idle(q);

    const row = h.server.rows.get(id)!;
    expect(row.status).toBe('ready');
    expect(row.visibility).toBe('only_me'); // PRIVATE BY DEFAULT
    // Insert payload: client id, never created_at / server-owned columns.
    const ins = h.server.inserts[0]!;
    expect(ins['id']).toBe(id);
    for (const k of ['created_at', 'updated_at', 'status', 'bytes', 'storage_path', 'thumb_path', 'author_id']) {
      expect(ins).not.toHaveProperty(k);
    }
    expect(ins['taken_at']).toBe('2026-07-14T12:30:00.000Z');
    expect(ins['day_index']).toBe(2);
    expect(h.server.uploads.map((u) => u.path)).toEqual([row.storage_path, row.thumb_path]);
    expect(h.server.uploads.every((u) => u.opts['upsert'] === false && u.opts['contentType'] === 'image/jpeg')).toBe(true);
    // The uploaded bytes are the prepared, metadata-free JPEG — never the EXIF original.
    for (const u of h.server.uploads) expect(inspectJpeg(u.bytes).hasExif).toBe(false);
    expect(h.ready).toEqual([id]);
    expect(q.getSnapshot().jobs).toHaveLength(0);
    expect(await h.blobs.keys()).toEqual([]);
  });
});

describe('durability + idempotent retries', () => {
  it('a restart resumes from the persisted checkpoint (no duplicate row)', async () => {
    const h = harness();
    const q1 = h.make();
    await q1.start(USER);
    const id = uuid();
    h.server.fail.upload = { error: { name: 'StorageUnknownError', message: 'Network request failed' }, times: 1 };
    await q1.enqueue({ id, tripId: TRIP, prepared: prepared() });
    await idle(q1);
    expect(h.server.rows.get(id)?.status).toBe('pending');
    const view = q1.getSnapshot().jobs[0]!;
    expect(view.state).toBe('waiting');
    expect(view.waitingFor).toBe('network');
    q1.stop(); // app killed / signed out

    const q2 = h.make(); // cold start: same kv + blob store
    await q2.start(USER);
    await idle(q2);
    expect(h.server.rows.get(id)?.status).toBe('ready');
    expect(h.server.inserts).toHaveLength(1);
  });

  it('409 "already exists" on a re-upload counts as uploaded', async () => {
    const h = harness();
    const q = h.make();
    await q.start(USER);
    const id = uuid();
    h.server.fail.finalize = { error: { message: 'TypeError: Failed to fetch' }, times: 1 };
    await q.enqueue({ id, tripId: TRIP, prepared: prepared() });
    await idle(q);
    // Simulate a lost checkpoint: the job believes nothing was uploaded yet.
    q.stop();
    const manifestKey = [...h.kv.data.keys()][0]!;
    const m = JSON.parse(h.kv.data.get(manifestKey)!);
    m.jobs[0].stage = 'row_created';
    h.kv.data.set(manifestKey, JSON.stringify(m));
    const q2 = h.make();
    await q2.start(USER);
    await idle(q2);
    expect(h.server.uploads.filter((u) => u.path.endsWith(`${id}.jpg`))).toHaveLength(2); // second answered 409
    expect(h.server.rows.get(id)?.status).toBe('ready');
    expect(h.ready).toEqual([id]);
  });

  it('a lost insert response (23505 on retry) adopts the existing pending row', async () => {
    const h = harness();
    const q = h.make();
    await q.start(USER);
    h.server.loseInsertResponse = 1;
    const id = uuid();
    await q.enqueue({ id, tripId: TRIP, prepared: prepared() });
    await idle(q);
    await h.advance(10_000);
    await idle(q);
    expect(h.server.inserts).toHaveLength(2);
    expect(h.server.rows.get(id)?.status).toBe('ready');
  });

  it('upload_incomplete on finalize → uploads again, then ready', async () => {
    const h = harness();
    const q = h.make();
    await q.start(USER);
    const id = uuid();
    await q.enqueue({ id, tripId: TRIP, prepared: prepared() });
    // Let insert + uploads happen, then drop the thumbnail server-side before finalize.
    h.server.fail.finalize = { error: { code: 'P0001', message: 'upload_incomplete' }, times: 1 };
    await idle(q);
    await h.advance(10_000);
    await idle(q);
    expect(h.server.rows.get(id)?.status).toBe('ready');
  });

  it('a row purged after 24 h is re-inserted with the SAME id', async () => {
    const h = harness();
    const q = h.make();
    await q.start(USER);
    const id = uuid();
    h.server.fail.upload = { error: { name: 'StorageUnknownError', message: 'Network request failed' }, times: 1 };
    await q.enqueue({ id, tripId: TRIP, prepared: prepared() });
    await idle(q);
    h.server.rows.delete(id); // pg_cron purge_stale_pending_photos
    q.wake();
    await idle(q);
    await h.advance(1000);
    await idle(q);
    expect(h.server.inserts.map((i) => i['id'])).toEqual([id, id]);
    expect(h.server.rows.get(id)?.status).toBe('ready');
  });
});

describe('quota + errors', () => {
  it("quota_exceeded {scope:'pending'} waits for a slot instead of failing", async () => {
    const h = harness();
    const q = h.make();
    await q.start(USER);
    h.server.pendingCap = 0; // other devices hold every slot
    const id = uuid();
    await q.enqueue({ id, tripId: TRIP, prepared: prepared() });
    await idle(q);
    const job = q.getSnapshot().jobs[0]!;
    expect(job.state).toBe('waiting');
    expect(job.waitingFor).toBe('pending_slot');
    expect(job.error).toBeNull();
    h.server.pendingCap = 20; // slots freed
    await h.advance(20_000);
    await idle(q);
    expect(h.server.rows.get(id)?.status).toBe('ready');
  });

  it.each([
    [{ code: 'P0001', message: 'quota_exceeded', details: '{"scope":"user","limit":300,"used":300}' }, 'quota_exceeded', 'user'],
    [{ code: 'P0001', message: 'quota_exceeded', details: '{"scope":"user_bytes","limit":104857600,"used":104857600}' }, 'quota_exceeded', 'user_bytes'],
    [{ code: 'P0001', message: 'quota_exceeded', details: '{"scope":"trip","limit":500,"used":500}' }, 'quota_exceeded', 'trip'],
    [{ code: 'P0001', message: 'storage_full', details: '{"scope":"global","limit":1,"used":2}' }, 'storage_full', 'global'],
  ])('permanent %# → job failed with code/scope; retry() puts it back', async (error, code, scope) => {
    const h = harness();
    const q = h.make();
    await q.start(USER);
    h.server.fail.insert = { error, times: 1 };
    const id = uuid();
    await q.enqueue({ id, tripId: TRIP, prepared: prepared() });
    await idle(q);
    const job = q.getSnapshot().jobs[0]!;
    expect(job.state).toBe('failed');
    expect(job.error).toMatchObject({ code, scope });
    q.retry(id);
    await idle(q);
    expect(h.server.rows.get(id)?.status).toBe('ready');
  });

  it('a Storage 403 is diagnosed via get_memory_quota (user_bytes / storage_full)', async () => {
    const h = harness();
    const q = h.make();
    await q.start(USER);
    h.server.fail.upload = {
      error: { name: 'StorageApiError', status: 403, statusCode: '403', message: 'new row violates row-level security policy' },
      times: 1,
    };
    h.server.quota = { user_bytes: 104857000, user_bytes_cap: 104857600, storage_full: false, user_pending_cap: 20 };
    await q.enqueue({ id: uuid(), tripId: TRIP, prepared: prepared() });
    await idle(q);
    expect(q.getSnapshot().jobs[0]!.error).toMatchObject({ code: 'quota_exceeded', scope: 'user_bytes' });

    const h2 = harness();
    const q2 = h2.make();
    await q2.start(USER);
    h2.server.fail.upload = { error: { name: 'StorageApiError', status: 403, statusCode: '403', message: 'denied' }, times: 1 };
    h2.server.quota = { user_bytes: 0, user_bytes_cap: 104857600, storage_full: true, user_pending_cap: 20 };
    await q2.enqueue({ id: uuid(), tripId: TRIP, prepared: prepared() });
    await idle(q2);
    expect(q2.getSnapshot().jobs[0]!.error).toMatchObject({ code: 'storage_full' });
  });
});

describe('bounded concurrency', () => {
  it('never more than 2 in flight, and never more pending rows than user_pending_cap', async () => {
    const h = harness();
    h.server.quota = { ...h.server.quota, user_pending_cap: 1 };
    const q = h.make();
    await q.start(USER);
    await settle(); // refreshPendingCap
    const ids = [uuid(), uuid(), uuid(), uuid(), uuid()];
    let maxPending = 0;
    const origHandle = h.server.handle.bind(h.server);
    h.server.handle = async (table, st) => {
      const res = await origHandle(table, st);
      maxPending = Math.max(maxPending, [...h.server.rows.values()].filter((r) => r.status === 'pending').length);
      return res;
    };
    for (const id of ids) await q.enqueue({ id, tripId: TRIP, prepared: prepared() });
    for (let i = 0; i < 10; i++) {
      await idle(q);
      await h.advance(20_000);
    }
    expect(ids.every((id) => h.server.rows.get(id)?.status === 'ready')).toBe(true);
    expect(h.server.maxConcurrentSeen).toBeLessThanOrEqual(2);
    expect(maxPending).toBeLessThanOrEqual(1);
  });
});

describe('cancel + file deletion', () => {
  it('cancel after the row exists: row tombstoned, uploaded files removed, local bytes dropped', async () => {
    const h = harness();
    const q = h.make();
    await q.start(USER);
    const id = uuid();
    h.server.fail.finalize = { error: { message: 'TypeError: Failed to fetch' }, times: 5 };
    await q.enqueue({ id, tripId: TRIP, prepared: prepared() });
    await idle(q);
    const row = h.server.rows.get(id)!;
    await q.cancel(id);
    await idle(q);
    expect(row.deleted).toBe(true);
    expect(h.server.removed.sort()).toEqual([row.storage_path, row.thumb_path].sort());
    expect(q.getSnapshot().jobs).toHaveLength(0);
    expect(await h.blobs.keys()).toEqual([]);
    expect(h.removedJobs).toEqual([id]);
  });

  it('scheduleObjectDeletion waits for the undo window; cancelObjectDeletion before it keeps the files', async () => {
    const h = harness();
    const q = h.make();
    await q.start(USER);
    const photo = { id: uuid(), storage_path: `${TRIP}/${USER}/x.jpg`, thumb_path: `${TRIP}/${USER}/x_t.jpg` };
    h.server.objects.set(photo.storage_path, CLEAN);
    h.server.objects.set(photo.thumb_path, CLEAN);

    q.scheduleObjectDeletion(photo, 120_000);
    await idle(q);
    expect(h.server.removed).toEqual([]);
    expect(q.cancelObjectDeletion(photo.id)).toBe(true); // undo in time
    await h.advance(200_000);
    await idle(q);
    expect(h.server.removed).toEqual([]);

    q.scheduleObjectDeletion(photo, 120_000);
    expect(q.getSnapshot().pendingDeletions).toBe(1);
    await h.advance(120_001);
    await idle(q);
    expect(h.server.removed.sort()).toEqual([photo.storage_path, photo.thumb_path].sort());
    expect(q.canRestore(photo.id)).toBe(false);
    expect(q.cancelObjectDeletion(photo.id)).toBe(false); // too late: files gone
  });

  it('pending deletions survive a restart and run immediately', async () => {
    const h = harness();
    const q = h.make();
    await q.start(USER);
    const photo = { id: uuid(), storage_path: `${TRIP}/${USER}/y.jpg`, thumb_path: `${TRIP}/${USER}/y_t.jpg` };
    q.scheduleObjectDeletion(photo, 0);
    h.server.fail.remove = { error: { message: 'TypeError: Failed to fetch' }, times: 1 };
    await idle(q);
    q.stop();
    const q2 = h.make();
    await q2.start(USER);
    await h.advance(60_000);
    await idle(q2);
    expect(h.server.removed.sort()).toEqual([photo.storage_path, photo.thumb_path].sort());
  });
});

describe('account deletion', () => {
  it("wipe(userId) forgets that user's queued photos on the device (manifest + bytes) without touching the server", async () => {
    const h = harness();
    const q = h.make();
    await q.start(USER);
    h.server.fail.insert = { error: { message: 'TypeError: Failed to fetch' }, times: 10 };
    await q.enqueue({ id: uuid(), tripId: TRIP, prepared: prepared() });
    await idle(q);
    await h.blobs.put('someone-else/abc', CLEAN);
    const insertsBefore = h.server.inserts.length;
    await q.wipe(USER);
    expect(await h.blobs.keys()).toEqual(['someone-else/abc']);
    const q2 = h.make();
    await q2.start(USER);
    expect(q2.getSnapshot().jobs).toHaveLength(0);
    expect(h.server.inserts.length).toBe(insertsBefore);
  });
});

describe('per-user isolation', () => {
  it("another user's sign-in never sees or uploads the first user's queue", async () => {
    const h = harness();
    const q = h.make();
    await q.start(USER);
    h.server.fail.insert = { error: { message: 'TypeError: Failed to fetch' }, times: 10 };
    await q.enqueue({ id: uuid(), tripId: TRIP, prepared: prepared() });
    await idle(q);
    q.stop();
    await q.start('99999999-9999-4999-8999-999999999999');
    expect(q.getSnapshot().jobs).toHaveLength(0);
    expect(q.getSnapshot().userId).toBe('99999999-9999-4999-8999-999999999999');
  });
});
