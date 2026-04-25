/**
 * Pure helper for generating a one-line summary string from shared trip data.
 *
 * Extracted from `app/share/[token].tsx` so it can be unit-tested in Jest
 * without pulling in expo-router or React Native native deps (which crash the
 * jsdom runtime). Nothing here depends on React, Expo, or any native module.
 *
 * Functions:
 *
 *   buildSummary(places, trip)
 *     Builds a short human-readable description of a shared trip, used as
 *     the og:description / twitter:description meta content. Format varies:
 *
 *       0 places:                    "Empty trip · {dailyHours}/day"
 *       places, no dates:            "{n} place[s] · {dailyHours}/day"
 *       places, both dates present:  "{dayCount}-day trip · {n} place[s] · {dailyHours}/day"
 *
 *     `daily_hours_budget` is rendered without a trailing ".0" for whole
 *     numbers (e.g. 8 → "8h", 7.5 → "7.5h"). Output is hard-capped at 200
 *     characters (the og:description limit) — anything longer is sliced to
 *     197 chars and "..." is appended.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Subset of trip metadata needed by `buildSummary`. Mirrors the shape used by
 * `app/share/[token].tsx` — intentionally not imported from `@/api/types` so
 * this file stays dependency-free and testable in isolation.
 */
export interface SharedTripMeta {
  title: string;
  start_date: string | null;
  end_date: string | null;
  daily_hours_budget: number;
  transport_mode: string;
}

/**
 * Subset of place data needed by `buildSummary` (currently only the count
 * matters, but the full shape is accepted so callers can pass place arrays
 * without slicing).
 */
export interface SharedPlace {
  id: string;
  user_title: string | null;
  lat: number;
  lng: number;
  day_index: number | null;
  order_in_day: number | null;
  visit_duration_minutes: number;
}

// ── Exported helper ───────────────────────────────────────────────────────────

/**
 * Builds a concise summary string for a shared trip, suitable for use as an
 * og:description / twitter:description value.
 *
 * Output is always ≤ 200 characters. Any longer result is truncated to 197
 * characters with "..." appended.
 */
export function buildSummary(
  places: SharedPlace[],
  trip: SharedTripMeta,
): string {
  const placeCount = places.length;

  // Format daily hours budget: no trailing ".0" for whole numbers.
  const hours = trip.daily_hours_budget;
  const dailyHours = Number.isInteger(hours)
    ? `${hours}h`
    : `${hours.toFixed(1)}h`;

  let summary: string;

  if (placeCount === 0) {
    summary = `Empty trip · ${dailyHours}/day`;
  } else if (trip.start_date && trip.end_date) {
    const msPerDay = 1000 * 60 * 60 * 24;
    const start = new Date(trip.start_date).getTime();
    const end = new Date(trip.end_date).getTime();
    // Inclusive day count — floor in case of floating-point dust.
    const dayCount = Math.max(1, Math.floor((end - start) / msPerDay) + 1);
    summary = `${dayCount}-day trip · ${placeCount} place${placeCount === 1 ? '' : 's'} · ${dailyHours}/day`;
  } else {
    summary = `${placeCount} place${placeCount === 1 ? '' : 's'} · ${dailyHours}/day`;
  }

  // Hard-cap at 200 chars (the og:description limit enforced here for safety).
  return summary.length > 200 ? summary.slice(0, 197) + '...' : summary;
}
