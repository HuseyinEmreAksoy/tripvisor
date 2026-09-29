/**
 * M5 Y2.2 — "rate pending" reconciliation helpers and home-change planning.
 */
import { describe, expect, it } from '@jest/globals';
import {
  addDaysIso,
  fxRequestDate,
  localIsoDate,
  mergeRateNeeds,
  missingRateNeeds,
  needsRateFill,
  needsRederive,
  planHomeCurrencyChange,
  planRateFills,
  rateFillPatch,
  rateNeeds,
  wantedRateDate,
} from '../reconcile';
import type { MoneyExpense } from '../types';

function row(over: Partial<MoneyExpense> = {}): MoneyExpense {
  return {
    id: 'x',
    trip_id: 't1',
    amount: 10,
    kind: 'actual',
    currency: 'EUR',
    fx_rate: null,
    fx_date: '2026-09-20',
    fx_home_currency: 'TRY',
    ...over,
  };
}

describe('dates', () => {
  it('localIsoDate / addDaysIso are calendar arithmetic', () => {
    expect(localIsoDate(new Date(2026, 8, 29, 23, 59))).toBe('2026-09-29');
    expect(addDaysIso('2026-09-29', 3)).toBe('2026-10-02');
    expect(addDaysIso('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
    expect(() => addDaysIso('bad', 1)).toThrow(RangeError);
  });

  it('wantedRateDate: fx_date → start + day_index → created_at → today, clamped to today', () => {
    const today = '2026-09-29';
    expect(wantedRateDate({ fx_date: '2026-09-20' }, { today })).toBe('2026-09-20');
    expect(wantedRateDate({ fx_date: null, day_index: 2 }, { today, tripStartDate: '2026-09-10' })).toBe('2026-09-12');
    expect(wantedRateDate({ fx_date: null, day_index: 2 }, { today, tripStartDate: '2026-10-10' })).toBe(today); // future day
    expect(wantedRateDate({ fx_date: null, created_at: '2026-09-01T10:00:00Z' }, { today })).toBe('2026-09-01');
    expect(wantedRateDate({ fx_date: null }, { today })).toBe(today);
    expect(wantedRateDate({ fx_date: '2027-01-01' }, { today })).toBe(today);
  });

  it("fxRequestDate: past days as-is, today or later is 'latest'", () => {
    expect(fxRequestDate('2026-09-28', '2026-09-29')).toBe('2026-09-28');
    expect(fxRequestDate('2026-09-29', '2026-09-29')).toBe('latest');
    expect(fxRequestDate('2026-10-01', '2026-09-29')).toBe('latest');
    expect(fxRequestDate('nope', '2026-09-29')).toBe('latest');
  });
});

describe('needsRateFill / needsRederive', () => {
  it('a foreign row without a frozen rate needs a fill', () => {
    expect(needsRateFill(row(), 'TRY')).toBe(true);
    expect(needsRateFill(row({ fx_rate: 35 }), 'TRY')).toBe(false);
    expect(needsRateFill(row({ currency: 'TRY' }), 'TRY')).toBe(false);
    expect(needsRateFill(row({ currency: null }), 'TRY')).toBe(false);
    expect(needsRateFill(row({ deleted: true }), 'TRY')).toBe(false);
    expect(needsRateFill(row(), null)).toBe(false);
  });

  it('a row frozen into an old home needs re-derivation, not a fill', () => {
    expect(needsRederive(row({ fx_rate: 35, fx_home_currency: 'TRY' }), 'USD')).toBe(true);
    expect(needsRederive(row({ fx_rate: 35, fx_home_currency: 'TRY' }), 'TRY')).toBe(false);
    expect(needsRederive(row({ fx_rate: null }), 'USD')).toBe(false);
    expect(needsRederive(row({ currency: 'USD', fx_rate: 35 }), 'USD')).toBe(false);
  });
});

describe('planRateFills', () => {
  it('groups pending rows by trip/currency/request date and skips unknown homes', () => {
    const rows = [
      row({ id: 'a', fx_date: '2026-09-20' }),
      row({ id: 'b', fx_date: '2026-09-20' }),
      row({ id: 'c', currency: 'USD', fx_date: '2026-09-20' }),
      row({ id: 'd', fx_date: '2026-09-29' }), // today → latest
      row({ id: 'e', fx_rate: 35 }), // already frozen
      row({ id: 'f', trip_id: 'unknown-trip' }),
      row({ id: 'g', trip_id: undefined }),
    ];
    const groups = planRateFills(rows, (tripId) => (tripId === 't1' ? 'TRY' : null), { today: '2026-09-29' });
    expect(groups).toEqual([
      { tripId: 't1', from: 'EUR', to: 'TRY', date: '2026-09-20', requestDate: '2026-09-20', ids: ['a', 'b'] },
      { tripId: 't1', from: 'USD', to: 'TRY', date: '2026-09-20', requestDate: '2026-09-20', ids: ['c'] },
      { tripId: 't1', from: 'EUR', to: 'TRY', date: '2026-09-29', requestDate: 'latest', ids: ['d'] },
    ]);
  });

  it('uses the trip start date for rows without fx_date', () => {
    const groups = planRateFills([row({ id: 'a', fx_date: null, day_index: 1 })], () => 'TRY', {
      today: '2026-09-29',
      startDateOf: () => '2026-09-01',
    });
    expect(groups[0]).toMatchObject({ date: '2026-09-02', requestDate: '2026-09-02' });
  });

  it('rateFillPatch validates what it writes (mirrors the DB CHECKs)', () => {
    expect(rateFillPatch(35.2, '2026-09-20', 'try')).toEqual({
      fx_rate: 35.2,
      fx_date: '2026-09-20',
      fx_home_currency: 'TRY',
    });
    expect(() => rateFillPatch(0, '2026-09-20', 'TRY')).toThrow(RangeError);
    expect(() => rateFillPatch(Number.NaN, '2026-09-20', 'TRY')).toThrow(RangeError);
    expect(() => rateFillPatch(1, '2026-02-30', 'TRY')).toThrow(RangeError);
    expect(() => rateFillPatch(1, '2026-09-20', 'LIRA')).toThrow(RangeError);
  });
});

describe('rate needs (warm fx for every distinct fx_date)', () => {
  const rows = [
    row({ id: 'a', currency: 'EUR', fx_rate: 35, fx_home_currency: 'TRY', fx_date: '2026-09-20' }),
    row({ id: 'b', currency: 'USD', fx_rate: null, fx_date: '2026-09-20' }),
    row({ id: 'c', currency: 'USD', fx_rate: 1.2, fx_home_currency: 'USD', fx_date: '2026-09-21' }),
    row({ id: 'd', currency: 'GBP', fx_rate: null, fx_date: null }),
    row({ id: 'e', currency: 'TRY', fx_date: '2026-09-22' }),
    row({ id: 'f', currency: 'JPY', fx_rate: 0.3, fx_home_currency: 'TRY', fx_date: '2026-09-23', deleted: true }),
  ];

  it('lists the days + codes step 3 would read under a home', () => {
    // a is frozen into TRY (no table needed); b is pending; c is frozen into USD (≠ TRY);
    // d has no fx_date; e is already TRY; f is a tombstone.
    expect(rateNeeds(rows, 'TRY')).toEqual([
      { date: '2026-09-20', currencies: ['TRY', 'USD'] },
      { date: '2026-09-21', currencies: ['TRY', 'USD'] },
    ]);
    // After switching home to USD: a (EUR→USD) and e (TRY→USD) need the table; b and c are USD (rate 1).
    expect(rateNeeds(rows, 'USD')).toEqual([
      { date: '2026-09-20', currencies: ['USD'] }, // the EUR leg is implicit (1)
      { date: '2026-09-22', currencies: ['TRY', 'USD'] },
    ]);
    expect(rateNeeds(rows, 'lira')).toEqual([]);
  });

  it('merge + missing against a book', () => {
    const merged = mergeRateNeeds([
      [{ date: '2026-09-20', currencies: ['TRY', 'USD'] }],
      [
        { date: '2026-09-20', currencies: ['GBP', 'EUR'] },
        { date: '2026-09-19', currencies: ['JPY'] },
      ],
    ]);
    expect(merged).toEqual([
      { date: '2026-09-19', currencies: ['JPY'] },
      { date: '2026-09-20', currencies: ['GBP', 'TRY', 'USD'] },
    ]);
    const full = { '2026-09-19': { JPY: 160 }, '2026-09-20': { TRY: 50, USD: 1.2, GBP: 0.85 } };
    expect(missingRateNeeds(full, merged)).toEqual([]);
    expect(missingRateNeeds({ '2026-09-20': { TRY: 50 } }, merged)).toEqual(merged);
    expect(missingRateNeeds(undefined, merged)).toEqual(merged);
  });

  it('planHomeCurrencyChange counts what the confirm dialog explains', () => {
    const plan = planHomeCurrencyChange(rows, 'TRY', 'usd');
    expect(plan).toMatchObject({
      from: 'TRY',
      to: 'USD',
      total: 5,
      alreadyInNewHome: 2, // b, c
      frozenIntoNewHome: 0,
      toRederive: 2, // a, e
      withoutDate: 1, // d
    });
    expect(plan.needs).toEqual(rateNeeds(rows, 'USD'));
    expect(() => planHomeCurrencyChange(rows, 'TRY', 'dollars')).toThrow(RangeError);
  });
});
