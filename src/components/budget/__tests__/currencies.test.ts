import { describe, expect, it } from '@jest/globals';
import {
  COMMON_CURRENCIES,
  allCurrencyCodes,
  convertBudget,
  filterCurrencies,
  foldForSearch,
  recentCurrencies,
  suggestedCurrencies,
} from '../currencies';
import { amountToInputText, applyAmountKey } from '../expenseMath';

describe('recentCurrencies', () => {
  it('orders distinct codes by latest use, skipping home, NULL and tombstones', () => {
    const rows = [
      { currency: 'usd', created_at: '2026-09-01T10:00:00Z' },
      { currency: 'EUR', created_at: '2026-09-03T10:00:00Z' },
      { currency: 'USD', created_at: '2026-09-05T10:00:00Z' },
      { currency: 'TRY', created_at: '2026-09-06T10:00:00Z' },
      { currency: null, created_at: '2026-09-07T10:00:00Z' },
      { currency: 'GBP', created_at: '2026-09-08T10:00:00Z', deleted: true },
    ];
    expect(recentCurrencies(rows, 'TRY')).toEqual(['USD', 'EUR']);
    expect(recentCurrencies(rows, 'TRY', 1)).toEqual(['USD']);
    expect(recentCurrencies(undefined, 'TRY')).toEqual([]);
  });
});

describe('suggestedCurrencies', () => {
  it('home first, then recent, extras up to max, and always the selection', () => {
    expect(suggestedCurrencies({ home: 'TRY', recent: ['EUR'], extra: ['EUR', 'USD', 'GBP'], max: 3 })).toEqual([
      'TRY',
      'EUR',
      'USD',
    ]);
    expect(suggestedCurrencies({ home: 'TRY', recent: [], selected: 'JPY', max: 2, extra: ['EUR', 'USD'] })).toEqual([
      'TRY',
      'EUR',
      'JPY',
    ]);
    expect(suggestedCurrencies({ home: 'bad!', recent: ['eur'] })).toEqual(['EUR']);
  });
});

describe('filterCurrencies', () => {
  const names: Record<string, string> = { EUR: 'Euro', JPY: 'Japon Yeni', TRY: 'Türk Lirası', ISK: 'İzlanda Kronu' };
  const nameOf = (c: string) => names[c] ?? c;
  const codes = ['EUR', 'JPY', 'TRY', 'ISK'];

  it('matches code prefixes first, then names (case/accent/Turkish-i insensitive)', () => {
    expect(filterCurrencies(codes, 'yen', nameOf)).toEqual(['JPY']);
    expect(filterCurrencies(codes, 'tr', nameOf)).toEqual(['TRY']);
    expect(filterCurrencies(codes, 'turk', nameOf)).toEqual(['TRY']);
    expect(filterCurrencies(codes, 'izlanda', nameOf)).toEqual(['ISK']);
    expect(filterCurrencies(codes, '  ', nameOf)).toEqual(codes);
    expect(filterCurrencies(codes, 'zzz', nameOf)).toEqual([]);
  });

  it('folds for search', () => {
    expect(foldForSearch(' Türk Lirası ')).toBe('turk lirasi');
  });
});

describe('allCurrencyCodes', () => {
  it('keeps the common list first and appends the server list A→Z without duplicates', () => {
    const all = allCurrencyCodes(['XOF', 'eur', 'AMD', 'bad!']);
    expect(all.slice(0, COMMON_CURRENCIES.length)).toEqual([...COMMON_CURRENCIES]);
    expect(all.slice(COMMON_CURRENCIES.length)).toEqual(['AMD', 'XOF']);
  });
});

describe('convertBudget', () => {
  it('rounds once to the target minor units', () => {
    expect(convertBudget(50000, 0.02, 'EUR')).toBe(1000);
    expect(convertBudget(10, 161.234, 'JPY')).toBe(1612);
  });
});

describe('keypad in the app language (Y3.2)', () => {
  it('writes the Turkish decimal comma and respects the currency minor units', () => {
    const tr = { decimalSeparator: ',' as const, maxDecimals: 2 };
    let text = '';
    for (const key of ['1', '2', '.', '5', '0', '9'] as const) text = applyAmountKey(text, key, tr);
    expect(text).toBe('12,50');
    expect(applyAmountKey('', '.', tr)).toBe('0,');
    expect(applyAmountKey('12.5', '0', tr)).toBe('12,50');
    // JPY: no decimal key effect.
    expect(applyAmountKey('12', '.', { decimalSeparator: ',', maxDecimals: 0 })).toBe('12');
    // Default stays the X2.4 '.' behavior.
    expect(applyAmountKey('9', '.')).toBe('9.');
  });

  it('shows stored amounts with the language separator', () => {
    expect(amountToInputText(12.5, ',')).toBe('12,5');
    expect(amountToInputText(12.5)).toBe('12.5');
    expect(amountToInputText(null)).toBe('');
  });
});
