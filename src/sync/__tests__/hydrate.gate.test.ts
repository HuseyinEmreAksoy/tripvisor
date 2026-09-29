/**
 * F11 fixes in hydrate.ts:
 *   - F11-2: the plugin talks through a client GATED to the root's user, so
 *     after sign-out (and with a different user signed in) pulls/writes
 *     never reach the network and realtime events are dropped; teardown
 *     disables every root (unsubscribing realtime) and a same-user resume
 *     re-enables it.
 *   - F11-4: every root (read-only ones too) gets the infinite retry policy.
 *   - F11-3: a drained write queue (numPendingSets → 0) clears writeErrorCount;
 *     network-class errors never count as write failures.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Observable } from '@legendapp/state';

type Cfg = {
  collection: string;
  retry?: unknown;
  supabase: {
    from: (t: string) => unknown;
    channel: (name: string) => { on: (type: string, filter: unknown, cb: (p: unknown) => void) => unknown };
  };
};
type StateMock = Observable<{ isLoaded: boolean; isGetting: boolean; isSyncEnabled: boolean; numPendingSets: number; sync: () => void }>;

const mockConfigs: Cfg[] = [];
const mockStates: StateMock[] = [];
const mockSyncCalls: number[] = [];
const mockHandlers: Array<(p: unknown) => void> = [];
const mockFrom = jest.fn((t: string) => ({ table: t }));

jest.mock('@legendapp/state/sync', () => ({
  syncObservable: jest.fn((_obs: unknown, cfg: Cfg) => {
    mockConfigs.push(cfg);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { observable: obs } = require('@legendapp/state');
    const idx = mockStates.length;
    const s = obs({
      isLoaded: false,
      isGetting: true,
      isSyncEnabled: true,
      numPendingSets: 0,
      sync: () => {
        mockSyncCalls.push(idx);
      },
    });
    mockStates.push(s);
    return s;
  }),
}));
jest.mock('@legendapp/state/sync-plugins/supabase', () => ({ syncedSupabase: jest.fn((cfg: unknown) => cfg) }));
jest.mock('../../api/supabase', () => ({
  supabase: {
    from: (t: string) => mockFrom(t),
    schema: jest.fn(),
    channel: jest.fn(() => {
      const ch = {
        on: (_type: string, _filter: unknown, cb: (p: unknown) => void) => {
          mockHandlers.push(cb);
          return ch;
        },
        subscribe: () => ch,
      };
      return ch;
    }),
  },
}));
jest.mock('../../lib/sentry', () => ({ Sentry: { addBreadcrumb: jest.fn() } }));
jest.mock('../flags', () => ({ loadTier1SyncFlag: jest.fn(async () => true), isTier1SyncEnabled: () => true }));
jest.mock('../persistence', () => ({
  createSyncPersistence: async () => ({ plugin: undefined, degraded: true, reason: 'test' }),
}));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => {}) },
}));

type HydrateModule = typeof import('../hydrate');
type TelemetryModule = typeof import('../telemetry');

function load(): { hydrate: HydrateModule; telemetry: TelemetryModule } {
  let hydrate!: HydrateModule;
  let telemetry!: TelemetryModule;
  jest.isolateModules(() => {
    hydrate = require('../hydrate');
    telemetry = require('../telemetry');
  });
  return { hydrate, telemetry };
}

beforeEach(() => {
  mockConfigs.length = 0;
  mockStates.length = 0;
  mockSyncCalls.length = 0;
  mockHandlers.length = 0;
  mockFrom.mockClear();
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('F11-4: retry policy', () => {
  it('every root, read-only ones included, retries gets with backoff', async () => {
    const { hydrate } = load();
    await hydrate.initTier1Sync({ userId: 'u1' });
    expect(mockConfigs.length).toBeGreaterThan(0);
    for (const cfg of mockConfigs) {
      expect(cfg.retry).toEqual({ infinite: true, backoff: 'exponential', maxDelay: 30000 });
    }
    const days = mockConfigs.find((c) => c.collection === 'trip_days');
    expect(days?.retry).toBeDefined();
  });
});

describe('F11-2: engine stops at teardown', () => {
  it('the gated client refuses network calls while inactive and resumes for the same user', async () => {
    const { hydrate } = load();
    await hydrate.initTier1Sync({ userId: 'userA' });
    const cfg = mockConfigs[0]!;

    expect(cfg.supabase.from('trips')).toEqual({ table: 'trips' });
    expect(mockFrom).toHaveBeenCalledTimes(1);

    hydrate.teardownTier1Sync();
    expect(() => cfg.supabase.from('trips')).toThrow(hydrate.TIER1_SYNC_INACTIVE_MESSAGE);

    // A different user signs in: A's roots stay inert (no request under B's JWT).
    await expect(hydrate.initTier1Sync({ userId: 'userB' })).resolves.toEqual({ started: false, degraded: false });
    expect(() => cfg.supabase.from('trips')).toThrow(hydrate.TIER1_SYNC_INACTIVE_MESSAGE);
    expect(mockFrom).toHaveBeenCalledTimes(1);

    await hydrate.initTier1Sync({ userId: 'userA' });
    expect(cfg.supabase.from('trips')).toEqual({ table: 'trips' });
  });

  it('realtime events are dropped while the engine is inactive for the root user', async () => {
    const { hydrate } = load();
    await hydrate.initTier1Sync({ userId: 'userA' });
    const received: unknown[] = [];
    mockConfigs[0]!.supabase.channel('LS_trips0').on('postgres_changes', {}, (p) => received.push(p));
    const handler = mockHandlers[0]!;

    handler({ eventType: 'INSERT', new: { id: 'a' } });
    expect(received).toHaveLength(1);

    hydrate.teardownTier1Sync();
    await hydrate.initTier1Sync({ userId: 'userB' }); // restart-required, inert
    handler({ eventType: 'INSERT', new: { id: 'b-private' } });
    expect(received).toHaveLength(1);
  });

  it('teardown disables every root and syncs (unsubscribe); resume re-enables', async () => {
    const { hydrate } = load();
    await hydrate.initTier1Sync({ userId: 'u1' });
    hydrate.teardownTier1Sync();
    for (const s of mockStates) expect(s.isSyncEnabled.peek()).toBe(false);
    expect(new Set(mockSyncCalls).size).toBe(mockStates.length);

    await hydrate.initTier1Sync({ userId: 'u1' });
    for (const s of mockStates) expect(s.isSyncEnabled.peek()).toBe(true);
  });
});

describe('F11-3: write error counter', () => {
  it('clears when the root write queue drains', async () => {
    const { hydrate, telemetry } = load();
    await hydrate.initTier1Sync({ userId: 'u1' });
    const idx = mockConfigs.findIndex((c) => c.collection === 'trip_places');
    const places = mockStates[idx]!;
    places.numPendingSets.set(1);
    telemetry.recordWriteFailure('trip_places', new Error('new row violates row-level security policy'));
    telemetry.recordWriteFailure('trip_places', new Error('new row violates row-level security policy'));
    expect(telemetry.getSyncTelemetry().entities.trip_places.writeErrorCount).toBe(2);
    places.numPendingSets.set(0);
    expect(telemetry.getSyncTelemetry().entities.trip_places.writeErrorCount).toBe(0);
  });

  it('network-class errors (offline retries) are not counted', () => {
    const { telemetry } = load();
    for (const msg of ['TypeError: Network request failed', 'Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed']) {
      telemetry.recordWriteFailure('trip_places', new Error(msg));
    }
    telemetry.recordWriteFailure('trip_places', { status: 0, message: '' });
    expect(telemetry.getSyncTelemetry().entities.trip_places.writeErrorCount).toBe(0);
    expect(telemetry.isNetworkClassError(new Error('permission denied for table trips'))).toBe(false);
  });
});
