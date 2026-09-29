/**
 * M5 Y2.2 — conversion order (0038 CORRECTION) and trip totals.
 */
import { describe, expect, it } from '@jest/globals';
import {
  type ExpenseConversion,
  applyRate,
  bookRate,
  convertAmount,
  convertExpense,
  crossRate,
  expenseInHome,
  isIsoDate,
} from '../convert';
import { toPlainString } from '../decimal';
import { emptyTripMoneySummary, summarizeTripMoney } from '../summary';
import type { MoneyExpense, RateBook } from '../types';

function homeExact(c: ExpenseConversion): string {
  if (c.status !== 'converted') throw new Error(`expected a converted row, got ${c.status}`);
  return toPlainString(c.homeAmount);
}

let seq = 0;
function row(over: Partial<MoneyExpense> = {}): MoneyExpense {
  seq += 1;
  return {
    id: `e${seq}`,
    trip_id: 't1',
    amount: 10,
    kind: 'actual',
    category: 'food',
    day_index: null,
    currency: 'EUR',
    fx_rate: null,
    fx_date: '2026-09-25',
    fx_home_currency: 'TRY',
    ...over,
  };
}

// EUR-based: 1 EUR = 50 TRY = 1.25 USD = 160 JPY on 2026-09-25.
const BOOK: RateBook = {
  '2026-09-25': { TRY: 50, USD: 1.25, JPY: 160 },
  latest: { TRY: 55, USD: 1.1, JPY: 170 },
};

describe('rates', () => {
  it('crossRate goes through EUR (EUR itself = 1) and needs both legs', () => {
    expect(toPlainString(crossRate(BOOK['2026-09-25'], 'EUR', 'TRY')!)).toBe('50');
    expect(toPlainString(crossRate(BOOK['2026-09-25'], 'TRY', 'EUR')!)).toBe('0.02');
    expect(toPlainString(crossRate(BOOK['2026-09-25'], 'USD', 'TRY')!)).toBe('40');
    expect(crossRate(BOOK['2026-09-25'], 'GBP', 'TRY')).toBeNull();
    expect(crossRate(undefined, 'USD', 'TRY')).toBeNull();
    expect(toPlainString(crossRate(undefined, 'TRY', 'TRY')!)).toBe('1');
    expect(bookRate(BOOK, '2026-09-24', 'USD', 'TRY')).toBeNull();
    expect(crossRate({ TRY: 0 }, 'EUR', 'TRY')).toBeNull();
  });

  it('isIsoDate rejects impossible dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-9-1')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  it('applyRate / convertAmount (live preview) round only the display value', () => {
    expect(applyRate('12.5', '35.2134', 'TRY')).toEqual({ currency: 'TRY', exact: '440.1675', value: 440.17 });
    expect(convertAmount(10, 'usd', 'TRY', BOOK['2026-09-25'])).toEqual({ currency: 'TRY', exact: '400', value: 400 });
    expect(convertAmount(10, 'GBP', 'TRY', BOOK['2026-09-25'])).toBeNull();
    expect(convertAmount(10, 'bad', 'TRY', BOOK['2026-09-25'])).toBeNull();
  });
});

describe('convertExpense — the corrected order', () => {
  it('1. same currency and legacy NULL are exactly 1, in every mode', () => {
    const same = convertExpense(row({ currency: 'TRY', fx_rate: 99 }), { home: 'TRY' });
    expect(same).toMatchObject({ status: 'converted', method: 'same_currency' });
    expect(homeExact(same)).toBe('10');
    const legacy = convertExpense(row({ currency: null, fx_rate: null, fx_date: null }), { home: 'TRY' });
    expect(legacy).toMatchObject({ status: 'converted', method: 'legacy', currency: 'TRY' });
    expect(convertExpense(row({ currency: 'TRY' }), { home: 'TRY', rateMode: 'today' })).toMatchObject({
      method: 'same_currency',
    });
  });

  it('2. frozen fx_rate applies ONLY when fx_home_currency is the current home', () => {
    const frozen = convertExpense(row({ fx_rate: 35.5, fx_home_currency: 'TRY' }), { home: 'TRY', book: BOOK });
    expect(frozen).toMatchObject({ status: 'converted', method: 'frozen' });
    expect(homeExact(frozen)).toBe('355');
    // case-insensitive codes from older rows
    expect(convertExpense(row({ fx_rate: 35.5, fx_home_currency: 'try' }), { home: 'try' })).toMatchObject({
      method: 'frozen',
    });
  });

  it('3. home changed → re-derived from the EUR table on fx_date (never the old frozen rate)', () => {
    const e = row({ currency: 'EUR', fx_rate: 35.5, fx_home_currency: 'TRY' });
    const c = convertExpense(e, { home: 'USD', book: BOOK });
    expect(c).toMatchObject({ status: 'converted', method: 'rederived' });
    expect(homeExact(c)).toBe('12.5'); // 10 EUR × 1.25
  });

  it('3. pending (fx_rate NULL) with table rates on fx_date converts via the table', () => {
    const c = convertExpense(row({ currency: 'USD', fx_rate: null }), { home: 'TRY', book: BOOK });
    expect(c).toMatchObject({ method: 'rederived' });
    expect(homeExact(c)).toBe('400');
  });

  it('4. otherwise PENDING — never 1:1 and never the wrong-currency frozen rate', () => {
    expect(convertExpense(row({ fx_rate: null }), { home: 'TRY' })).toMatchObject({
      status: 'pending',
      reason: 'rate_pending',
      currency: 'EUR',
    });
    expect(convertExpense(row({ fx_rate: 35.5, fx_home_currency: 'TRY' }), { home: 'USD' })).toMatchObject({
      status: 'pending',
      reason: 'home_changed',
    });
    expect(convertExpense(row({ fx_rate: null, fx_date: null }), { home: 'TRY', book: BOOK })).toMatchObject({
      status: 'pending',
      reason: 'no_fx_date',
    });
    // table has the date but not the leg
    expect(convertExpense(row({ currency: 'GBP' }), { home: 'TRY', book: BOOK })).toMatchObject({
      status: 'pending',
    });
    expect(expenseInHome(row({ fx_rate: null }), { home: 'TRY' })).toBeNull();
  });

  it("today mode uses today's table for every foreign row, pending when missing", () => {
    const c = convertExpense(row({ fx_rate: 35.5, fx_home_currency: 'TRY' }), { home: 'TRY', book: BOOK, rateMode: 'today' });
    expect(c).toMatchObject({ method: 'today' });
    expect(homeExact(c)).toBe('550');
    expect(convertExpense(row(), { home: 'TRY', rateMode: 'today' })).toMatchObject({
      status: 'pending',
      reason: 'today_rate_missing',
    });
    expect(
      convertExpense(row(), { home: 'TRY', rateMode: 'today', todayRates: { TRY: 60 } }),
    ).toMatchObject({ method: 'today' });
  });

  it('invalid rows are flagged, not converted', () => {
    expect(convertExpense(row({ amount: Number.NaN }), { home: 'TRY' })).toEqual({ status: 'invalid', reason: 'amount' });
    expect(convertExpense(row({ amount: -1 }), { home: 'TRY' })).toEqual({ status: 'invalid', reason: 'amount' });
    expect(convertExpense(row({ currency: 'EURO' }), { home: 'TRY' })).toEqual({ status: 'invalid', reason: 'currency' });
    expect(() => convertExpense(row(), { home: 'lira' })).toThrow(RangeError);
  });
});

describe('summarizeTripMoney', () => {
  const rows: MoneyExpense[] = [
    row({ id: 'a', currency: 'TRY', amount: 100, category: 'food', day_index: 0, kind: 'actual' }),
    row({ id: 'b', currency: 'EUR', amount: 10, fx_rate: 35, fx_home_currency: 'TRY', category: 'food', day_index: 0 }),
    row({ id: 'c', currency: 'EUR', amount: 12.5, fx_rate: null, category: 'transport', day_index: 1 }), // pending (no book)
    row({ id: 'd', currency: 'USD', amount: 20, fx_rate: null, kind: 'estimated', category: 'shopping' }), // pending
    row({ id: 'e', currency: null, amount: 5, fx_rate: null, fx_date: null, category: 'other', day_index: 1 }), // legacy
    row({ id: 'f', currency: 'JPY', amount: 1000, fx_rate: 0.2, fx_home_currency: 'TRY', kind: 'estimated', category: 'accommodation' }),
    row({ id: 'dead', currency: 'TRY', amount: 1e6, deleted: true }),
    row({ id: 'weird', currency: 'TRY', amount: 1, category: 'spa' }), // unknown category → other
    row({ id: 'nokind', currency: 'TRY', amount: 1, kind: 'maybe' }),
  ];

  const summary = summarizeTripMoney(rows, { home: 'TRY', budget: 1000 });

  it('totals only converted rows, in the home currency', () => {
    // actual: 100 + 350 + 5 + 1 = 456; estimated: 200
    expect(summary.total.actual).toEqual({ currency: 'TRY', exact: '456', value: 456 });
    expect(summary.total.estimated).toEqual({ currency: 'TRY', exact: '200', value: 200 });
    expect(summary.counts).toEqual({ total: 8, converted: 5, pending: 2, invalid: 1 });
    expect(summary.methods).toEqual({ same_currency: 2, legacy: 1, frozen: 2, rederived: 0, today: 0 });
  });

  it('reports pending rows per ORIGINAL currency (the get_my_trip_stats mirror)', () => {
    expect(summary.pending.count).toBe(2);
    expect(summary.pending.ids).toEqual(['c', 'd']);
    expect(summary.pending.actualByCurrency).toEqual({ EUR: { currency: 'EUR', exact: '12.5', value: 12.5 } });
    expect(summary.pending.estimatedByCurrency).toEqual({ USD: { currency: 'USD', exact: '20', value: 20 } });
    expect(summary.rows.c).toMatchObject({ status: 'pending', reason: 'rate_pending' });
    expect(summary.rows.nokind).toEqual({ status: 'invalid', reason: 'kind' });
    expect(summary.rows.dead).toBeUndefined();
  });

  it('category grid is complete, unknown categories fold into other, and it sums to the total', () => {
    expect(Object.keys(summary.byCategory)).toEqual([
      'accommodation',
      'food',
      'transport',
      'shopping',
      'activities',
      'other',
    ]);
    expect(summary.byCategory.food.actual.value).toBe(450);
    expect(summary.byCategory.other.actual.value).toBe(6);
    expect(summary.byCategory.other.count).toBe(2);
    expect(summary.byCategory.transport.count).toBe(1); // pending row counted, not summed
    expect(summary.byCategory.transport.actual.value).toBe(0);
    expect(summary.byCategory.accommodation.estimated.value).toBe(200);
    expect(summary.byCategory.accommodation.remaining.value).toBe(200);
    expect(summary.byCategory.activities).toMatchObject({ count: 0, remaining: { value: 0 } });
  });

  it('days sort ascending with trip-level last', () => {
    expect(summary.byDay.map((d) => d.dayIndex)).toEqual([0, 1, null]);
    expect(summary.byDay[0]).toMatchObject({ actual: { value: 450 }, count: 2, pendingCount: 0 });
    expect(summary.byDay[1]).toMatchObject({ actual: { value: 5 }, count: 2, pendingCount: 1 });
  });

  it('per-currency breakdown: home first, original and converted and pending slices', () => {
    expect(summary.byCurrency.map((c) => c.currency)).toEqual(['TRY', 'EUR', 'JPY', 'USD']);
    const eur = summary.byCurrency.find((c) => c.currency === 'EUR')!;
    expect(eur.count).toBe(2);
    expect(eur.original.actual.value).toBe(22.5);
    expect(eur.converted.actual.value).toBe(350);
    expect(eur.pending).toMatchObject({ count: 1, actual: { value: 12.5, currency: 'EUR' } });
    const jpy = summary.byCurrency.find((c) => c.currency === 'JPY')!;
    expect(jpy.original.estimated).toEqual({ currency: 'JPY', exact: '1000', value: 1000 });
    const usd = summary.byCurrency.find((c) => c.currency === 'USD')!;
    expect(usd.converted.estimated.value).toBe(0);
    expect(usd.pending.estimated.value).toBe(20);
  });

  it('budget and remaining are in the home currency', () => {
    expect(summary.budget).toEqual({ currency: 'TRY', exact: '1000', value: 1000 });
    expect(summary.remaining).toEqual({ currency: 'TRY', exact: '544', value: 544 });
    expect(summarizeTripMoney([], { home: 'TRY' }).budget).toBeNull();
  });

  it('once the table has fx_date, the pending rows re-derive and leave the pending report', () => {
    const withBook = summarizeTripMoney(rows, { home: 'TRY', book: BOOK });
    expect(withBook.pending.count).toBe(0);
    // + 12.5 EUR × 50 = 625 actual; + 20 USD × 40 = 800 estimated
    expect(withBook.total.actual.value).toBe(456 + 625);
    expect(withBook.total.estimated.value).toBe(200 + 800);
    expect(withBook.methods.rederived).toBe(2);
  });

  it('empty summary', () => {
    const empty = emptyTripMoneySummary('JPY');
    expect(empty.total.actual).toEqual({ currency: 'JPY', exact: '0', value: 0 });
    expect(empty.byDay).toEqual([]);
    expect(empty.byCurrency).toEqual([]);
    expect(() => summarizeTripMoney([], { home: '' })).toThrow(RangeError);
  });

  it('rounds each displayed total once, to the minor units (JPY)', () => {
    const jpy = summarizeTripMoney(
      [
        row({ currency: 'EUR', amount: 0.3, fx_rate: 160.4, fx_home_currency: 'JPY' }),
        row({ currency: 'EUR', amount: 0.3, fx_rate: 160.4, fx_home_currency: 'JPY' }),
      ],
      { home: 'JPY' },
    );
    // 2 × 48.12 = 96.24 → ¥96 (not 48 + 48 = 96 by accident: exact is kept)
    expect(jpy.total.actual).toEqual({ currency: 'JPY', exact: '96.24', value: 96 });
  });
});
