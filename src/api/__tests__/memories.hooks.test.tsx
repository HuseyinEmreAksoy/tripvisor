/**
 * M5 Y2.1 — the memories hooks (src/api/memories.ts): tier routing.
 *
 * Engine mocked down to its gate (active flag, session user, per-root
 * loaded signal); the Tier-1 store and src/sync/memories.ts are real; the
 * upload queue and the photo pipeline are fakes. Asserts:
 *   - Tier-1 serving → writes land in the store, no PostgREST call;
 *   - flag off → PostgREST with a client-minted id, private by default,
 *     never created_at / author_id / server-owned columns;
 *   - review upsert updates the existing live review instead of creating;
 *   - photo delete → tombstone + file deletion after the undo window + undo;
 *   - useAddPhotos re-encodes every asset (never the original) and queues it
 *     with the derived trip day;
 *   - useTripMemories merges own Tier-1 rows with others' shared Tier-2 rows.
 */
import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── mocks (hoisted) ──────────────────────────────────────────────────────
let mockActive = false;
const mockUser = '11111111-1111-4111-8111-111111111111';
const mockCalls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
const mockRows: Record<string, unknown[]> = {};

jest.mock('../supabase', () => {
  const makeChain = (table: string) => {
    const rec = { table, ops: [] as Array<[string, unknown[]]> };
    mockCalls.push(rec);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'insert', 'update', 'delete', 'limit', 'single', 'maybeSingle']) {
      chain[m] = (...args: unknown[]) => {
        rec.ops.push([m, args]);
        return chain;
      };
    }
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: mockRows[table] ?? [], error: null });
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => makeChain(table),
      rpc: async () => ({ data: null, error: { message: 'offline' } }),
      auth: { getSession: async () => ({ data: { session: { user: { id: mockUser } } } }) },
      storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
    },
  };
});

jest.mock('@/sync/hydrate', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { observable } = require('@legendapp/state');
  return {
    tier1RootLoaded$: observable({
      trips: false,
      tripPlaces: false,
      tripDays: false,
      tripExpenses: false,
      tripAccommodations: false,
      tripPlaceReactions: false,
      tripPlaceComments: false,
      tripPackingItems: false,
      tripJournalEntries: false,
      tripPlaceReviews: false,
      tripPhotos: false,
    }),
    isTier1SyncInitialized: () => mockActive,
    getTier1SyncUserId: () => (mockActive ? mockUser : null),
    resyncTier1: jest.fn(),
  };
});
jest.mock('@/sync/flags', () => ({ isTier1SyncEnabled: () => true, loadTier1SyncFlag: async () => true }));
jest.mock('../trip-places', () => ({ useTripPlaces: () => ({ data: [] }) }));

const mockQueue = {
  snapshot: { userId: mockUser, jobs: [] as unknown[], pendingDeletions: 0, durable: true },
  enqueued: [] as Array<Record<string, unknown>>,
  deletions: [] as Array<{ photo: Record<string, unknown>; grace: number }>,
  cancelled: [] as string[],
  jobIds: new Set<string>(),
};
jest.mock('../memories.upload-queue', () => ({
  PHOTO_BUCKET: 'trip-memories',
  OBJECT_DELETE_GRACE_MS: 120000,
  onPhotoUploadSettled: () => () => undefined,
  getPhotoUploadQueue: () => ({
    getSnapshot: () => mockQueue.snapshot,
    subscribe: () => () => undefined,
    start: async () => undefined,
    enqueue: async (input: Record<string, unknown>) => {
      mockQueue.enqueued.push(input);
      return input['id'];
    },
    hasJob: (id: string) => mockQueue.jobIds.has(id),
    cancel: async (id: string) => void mockQueue.cancelled.push(id),
    scheduleObjectDeletion: (photo: Record<string, unknown>, grace: number) => void mockQueue.deletions.push({ photo, grace }),
    cancelObjectDeletion: () => true,
    updateQueuedJob: () => false,
  }),
}));

const mockPrepare = jest.fn(async (asset: { uri: string }) => {
  if (asset.uri.endsWith('.heic')) {
    const e = new Error('unsupported') as Error & { code: string };
    e.name = 'PhotoEncodeError';
    e.code = 'unsupported_image';
    throw e;
  }
  return {
    full: { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 1600, height: 1200, quality: 0.75 },
    thumb: { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 400, height: 300, quality: 0.7 },
    takenAt: new Date(2026, 6, 16, 10, 0).toISOString(),
  };
});
jest.mock('../../lib/photos/pipeline', () => ({ preparePhoto: (a: { uri: string }) => mockPrepare(a) }));

/* eslint-disable import/first */
import { tier1Store$ } from '@/sync/store';
import { tier1RootLoaded$ } from '@/sync/hydrate';
import { getSessionUndoStack, _resetSessionUndoStackForTests } from '@/sync/undo';
import {
  useAddPhotos,
  useDeleteMemory,
  useSaveJournalEntry,
  useSetMemoryVisibility,
  useTripMemories,
  useUpsertPlaceReview,
} from '../memories';
import type { Trip } from '../types';
import type { TripPhoto, TripPlaceReview } from '../memories.types';
/* eslint-enable import/first */

const TRIP = '22222222-2222-4222-8222-222222222222';
const PLACE = '33333333-3333-4333-8333-333333333333';
const FRIEND = '99999999-9999-4999-8999-999999999999';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return Wrapper;
}

function calls(table: string) {
  return mockCalls.filter((c) => c.table === table);
}

function serveTier1() {
  mockActive = true;
  tier1RootLoaded$.tripJournalEntries.set(true);
  tier1RootLoaded$.tripPlaceReviews.set(true);
  tier1RootLoaded$.tripPhotos.set(true);
}

beforeEach(() => {
  mockActive = false;
  mockCalls.length = 0;
  for (const k of Object.keys(mockRows)) delete mockRows[k];
  mockQueue.enqueued.length = 0;
  mockQueue.deletions.length = 0;
  mockQueue.cancelled.length = 0;
  mockQueue.jobIds.clear();
  mockPrepare.mockClear();
  tier1RootLoaded$.tripJournalEntries.set(false);
  tier1RootLoaded$.tripPlaceReviews.set(false);
  tier1RootLoaded$.tripPhotos.set(false);
  tier1Store$.tripJournalEntries.set({});
  tier1Store$.tripPlaceReviews.set({});
  tier1Store$.tripPhotos.set({});
  tier1Store$.trips.set({});
  _resetSessionUndoStackForTests?.();
});

describe('journal', () => {
  it('Tier-1 serving: create lands in the store (private by default), no network', async () => {
    serveTier1();
    const { result } = renderHook(() => useSaveJournalEntry(), { wrapper: wrapper() });
    let id = '';
    await act(async () => {
      id = await result.current.mutateAsync({ tripId: TRIP, dayIndex: 2, body: 'Balat walk' });
    });
    expect(tier1Store$.tripJournalEntries[id]!.peek()).toMatchObject({
      trip_id: TRIP,
      author_id: mockUser,
      day_index: 2,
      body: 'Balat walk',
      visibility: 'only_me',
    });
    expect(calls('trip_journal_entries')).toHaveLength(0);
  });

  it('flag off: PostgREST insert with a client id, private by default, no server-owned fields', async () => {
    const { result } = renderHook(() => useSaveJournalEntry(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ tripId: TRIP, dayIndex: 0, body: 'Landed' });
    });
    const insert = calls('trip_journal_entries')[0]!.ops.find(([m]) => m === 'insert')![1][0] as Record<string, unknown>;
    expect(insert).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), trip_id: TRIP, day_index: 0, body: 'Landed', visibility: 'only_me' });
  });

  it('rejects a body over the 20 000-char CHECK before any write', async () => {
    const { result } = renderHook(() => useSaveJournalEntry(), { wrapper: wrapper() });
    await act(async () => {
      await expect(result.current.mutateAsync({ tripId: TRIP, dayIndex: 0, body: 'x'.repeat(20001) })).rejects.toBeTruthy();
    });
    expect(calls('trip_journal_entries')).toHaveLength(0);
  });
});

describe('reviews', () => {
  it('upsert updates the existing own live review instead of creating a second one', async () => {
    serveTier1();
    const existing: TripPlaceReview = {
      id: '44444444-4444-4444-8444-444444444444',
      trip_id: TRIP,
      trip_place_id: PLACE,
      author_id: mockUser,
      rating: 3,
      body: 'ok',
      visibility: 'only_me',
      place_name_snapshot: 'Pera',
      place_google_id_snapshot: null,
      created_at: '2026-07-14T10:00:00Z',
      updated_at: '2026-07-14T10:00:00Z',
      deleted: false,
    };
    tier1Store$.tripPlaceReviews[existing.id]!.set(existing);
    const { result } = renderHook(() => useUpsertPlaceReview(), { wrapper: wrapper() });
    let id = '';
    await act(async () => {
      id = await result.current.mutateAsync({ tripId: TRIP, tripPlaceId: PLACE, rating: 5 });
    });
    expect(id).toBe(existing.id);
    expect(Object.keys(tier1Store$.tripPlaceReviews.peek() ?? {})).toEqual([existing.id]);
    expect(tier1Store$.tripPlaceReviews[existing.id]!.rating.peek()).toBe(5);
  });
});

describe('visibility', () => {
  it('flag off: one PostgREST update per kind with .in(ids)', async () => {
    const { result } = renderHook(() => useSetMemoryVisibility(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        tripId: TRIP,
        visibility: 'trip',
        items: [
          { kind: 'journal', id: 'a' },
          { kind: 'journal', id: 'b' },
          { kind: 'photo', id: 'c' },
        ],
      });
    });
    const j = calls('trip_journal_entries')[0]!.ops;
    expect(j).toEqual([
      ['update', [{ visibility: 'trip' }]],
      ['in', ['id', ['a', 'b']]],
    ]);
    expect(calls('trip_photos')[0]!.ops[0]).toEqual(['update', [{ visibility: 'trip' }]]);
    expect(calls('trip_place_reviews')).toHaveLength(0);
  });
});

describe('photo delete', () => {
  it('Tier-1: tombstone + files removed after the undo window + an undo entry', async () => {
    serveTier1();
    const photo: TripPhoto = {
      id: '55555555-5555-4555-8555-555555555555',
      trip_id: TRIP,
      author_id: mockUser,
      day_index: 0,
      trip_place_id: null,
      storage_path: `${TRIP}/${mockUser}/p.jpg`,
      thumb_path: `${TRIP}/${mockUser}/p_t.jpg`,
      width: 1,
      height: 1,
      bytes: 1,
      thumb_bytes: 1,
      caption: null,
      taken_at: null,
      status: 'ready',
      visibility: 'only_me',
      created_at: 'x',
      updated_at: 'x',
      deleted: false,
    };
    tier1Store$.tripPhotos[photo.id]!.set(photo);
    const before = getSessionUndoStack().size;
    const { result } = renderHook(() => useDeleteMemory(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ kind: 'photo', id: photo.id, tripId: TRIP });
    });
    expect(tier1Store$.tripPhotos[photo.id]!.deleted.peek()).toBe(true);
    expect(mockQueue.deletions).toEqual([{ photo: expect.objectContaining({ id: photo.id, storage_path: photo.storage_path, thumb_path: photo.thumb_path }), grace: 120000 }]);
    expect(getSessionUndoStack().size).toBe(before + 1);
    expect(calls('trip_photos')).toHaveLength(0);
  });

  it('a photo still uploading from this device is cancelled instead', async () => {
    serveTier1();
    mockQueue.jobIds.add('q1');
    const { result } = renderHook(() => useDeleteMemory(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ kind: 'photo', id: 'q1', tripId: TRIP });
    });
    expect(mockQueue.cancelled).toEqual(['q1']);
  });
});

describe('useAddPhotos', () => {
  it('re-encodes every asset, derives the trip day from the capture date, queues privately; bad assets are reported', async () => {
    serveTier1();
    tier1Store$.trips[TRIP]!.set({ id: TRIP, start_date: '2026-07-14', end_date: '2026-07-20' } as Trip);
    const { result } = renderHook(() => useAddPhotos(), { wrapper: wrapper() });
    let out: { ids: string[]; failed: Array<{ index: number; error: { code: string } }> } = { ids: [], failed: [] };
    await act(async () => {
      out = await result.current.mutateAsync({
        tripId: TRIP,
        assets: [{ uri: 'file:///a.jpg' }, { uri: 'file:///b.heic' }, { uri: 'file:///c.jpg' }],
      });
    });
    expect(mockPrepare).toHaveBeenCalledTimes(3);
    expect(out.ids).toHaveLength(2);
    expect(out.failed).toEqual([{ index: 1, error: expect.objectContaining({ code: 'unsupported_image' }) }]);
    expect(mockQueue.enqueued).toHaveLength(2);
    for (const e of mockQueue.enqueued) {
      expect(e).toMatchObject({ tripId: TRIP, dayIndex: 2, visibility: 'only_me', tripPlaceId: null });
      // What is queued is the PREPARED image, never the picked file.
      expect((e['prepared'] as { full: { width: number } }).full.width).toBe(1600);
    }
  });

  it('an explicit dayIndex (incl. null = undated) wins over the capture date', async () => {
    serveTier1();
    const { result } = renderHook(() => useAddPhotos(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ tripId: TRIP, assets: [{ uri: 'file:///a.jpg' }], dayIndex: null, visibility: 'trip' });
    });
    expect(mockQueue.enqueued[0]).toMatchObject({ dayIndex: null, visibility: 'trip' });
  });
});

describe('useTripMemories', () => {
  it('own rows from Tier-1 + a friend’s shared rows from Tier-2 (Tier-2 copies of mine ignored)', async () => {
    serveTier1();
    tier1Store$.tripJournalEntries['j-mine']!.set({
      id: 'j-mine',
      trip_id: TRIP,
      author_id: mockUser,
      day_index: 0,
      body: 'from tier-1',
      visibility: 'only_me',
      created_at: '2026-07-14T08:00:00Z',
      updated_at: '2026-07-14T08:00:00Z',
      deleted: false,
    });
    mockRows['trip_journal_entries'] = [
      { id: 'j-mine', trip_id: TRIP, author_id: mockUser, day_index: 0, body: 'stale', visibility: 'only_me', created_at: 'a', updated_at: 'a', deleted: false },
      { id: 'j-friend', trip_id: TRIP, author_id: FRIEND, day_index: 0, body: 'hi', visibility: 'trip', created_at: '2026-07-14T09:00:00Z', updated_at: 'a', deleted: false },
    ];
    const { result } = renderHook(() => useTripMemories(TRIP), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.items.map((i) => i.id).sort()).toEqual(['j-friend', 'j-mine']));
    const mine = result.current.data!.items.find((i) => i.id === 'j-mine');
    expect(mine?.kind === 'journal' && mine.entry.body).toBe('from tier-1');
    expect(result.current.data!.items.find((i) => i.id === 'j-friend')?.isOwn).toBe(false);
    expect(result.current.userId).toBe(mockUser);
  });
});
