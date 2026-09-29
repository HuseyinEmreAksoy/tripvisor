/**
 * persistGuard — invariant: a corrupt/unreadable/empty persisted Tier-1
 * table must never be combined with an incremental last-sync watermark.
 *
 * Uses the REAL upstream ObservablePersistSqlite over an in-memory kv store
 * that can simulate the expo-sqlite 16.0.10 web WorkerChannel bug (sync
 * reads truncated to `length & 0xFF` bytes) and read failures.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { observable, when } from '@legendapp/state';
import { syncObservable, type ObservablePersistPlugin } from '@legendapp/state/sync';
import { observablePersistSqlite } from '@legendapp/state/persist-plugins/expo-sqlite';

const mockLarge = jest.fn();
const mockReset = jest.fn();
jest.mock('../telemetry', () => ({
  recordPersistValueLarge: (...a: unknown[]) => mockLarge(...a),
  recordPersistWatermarkReset: (...a: unknown[]) => mockReset(...a),
}));

import {
  guardPersistPlugin,
  guardStorage,
  LARGE_VALUE_WARN_BYTES,
  type SyncKvStorage,
} from '../persistGuard';

type ReadMode = 'ok' | 'truncate-length-byte' | 'throw';

class FakeKv implements SyncKvStorage {
  map = new Map<string, string>();
  readMode: ReadMode = 'ok';
  getItemSync(key: string): string | null {
    const v = this.map.get(key) ?? null;
    if (v === null || key.endsWith('__m')) return v;
    if (this.readMode === 'throw') throw new Error('result too large for sync channel');
    // The bug: only the low byte of the length survived.
    if (this.readMode === 'truncate-length-byte') return v.slice(0, v.length & 0xff);
    return v;
  }
  setItemSync(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItemSync(key: string): void {
    this.map.delete(key);
  }
}

const TABLE = 'tier1/user-1/trips';
const CONFIG = { name: TABLE };

function makeRows(n: number): Record<string, { id: string; name: string }> {
  const out: Record<string, { id: string; name: string }> = {};
  for (let i = 0; i < n; i++) out[`id-${i}`] = { id: `id-${i}`, name: `Trip number ${i}` };
  return out;
}

function seed(kv: FakeKv, table: unknown, metadata: unknown): void {
  kv.map.set(TABLE, JSON.stringify(table));
  kv.map.set(`${TABLE}__m`, JSON.stringify(metadata));
}

function makePlugin(kv: FakeKv): ObservablePersistPlugin {
  const storage = guardStorage(kv);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake kv vs nominal SQLiteStorage param
  return guardPersistPlugin(observablePersistSqlite(storage as any), storage);
}

beforeEach(() => {
  mockLarge.mockClear();
  mockReset.mockClear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('guardPersistPlugin — watermark reset invariant', () => {
  it('keeps lastSync when the table loads fine', () => {
    const kv = new FakeKv();
    seed(kv, makeRows(20), { lastSync: 1000 });
    const p = makePlugin(kv);
    expect(Object.keys(p.getTable(TABLE, {}, CONFIG) as object)).toHaveLength(20);
    expect(p.getMetadata(TABLE, CONFIG).lastSync).toBe(1000);
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('drops lastSync (keeps pending) when the table value is truncated/unparseable — the 2026-09-29 web bug', () => {
    const kv = new FakeKv();
    const pending = { 'id-1': { p: ['id-1'], t: [], v: { name: 'offline edit' } } };
    seed(kv, makeRows(33), { lastSync: 1000, pending });
    kv.readMode = 'truncate-length-byte';
    const p = makePlugin(kv);

    expect(p.getTable(TABLE, {}, CONFIG)).toBeUndefined();
    const md = p.getMetadata(TABLE, CONFIG);
    expect(md.lastSync).toBeUndefined();
    expect(md.pending).toEqual(pending); // offline write queue survives
    // Removal is persisted so it can't come back on the next cold start.
    expect(JSON.parse(kv.map.get(`${TABLE}__m`)!)).toEqual({ pending });
    expect(mockReset).toHaveBeenCalledWith('trips', 'unparseable', expect.any(String));
  });

  it('drops lastSync when the read throws (e.g. value above the 1 MiB web channel)', () => {
    const kv = new FakeKv();
    seed(kv, makeRows(5), { lastSync: 1000 });
    kv.readMode = 'throw';
    const p = makePlugin(kv);
    p.getTable(TABLE, {}, CONFIG);
    expect(p.getMetadata(TABLE, CONFIG).lastSync).toBeUndefined();
    expect(mockReset).toHaveBeenCalledWith('trips', 'unreadable', 'result too large for sync channel');
  });

  it('drops lastSync when the table is missing but the watermark is present', () => {
    const kv = new FakeKv();
    kv.map.set(`${TABLE}__m`, JSON.stringify({ lastSync: 1000 }));
    const p = makePlugin(kv);
    p.getTable(TABLE, {}, CONFIG);
    expect(p.getMetadata(TABLE, CONFIG).lastSync).toBeUndefined();
    expect(mockReset).toHaveBeenCalledWith('trips', 'empty', undefined);
  });

  it('drops lastSync when the table is an empty object', () => {
    const kv = new FakeKv();
    seed(kv, {}, { lastSync: 1000 });
    const p = makePlugin(kv);
    p.getTable(TABLE, {}, CONFIG);
    expect(p.getMetadata(TABLE, CONFIG).lastSync).toBeUndefined();
  });

  it('is order-independent (getMetadata before getTable)', () => {
    const kv = new FakeKv();
    seed(kv, makeRows(33), { lastSync: 1000 });
    kv.readMode = 'truncate-length-byte';
    const p = makePlugin(kv);
    expect(p.getMetadata(TABLE, CONFIG).lastSync).toBeUndefined();
  });

  it('does nothing when there is no watermark (fresh install)', () => {
    const kv = new FakeKv();
    const p = makePlugin(kv);
    expect(p.getTable(TABLE, {}, CONFIG)).toEqual({});
    p.getMetadata(TABLE, CONFIG);
    expect(mockReset).not.toHaveBeenCalled();
    expect(kv.map.has(`${TABLE}__m`)).toBe(false);
  });

  it('end-to-end: syncObservable pulls with lastSync undefined after a corrupt load', async () => {
    const kv = new FakeKv();
    seed(kv, makeRows(33), { lastSync: 1000 });
    kv.readMode = 'truncate-length-byte';
    const plugin = makePlugin(kv);

    const seen: Array<number | undefined> = [];
    const obs$ = observable<Record<string, { id: string; name: string }>>();
    const state$ = syncObservable(obs$, {
      persist: { name: TABLE, plugin },
      get: ({ lastSync }: { lastSync?: number }) => {
        seen.push(lastSync);
        return makeRows(33);
      },
    });
    obs$.get(); // activate
    await when(state$.isLoaded);
    expect(seen).toEqual([undefined]); // FULL pull, not "changed since 1000"
    expect(Object.keys(obs$.peek() ?? {})).toHaveLength(33);
  });

  it('end-to-end control: a healthy load pulls incrementally with the stored lastSync', async () => {
    const kv = new FakeKv();
    seed(kv, makeRows(33), { lastSync: 1000 });
    const plugin = makePlugin(kv);
    const seen: Array<number | undefined> = [];
    const obs$ = observable<Record<string, { id: string; name: string }>>();
    const state$ = syncObservable(obs$, {
      persist: { name: TABLE, plugin },
      get: ({ lastSync }: { lastSync?: number }) => {
        seen.push(lastSync);
        return {};
      },
    });
    obs$.get();
    await when(state$.isLoaded);
    expect(seen).toEqual([1000]);
  });
});

describe('guardStorage — size breadcrumb', () => {
  it('breadcrumbs once per key when a table value exceeds 512 KiB, never for metadata', () => {
    const kv = new FakeKv();
    const s = guardStorage(kv);
    const big = 'x'.repeat(LARGE_VALUE_WARN_BYTES + 1);
    s.setItemSync(TABLE, big);
    s.setItemSync(TABLE, big);
    s.setItemSync(`${TABLE}__m`, big);
    s.setItemSync('tier1/user-1/trip_places', 'small');
    expect(mockLarge).toHaveBeenCalledTimes(1);
    expect(mockLarge).toHaveBeenCalledWith('trips', LARGE_VALUE_WARN_BYTES + 1, expect.any(Number));
    expect(kv.map.get(TABLE)).toBe(big); // write still goes through
  });
});
