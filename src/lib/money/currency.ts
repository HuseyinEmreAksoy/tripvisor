/**
 * Currency codes and minor units (ISO 4217) — M5 Y2.2.
 *
 * Minor units decide DISPLAY rounding only: JPY has 0 decimals, KWD 3, most
 * currencies 2. Arithmetic stays exact (decimal.ts); `roundMoney` is applied
 * once, when a value becomes a {@link MoneyValue}.
 */
import {
  type Decimal,
  type DecimalInput,
  pow10,
  round,
  toDecimal,
  toNumber,
  toPlainString,
} from './decimal';
import type { CurrencyCode, MoneyValue } from './types';

/** The base every `fx_rates` row is stored against (ADR-0012 §2). */
export const FX_BASE: CurrencyCode = 'EUR';

const CODE_RE = /^[A-Z]{3}$/;

/**
 * ISO 4217 exponents that differ from 2 (list 1, active codes). Anything not
 * listed has 2. Source: ISO 4217 list one (SIX), 2026 edition.
 */
const MINOR_UNITS: Readonly<Record<string, number>> = Object.freeze({
  // 0 decimals
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  // 3 decimals
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
  // 4 decimals
  CLF: 4,
  UYW: 4,
});

/** True for an upper-case ISO 4217 shape ('EUR'). The DB CHECK is the same regex. */
export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && CODE_RE.test(value);
}

/** ' eur ' → 'EUR'; anything that is not three letters → null. */
export function normalizeCurrency(value: unknown): CurrencyCode | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** Decimal places of `code` (2 when unknown). */
export function currencyMinorUnits(code: CurrencyCode): number {
  const normalized = normalizeCurrency(code);
  if (!normalized) return 2;
  return MINOR_UNITS[normalized] ?? 2;
}

/** Round to the currency's minor units, half away from zero. Display boundary only. */
export function roundMoney(amount: DecimalInput, code: CurrencyCode): Decimal {
  return round(toDecimal(amount), currencyMinorUnits(code), 'half-expand');
}

/**
 * The amount as an integer count of minor units (cents, kuruş, yen), rounded
 * half away from zero. Throws RangeError beyond Number.MAX_SAFE_INTEGER.
 */
export function toMinorUnits(amount: DecimalInput, code: CurrencyCode): number {
  const digits = currencyMinorUnits(code);
  const rounded = round(toDecimal(amount), digits, 'half-expand');
  const units = rounded.m * pow10(digits - rounded.s);
  const n = Number(units);
  if (!Number.isSafeInteger(n)) throw new RangeError(`Amount out of range for minor units: ${toPlainString(rounded)}`);
  return n;
}

/** Inverse of {@link toMinorUnits}: 1250 EUR-cents → 12.5. */
export function fromMinorUnits(units: number | bigint, code: CurrencyCode): Decimal {
  const m = typeof units === 'bigint' ? units : BigInt(assertSafeInteger(units));
  return toDecimal({ m, s: currencyMinorUnits(code) });
}

function assertSafeInteger(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Not a safe integer: ${n}`);
  return n;
}

/** Wrap an exact amount as a {@link MoneyValue} (exact string + display-rounded number). */
export function moneyValue(amount: DecimalInput, code: CurrencyCode): MoneyValue {
  const exact = toDecimal(amount);
  return {
    currency: code,
    exact: toPlainString(exact),
    value: toNumber(roundMoney(exact, code)),
  };
}

/** A zero {@link MoneyValue} in `code`. */
export function zeroMoney(code: CurrencyCode): MoneyValue {
  return { currency: code, exact: '0', value: 0 };
}
