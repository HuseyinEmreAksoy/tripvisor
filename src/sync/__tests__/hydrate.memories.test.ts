/**
 * M5 Y2.1 — hydrate.ts wiring of the memory roots (0036 SYNC CONTRACT):
 *   - the pull is filtered to author_id = <session user> (own rows only);
 *   - the realtime channel is filtered the same way (RLS alone would push
 *     other members' SHARED rows, which could never be evicted after an
 *     un-share → ghost rows);
 *   - a foreign row that still reaches the boundary is dropped (network:
 *     tombstone stub; disk: skipped);
 *   - trip_photos gets read+update only (rows are born in the upload queue);
 *     journal/reviews read+create+update; non-memory roots unchanged.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type Cfg = Record<string, unknown> & {
  collection: string;
  actions: string[];
  realtime: unknown;
  filter?: (q: { eq: (c: string, v: string) => unknown }) => unknown;
  transform: { load: (row: Record<string, unknown>) => Record<string, unknown> };
  persist?: { transform: { load: (v: Record<string, Record<string, unknown>>) => Record<string, unknown> } };
};

const mockConfigs: Cfg[] = [];

jest.mock('@legendapp/state/sync', () => ({
  syncObservable: jest.fn((_obs: unknown, cfg: Cfg) => {
    mockConfigs.push(cfg);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { observable } = require('@legendapp/state');
    return observable({ isLoaded: false, isGetting: false });
  }),
}));
jest.mock('@legendapp/state/sync-plugins/supabase', () => ({ syncedSupabase: jest.fn((cfg: unknown) => cfg) }));
jest.mock('../../api/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/sentry', () => ({ Sentry: { addBreadcrumb: jest.fn() } }));
jest.mock('../flags', () => ({ loadTier1SyncFlag: jest.fn(async () => true), isTier1SyncEnabled: () => true }));
jest.mock('../persistence', () => ({
  // A (fake) real plugin, so the persist config — and its disk transform — is attached.
  createSyncPersistence: async () => ({ plugin: { fake: true }, degraded: false }),
}));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => {}) },
}));

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';

async function boot(): Promise<Record<string, Cfg>> {
  mockConfigs.length = 0;
  let hydrate!: typeof import('../hydrate');
  jest.isolateModules(() => {
    hydrate = require('../hydrate');
  });
  jest.spyOn(console, 'info').mockImplementation(() => {});
  const res = await hydrate.initTier1Sync({ userId: ME });
  expect(res.started).toBe(true);
  return Object.fromEntries(mockConfigs.map((c) => [c.collection, c]));
}

let byTable: Record<string, Cfg>;
beforeEach(async () => {
  byTable = await boot();
});

describe('memory roots are author-scoped', () => {
  it.each(['trip_journal_entries', 'trip_place_reviews', 'trip_photos'])('%s: pull filter author_id = session user', (t) => {
    const cfg = byTable[t]!;
    const calls: Array<[string, string]> = [];
    const q = { eq: (c: string, v: string) => (calls.push([c, v]), q) };
    expect(typeof cfg.filter).toBe('function');
    cfg.filter!(q);
    expect(calls).toEqual([['author_id', ME]]);
  });

  it.each(['trip_journal_entries', 'trip_place_reviews', 'trip_photos'])('%s: realtime channel filtered to the author', (t) => {
    expect(byTable[t]!.realtime).toEqual({ filter: `author_id=eq.${ME}` });
  });

  it('non-memory roots are NOT author-filtered (RLS scoping as before)', () => {
    for (const t of ['trips', 'trip_places', 'trip_place_comments', 'trip_expenses']) {
      expect(byTable[t]!.filter).toBeUndefined();
      expect(byTable[t]!.realtime).toBe(true);
    }
  });

  it('actions: photos read+update (born in the upload queue), journal/reviews read+create+update', () => {
    expect(byTable['trip_photos']!.actions).toEqual(['read', 'update']);
    expect(byTable['trip_journal_entries']!.actions).toEqual(['read', 'create', 'update']);
    expect(byTable['trip_place_reviews']!.actions).toEqual(['read', 'create', 'update']);
    expect(byTable['trip_days']!.actions).toEqual(['read']);
  });

  it('network load: own rows pass (sanitized); a foreign row becomes a tombstone stub (dropped)', () => {
    const load = byTable['trip_journal_entries']!.transform.load;
    expect(load({ id: 'j1', trip_id: 't', author_id: ME, day_index: 0, body: 'hi', visibility: 'only_me', deleted: false, junk: 1 })).toEqual({
      id: 'j1',
      trip_id: 't',
      author_id: ME,
      day_index: 0,
      body: 'hi',
      visibility: 'only_me',
      deleted: false,
    });
    expect(load({ id: 'j2', trip_id: 't', author_id: OTHER, body: 'shared by a friend', visibility: 'trip', deleted: false })).toEqual({
      id: 'j2',
      deleted: true,
    });
  });

  it('disk load: a foreign row persisted by an older build is skipped entirely', () => {
    const diskLoad = byTable['trip_photos']!.persist!.transform.load;
    const out = diskLoad({
      mine: { id: 'mine', author_id: ME, trip_id: 't', status: 'ready', deleted: false },
      theirs: { id: 'theirs', author_id: OTHER, trip_id: 't', status: 'ready', deleted: false },
    });
    expect(Object.keys(out)).toEqual(['mine']);
  });
});
