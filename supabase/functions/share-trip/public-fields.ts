// share-trip — allow-lists for the ANONYMOUS `op: "read"` payload.
//
// Pure module (no Deno / network imports) so the allow-lists can be unit
// tested in isolation and type-checked by the repo-root tsc.
//
// Why an explicit allow-list (and not just the PostgREST `select` string):
// the read runs under the service-role client, so the response shape is the
// ONLY thing standing between a stranger holding a link and the trip's
// private data. The same key lists drive both the `select` (least data
// fetched) and `pickPublic` (least data returned), so a future edit to one
// cannot silently widen the other.
//
// contractVersion history (`meta.contractVersion` on the read response):
//   1 (implicit — v1 responses carried no `meta`):
//       trip.id + places[].notes were returned.
//   2 (security audit #12, 2026-09-29):
//       - `trip.id` REMOVED — the public page never needed it, and the trip
//         uuid is the key of every RLS/Storage path; no reason to hand it to
//         anonymous viewers.
//       - `places[].notes` REMOVED — product decision: notes are PRIVATE by
//         default ("memories are private by default"). Day notes
//         (`trip_days.notes`) were never part of the payload and stay out.
//         The M5 plan adds per-trip public-link toggles; when a "show notes"
//         toggle lands it must be an explicit opt-in read here, gated on the
//         owner's flag, and bump the contract version again.
//   Removing fields is normally a parallel-version change, but this is a
//   data-exposure fix: keeping v1 alive for old binaries would keep the leak
//   alive. Every shipped consumer already tolerates the missing fields
//   (`SharedTimeline` guards `place.notes ?`, nothing reads `trip.id`,
//   `functions/share/[token].ts` reads only title/dates + places.length).

export const SHARE_READ_CONTRACT_VERSION = 2 as const;

export const PUBLIC_TRIP_KEYS = [
  'title',
  'start_date',
  'end_date',
  'daily_hours_budget',
  'transport_mode',
  'timezone',
] as const;

export const PUBLIC_PLACE_KEYS = [
  'id',
  'google_place_id',
  'user_title',
  'category',
  'lat',
  'lng',
  'visit_duration_minutes',
  'day_index',
  'order_in_day',
] as const;

export const PUBLIC_LEG_KEYS = [
  'id',
  'from_place_id',
  'to_place_id',
  'day_index',
  'transport_mode',
  'duration_seconds',
  'distance_meters',
  'polyline',
  'computed_at',
] as const;

/** Keys that must NEVER appear on the anonymous read payload (regression guard). */
export const FORBIDDEN_PUBLIC_KEYS = ['user_id', 'notes'] as const;

export const TRIP_FIELDS = PUBLIC_TRIP_KEYS.join(', ');
export const PLACE_FIELDS = PUBLIC_PLACE_KEYS.join(', ');
export const LEG_FIELDS = PUBLIC_LEG_KEYS.join(', ');

type Row = Record<string, unknown>;

/**
 * Copy only `keys` from `row`. Keys absent on the row are omitted (not set to
 * undefined) so the JSON shape mirrors what the DB returned.
 */
export function pickPublic<K extends string>(row: Row, keys: readonly K[]): Partial<Record<K, unknown>> {
  const out: Partial<Record<K, unknown>> = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(row, k)) out[k] = row[k];
  }
  return out;
}

export interface PublicSharePayload {
  trip: Partial<Record<(typeof PUBLIC_TRIP_KEYS)[number], unknown>>;
  places: Array<Partial<Record<(typeof PUBLIC_PLACE_KEYS)[number], unknown>>>;
  legs: Array<Partial<Record<(typeof PUBLIC_LEG_KEYS)[number], unknown>>>;
  meta: { contractVersion: typeof SHARE_READ_CONTRACT_VERSION };
}

/** Shape the anonymous read response from raw DB rows (allow-list only). */
export function buildPublicSharePayload(input: {
  trip: Row;
  places: readonly Row[] | null | undefined;
  legs: readonly Row[] | null | undefined;
}): PublicSharePayload {
  return {
    trip: pickPublic(input.trip, PUBLIC_TRIP_KEYS),
    places: (input.places ?? []).map((p) => pickPublic(p, PUBLIC_PLACE_KEYS)),
    legs: (input.legs ?? []).map((l) => pickPublic(l, PUBLIC_LEG_KEYS)),
    meta: { contractVersion: SHARE_READ_CONTRACT_VERSION },
  };
}
