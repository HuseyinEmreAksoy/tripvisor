/**
 * persistence.web.ts — S2.8.13 blocker B1 (landed in X1.3).
 *
 * The synchronous probe used to race expo-sqlite's worker boot and threw
 * "Sync operation timeout" on every cold load. The factory now awaits ONE
 * async op first (boots worker + wasm + OPFS with no sync deadline), bounded
 * by a timeout, and only then runs the sync probe.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockCalls: string[] = [];
let mockGetItemAsync: () => Promise<string | null>;
let mockGetItemSync: () => string | null;

jest.mock('expo-sqlite/kv-store', () => ({
  SQLiteStorage: jest.fn().mockImplementation(() => ({
    getItemAsync: () => {
      mockCalls.push('async');
      return mockGetItemAsync();
    },
    getItemSync: () => {
      mockCalls.push('sync');
      return mockGetItemSync();
    },
  })),
}));
jest.mock('@legendapp/state/persist-plugins/expo-sqlite', () => ({
  observablePersistSqlite: jest.fn(() => ({ __plugin: true })),
}));

import { createSyncPersistence } from '../persistence.web';

beforeEach(() => {
  mockCalls.length = 0;
  mockGetItemAsync = async () => null;
  mockGetItemSync = () => null;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('createSyncPersistence (web)', () => {
  it('warms the worker asynchronously BEFORE the sync probe, then attaches', async () => {
    let resolveWarmup!: (v: string | null) => void;
    mockGetItemAsync = () =>
      new Promise((r) => {
        resolveWarmup = r;
      });
    const p = createSyncPersistence();
    await Promise.resolve();
    expect(mockCalls).toEqual(['async']); // sync probe must wait for the warm-up
    resolveWarmup(null);
    const result = await p;
    expect(mockCalls).toEqual(['async', 'sync']);
    expect(result.degraded).toBe(false);
    expect(result.reason).toBeNull();
    // The upstream plugin is wrapped by persistGuard (watermark-reset guard).
    expect(typeof result.plugin?.getTable).toBe('function');
    expect(typeof result.plugin?.getMetadata).toBe('function');
  });

  it('degrades with a clear reason when the warm-up never finishes', async () => {
    jest.useFakeTimers();
    mockGetItemAsync = () => new Promise(() => {}); // wedged worker
    const p = createSyncPersistence();
    await jest.advanceTimersByTimeAsync(6000);
    const result = await p;
    expect(result.degraded).toBe(true);
    expect(result.plugin).toBeUndefined();
    expect(result.reason).toMatch(/warm-up timed out/);
    expect(mockCalls).toEqual(['async']); // never probed sync
  });

  it('degrades (never throws) when the warm-up rejects', async () => {
    mockGetItemAsync = async () => {
      throw new Error('OPFS unavailable');
    };
    const result = await createSyncPersistence();
    expect(result.degraded).toBe(true);
    expect(result.reason).toMatch(/OPFS unavailable/);
  });

  it('degrades when the sync channel still fails after warm-up', async () => {
    mockGetItemSync = () => {
      throw new Error('Sync operation timeout');
    };
    const result = await createSyncPersistence();
    expect(result.degraded).toBe(true);
    expect(result.reason).toMatch(/Sync operation timeout/);
  });

  it('skips the worker entirely without SharedArrayBuffer', async () => {
    const sab = globalThis.SharedArrayBuffer;
    // @ts-expect-error -- simulate a non-cross-origin-isolated page
    delete globalThis.SharedArrayBuffer;
    try {
      const result = await createSyncPersistence();
      expect(result.degraded).toBe(true);
      expect(result.reason).toMatch(/SharedArrayBuffer unavailable/);
      expect(mockCalls).toEqual([]);
    } finally {
      globalThis.SharedArrayBuffer = sab;
    }
  });
});
