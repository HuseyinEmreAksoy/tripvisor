/**
 * M5 Y2.1 — memories read model: the pure merge behind useTripMemories
 * (own Tier-1 rows + others' shared Tier-2 rows + this device's upload
 * jobs), the capture-date → trip day mapping, and the persister firewall
 * (Tier-2 memory keys are never dehydrated to disk).
 */
import { describe, expect, it, jest } from '@jest/globals';
import { QueryClient, dehydrate } from '@tanstack/react-query';

jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('../../lib/sentry', () => ({ Sentry: { addBreadcrumb: jest.fn() } }));

import { buildTripMemoriesView, dayIndexForCapture, memoryKeys, type OwnMemoryRows, type TripMemoryRows } from '../memories';
import type { PhotoUploadJobView, TripJournalEntry, TripPhoto, TripPlaceReview } from '../memories.types';
import { shouldDehydrateQuery } from '../offline.web';

const TRIP = '22222222-2222-4222-8222-222222222222';
const ME = '11111111-1111-4111-8111-111111111111';
const FRIEND = '99999999-9999-4999-8999-999999999999';

function journal(over: Partial<TripJournalEntry>): TripJournalEntry {
  return {
    id: 'j',
    trip_id: TRIP,
    author_id: ME,
    day_index: 0,
    body: '',
    visibility: 'only_me',
    created_at: '2026-07-14T08:00:00Z',
    updated_at: '2026-07-14T08:00:00Z',
    deleted: false,
    ...over,
  };
}

function review(over: Partial<TripPlaceReview>): TripPlaceReview {
  return {
    id: 'r',
    trip_id: TRIP,
    trip_place_id: 'place-1',
    author_id: ME,
    rating: 5,
    body: '',
    visibility: 'only_me',
    place_name_snapshot: null,
    place_google_id_snapshot: null,
    created_at: '2026-07-14T12:00:00Z',
    updated_at: '2026-07-14T12:00:00Z',
    deleted: false,
    ...over,
  };
}

function photo(over: Partial<TripPhoto>): TripPhoto {
  return {
    id: 'p',
    trip_id: TRIP,
    author_id: ME,
    day_index: 0,
    trip_place_id: null,
    storage_path: 'a.jpg',
    thumb_path: 'a_t.jpg',
    width: 1600,
    height: 1200,
    bytes: 1,
    thumb_bytes: 1,
    caption: null,
    taken_at: null,
    status: 'ready',
    visibility: 'only_me',
    created_at: '2026-07-14T10:00:00Z',
    updated_at: '2026-07-14T10:00:00Z',
    deleted: false,
    ...over,
  };
}

function job(over: Partial<PhotoUploadJobView>): PhotoUploadJobView {
  return {
    id: 'job',
    tripId: TRIP,
    dayIndex: 1,
    tripPlaceId: null,
    caption: null,
    visibility: 'only_me',
    takenAt: '2026-07-15T09:00:00.000Z',
    width: 1600,
    height: 1200,
    bytes: 1000,
    state: 'uploading',
    progress: 0.15,
    waitingFor: null,
    error: null,
    previewUri: 'file:///q/job.jpg',
    createdAt: Date.parse('2026-07-15T09:05:00Z'),
    ...over,
  };
}

describe('buildTripMemoriesView', () => {
  const own: OwnMemoryRows = {
    userId: ME,
    journal: [
      journal({ id: 'j-mine', day_index: 0, body: 'Day one', created_at: '2026-07-14T21:00:00Z' }),
      journal({ id: 'j-deleted', day_index: 0, deleted: true }),
    ],
    reviews: [review({ id: 'r-mine', trip_place_id: 'place-2' })],
    photos: [
      photo({ id: 'p-ready', day_index: 0, taken_at: '2026-07-14T09:00:00Z', created_at: '2026-07-16T00:00:00Z' }),
      photo({ id: 'p-pending-elsewhere', status: 'pending' }),
      photo({ id: 'p-pending-here', status: 'pending', day_index: 1 }),
      photo({ id: 'p-other-trip', trip_id: 'other-trip' }),
    ],
  };
  const shared: TripMemoryRows = {
    userId: ME,
    // Tier-2 also returns MY rows (RLS): they must be ignored while Tier-1 serves.
    journal: [
      journal({ id: 'j-mine', body: 'stale tier-2 copy' }),
      journal({ id: 'j-friend', author_id: FRIEND, visibility: 'trip', day_index: 1, created_at: '2026-07-15T20:00:00Z' }),
    ],
    reviews: [review({ id: 'r-friend', author_id: FRIEND, visibility: 'trip', trip_place_id: null })],
    photos: [photo({ id: 'p-friend', author_id: FRIEND, visibility: 'trip', day_index: 0, taken_at: '2026-07-14T07:00:00Z' })],
  };
  const jobs = [
    job({ id: 'p-pending-here' }),
    job({ id: 'q-only', dayIndex: 1, takenAt: '2026-07-15T10:00:00.000Z' }),
    job({ id: 'q-failed', dayIndex: null, takenAt: null, state: 'failed', error: { code: 'storage_full', scope: 'global' } }),
    job({ id: 'q-other-trip', tripId: 'other-trip' }),
  ];
  const placeDay = new Map<string, number | null>([['place-2', 1]]);
  const view = buildTripMemoriesView({ tripId: TRIP, userId: ME, own, shared, jobs, placeDay });
  const ids = view.items.map((i) => i.id);

  it('merges own Tier-1 rows with friends’ shared rows; Tier-2 copies of MY rows are ignored', () => {
    expect(ids).toContain('j-friend');
    expect(ids).toContain('p-friend');
    expect(ids).toContain('r-friend');
    const mine = view.items.find((i) => i.id === 'j-mine');
    expect(mine?.kind === 'journal' && mine.entry.body).toBe('Day one');
    expect(ids.filter((i) => i === 'j-mine')).toHaveLength(1);
    expect(view.items.find((i) => i.id === 'p-friend')?.isOwn).toBe(false);
    expect(view.items.find((i) => i.id === 'p-ready')?.isOwn).toBe(true);
  });

  it('hides tombstones, other trips and own pending photos that this device is not uploading', () => {
    expect(ids).not.toContain('j-deleted');
    expect(ids).not.toContain('p-other-trip');
    expect(ids).not.toContain('q-other-trip');
    expect(ids).not.toContain('p-pending-elsewhere');
  });

  it('queued photos show from their job (row or not), with local preview + state', () => {
    const here = view.items.find((i) => i.id === 'p-pending-here');
    expect(here?.kind === 'photo' && here.upload?.previewUri).toBe('file:///q/job.jpg');
    const only = view.items.find((i) => i.id === 'q-only');
    expect(only?.kind === 'photo' && only.photo).toBeNull();
    expect(only?.kind === 'photo' && only.upload?.state).toBe('uploading');
  });

  it('groups by day ascending (undated last), oldest first inside a day; reviews take their place’s day', () => {
    expect(view.days.map((d) => d.dayIndex)).toEqual([0, 1, null]);
    expect(view.days[0]!.items.map((i) => i.id)).toEqual(['p-friend', 'p-ready', 'j-mine']);
    expect(view.days[1]!.items.map((i) => i.id)).toContain('r-mine');
    expect(view.days[2]!.items.map((i) => i.id).sort()).toEqual(['q-failed', 'r-friend']);
  });

  it('counts + latestPhoto for the hub card', () => {
    expect(view.counts).toEqual({ photos: 5, journal: 2, reviews: 2, uploading: 2, failed: 1 });
    expect(view.latestPhoto?.id).toBe('p-ready');
  });

  it('flag-off / not hydrated: own rows come from Tier-2 (own === null)', () => {
    const v = buildTripMemoriesView({ tripId: TRIP, userId: ME, own: null, shared, jobs: [], placeDay });
    const mine = v.items.find((i) => i.id === 'j-mine');
    expect(mine?.isOwn).toBe(true);
    expect(mine?.kind === 'journal' && mine.entry.body).toBe('stale tier-2 copy');
  });
});

describe('dayIndexForCapture', () => {
  const trip = { start_date: '2026-07-14', end_date: '2026-07-20' };
  it('maps the capture day (device-local calendar) to the 0-based trip day', () => {
    expect(dayIndexForCapture(new Date(2026, 6, 14, 9, 0).toISOString(), trip)).toBe(0);
    expect(dayIndexForCapture(new Date(2026, 6, 16, 23, 59).toISOString(), trip)).toBe(2);
    expect(dayIndexForCapture(new Date(2026, 6, 20, 12, 0).toISOString(), trip)).toBe(6);
  });
  it('outside the trip, no date or no trip start → null (undated)', () => {
    expect(dayIndexForCapture(new Date(2026, 6, 13, 12, 0).toISOString(), trip)).toBeNull();
    expect(dayIndexForCapture(new Date(2026, 6, 21, 12, 0).toISOString(), trip)).toBeNull();
    expect(dayIndexForCapture(null, trip)).toBeNull();
    expect(dayIndexForCapture('2026-07-14T09:00:00Z', { start_date: null, end_date: null })).toBeNull();
  });
});

describe('persister firewall', () => {
  it('Tier-2 memory queries (others’ items, quota, signed URLs) are never dehydrated', () => {
    const client = new QueryClient();
    client.setQueryData(memoryKeys.trip(TRIP), { journal: [], reviews: [], photos: [] });
    client.setQueryData(memoryKeys.quota(TRIP), { user_used: 1 });
    client.setQueryData(memoryKeys.signedUrl('a/b/c.jpg'), 'https://signed');
    client.setQueryData(['trips'], []);
    const roots = dehydrate(client, { shouldDehydrateQuery }).queries.map((q) => q.queryKey[0]);
    expect(roots).toEqual(['trips']);
    client.clear();
  });
});
