/**
 * F14: Insights spending never adds raw `amount` across currencies and never
 * mixes trips with different home currencies in one series.
 */
import { describe, expect, it } from '@jest/globals';
import { summarizeTripMoney, type MoneyExpense, type TripMoneySummary } from '@/lib/money';
import type { TripStatsRow } from '@/api/trip-stats';
import { buildSpendingGroups, spendingOverTime } from '../spending';

const trips = [
  { id: 'try-trip', title: 'Antalya', currency: 'TRY', start_date: '2026-05-01' },
  { id: 'eur-trip', title: 'Lisbon', currency: 'EUR', start_date: '2026-06-01' },
];

const tryRows: MoneyExpense[] = [
  { id: 'a', trip_id: 'try-trip', amount: 30000, kind: 'actual', category: 'accommodation', currency: 'TRY' },
  // €100 converted at a frozen 37 TRY/EUR.
  { id: 'b', trip_id: 'try-trip', amount: 100, kind: 'actual', category: 'food', currency: 'EUR', fx_rate: 37, fx_home_currency: 'TRY', fx_date: '2026-05-02' },
];
const eurRows: MoneyExpense[] = [
  { id: 'c', trip_id: 'eur-trip', amount: 500, kind: 'actual', category: 'accommodation', currency: 'EUR' },
  // $200 dinner with no rate yet: pending, excluded from totals.
  { id: 'd', trip_id: 'eur-trip', amount: 200, kind: 'actual', category: 'food', currency: 'USD', fx_rate: null, fx_date: '2026-06-02' },
];

function summaries(): Record<string, TripMoneySummary> {
  return {
    'try-trip': summarizeTripMoney(tryRows, { home: 'TRY' }),
    'eur-trip': summarizeTripMoney(eurRows, { home: 'EUR' }),
  };
}

describe('buildSpendingGroups', () => {
  it('groups by home currency with converted live totals and pending notes', () => {
    const groups = buildSpendingGroups(trips, new Map(), summaries());
    expect(groups.map((g) => g.currency).sort()).toEqual(['EUR', 'TRY']);

    const tryGroup = groups.find((g) => g.currency === 'TRY')!;
    expect(tryGroup.perTrip).toEqual([
      { tripId: 'try-trip', title: 'Antalya', startDate: '2026-05-01', value: 33700 },
    ]);
    expect(tryGroup.byCategory).toEqual([
      { category: 'accommodation', value: 30000 },
      { category: 'food', value: 3700 },
    ]);

    const eurGroup = groups.find((g) => g.currency === 'EUR')!;
    expect(eurGroup.total).toBe(500);
    expect(eurGroup.byCategory).toEqual([{ category: 'accommodation', value: 500 }]);
    expect(eurGroup.pendingCount).toBe(1);
    expect(eurGroup.pendingByCurrency).toEqual({ USD: 200 });
  });

  it('prefers the MV total (home currency) and its pending report for trips it has', () => {
    const mv: TripStatsRow = {
      user_id: 'u',
      trip_id: 'eur-trip',
      total_actual_spend: 480,
      total_estimated_spend: 0,
      liked_count: 0,
      disliked_count: 0,
      place_count: 0,
      pending_count: 2,
      pending_actual_by_currency: { USD: 250 },
    };
    const groups = buildSpendingGroups(trips, new Map([['eur-trip', mv]]), summaries());
    const eurGroup = groups.find((g) => g.currency === 'EUR')!;
    expect(eurGroup.perTrip[0]?.value).toBe(480);
    expect(eurGroup.pendingByCurrency).toEqual({ USD: 250 });
    expect(eurGroup.pendingCount).toBe(2);
  });

  it('skips trips without a home currency and renders nothing without summaries', () => {
    expect(buildSpendingGroups([{ id: 'x', title: 'X', currency: null }], new Map(), undefined)).toEqual([]);
    expect(buildSpendingGroups(trips, new Map(), undefined)).toEqual([]);
  });

  it('spendingOverTime needs three dated trips in one currency', () => {
    const [group] = buildSpendingGroups(trips.slice(0, 1), new Map(), summaries());
    expect(spendingOverTime(group!)).toEqual([]);
    const three = {
      currency: 'TRY',
      perTrip: [
        { tripId: '3', title: 'C', startDate: '2026-03-01', value: 3 },
        { tripId: '1', title: 'A', startDate: '2026-01-01', value: 1 },
        { tripId: '2', title: 'B', startDate: '2026-02-01', value: 2 },
      ],
      byCategory: [],
      pendingByCurrency: {},
      pendingCount: 0,
      total: 6,
    };
    expect(spendingOverTime(three).map((p) => p.label)).toEqual(['2026-01', '2026-02', '2026-03']);
  });
});
