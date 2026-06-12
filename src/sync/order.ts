/**
 * order.ts — pure display-ordering helpers for trip places (v2 S2.8.5).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DIVERGENCE RISK — BINDING CROSS-REFERENCE (client side; the server file is
 * deliberately untouched by S2.8.5, so this is the only side carrying it):
 *
 *   {@link orderDayPlacesByRank} MUST stay rule-identical to the manual-mode
 *   per-day ordering in `supabase/functions/optimize-trip/index.ts` →
 *   `runManualMode`, step 2 ("Order each day's chain", the block around the
 *   `ranked` / `unranked` partition). That Edge branch is what PERSISTS
 *   `order_in_day` back from `manual_rank` (S2.8.2, C1 loop closure); this
 *   helper is what the UI uses to render the same order BEFORE the recompute
 *   lands (offline drag, pendingRecompute window). If the two ever disagree,
 *   a drag would visibly "snap" to a different order when the Edge recompute
 *   syncs back — the exact class of bug C1 exists to prevent. Any change to
 *   either side must be mirrored in the other within the same phase.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE CANONICAL PER-DAY RULE (verbatim from the Edge function):
 *   - Legacy base order: `order_in_day` asc, NULLs LAST (defensive — a
 *     scheduled row should always carry order_in_day), stable.
 *   - ALL rows in the day lack a string `manual_rank` → the legacy base
 *     order stands. Byte-identical to pre-rank behavior; every v1 trip
 *     (all-NULL ranks) takes this path.
 *   - ANY row carries a rank → ranked rows FIRST, sorted by PLAIN
 *     lexicographic string comparison of `manual_rank` (base-62 fractional
 *     index over 0-9 < A-Z < a-z; JS `<` and Postgres text agree —
 *     src/sync/rank.ts), then NULL-rank rows AFTER, preserving their legacy
 *     base order. This covers the mixed window: "dragged in v1 yesterday
 *     (ranks NULL), drags flag-on today (ranks set)".
 *   - Ties are STABLE everywhere (two clients minting the same rank key
 *     offline keep the legacy base order) — Array.prototype.sort stability
 *     is guaranteed by ES2019 in V8 (Deno, Chrome) and Hermes alike.
 *   - `typeof manual_rank === 'string'` (not `!== null`) so a row missing
 *     the key entirely (undefined — pre-S2 cached shapes) is treated as
 *     unranked instead of poisoning the rank sort.
 *
 * PURE: no I/O, no store access, no React. Importable by the API facade
 * (src/api/trip-places.ts), the UI (ItineraryTab / route-shell stateKey —
 * S2.8.7), and jest property suites comparing against Edge fixtures.
 */

import type { RouteRenderMode } from '../api/types';

/**
 * Structural subset every orderable place row carries — satisfied by the
 * client `TripPlace` type AND by the Edge function's `TripPlaceRow` shape,
 * so fixtures can be shared across both test suites.
 */
export interface DisplayOrderablePlace {
  day_index: number | null;
  order_in_day: number | null;
  /** Optional because pre-S2 read paths / cached rows may omit the key. */
  manual_rank?: string | null;
}

/**
 * Nullable-number ascending comparator with explicit NULL placement.
 * Exported for the trip-places store selector (S2.8.5), which must mirror
 * the v1 SQL contract `order('…', { nullsFirst: true })` exactly.
 */
export function compareNullableNumbersAsc(
  a: number | null,
  b: number | null,
  nulls: 'first' | 'last',
): number {
  if (a === null || b === null) {
    if (a === null && b === null) return 0;
    if (a === null) return nulls === 'first' ? -1 : 1;
    return nulls === 'first' ? 1 : -1;
  }
  return a - b;
}

/**
 * The canonical per-day rule (see module header — MUST mirror
 * optimize-trip's `runManualMode` step 2). Input is ONE day's places in any
 * order; output is a NEW array (input never mutated).
 */
export function orderDayPlacesByRank<T extends DisplayOrderablePlace>(
  dayPlaces: readonly T[],
): T[] {
  // 1. Legacy base order: order_in_day asc, NULLs last, stable. (The Edge
  //    function sorts with `?? Number.MAX_SAFE_INTEGER` — same ordering.)
  const list = [...dayPlaces].sort((a, b) =>
    compareNullableNumbersAsc(a.order_in_day, b.order_in_day, 'last'),
  );
  // 2. Partition on `typeof === 'string'` (undefined AND null are unranked).
  const ranked = list.filter(
    (p): p is T & { manual_rank: string } => typeof p.manual_rank === 'string',
  );
  if (ranked.length === 0) return list; // all-NULL day → legacy order stands
  const unranked = list.filter((p) => typeof p.manual_rank !== 'string');
  // 3. Plain lexicographic string compare — NOT localeCompare (locale
  //    collation can disagree with Postgres text order; JS `<` over the
  //    base-62 ASCII alphabet is what rank.ts guarantees agreement on).
  //    Ties return 0 → stable sort keeps the legacy base order.
  ranked.sort((a, b) =>
    a.manual_rank < b.manual_rank ? -1 : a.manual_rank > b.manual_rank ? 1 : 0,
  );
  return [...ranked, ...unranked];
}

/**
 * Full-list display ordering for a trip's places (the S2.8.5 helper the
 * S2.8.7 ItineraryTab repoint + route-shell stateKey consume).
 *
 * Day grouping: unscheduled (day_index NULL) first, then days ascending —
 * today's SQL contract (`order('day_index', { nullsFirst: true })`).
 *
 * Within each SCHEDULED day:
 *   - rank-aware (`renderMode === 'manual' && tier1Active`) → the canonical
 *     Edge rule via {@link orderDayPlacesByRank}. Gated on BOTH flags so
 *     flag-off display stays byte-identical to v1 (flag-off clients see rank
 *     order only after the server recompute writes order_in_day — S2.8.2),
 *     and optimized-mode display always follows the optimizer's own
 *     order_in_day.
 *   - otherwise → the v1 SQL order (`order_in_day` asc, NULLs FIRST). Note
 *     the deliberate asymmetry with the rank branch's NULLs-LAST base: each
 *     branch mirrors ITS canonical source (SQL ORDER BY vs. the Edge rule);
 *     the difference is observable only for the degenerate scheduled-row-
 *     without-order_in_day case, which the optimizer never produces.
 *
 * The unscheduled (Ideas) group is NEVER rank-ordered — the Edge function
 * skips day_index-NULL rows entirely, so applying ranks there would diverge
 * from what a recompute persists.
 *
 * Stable: ties preserve input order, so feeding it the already-sorted
 * useTripPlaces result is deterministic and (flag-off) an identity re-sort.
 */
export function orderPlacesForDisplay<T extends DisplayOrderablePlace>(
  places: readonly T[],
  renderMode: RouteRenderMode,
  tier1Active: boolean,
): T[] {
  const rankAware = renderMode === 'manual' && tier1Active;

  // Partition by day, preserving input order inside each bucket.
  const unscheduled: T[] = [];
  const byDay = new Map<number, T[]>();
  for (const p of places) {
    if (p.day_index === null) {
      unscheduled.push(p);
      continue;
    }
    const bucket = byDay.get(p.day_index);
    if (bucket) bucket.push(p);
    else byDay.set(p.day_index, [p]);
  }

  const legacySqlOrder = (group: T[]): T[] =>
    [...group].sort((a, b) => compareNullableNumbersAsc(a.order_in_day, b.order_in_day, 'first'));

  const out: T[] = legacySqlOrder(unscheduled);
  for (const dayIndex of [...byDay.keys()].sort((a, b) => a - b)) {
    const bucket = byDay.get(dayIndex);
    if (!bucket) continue; // unreachable — keys come from the map itself
    out.push(...(rankAware ? orderDayPlacesByRank(bucket) : legacySqlOrder(bucket)));
  }
  return out;
}
