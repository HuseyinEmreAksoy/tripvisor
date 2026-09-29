/**
 * Pure filter/sort helpers for the trips list.
 *
 * Extracted from `app/(app)/trips.tsx` so they can be unit-tested in Jest
 * without pulling in expo-router or React Native native deps (which crash the
 * jsdom runtime). Nothing here depends on React, Expo, or any native module —
 * only on the `Trip` type from `@/api/types`.
 *
 * Functions:
 *
 *   applySearch(trips, query)
 *     Case-insensitive substring match on `trip.title`. An empty or
 *     whitespace-only query returns the input array unchanged.
 *
 *   applyDateFilter(trips, filter, today)
 *     Keeps trips that match the requested date category:
 *       'all'      — no filtering.
 *       'upcoming' — start_date >= today, OR (null start + end_date >= today),
 *                    OR both dates null (unscheduled trips stay visible).
 *       'past'     — end_date < today AND end_date is not null.
 *     `today` must be a YYYY-MM-DD string; DB dates are stored in the same
 *     format so lexicographic comparison is valid.
 *
 *   applySort(trips, sortKey, legsByTripId)
 *     Returns a sorted copy (never mutates). Sort keys:
 *       'recent'     — created_at descending.
 *       'az'         — locale-aware ascending by title.
 *       'start_date' — ascending; null start_dates sink to the bottom.
 *       'duration'   — total trip travel time = sum(leg.duration_seconds)
 *                      descending (longest travel time first); trips with no
 *                      legs (total = 0) sink last, with created_at descending
 *                      as tiebreak. Time-first replacement for the retired
 *                      per-km 'cost' sort (v2 Phase 0.1).
 */

import type { Trip } from '@/api/types';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SortKey = 'recent' | 'az' | 'start_date' | 'duration';

export type DateFilter = 'all' | 'upcoming' | 'past';

// ── Internal constants ────────────────────────────────────────────────────────

// Locale-aware collator for A→Z sort. Stable module-level instance so callers
// don't pay the construction cost on every invocation.
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

// ── Exported helpers ──────────────────────────────────────────────────────────

/**
 * Today's LOCAL calendar date as YYYY-MM-DD. Trip dates are local calendar
 * days, so `toISOString()` (UTC) would misclassify trips near midnight.
 */
export function localISODate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Case-insensitive substring match on `trip.title`.
 * Trims leading/trailing whitespace from the query before comparing.
 */
export function applySearch(trips: Trip[], query: string): Trip[] {
  const q = query.trim().toLowerCase();
  if (!q) return trips;
  return trips.filter((trip) => trip.title.toLowerCase().includes(q));
}

/**
 * Applies the Upcoming / Past / All date filter.
 *
 * Rules:
 *   upcoming  — start_date >= today, OR (start_date null AND end_date >= today),
 *               OR both dates null (unscheduled active trip — kept visible).
 *   past      — end_date < today AND end_date != null.
 *   all       — no filtering.
 *
 * Both sides of every comparison are `YYYY-MM-DD` strings so lexicographic
 * `<` / `>=` is correct.
 */
export function applyDateFilter(trips: Trip[], filter: DateFilter, today: string): Trip[] {
  if (filter === 'all') return trips;

  return trips.filter((trip) => {
    const { start_date, end_date } = trip;

    if (filter === 'upcoming') {
      // Unscheduled trip — always show in Upcoming.
      if (!start_date && !end_date) return true;
      if (start_date) return start_date >= today;
      // start_date is null but end_date is present.
      return end_date != null && end_date >= today;
    }

    // filter === 'past'
    return end_date != null && end_date < today;
  });
}

/**
 * Sorts a copy of `trips` by `key`. Never mutates the input array.
 *
 * `legsByTripId` is only consulted for the `'duration'` sort. For all other
 * keys it may be an empty Map — the caller can pass `new Map()` or the hook
 * value without cost.
 */
export function applySort(
  trips: Trip[],
  key: SortKey,
  legsByTripId: Map<string, { duration_seconds: number }[]>,
): Trip[] {
  // Slice to avoid mutating the TanStack Query cache array.
  const sorted = trips.slice();
  switch (key) {
    case 'recent':
      sorted.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      break;
    case 'az':
      sorted.sort((a, b) => collator.compare(a.title, b.title));
      break;
    case 'start_date':
      sorted.sort((a, b) => {
        // Null start_dates sink to the bottom.
        if (!a.start_date && !b.start_date) return 0;
        if (!a.start_date) return 1;
        if (!b.start_date) return -1;
        return a.start_date.localeCompare(b.start_date);
      });
      break;
    case 'duration': {
      /**
       * Time-first sort (v2 Phase 0.1, replaces the retired per-km 'cost'
       * sort): total trip travel time = sum(leg.duration_seconds).
       * Trips with no legs (total = 0) sink to the bottom via the fallback
       * `created_at` tiebreak to keep ordering stable.
       */
      const travelSeconds = (trip: Trip): number => {
        const legs = legsByTripId.get(trip.id) ?? [];
        return legs.reduce((acc, leg) => acc + leg.duration_seconds, 0);
      };
      sorted.sort((a, b) => {
        const diff = travelSeconds(b) - travelSeconds(a); // descending
        if (diff !== 0) return diff;
        // Tiebreak: more recent first.
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      break;
    }
  }
  return sorted;
}
