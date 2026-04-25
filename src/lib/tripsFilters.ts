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
 *       'cost'       — sum(leg.distance_meters / 1000 * trip.cost_per_km)
 *                      descending; trips with no legs (cost = 0) sink last,
 *                      with created_at descending as tiebreak.
 */

import type { Trip } from '@/api/types';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SortKey = 'recent' | 'az' | 'start_date' | 'cost';

export type DateFilter = 'all' | 'upcoming' | 'past';

// ── Internal constants ────────────────────────────────────────────────────────

// Locale-aware collator for A→Z sort. Stable module-level instance so callers
// don't pay the construction cost on every invocation.
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

// ── Exported helpers ──────────────────────────────────────────────────────────

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
 * `legsByTripId` is only consulted for `'cost'` sort. For all other keys it
 * may be an empty Map — the caller can pass `new Map()` or the hook value
 * without cost.
 */
export function applySort(
  trips: Trip[],
  key: SortKey,
  legsByTripId: Map<string, { distance_meters: number }[]>,
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
    case 'cost': {
      /**
       * Compute trip cost = sum(leg.distance_meters / 1000 * trip.cost_per_km).
       * Trips with no legs (total cost = 0) sink to the bottom via the
       * fallback `created_at` tiebreak to keep ordering stable.
       */
      const cost = (trip: Trip): number => {
        const legs = legsByTripId.get(trip.id) ?? [];
        return legs.reduce(
          (acc, leg) => acc + (leg.distance_meters / 1000) * trip.cost_per_km,
          0,
        );
      };
      sorted.sort((a, b) => {
        const diff = cost(b) - cost(a); // descending
        if (diff !== 0) return diff;
        // Tiebreak: more recent first.
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      break;
    }
  }
  return sorted;
}
