/**
 * Unit tests for the client-side filter/sort helpers.
 *
 * Helpers live in `src/lib/tripsFilters.ts` — a pure module with no React or
 * React Native dependencies — so this test file can run in Jest's jsdom
 * runtime without any native-module mocks.
 */

import { describe, expect, it } from '@jest/globals';
import type { Trip, Uuid } from '@/api/types';
import { applySearch, applyDateFilter, applySort, localISODate } from '@/lib/tripsFilters';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTrip(overrides: Partial<Trip> & { id: Uuid }): Trip {
  return {
    user_id: 'u-1',
    title: 'Test trip',
    start_date: null,
    end_date: null,
    daily_hours_budget: 8,
    anchor_place_id: null,
    transport_mode: 'driving',
    timezone: null,
    archived_at: null,
    currency: 'USD',
    total_budget: null,
    route_render_mode: 'optimized',
    cover_photo_google_place_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const lisbon = makeTrip({ id: 'a', title: 'Lisbon weekend', created_at: '2026-04-01T00:00:00Z' });
const paris = makeTrip({ id: 'b', title: 'Paris in spring', created_at: '2026-03-01T00:00:00Z' });
const tokyo = makeTrip({ id: 'c', title: 'Tokyo adventure', created_at: '2026-02-01T00:00:00Z' });

// ── applySearch ───────────────────────────────────────────────────────────────

describe('applySearch', () => {
  const trips = [lisbon, paris, tokyo];

  it('returns all trips when query is empty', () => {
    expect(applySearch(trips, '')).toEqual(trips);
  });

  it('returns all trips when query is whitespace-only', () => {
    expect(applySearch(trips, '   ')).toEqual(trips);
  });

  it('matches case-insensitively', () => {
    expect(applySearch(trips, 'LISBON')).toEqual([lisbon]);
    expect(applySearch(trips, 'lisbon')).toEqual([lisbon]);
    expect(applySearch(trips, 'Lisbon')).toEqual([lisbon]);
  });

  it('matches substring in the middle of a title', () => {
    expect(applySearch(trips, 'in spring')).toEqual([paris]);
  });

  it('returns empty array when no trip matches', () => {
    expect(applySearch(trips, 'Berlin')).toEqual([]);
  });

  it('returns multiple trips when query matches several', () => {
    // 'a' matches "Paris in spring" (has 'a') and "Tokyo adventure" (has 'a')
    const result = applySearch([lisbon, paris, tokyo], 'a');
    expect(result.map((t) => t.id).sort()).toEqual(['b', 'c']);
  });

  it('trims leading/trailing whitespace from the query', () => {
    expect(applySearch(trips, '  lisbon  ')).toEqual([lisbon]);
  });

  it('does not mutate the input array', () => {
    const copy = [...trips];
    applySearch(trips, 'x');
    expect(trips).toEqual(copy);
  });
});

// ── applyDateFilter ───────────────────────────────────────────────────────────

describe('applyDateFilter', () => {
  const today = '2026-05-15';

  const upcoming = makeTrip({ id: 'up', title: 'Upcoming', start_date: '2026-06-01', end_date: '2026-06-05' });
  const past = makeTrip({ id: 'past', title: 'Past', start_date: '2026-01-01', end_date: '2026-01-05' });
  const unscheduled = makeTrip({ id: 'un', title: 'Unscheduled', start_date: null, end_date: null });
  const ongoingNoStart = makeTrip({ id: 'ons', title: 'Ongoing no start', start_date: null, end_date: '2026-06-01' });
  const trips = [upcoming, past, unscheduled, ongoingNoStart];

  it('returns all trips for "all" filter', () => {
    expect(applyDateFilter(trips, 'all', today)).toEqual(trips);
  });

  describe('"upcoming" filter', () => {
    it('includes trips with start_date >= today', () => {
      expect(applyDateFilter([upcoming], 'upcoming', today)).toEqual([upcoming]);
    });

    it('excludes trips where start_date < today', () => {
      expect(applyDateFilter([past], 'upcoming', today)).toEqual([]);
    });

    it('includes unscheduled trips (both dates null)', () => {
      expect(applyDateFilter([unscheduled], 'upcoming', today)).toEqual([unscheduled]);
    });

    it('includes trips with null start_date and end_date >= today', () => {
      expect(applyDateFilter([ongoingNoStart], 'upcoming', today)).toEqual([ongoingNoStart]);
    });

    it('excludes trips with null start_date and end_date < today', () => {
      const expired = makeTrip({ id: 'exp', title: 'Expired', start_date: null, end_date: '2026-01-01' });
      expect(applyDateFilter([expired], 'upcoming', today)).toEqual([]);
    });
  });

  describe('"past" filter', () => {
    it('includes trips where end_date < today', () => {
      expect(applyDateFilter([past], 'past', today)).toEqual([past]);
    });

    it('excludes trips where end_date is null', () => {
      expect(applyDateFilter([unscheduled, ongoingNoStart], 'past', today)).toEqual([]);
    });

    it('excludes upcoming trips', () => {
      expect(applyDateFilter([upcoming], 'past', today)).toEqual([]);
    });

    it('excludes a trip whose end_date equals today (not strictly past)', () => {
      const endsToday = makeTrip({ id: 'et', title: 'Ends today', start_date: null, end_date: today });
      expect(applyDateFilter([endsToday], 'past', today)).toEqual([]);
    });
  });

  it('does not mutate the input array', () => {
    const copy = [...trips];
    applyDateFilter(trips, 'upcoming', today);
    expect(trips).toEqual(copy);
  });
});

// ── applySort ─────────────────────────────────────────────────────────────────

describe('applySort', () => {
  const emptyLegs: Map<string, { duration_seconds: number }[]> = new Map();

  const alpha = makeTrip({ id: 'a', title: 'Alpha', created_at: '2026-01-01T00:00:00Z', start_date: '2026-06-10' });
  const beta = makeTrip({ id: 'b', title: 'Beta', created_at: '2026-03-01T00:00:00Z', start_date: '2026-05-01' });
  const zeta = makeTrip({ id: 'z', title: 'Zeta', created_at: '2026-02-01T00:00:00Z', start_date: null });
  const trips = [alpha, zeta, beta];

  describe('"recent" sort', () => {
    it('sorts by created_at descending (most recent first)', () => {
      const result = applySort(trips, 'recent', emptyLegs);
      expect(result.map((t) => t.id)).toEqual(['b', 'z', 'a']);
    });
  });

  describe('"az" sort', () => {
    it('sorts alphabetically by title ascending', () => {
      const result = applySort(trips, 'az', emptyLegs);
      expect(result.map((t) => t.id)).toEqual(['a', 'b', 'z']);
    });

    it('is case-insensitive (locale-aware collator)', () => {
      const lower = makeTrip({ id: 'l', title: 'alpha' });
      const upper = makeTrip({ id: 'u', title: 'Zeta' });
      const result = applySort([upper, lower], 'az', emptyLegs);
      expect(result[0]!.id).toBe('l');
    });
  });

  describe('"start_date" sort', () => {
    it('sorts by start_date ascending, nulls last', () => {
      // beta: 2026-05-01, alpha: 2026-06-10, zeta: null (sinks last)
      const result = applySort(trips, 'start_date', emptyLegs);
      expect(result.map((t) => t.id)).toEqual(['b', 'a', 'z']);
    });

    it('two trips with null start_date sort to a stable tie', () => {
      const a = makeTrip({ id: 'na', title: 'A', start_date: null });
      const b = makeTrip({ id: 'nb', title: 'B', start_date: null });
      const result = applySort([a, b], 'start_date', emptyLegs);
      expect(result.map((t) => t.id).sort()).toEqual(['na', 'nb']);
    });
  });

  describe('"duration" sort', () => {
    it('sorts by total travel time descending (longest first)', () => {
      const legs: Map<string, { duration_seconds: number }[]> = new Map([
        ['a', [{ duration_seconds: 3600 }]],                              // 1h
        ['b', [{ duration_seconds: 7200 }, { duration_seconds: 10800 }]], // 5h
        ['z', []],                                                        // 0
      ]);
      const a = makeTrip({ id: 'a', title: 'A', created_at: '2026-01-01T00:00:00Z' });
      const b = makeTrip({ id: 'b', title: 'B', created_at: '2026-02-01T00:00:00Z' });
      const z = makeTrip({ id: 'z', title: 'Z', created_at: '2026-03-01T00:00:00Z' });
      const result = applySort([a, b, z], 'duration', legs);
      expect(result.map((t) => t.id)).toEqual(['b', 'a', 'z']);
    });

    it('breaks duration ties by created_at descending (more recent first)', () => {
      const older = makeTrip({ id: 'old', title: 'Old', created_at: '2026-01-01T00:00:00Z' });
      const newer = makeTrip({ id: 'new', title: 'New', created_at: '2026-06-01T00:00:00Z' });
      const result = applySort([older, newer], 'duration', emptyLegs);
      expect(result[0]!.id).toBe('new');
    });
  });

  it('does not mutate the input array', () => {
    const copy = [...trips];
    applySort(trips, 'recent', emptyLegs);
    expect(trips).toEqual(copy);
  });
});

// ── localISODate ─────────────────────────────────────────────────────────────

describe('localISODate', () => {
  it('uses local calendar parts, not the UTC date', () => {
    // 00:30 local on 5 Oct — UTC may still be 4 Oct east of Greenwich.
    expect(localISODate(new Date(2026, 9, 5, 0, 30))).toBe('2026-10-05');
    // 23:30 local on 4 Oct — UTC may already be 5 Oct west of Greenwich.
    expect(localISODate(new Date(2026, 9, 4, 23, 30))).toBe('2026-10-04');
  });

  it('zero-pads month and day', () => {
    expect(localISODate(new Date(2026, 0, 3, 12))).toBe('2026-01-03');
  });
});
