/**
 * Insights spending aggregation (M5 Y3.2 / F14): turns trips + MV rows +
 * live money summaries into per-HOME-CURRENCY groups.
 *
 * Rules:
 *   - Never add `trip_expenses.amount` directly: it is in the row's ORIGINAL
 *     currency. Live values come from `useMoneySummaries` (converted into the
 *     trip's home currency, pending rows excluded) — the same unit as the
 *     nightly MV's `total_actual_spend` (0034/0038).
 *   - Never add values from trips with different home currencies together:
 *     every chart is drawn once per home currency group.
 *   - Pending (not yet converted) amounts are reported per ORIGINAL currency
 *     and never converted here.
 */
import { normalizeCurrency, type TripMoneySummary } from '@/lib/money';
import type { TripStatsRow } from '@/api/trip-stats';
import type { TripExpenseCategory } from '@/api/types';

export const EXPENSE_CATEGORIES: readonly TripExpenseCategory[] = [
  'accommodation',
  'food',
  'transport',
  'shopping',
  'activities',
  'other',
];

export interface SpendingTripInput {
  id: string;
  title: string;
  currency: string | null | undefined;
  start_date?: string | null;
}

export interface SpendingTripTotal {
  tripId: string;
  title: string;
  startDate: string | null;
  /** Converted actual spend in the group's home currency. */
  value: number;
}

export interface SpendingGroup {
  /** The home currency every value in this group is in. */
  currency: string;
  /** Trips with spend > 0, in input order. */
  perTrip: SpendingTripTotal[];
  /** Live converted actual spend per category (only categories > 0, fixed order). */
  byCategory: { category: TripExpenseCategory; value: number }[];
  /** Pending actual amounts per ORIGINAL currency (not in the totals). */
  pendingByCurrency: Record<string, number>;
  pendingCount: number;
  /** Sum of perTrip values (same unit). */
  total: number;
}

export function buildSpendingGroups(
  trips: readonly SpendingTripInput[],
  statsByTrip: ReadonlyMap<string, TripStatsRow>,
  summaries: Record<string, TripMoneySummary> | undefined,
): SpendingGroup[] {
  const groups = new Map<string, SpendingGroup>();
  const groupFor = (currency: string): SpendingGroup => {
    let g = groups.get(currency);
    if (!g) {
      g = { currency, perTrip: [], byCategory: [], pendingByCurrency: {}, pendingCount: 0, total: 0 };
      groups.set(currency, g);
    }
    return g;
  };
  const categoryTotals = new Map<string, Map<TripExpenseCategory, number>>();

  for (const trip of trips) {
    const summary = summaries?.[trip.id];
    // MV total_actual_spend is in trips.currency; the live summary's `home` is too.
    const home = normalizeCurrency(trip.currency) ?? summary?.home ?? null;
    if (!home) continue; // Unknown unit: never mix it into a chart.
    const mv = statsByTrip.get(trip.id);

    let value = 0;
    let pendingCount = 0;
    let pending: Record<string, number> = {};
    if (mv) {
      value = Number(mv.total_actual_spend) || 0;
      pendingCount = mv.pending_count ?? 0;
      for (const [code, amount] of Object.entries(mv.pending_actual_by_currency ?? {})) {
        if (typeof amount === 'number' && amount > 0) pending[code] = amount;
      }
    } else if (summary) {
      value = summary.total.actual.value;
      pendingCount = summary.pending.count;
      pending = {};
      for (const [code, money] of Object.entries(summary.pending.actualByCurrency)) {
        if (money.value > 0) pending[code] = money.value;
      }
    }

    // Categories are always live (the MV has no breakdown), same home unit.
    if (summary && summary.home === home) {
      let cats = categoryTotals.get(home);
      if (!cats) {
        cats = new Map();
        categoryTotals.set(home, cats);
      }
      for (const cat of EXPENSE_CATEGORIES) {
        const v = summary.byCategory[cat]?.actual.value ?? 0;
        if (v > 0) cats.set(cat, (cats.get(cat) ?? 0) + v);
      }
    }

    if (value <= 0 && pendingCount === 0) continue;
    const g = groupFor(home);
    if (value > 0) {
      g.perTrip.push({ tripId: trip.id, title: trip.title, startDate: trip.start_date ?? null, value });
      g.total += value;
    }
    g.pendingCount += pendingCount;
    for (const [code, amount] of Object.entries(pending)) {
      g.pendingByCurrency[code] = (g.pendingByCurrency[code] ?? 0) + amount;
    }
  }

  for (const [home, cats] of categoryTotals) {
    const g = groups.get(home) ?? (cats.size > 0 ? groupFor(home) : undefined);
    if (!g) continue;
    g.byCategory = EXPENSE_CATEGORIES.filter((c) => (cats.get(c) ?? 0) > 0).map((c) => ({
      category: c,
      value: cats.get(c) ?? 0,
    }));
  }

  // Largest group first (by trip count, then total, then code) so the main
  // home currency leads.
  return [...groups.values()]
    .filter((g) => g.perTrip.length > 0 || g.byCategory.length > 0 || g.pendingCount > 0)
    .sort(
      (a, b) =>
        b.perTrip.length - a.perTrip.length || b.total - a.total || a.currency.localeCompare(b.currency),
    );
}

/** Spending-over-time points for one group: dated trips, ascending; only when ≥ 3. */
export function spendingOverTime(group: SpendingGroup): { label: string; value: number }[] {
  const points = group.perTrip
    .filter((p) => Boolean(p.startDate))
    .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))
    .map((p) => ({ label: (p.startDate ?? '').slice(0, 7), value: p.value }));
  return points.length >= 3 ? points : [];
}
