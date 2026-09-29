import { describe, expect, it } from '@jest/globals';
import {
  applyAmountKey,
  dailySpend,
  parseAmount,
  shortDayLabel,
  todayDayIndex,
  type AmountKey,
} from '../expenseMath';
import type { TripExpense } from '@/api/types';

function press(keys: AmountKey[], start = ''): string {
  return keys.reduce((text, key) => applyAmountKey(text, key), start);
}

function expense(overrides: Partial<TripExpense>): TripExpense {
  return {
    id: Math.random().toString(36),
    trip_id: 't1',
    category: 'food',
    amount: 10,
    kind: 'actual',
    day_index: null,
    label: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('applyAmountKey', () => {
  it('builds a decimal amount', () => {
    expect(press(['1', '2', '.', '5', '0'])).toBe('12.50');
  });
  it('caps decimals at two and allows a single point', () => {
    expect(press(['3', '.', '1', '4', '1', '.'])).toBe('3.14');
  });
  it('turns a leading point into 0. and replaces a lone zero', () => {
    expect(press(['.'])).toBe('0.');
    expect(press(['0', '7'])).toBe('7');
  });
  it('backspaces and normalizes a typed comma', () => {
    expect(press(['back'], '12,5')).toBe('12.');
    expect(press(['back'], '')).toBe('');
  });
  it('stops at the max length', () => {
    expect(applyAmountKey('1234567890', '1')).toBe('1234567890');
  });
});

describe('parseAmount', () => {
  it('parses dot and comma decimals, rejects empty/negative', () => {
    expect(parseAmount('9.99')).toBe(9.99);
    expect(parseAmount('9,5')).toBe(9.5);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('-3')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
});

describe('todayDayIndex', () => {
  it('returns the 0-based day inside the trip', () => {
    expect(todayDayIndex('2026-05-10', 5, new Date(2026, 4, 12, 23, 30))).toBe(2);
  });
  it('returns null outside the trip or without dates', () => {
    expect(todayDayIndex('2026-05-10', 5, new Date(2026, 4, 9))).toBeNull();
    expect(todayDayIndex('2026-05-10', 5, new Date(2026, 4, 15))).toBeNull();
    expect(todayDayIndex(null, 5, new Date())).toBeNull();
  });
});

describe('shortDayLabel', () => {
  it('uses weekday + date when the trip has a start date', () => {
    // 2026-05-10 is a Sunday.
    expect(shortDayLabel('2026-05-10', 0)).toBe('Sun 10');
    expect(shortDayLabel('2026-05-30', 2)).toBe('Mon 1');
  });
  it('falls back to Day N', () => {
    expect(shortDayLabel(null, 3)).toBe('Day 4');
  });
});

describe('dailySpend', () => {
  it('sums actual spend per day and ignores estimates', () => {
    const result = dailySpend(
      [
        expense({ day_index: 0, amount: 20 }),
        expense({ day_index: 0, amount: 5 }),
        expense({ day_index: 2, amount: 40 }),
        expense({ day_index: 1, amount: 999, kind: 'estimated' }),
        expense({ day_index: null, amount: 7 }),
      ],
      3,
    );
    expect(result.days).toEqual([25, 0, 40]);
    expect(result.unassigned).toBe(7);
    expect(result.max).toBe(40);
    expect(result.averagePerActiveDay).toBe(32.5);
  });
  it('widens past dayCount for pinned expenses and skips tombstones', () => {
    const result = dailySpend(
      [expense({ day_index: 4, amount: 10 }), expense({ day_index: 0, amount: 3, deleted: true })],
      2,
    );
    expect(result.days).toEqual([0, 0, 0, 0, 10]);
  });
});

describe('parseAmount (locale-aware grouping)', () => {
  it('never reads a thousands separator as a decimal point', () => {
    expect(parseAmount('1,250', { language: 'en' })).toBe(1250);
    expect(parseAmount('5,000')).toBe(5000);
    expect(parseAmount('10.000', { language: 'tr' })).toBe(10000);
    expect(parseAmount('12,5', { language: 'tr' })).toBe(12.5);
    expect(parseAmount('1.234,56', { language: 'tr' })).toBe(1234.56);
  });
  it('still accepts keypad-style dot decimals in tr', () => {
    expect(parseAmount('12.5', { language: 'tr' })).toBe(12.5);
  });
});

describe('dailySpend (multi-currency)', () => {
  it('sums converted home values only and counts pending rows separately', () => {
    const jpy = expense({ id: 'jpy', day_index: 1, amount: 2000, currency: 'JPY' });
    const eur = expense({ id: 'eur', day_index: 1, amount: 20, currency: 'EUR' });
    const usd = expense({ id: 'usd', day_index: null, amount: 50, currency: 'USD' });
    const home = (value: number) => ({ currency: 'EUR', exact: String(value), value });
    const result = dailySpend([jpy, eur, usd], 2, {
      home: 'EUR',
      rows: {
        jpy: { status: 'converted', method: 'stored', original: { currency: 'JPY', exact: '2000', value: 2000 }, home: home(12.5), rate: 0.00625 },
        eur: { status: 'converted', method: 'identity', original: home(20), home: home(20), rate: 1 },
        usd: { status: 'pending', reason: 'no_rate', original: { currency: 'USD', exact: '50', value: 50 } },
      } as never,
    });
    expect(result.days).toEqual([0, 32.5]);
    expect(result.unassigned).toBe(0);
    expect(result.pendingUnassigned).toBe(1);
  });
  it('without a summary, skips foreign-currency rows instead of adding them 1:1', () => {
    const result = dailySpend(
      [
        expense({ day_index: 0, amount: 2000, currency: 'JPY' }),
        expense({ day_index: 0, amount: 20, currency: 'EUR' }),
        expense({ day_index: 0, amount: 5 }),
      ],
      1,
      { home: 'EUR' },
    );
    expect(result.days).toEqual([25]);
    expect(result.pendingDays).toEqual([1]);
  });
});
