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
/** syncObservable call index that throws once (simulates attachEntity failing partway). */
let mockThrowAtCall: number | null = null;
let mockSyncObservableCalls = 0;
let mockResolvePersistence: ((v: unknown) => void) | null = null;
const mockCreateSyncPersistence = jest.fn(
  () =>
    new Promise((resolve) => {
      mockResolvePersistence = resolve;
    }),
);

jest.mock('@legendapp/state/sync', () => ({
  syncObservable: jest.fn(() => {
    const call = mockSyncObservableCalls++;
    if (mockThrowAtCall === call) {
      mockThrowAtCall = null;
      throw new Error('attach failed (test)');
    }
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
jest.mock('../flags', () => ({
  loadTier1SyncFlag: jest.fn(async () => true),
  isTier1SyncEnabled: () => true,
}));
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
type MutationsModule = typeof import('../mutations');

function load(): {
  hydrate: HydrateModule;
  telemetry: TelemetryModule;
  store: StoreModule;
  mutations: MutationsModule;
} {
  let hydrate!: HydrateModule;
  let telemetry!: TelemetryModule;
  let store!: StoreModule;
  let mutations!: MutationsModule;
  jest.isolateModules(() => {
    hydrate = require('../hydrate');
    telemetry = require('../telemetry');
    store = require('../store');
    mutations = require('../mutations');
  });
  return { hydrate, telemetry, store, mutations };
}

const OK_PERSISTENCE = { plugin: undefined, degraded: true, reason: 'test: in-memory' };

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  mockSyncStates.length = 0;
  mockThrowAtCall = null;
  mockSyncObservableCalls = 0;
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

describe('initTier1Sync: partial-attach idempotency (X2.5 reviewer follow-up a)', () => {
  it('a boot that throws mid-attach is retried without re-attaching the roots it already bound', async () => {
    const { hydrate, store } = load();
    mockThrowAtCall = 3; // roots 0..2 attach, root 3 throws
    const first = hydrate.initTier1Sync({ userId: 'u1' });
    await flush();
    mockResolvePersistence!(OK_PERSISTENCE);
    await expect(first).rejects.toThrow('attach failed (test)');
    expect(mockSyncStates).toHaveLength(3);
    expect(hydrate.isTier1SyncInitialized()).toBe(false);

    // Retry: the warm-up is cached (no second DB open), roots 0..2 are skipped.
    await expect(hydrate.initTier1Sync({ userId: 'u1' })).resolves.toEqual({
      started: true,
      degraded: true,
    });
    expect(mockCreateSyncPersistence).toHaveBeenCalledTimes(1);
    expect(mockSyncStates).toHaveLength(store.TIER1_STORE_KEYS.length); // each root exactly once
    expect(mockSyncObservableCalls).toBe(store.TIER1_STORE_KEYS.length + 1); // + the one that threw
  });

  it('a partial attach stays bound to its user: a different user is told to restart', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { hydrate, telemetry } = load();
    mockThrowAtCall = 2;
    const first = hydrate.initTier1Sync({ userId: 'u1' });
    await flush();
    mockResolvePersistence!(OK_PERSISTENCE);
    await expect(first).rejects.toThrow();
    await expect(hydrate.initTier1Sync({ userId: 'u2' })).resolves.toEqual({
      started: false,
      degraded: false,
    });
    expect(telemetry.getSyncTelemetry().restartRequired).toBe(true);
    expect(mockSyncStates).toHaveLength(2); // nothing new attached for u2
  });
});

describe('initTier1Sync: account switch (X2.5 reviewer follow-up b)', () => {
  it('A signs out mid-boot, B signs in mid-boot → B gets a clean Tier-1 boot (nothing bound to A)', async () => {
    const { hydrate, store, telemetry } = load();
    const a = hydrate.initTier1Sync({ userId: 'userA' });
    await flush();
    hydrate.teardownTier1Sync(); // A signs out during the warm-up
    const b = hydrate.initTier1Sync({ userId: 'userB' });
    await flush();
    mockResolvePersistence!(OK_PERSISTENCE);
    await expect(a).resolves.toEqual({ started: false, degraded: true });
    await expect(b).resolves.toEqual({ started: true, degraded: true });

    expect(hydrate.getTier1SyncUserId()).toBe('userB');
    expect(mockCreateSyncPersistence).toHaveBeenCalledTimes(1); // warm-up reused
    expect(mockSyncStates).toHaveLength(store.TIER1_STORE_KEYS.length); // ONE attach set (B's)
    expect(telemetry.getSyncTelemetry().restartRequired).toBe(false);
  });

  it('A fully booted, signs out, B signs in → restart required, telemetered, and A\'s store is never served', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { hydrate, store, telemetry, mutations } = load();
    const a = hydrate.initTier1Sync({ userId: 'userA' });
    await flush();
    mockResolvePersistence!(OK_PERSISTENCE);
    await a;
    // A's hydrated data sits in the (undetachable) store.
    store.tier1Store$.trips.set({ tA: { id: 'tA', title: 'A private trip' } } as never);
    store.tier1Store$.tripExpenses.set({ eA: { id: 'eA', trip_id: 'tA', amount: 1 } } as never);
    for (const s of mockSyncStates) s.assign({ isLoaded: true, isGetting: false });
    expect(mutations.isTier1SyncActive()).toBe(true);

    hydrate.teardownTier1Sync();
    await expect(hydrate.initTier1Sync({ userId: 'userB' })).resolves.toEqual({
      started: false,
      degraded: false,
    });

    // Explicit state…
    expect(telemetry.getSyncTelemetry().restartRequired).toBe(true);
    expect(telemetry.getSyncTelemetry().enabled).toBe(false);
    // …and every read/write facade gate stays closed for B, so A's rows —
    // though still in memory — can never be served or written through.
    expect(hydrate.isTier1SyncInitialized()).toBe(false);
    expect(hydrate.getTier1SyncUserId()).toBeNull();
    expect(mutations.isTier1SyncActive()).toBe(false);
    expect(() => mutations.updateExpense('eA', { amount: 2 })).toThrow(/not active/);
    expect(() => mutations.createPackingItems('tA', [{ label: 'x' }])).toThrow(/not active/);

    // A signing back in clears the flag and resumes.
    await hydrate.initTier1Sync({ userId: 'userA' });
    expect(telemetry.getSyncTelemetry().restartRequired).toBe(false);
    expect(mutations.isTier1SyncActive()).toBe(true);
  });
});

describe('tier1RootLoaded$ (X2.5 child-root serving signal)', () => {
  it('flips per root when that root\'s first remote load completes, even with zero rows', async () => {
    const { hydrate, store } = load();
    const p = hydrate.initTier1Sync({ userId: 'u1' });
    await flush();
    mockResolvePersistence!(OK_PERSISTENCE);
    await p;
    const idx = store.TIER1_STORE_KEYS.indexOf('tripExpenses');
    expect(hydrate.tier1RootLoaded$.tripExpenses.peek()).toBe(false);
    mockSyncStates[idx]!.assign({ isLoaded: true, isGetting: false });
    expect(hydrate.tier1RootLoaded$.tripExpenses.peek()).toBe(true);
    expect(hydrate.tier1RootLoaded$.tripPackingItems.peek()).toBe(false);
  });
});
