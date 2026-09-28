/**
 * hydrate.ts boot + telemetry stamping (S2.8.13 B1/B2, landed in X1.3).
 *
 * The Legend-State sync plugin is mocked: each syncObservable() call returns
 * a real observable sync-state ({ isLoaded, isGetting }) the test drives by
 * hand, so we can assert exactly what the engine does around it:
 *   - B1: the async persistence warm-up means initTier1Sync awaits — two
 *     concurrent same-user calls must share ONE boot (one persistence
 *     factory call, one attach per root).
 *   - sign-out during the warm-up must not activate the engine.
 *   - B2: a root whose first pull returns ZERO rows still gets lastSyncAt
 *     stamped (isLoaded false→true), so the pill can reach "Synced".
 *   - a persisted cold-start load (before the first remote load) updates
 *     row counts but does not claim a sync.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Observable } from '@legendapp/state';

type SyncStateMock = Observable<{ isLoaded: boolean; isGetting: boolean }>;

const mockSyncStates: SyncStateMock[] = [];
let mockResolvePersistence: ((v: unknown) => void) | null = null;
const mockCreateSyncPersistence = jest.fn(
  () =>
    new Promise((resolve) => {
      mockResolvePersistence = resolve;
    }),
);

jest.mock('@legendapp/state/sync', () => ({
  syncObservable: jest.fn(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { observable: obs } = require('@legendapp/state');
    const s = obs({ isLoaded: false, isGetting: true });
    mockSyncStates.push(s);
    return s;
  }),
}));
jest.mock('@legendapp/state/sync-plugins/supabase', () => ({
  syncedSupabase: jest.fn((cfg: unknown) => cfg),
}));
jest.mock('../../api/supabase', () => ({ supabase: {} }));
// @sentry/react-native starts a module-level interval; re-required per
// isolateModules it would keep jest alive.
jest.mock('../../lib/sentry', () => ({ Sentry: { addBreadcrumb: jest.fn() } }));
jest.mock('../flags', () => ({ loadTier1SyncFlag: jest.fn(async () => true) }));
jest.mock('../persistence', () => ({
  createSyncPersistence: () => mockCreateSyncPersistence(),
}));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => {}) },
}));

type HydrateModule = typeof import('../hydrate');
type TelemetryModule = typeof import('../telemetry');
type StoreModule = typeof import('../store');

function load(): { hydrate: HydrateModule; telemetry: TelemetryModule; store: StoreModule } {
  let hydrate!: HydrateModule;
  let telemetry!: TelemetryModule;
  let store!: StoreModule;
  jest.isolateModules(() => {
    hydrate = require('../hydrate');
    telemetry = require('../telemetry');
    store = require('../store');
  });
  return { hydrate, telemetry, store };
}

const OK_PERSISTENCE = { plugin: undefined, degraded: true, reason: 'test: in-memory' };

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  mockSyncStates.length = 0;
  mockResolvePersistence = null;
  mockCreateSyncPersistence.mockClear();
  jest.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('initTier1Sync — async boot (B1)', () => {
  it('concurrent same-user calls share one boot', async () => {
    const { hydrate, store } = load();
    const a = hydrate.initTier1Sync({ userId: 'u1' });
    const b = hydrate.initTier1Sync({ userId: 'u1' });
    await flush();
    expect(mockCreateSyncPersistence).toHaveBeenCalledTimes(1);
    expect(hydrate.isTier1SyncInitialized()).toBe(false); // still warming up

    mockResolvePersistence!(OK_PERSISTENCE);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual({ started: true, degraded: true });
    expect(rb).toEqual(ra);
    // one syncObservable per root — not doubled
    expect(mockSyncStates).toHaveLength(store.TIER1_STORE_KEYS.length);
    expect(hydrate.isTier1SyncInitialized()).toBe(true);

    // a later call takes the resume path: no second boot
    await expect(hydrate.initTier1Sync({ userId: 'u1' })).resolves.toEqual({
      started: true,
      degraded: true,
    });
    expect(mockCreateSyncPersistence).toHaveBeenCalledTimes(1);
  });

  it('a different user mid-boot gets started:false and no attach', async () => {
    const { hydrate, store } = load();
    const a = hydrate.initTier1Sync({ userId: 'u1' });
    await flush();
    await expect(hydrate.initTier1Sync({ userId: 'u2' })).resolves.toEqual({
      started: false,
      degraded: false,
    });
    mockResolvePersistence!(OK_PERSISTENCE);
    await a;
    expect(mockSyncStates).toHaveLength(store.TIER1_STORE_KEYS.length);
    expect(hydrate.getTier1SyncUserId()).toBe('u1');
  });

  it('sign-out during the warm-up does not activate the engine; same-user sign-in resumes', async () => {
    const { hydrate, telemetry } = load();
    const a = hydrate.initTier1Sync({ userId: 'u1' });
    await flush();
    hydrate.teardownTier1Sync();
    mockResolvePersistence!(OK_PERSISTENCE);
    await expect(a).resolves.toEqual({ started: false, degraded: true });
    expect(hydrate.isTier1SyncInitialized()).toBe(false);
    expect(telemetry.getSyncTelemetry().enabled).toBe(false);

    await expect(hydrate.initTier1Sync({ userId: 'u1' })).resolves.toEqual({
      started: true,
      degraded: true,
    });
    expect(hydrate.isTier1SyncInitialized()).toBe(true);
    expect(telemetry.getSyncTelemetry().enabled).toBe(true);
    expect(mockCreateSyncPersistence).toHaveBeenCalledTimes(1);
  });

  it('sign-out then same-user sign-in re-enables the status surface', async () => {
    const { hydrate, telemetry } = load();
    const a = hydrate.initTier1Sync({ userId: 'u1' });
    await flush();
    mockResolvePersistence!(OK_PERSISTENCE);
    await a;
    hydrate.teardownTier1Sync();
    expect(telemetry.getSyncTelemetry().enabled).toBe(false);
    await hydrate.initTier1Sync({ userId: 'u1' });
    expect(telemetry.getSyncTelemetry().enabled).toBe(true);
  });
});

describe('lastSyncAt stamping (B2)', () => {
  async function boot() {
    const mods = load();
    const p = mods.hydrate.initTier1Sync({ userId: 'u1' });
    await flush();
    mockResolvePersistence!(OK_PERSISTENCE);
    await p;
    return mods;
  }

  it('empty roots reach "Synced" once every first pull completes', async () => {
    const { telemetry, store } = await boot();
    expect(telemetry.getSyncTelemetry().lastSyncAgeMs).toBeNull();

    // Only trips has data; every other root's pull returns zero rows, so the
    // store observable never changes for them.
    store.tier1Store$.trips.set({ t1: { id: 't1' } } as never);
    for (const s of mockSyncStates) s.assign({ isLoaded: true, isGetting: false });

    const snap = telemetry.getSyncTelemetry();
    expect(snap.lastSyncAgeMs).not.toBeNull();
    expect(snap.entities.trips.rowCount).toBe(1);
    expect(snap.entities.trip_days.rowCount).toBe(0);
    expect(snap.entities.trip_days.lastSyncAt).not.toBeNull();
  });

  it('a stays-empty root is not stamped before its pull completes', async () => {
    const { telemetry } = await boot();
    mockSyncStates.slice(1).forEach((s) => s.assign({ isLoaded: true, isGetting: false }));
    expect(telemetry.getSyncTelemetry().lastSyncAgeMs).toBeNull();
  });

  it('a persisted cold-start load counts rows but does not claim a sync', async () => {
    const { telemetry, store } = await boot();
    store.tier1Store$.trips.set({ t1: { id: 't1' }, t2: { id: 't2' } } as never);
    const e = telemetry.getSyncTelemetry().entities.trips;
    expect(e.rowCount).toBe(2);
    expect(e.lastSyncAt).toBeNull();
  });

  it('later pulls (isGetting true→false) re-stamp an empty root', async () => {
    const { telemetry } = await boot();
    const days = mockSyncStates[2]!; // tripDays (TABLE_FOR_KEY order)
    days.assign({ isLoaded: true, isGetting: false });
    const first = telemetry.getSyncTelemetry().entities.trip_days.lastSyncAt!;
    const now = jest.spyOn(Date, 'now').mockReturnValue(first + 60_000);
    days.isGetting.set(true);
    days.isGetting.set(false);
    expect(telemetry.getSyncTelemetry().entities.trip_days.lastSyncAt).toBe(first + 60_000);
    now.mockRestore();
  });
});
