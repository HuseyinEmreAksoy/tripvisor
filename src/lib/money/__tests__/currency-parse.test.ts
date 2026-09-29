/**
 * M5 Y2.2 — minor units, display rounding and locale-aware amount parsing.
 */
import { describe, expect, it } from '@jest/globals';
import {
  currencyMinorUnits,
  fromMinorUnits,
  isCurrencyCode,
  moneyValue,
  normalizeCurrency,
  roundMoney,
  toMinorUnits,
  zeroMoney,
} from '../currency';
import { toPlainString } from '../decimal';
import { decimalSeparatorFor, parseAmount } from '../parse';

describe('currency codes and minor units', () => {
  it('normalises and validates ISO shapes', () => {
    expect(normalizeCurrency(' eur ')).toBe('EUR');
    expect(normalizeCurrency('EURO')).toBeNull();
    expect(normalizeCurrency(12)).toBeNull();
    expect(isCurrencyCode('TRY')).toBe(true);
    expect(isCurrencyCode('try')).toBe(false);
  });

  it('knows the 0/3/4-decimal currencies and defaults to 2', () => {
    expect(currencyMinorUnits('JPY')).toBe(0);
    expect(currencyMinorUnits('KRW')).toBe(0);
    expect(currencyMinorUnits('KWD')).toBe(3);
    expect(currencyMinorUnits('BHD')).toBe(3);
    expect(currencyMinorUnits('CLF')).toBe(4);
    expect(currencyMinorUnits('EUR')).toBe(2);
    expect(currencyMinorUnits('TRY')).toBe(2);
    expect(currencyMinorUnits('XYZ')).toBe(2);
    expect(currencyMinorUnits('bad')).toBe(2);
  });

  it('rounds for display to the minor units, half away from zero', () => {
    expect(toPlainString(roundMoney('1234.5', 'JPY'))).toBe('1235');
    expect(toPlainString(roundMoney('1.0005', 'KWD'))).toBe('1.001');
    expect(toPlainString(roundMoney('12.345', 'EUR'))).toBe('12.35');
    expect(toPlainString(roundMoney('-12.345', 'EUR'))).toBe('-12.35');
  });

  it('minor units round-trip', () => {
    expect(toMinorUnits('12.34', 'EUR')).toBe(1234);
    expect(toMinorUnits('12.345', 'EUR')).toBe(1235);
    expect(toMinorUnits('1500', 'JPY')).toBe(1500);
    expect(toMinorUnits('1.234', 'KWD')).toBe(1234);
    expect(toPlainString(fromMinorUnits(1234, 'EUR'))).toBe('12.34');
    expect(toPlainString(fromMinorUnits(BigInt(1234), 'KWD'))).toBe('1.234');
    expect(() => toMinorUnits('1e300', 'EUR')).toThrow(RangeError);
  });

  it('moneyValue keeps the exact string and rounds only the display number', () => {
    expect(moneyValue('440.1675', 'TRY')).toEqual({ currency: 'TRY', exact: '440.1675', value: 440.17 });
    expect(moneyValue('999.5', 'JPY')).toEqual({ currency: 'JPY', exact: '999.5', value: 1000 });
    expect(zeroMoney('EUR')).toEqual({ currency: 'EUR', exact: '0', value: 0 });
  });
});

describe('parseAmount', () => {
  const tr = { language: 'tr' } as const;
  const en = { language: 'en' } as const;

  it('picks the separator from the language', () => {
    expect(decimalSeparatorFor('tr')).toBe(',');
    expect(decimalSeparatorFor('tr-TR')).toBe(',');
    expect(decimalSeparatorFor('en')).toBe('.');
    expect(decimalSeparatorFor('en-GB')).toBe('.');
    expect(decimalSeparatorFor(undefined)).toBe('.');
  });

  it('Turkish: "12,50" is 12.5 and "1.234,5" is 1234.5', () => {
    expect(parseAmount('12,50', tr)).toEqual({ ok: true, value: 12.5, exact: '12.5' });
    expect(parseAmount('1.234,5', tr)).toEqual({ ok: true, value: 1234.5, exact: '1234.5' });
    expect(parseAmount('1.234', tr)).toMatchObject({ ok: true, value: 1234 });
    expect(parseAmount('1.234.567', tr)).toMatchObject({ ok: true, value: 1234567 });
    expect(parseAmount('0.500', tr)).toMatchObject({ ok: true, value: 0.5 }); // leading 0 can't be grouping
    expect(parseAmount('12.5', tr)).toMatchObject({ ok: true, value: 12.5 }); // lenient decimal point
  });

  it('English: "12.50" is 12.5 and "1,234.5" is 1234.5', () => {
    expect(parseAmount('12.50', en)).toMatchObject({ ok: true, value: 12.5 });
    expect(parseAmount('1,234.5', en)).toMatchObject({ ok: true, value: 1234.5 });
    expect(parseAmount('1,234', en)).toMatchObject({ ok: true, value: 1234 });
    expect(parseAmount('12,5', en)).toMatchObject({ ok: true, value: 12.5 }); // lenient
  });

  it('accepts keypad states and spacing', () => {
    expect(parseAmount('12,', tr)).toMatchObject({ ok: true, value: 12 });
    expect(parseAmount(',5', tr)).toMatchObject({ ok: true, value: 0.5 });
    expect(parseAmount(' 1 234,50 ', tr)).toMatchObject({ ok: true, value: 1234.5 });
    expect(parseAmount('1 234.50', en)).toMatchObject({ ok: true, value: 1234.5 });
    expect(parseAmount('+7', en)).toMatchObject({ ok: true, value: 7 });
    expect(parseAmount('0', en)).toMatchObject({ ok: true, value: 0 });
  });

  it('rejects empty, negative, malformed and oversized input', () => {
    expect(parseAmount('', tr)).toEqual({ ok: false, error: 'empty' });
    expect(parseAmount('   ', tr)).toEqual({ ok: false, error: 'empty' });
    expect(parseAmount(null, tr)).toEqual({ ok: false, error: 'empty' });
    expect(parseAmount('-5', tr)).toEqual({ ok: false, error: 'negative' });
    expect(parseAmount('−5', tr)).toEqual({ ok: false, error: 'negative' });
    expect(parseAmount('12,5,0', tr)).toEqual({ ok: false, error: 'invalid' });
    expect(parseAmount('1.23.4', tr)).toEqual({ ok: false, error: 'invalid' });
    expect(parseAmount('1.2.3,4', tr)).toEqual({ ok: false, error: 'invalid' });
    expect(parseAmount('12a', en)).toEqual({ ok: false, error: 'invalid' });
    expect(parseAmount(',', tr)).toEqual({ ok: false, error: 'invalid' });
    expect(parseAmount('€12', en)).toEqual({ ok: false, error: 'invalid' });
    expect(parseAmount('1000000000001', en)).toEqual({ ok: false, error: 'too_large' });
  });

  it('enforces the currency minor units (JPY 0, KWD 3), ignoring trailing zeros', () => {
    expect(parseAmount('1500,5', { ...tr, currency: 'JPY' })).toEqual({ ok: false, error: 'too_many_decimals' });
    expect(parseAmount('1500,0', { ...tr, currency: 'JPY' })).toMatchObject({ ok: true, value: 1500 });
    expect(parseAmount('1.2345', { ...en, currency: 'KWD' })).toEqual({ ok: false, error: 'too_many_decimals' });
    expect(parseAmount('1.234', { language: 'en', currency: 'KWD', decimalSeparator: '.' })).toMatchObject({
      ok: true,
      value: 1.234,
    });
    expect(parseAmount('12,345', { ...tr, currency: 'EUR' })).toEqual({ ok: false, error: 'too_many_decimals' });
  });

  it('decimalSeparator overrides the language', () => {
    expect(parseAmount('12,50', { language: 'en', decimalSeparator: ',' })).toMatchObject({ ok: true, value: 12.5 });
  });
});
