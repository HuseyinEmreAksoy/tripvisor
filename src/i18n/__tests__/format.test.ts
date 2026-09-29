/**
 * Shared formatters follow the ACTIVE APP LANGUAGE (ADR-0011 §4).
 * Jest pins the device to en-US (jest-setup.ts), so English is `en-US`.
 */
import { afterEach, describe, expect, it } from '@jest/globals';
import {
  compareText,
  formatDate,
  formatDateRange,
  formatDistance,
  formatDuration,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelative,
  formatTime,
  i18n,
  setLanguagePreference,
  toDate,
  toLocaleLower,
  toLocaleUpper,
} from '@/i18n';
import { formatCurrency } from '@/lib/formatCurrency';
import { formatDuration as legacyFormatDuration } from '@/lib/formatDuration';

// Intl may use U+00A0 / U+202F / U+2009 between parts; compare with plain spaces.
const plain = (s: string) => s.replace(/[   ]/g, ' ');

async function useLanguage(lng: 'en' | 'tr') {
  await setLanguagePreference(lng);
  expect(i18n.language).toBe(lng);
}

afterEach(async () => {
  await setLanguagePreference('system');
});

describe('formatMoney', () => {
  it('formats Turkish lira and euros the Turkish way', async () => {
    await useLanguage('tr');
    expect(plain(formatMoney(1234.5, 'TRY'))).toBe('₺1.234,50');
    expect(plain(formatMoney(1234.5, 'EUR'))).toBe('€1.234,50');
  });

  it('formats the same amounts the English way', async () => {
    await useLanguage('en');
    expect(plain(formatMoney(1234.5, 'EUR'))).toBe('€1,234.50');
    expect(plain(formatMoney(1234.5, 'USD'))).toBe('$1,234.50');
  });

  it('always uses the code it is given (never a trip default) and survives unknown codes', async () => {
    await useLanguage('en');
    expect(plain(formatMoney(10, 'gbp'))).toBe('£10.00');
    expect(plain(formatMoney(1234.5, 'XYZ1'))).toBe('1,234.50 XYZ1');
    expect(formatMoney(Number.NaN, 'EUR')).toBe('—');
  });

  it('keeps the legacy formatCurrency API but follows the app language', async () => {
    await useLanguage('tr');
    expect(plain(formatCurrency(1234.5, 'TRY'))).toBe('₺1.234,50');
    await useLanguage('en');
    expect(plain(formatCurrency(5, null))).toBe('$5.00');
  });
});

describe('numbers', () => {
  it('uses the app language separators', async () => {
    await useLanguage('tr');
    expect(formatNumber(1234.5)).toBe('1.234,5');
    expect(plain(formatPercent(0.42))).toBe('%42');
    await useLanguage('en');
    expect(formatNumber(1234.5)).toBe('1,234.5');
    expect(formatPercent(0.42)).toBe('42%');
  });

  it('formats distances', async () => {
    await useLanguage('tr');
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(1234)).toBe('1,2 km');
    await useLanguage('en');
    expect(formatDistance(1234)).toBe('1.2 km');
    expect(formatDistance(12_400)).toBe('12 km');
  });
});

describe('dates', () => {
  it('parses YYYY-MM-DD as a local date (no UTC off-by-one)', () => {
    const d = toDate('2026-06-12');
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(5);
    expect(d?.getDate()).toBe(12);
    expect(toDate('not a date')).toBeNull();
    expect(formatDate('garbage')).toBe('');
  });

  it('formats dates in Turkish', async () => {
    await useLanguage('tr');
    expect(formatDate('2026-09-29', 'short')).toBe('29 Eyl');
    expect(formatDate('2026-09-29', 'medium')).toBe('29 Eyl 2026');
    expect(formatDate('2026-09-29', 'long')).toBe('29 Eylül 2026');
    expect(formatDate('2026-09-29', 'weekdayLong')).toBe('29 Eylül Salı');
    expect(formatTime(new Date(2026, 8, 29, 14, 5))).toBe('14:05');
  });

  it('formats dates in English', async () => {
    await useLanguage('en');
    expect(formatDate('2026-09-29', 'medium')).toBe('Sep 29, 2026');
    expect(formatDate('2026-09-29', 'long')).toBe('September 29, 2026');
    expect(plain(formatTime(new Date(2026, 8, 29, 14, 5)))).toBe('2:05 PM');
  });

  it('formats a date range, collapsing the shared parts', async () => {
    await useLanguage('tr');
    expect(plain(formatDateRange('2026-06-12', '2026-06-18') ?? '')).toBe('12-18 Haz 2026'.replace('-', '–'));
    expect(formatDateRange('2026-06-12', '2026-06-12')).toBe('12 Haz 2026');
    expect(formatDateRange(null, '2026-06-12')).toBe('12 Haz 2026');
    expect(formatDateRange(null, undefined)).toBeNull();
    await useLanguage('en');
    expect(plain(formatDateRange('2026-06-28', '2026-07-03') ?? '')).toBe('Jun 28 – Jul 3, 2026');
  });
});

describe('formatRelative', () => {
  const now = new Date(2026, 8, 29, 12, 0);

  it('counts calendar days for countdowns', async () => {
    await useLanguage('tr');
    expect(formatRelative('2026-09-29', { now, granularity: 'day' })).toBe('bugün');
    expect(formatRelative('2026-09-30', { now, granularity: 'day' })).toBe('yarın');
    expect(formatRelative('2026-10-11', { now, granularity: 'day' })).toBe('2 hafta sonra');
    expect(formatRelative('2026-10-02', { now, granularity: 'day' })).toBe('3 gün sonra');
    await useLanguage('en');
    expect(formatRelative('2026-09-28', { now, granularity: 'day' })).toBe('yesterday');
    expect(formatRelative('2026-10-02', { now, granularity: 'day' })).toBe('in 3 days');
    expect(formatRelative('2026-09-28', { now: new Date(2026, 8, 30), granularity: 'day' })).toBe('2 days ago');
  });

  it('picks the largest unit that fits', async () => {
    await useLanguage('en');
    expect(formatRelative(new Date(now.getTime() - 10_000), { now })).toBe('just now');
    expect(formatRelative(new Date(now.getTime() - 60_000), { now })).toBe('1 minute ago');
    expect(formatRelative(new Date(now.getTime() + 3 * 3_600_000), { now })).toBe('in 3 hours');
    expect(formatRelative(new Date(2027, 8, 29), { now })).toBe('in 1 year');
    await useLanguage('tr');
    expect(formatRelative(new Date(now.getTime() - 5 * 60_000), { now })).toBe('5 dakika önce');
  });
});

describe('formatDuration', () => {
  it('keeps the English output callers already rely on', async () => {
    await useLanguage('en');
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(legacyFormatDuration(90)).toBe('1h 30m');
  });

  it('speaks Turkish', async () => {
    await useLanguage('tr');
    expect(formatDuration(45)).toBe('45 dk');
    expect(formatDuration(120)).toBe('2 sa');
    expect(legacyFormatDuration(90)).toBe('1 sa 30 dk');
  });
});

describe('collation and case (Turkish İ / ı)', () => {
  const cities = ['Zonguldak', 'İzmir', 'Isparta', 'Çanakkale', 'Cide', 'Ankara'];

  it('sorts with the Turkish alphabet in Turkish', async () => {
    await useLanguage('tr');
    expect([...cities].sort(compareText)).toEqual(['Ankara', 'Cide', 'Çanakkale', 'Isparta', 'İzmir', 'Zonguldak']);
  });

  it('folds Ç into C in English', async () => {
    await useLanguage('en');
    expect([...cities].sort(compareText)).toEqual(['Ankara', 'Çanakkale', 'Cide', 'Isparta', 'İzmir', 'Zonguldak']);
  });

  it('upper/lower-cases with the dotted and dotless i', async () => {
    await useLanguage('tr');
    expect(toLocaleUpper('istanbul')).toBe('İSTANBUL');
    expect(toLocaleLower('IĞDIR')).toBe('ığdır');
    await useLanguage('en');
    expect(toLocaleUpper('istanbul')).toBe('ISTANBUL');
  });
});
