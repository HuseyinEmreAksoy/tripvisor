/**
 * M5 Y2.1 — Tier-1 memory mutations (src/sync/memories.ts).
 *
 * Harness: the REAL tier1Store$ with no engine attached (hydrate mocked down
 * to the activity gate + session user). Asserts the engine rules for the
 * memory roots: client UUIDs, COMPLETE creates with author_id stamped and no
 * created_at, CHECK mirrors throw invalid_value BEFORE the store is touched,
 * tombstones + undo, the review supersede mirror, bulk visibility with one
 * undo entry, and the photo undo guard (files already removed → no restore).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

let mockActive = true;
const mockUser = '11111111-1111-4111-8111-111111111111';
jest.mock('../hydrate', () => ({
  isTier1SyncInitialized: () => mockActive,
  getTier1SyncUserId: () => (mockActive ? mockUser : null),
}));
jest.mock('../flags', () => ({ isTier1SyncEnabled: () => true }));

import { SyncWriteError } from '../mutations';
import {
  createJournalEntry,
  createPlaceReview,
  findOwnLiveReview,
  hasOwnMemoryRow,
  setMemoryVisibility,
  tombstoneJournalEntry,
  tombstonePhoto,
  tombstonePlaceReview,
  updateJournalEntry,
  updatePhoto,
  updatePlaceReview,
} from '../memories';
import { tier1Store$ } from '../store';
import type { TripPhoto } from '../../api/memories.types';

const TRIP = '22222222-2222-4222-8222-222222222222';
const PLACE = '33333333-3333-4333-8333-333333333333';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeEach(() => {
  mockActive = true;
  tier1Store$.tripJournalEntries.set({});
  tier1Store$.tripPlaceReviews.set({});
  tier1Store$.tripPhotos.set({});
  tier1Store$.tripPlaces.set({});
});

function expectCode(call: () => unknown, code: string): void {
  try {
    call();
  } catch (err) {
    expect(err).toBeInstanceOf(SyncWriteError);
    expect((err as SyncWriteError).code).toBe(code);
    return;
  }
  throw new Error(`expected SyncWriteError(${code})`);
}

const size = (rec: Record<string, unknown> | undefined) => Object.keys(rec ?? {}).length;

function seedPhoto(over: Partial<TripPhoto> = {}): TripPhoto {
  const row: TripPhoto = {
    id: '44444444-4444-4444-8444-444444444444',
    trip_id: TRIP,
    author_id: mockUser,
    day_index: 1,
    trip_place_id: null,
    storage_path: `${TRIP}/${mockUser}/p.jpg`,
    thumb_path: `${TRIP}/${mockUser}/p_t.jpg`,
    width: 1600,
    height: 1200,
    bytes: 300000,
    thumb_bytes: 30000,
    caption: null,
    taken_at: null,
    status: 'ready',
    visibility: 'only_me',
    created_at: '2026-07-14T10:00:00Z',
    updated_at: '2026-07-14T10:00:00Z',
    deleted: false,
    ...over,
  };
  tier1Store$.tripPhotos[row.id]!.set(row);
  return row;
}

describe('journal', () => {
  it('create is COMPLETE, private by default, author stamped, no created_at, client uuid', () => {
    const id = createJournalEntry({ trip_id: TRIP, day_index: 2 });
    expect(id).toMatch(UUID_RE);
    expect(tier1Store$.tripJournalEntries[id]!.peek()).toEqual({
      id,
      trip_id: TRIP,
      author_id: mockUser,
      day_index: 2,
      body: '',
      visibility: 'only_me',
      deleted: false,
    });
  });

  it('edit + tombstone return inverses that restore', () => {
    const id = createJournalEntry({ trip_id: TRIP, day_index: 0, body: 'Arrived' });
    const undoEdit = updateJournalEntry(id, { body: 'Arrived late', visibility: 'trip' });
    expect(tier1Store$.tripJournalEntries[id]!.peek()).toMatchObject({ body: 'Arrived late', visibility: 'trip' });
    void undoEdit.inverse();
    expect(tier1Store$.tripJournalEntries[id]!.peek()).toMatchObject({ body: 'Arrived', visibility: 'only_me' });
    const undoDel = tombstoneJournalEntry(id);
    expect(tier1Store$.tripJournalEntries[id]!.deleted.peek()).toBe(true);
    void undoDel.inverse();
    expect(tier1Store$.tripJournalEntries[id]!.deleted.peek()).toBe(false);
  });

  it('CHECK mirrors throw BEFORE the store is touched', () => {
    expectCode(() => createJournalEntry({ trip_id: TRIP, day_index: 1000 }), 'invalid_value');
    expectCode(() => createJournalEntry({ trip_id: TRIP, day_index: -1 }), 'invalid_value');
    expectCode(() => createJournalEntry({ trip_id: TRIP, day_index: 0, body: 'x'.repeat(20001) }), 'invalid_value');
    expectCode(() => createJournalEntry({ trip_id: 'not-a-uuid', day_index: 0 }), 'invalid_value');
    expectCode(
      () => createJournalEntry({ trip_id: TRIP, day_index: 0, visibility: 'public' as never }),
      'invalid_value',
    );
    expect(size(tier1Store$.tripJournalEntries.peek())).toBe(0);
    const id = createJournalEntry({ trip_id: TRIP, day_index: 0 });
    expectCode(() => updateJournalEntry(id, { body: 'x'.repeat(20001) }), 'invalid_value');
    expect(tier1Store$.tripJournalEntries[id]!.body.peek()).toBe('');
  });

  it('inactive engine → sync_inactive (callers use the online path)', () => {
    mockActive = false;
    expectCode(() => createJournalEntry({ trip_id: TRIP, day_index: 0 }), 'sync_inactive');
  });

  it("another author's row is never editable (row_not_found)", () => {
    tier1Store$.tripJournalEntries['j-other']!.set({
      id: 'j-other',
      trip_id: TRIP,
      author_id: '99999999-9999-4999-8999-999999999999',
      day_index: 0,
      body: 'theirs',
      visibility: 'trip',
      created_at: 'x',
      updated_at: 'x',
      deleted: false,
    });
    expectCode(() => updateJournalEntry('j-other', { body: 'mine now' }), 'row_not_found');
    expect(hasOwnMemoryRow({ kind: 'journal', id: 'j-other' })).toBe(false);
  });
});

describe('reviews', () => {
  it('create: user stars 1–5 or null, snapshots start null (server-owned), private by default', () => {
    const id = createPlaceReview({ trip_id: TRIP, trip_place_id: PLACE, rating: 4, body: 'Worth it' });
    expect(tier1Store$.tripPlaceReviews[id]!.peek()).toEqual({
      id,
      trip_id: TRIP,
      trip_place_id: PLACE,
      author_id: mockUser,
      rating: 4,
      body: 'Worth it',
      visibility: 'only_me',
      place_name_snapshot: null,
      place_google_id_snapshot: null,
      deleted: false,
    });
    expectCode(() => createPlaceReview({ trip_id: TRIP, trip_place_id: PLACE, rating: 6 }), 'invalid_value');
    expectCode(() => createPlaceReview({ trip_id: TRIP, trip_place_id: PLACE, rating: 3.5 }), 'invalid_value');
    expectCode(() => updatePlaceReview(id, { rating: 0 }), 'invalid_value');
    expectCode(() => updatePlaceReview(id, { body: 'x'.repeat(4001) }), 'invalid_value');
  });

  it('a second live review of the same place supersedes the first locally (mirrors 0036 §4b)', () => {
    const first = createPlaceReview({ trip_id: TRIP, trip_place_id: PLACE, rating: 2 });
    const second = createPlaceReview({ trip_id: TRIP, trip_place_id: PLACE, rating: 5 });
    expect(tier1Store$.tripPlaceReviews[first]!.deleted.peek()).toBe(true);
    expect(findOwnLiveReview(PLACE)?.id).toBe(second);
    // Undoing the delete of the first tombstones the second (last write wins).
    const undo = tombstonePlaceReview(second);
    void undo.inverse();
    expect(tier1Store$.tripPlaceReviews[second]!.deleted.peek()).toBe(false);
  });

  it('refuses a place the store knows belongs to another trip (would wedge the queue)', () => {
    tier1Store$.tripPlaces[PLACE]!.set({ id: PLACE, trip_id: '55555555-5555-4555-8555-555555555555' } as never);
    expectCode(() => createPlaceReview({ trip_id: TRIP, trip_place_id: PLACE, rating: 3 }), 'invalid_value');
  });
});

describe('photos (update-only root)', () => {
  it('caption/day/taken_at/visibility edits with validation; server-owned fields untouched', () => {
    const row = seedPhoto();
    const undo = updatePhoto(row.id, { caption: 'Sunset', day_index: 2, taken_at: '2026-07-14T18:00:00Z', visibility: 'trip' });
    expect(tier1Store$.tripPhotos[row.id]!.peek()).toMatchObject({
      caption: 'Sunset',
      day_index: 2,
      visibility: 'trip',
      status: 'ready',
      bytes: 300000,
      storage_path: row.storage_path,
    });
    void undo.inverse();
    expect(tier1Store$.tripPhotos[row.id]!.peek()).toMatchObject({ caption: null, day_index: 1, visibility: 'only_me' });
    // `status` / paths are not part of the patch type and are dropped at runtime.
    updatePhoto(row.id, { status: 'pending', storage_path: 'evil' } as never);
    expect(tier1Store$.tripPhotos[row.id]!.peek()).toMatchObject({ status: 'ready', storage_path: row.storage_path });
    expectCode(() => updatePhoto(row.id, { caption: 'x'.repeat(501) }), 'invalid_value');
    expectCode(() => updatePhoto(row.id, { taken_at: 'yesterday' }), 'invalid_value');
  });

  it('tombstone undo is refused once the files are gone (canRestore false)', () => {
    const row = seedPhoto();
    let filesGone = false;
    const undo = tombstonePhoto(row.id, 'Remove photo', { canRestore: () => !filesGone });
    expect(tier1Store$.tripPhotos[row.id]!.deleted.peek()).toBe(true);
    filesGone = true;
    expect(() => undo.inverse()).toThrow(SyncWriteError);
    expect(tier1Store$.tripPhotos[row.id]!.deleted.peek()).toBe(true);
  });

  it('tombstone undo inside the window restores', () => {
    const row = seedPhoto();
    const undo = tombstonePhoto(row.id, 'Remove photo', { canRestore: () => true });
    void undo.inverse();
    expect(tier1Store$.tripPhotos[row.id]!.deleted.peek()).toBe(false);
  });
});

describe('visibility (single + bulk)', () => {
  it('shares several own items in one tick; ONE undo restores each prior value; unknown/tombstoned skipped', () => {
    const j = createJournalEntry({ trip_id: TRIP, day_index: 0, visibility: 'trip' });
    const r = createPlaceReview({ trip_id: TRIP, trip_place_id: PLACE, rating: 5 });
    const p = seedPhoto().id;
    const gone = createJournalEntry({ trip_id: TRIP, day_index: 1 });
    tombstoneJournalEntry(gone);
    const { undo, applied, skipped } = setMemoryVisibility(
      [
        { kind: 'journal', id: j },
        { kind: 'review', id: r },
        { kind: 'photo', id: p },
        { kind: 'journal', id: gone },
        { kind: 'photo', id: 'not-in-store' },
      ],
      'trip',
    );
    expect(applied).toHaveLength(3);
    expect(skipped).toEqual([
      { kind: 'journal', id: gone },
      { kind: 'photo', id: 'not-in-store' },
    ]);
    expect(tier1Store$.tripPlaceReviews[r]!.visibility.peek()).toBe('trip');
    expect(tier1Store$.tripPhotos[p]!.visibility.peek()).toBe('trip');
    void undo.inverse();
    expect(tier1Store$.tripJournalEntries[j]!.visibility.peek()).toBe('trip'); // was already shared
    expect(tier1Store$.tripPlaceReviews[r]!.visibility.peek()).toBe('only_me');
    expect(tier1Store$.tripPhotos[p]!.visibility.peek()).toBe('only_me');
  });
});
