/**
 * M5 Y2.2 — src/lib/money/decimal.ts: exact decimal arithmetic.
 */
import { describe, expect, it } from '@jest/globals';
import {
  ONE,
  ZERO,
  add,
  cmp,
  div,
  eq,
  fromNumber,
  isDecimal,
  mul,
  neg,
  parseDecimal,
  round,
  sign,
  sub,
  sum,
  toDecimal,
  toNumber,
  toPlainString,
  tryDecimal,
} from '../decimal';

const s = (v: Parameters<typeof toPlainString>[0]) => toPlainString(v);

describe('parsing', () => {
  it('parses plain, signed, leading-dot and exponent forms exactly', () => {
    expect(s(parseDecimal('12.50'))).toBe('12.5');
    expect(s(parseDecimal('-3'))).toBe('-3');
    expect(s(parseDecimal('+0.001'))).toBe('0.001');
    expect(s(parseDecimal('.5'))).toBe('0.5');
    expect(s(parseDecimal('5.'))).toBe('5');
    expect(s(parseDecimal('1.5e-7'))).toBe('0.00000015');
    expect(s(parseDecimal('1.5E+3'))).toBe('1500');
    expect(s(parseDecimal('000123.4500'))).toBe('123.45');
    expect(s(parseDecimal('-0.000'))).toBe('0');
  });

  it('rejects garbage and hostile exponents', () => {
    for (const bad of ['', '.', '-', '1,5', '1.2.3', 'abc', '1e', 'NaN', 'Infinity', '12 34']) {
      expect(() => parseDecimal(bad)).toThrow();
    }
    expect(() => parseDecimal('1e999999')).toThrow(RangeError);
  });

  it('fromNumber takes the SHORTEST printed form (0.1 is exactly one tenth)', () => {
    expect(s(fromNumber(0.1))).toBe('0.1');
    expect(s(fromNumber(35.2134))).toBe('35.2134');
    expect(s(fromNumber(1e-7))).toBe('0.0000001');
    expect(s(fromNumber(1e21))).toBe('1000000000000000000000');
    expect(s(fromNumber(-0))).toBe('0');
    expect(() => fromNumber(NaN)).toThrow(RangeError);
    expect(() => fromNumber(Infinity)).toThrow(RangeError);
  });

  it('toDecimal / tryDecimal accept number, string, bigint and Decimal', () => {
    expect(s(toDecimal(BigInt(42)))).toBe('42');
    expect(s(toDecimal({ m: BigInt(1250), s: 2 }))).toBe('12.5');
    expect(tryDecimal(null)).toBeNull();
    expect(tryDecimal(undefined)).toBeNull();
    expect(tryDecimal(NaN)).toBeNull();
    expect(tryDecimal('x')).toBeNull();
    expect(tryDecimal({})).toBeNull();
    expect(s(tryDecimal('7')!)).toBe('7');
    expect(isDecimal(ONE)).toBe(true);
    expect(isDecimal({ m: 1, s: 0 })).toBe(false);
  });
});

describe('arithmetic', () => {
  it('0.1 + 0.2 === 0.3 (the float trap)', () => {
    expect(s(add(0.1, 0.2))).toBe('0.3');
    expect(eq(add(0.1, 0.2), '0.3')).toBe(true);
  });

  it('ten times 0.1 sums to exactly 1', () => {
    expect(s(sum(Array.from({ length: 10 }, () => 0.1)))).toBe('1');
  });

  it('sub / neg / mul are exact', () => {
    expect(s(sub('10', '0.01'))).toBe('9.99');
    expect(s(neg('12.5'))).toBe('-12.5');
    expect(s(neg(0))).toBe('0');
    expect(s(mul('12.5', '35.2134'))).toBe('440.1675');
    expect(s(mul('-2', '0.5'))).toBe('-1');
  });

  it('div rounds half-even at the requested scale and refuses zero', () => {
    expect(s(div(1, 3, 5))).toBe('0.33333');
    expect(s(div(2, 3, 5))).toBe('0.66667');
    expect(s(div('0.125', 1, 2))).toBe('0.12'); // tie → even
    expect(s(div('0.135', 1, 2))).toBe('0.14'); // tie → even
    expect(s(div(-1, 8, 2))).toBe('-0.12');
    expect(s(div(10, 4))).toBe('2.5');
    expect(() => div(1, 0)).toThrow(RangeError);
  });

  it('round is half away from zero by default (Postgres round / Intl)', () => {
    expect(s(round('0.125', 2))).toBe('0.13');
    expect(s(round('-0.125', 2))).toBe('-0.13');
    expect(s(round('2.5', 0))).toBe('3');
    expect(s(round('2.5', 0, 'half-even'))).toBe('2');
    expect(s(round('2.59', 1, 'down'))).toBe('2.5');
    expect(s(round('1.2', 5))).toBe('1.2');
  });

  it('cmp / sign / toNumber / padding', () => {
    expect(cmp('1.10', '1.1')).toBe(0);
    expect(cmp('-1', '0')).toBe(-1);
    expect(cmp('2', '1.999')).toBe(1);
    expect(sign('-0.01')).toBe(-1);
    expect(sign(ZERO)).toBe(0);
    expect(toNumber('12.50')).toBe(12.5);
    expect(Object.is(toNumber('-0'), 0)).toBe(true);
    expect(toPlainString('12.5', 2)).toBe('12.50');
    expect(toPlainString('-0.05')).toBe('-0.05');
  });
});
