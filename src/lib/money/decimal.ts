/**
 * Tiny exact decimal for money math (M5 Y2.2, ADR-0012).
 *
 * Why not plain `number`: `0.1 + 0.2 !== 0.3`, and a trip total summed from
 * many converted rows drifts by fractions of a cent depending on the order
 * the rows arrive in. The DB stores `amount`, `fx_rate` and `fx_rates.rate`
 * as `numeric` (exact), and the analytics MV sums them exactly. This helper
 * does the same on the client, so the live totals match the nightly rollup
 * and never depend on row order.
 *
 * Representation: `m × 10^-s` with `m` a bigint and `s` a non-negative
 * integer scale. Every value is kept NORMALISED (no trailing zeros in `m`
 * while `s > 0`), so two equal values are structurally equal.
 *
 *   - add / sub / mul are EXACT.
 *   - div is the only rounding operation (half-even at DIV_SCALE = 20
 *     fractional digits by default). Money code divides only to build a
 *     cross rate `rate(home) / rate(from)` (convert.ts keeps 30 digits
 *     there), which keeps the error of a converted amount far below a
 *     millionth of a cent for any realistic amount.
 *   - Rounding to a currency's minor units happens ONLY at display
 *     (`roundMoney` in currency.ts), half away from zero, which is what both
 *     Postgres `round(numeric)` and `Intl.NumberFormat` do.
 *
 * Pure: no I/O, no Intl, no platform code. Uses `BigInt(...)` calls instead of
 * `0n` literals so no toolchain needs the literal syntax (Hermes, web and Node
 * all support BigInt itself).
 */

export interface Decimal {
  /** Unscaled integer. */
  readonly m: bigint;
  /** Scale (fractional digits): value = m / 10^s. Non-negative integer. */
  readonly s: number;
}

/** What the money functions accept: a Decimal, a finite number, a decimal string, or a bigint. */
export type DecimalInput = Decimal | number | string | bigint;

export type RoundingMode =
  /** Half away from zero: 0.125 → 0.13, -0.125 → -0.13 (Postgres round(), Intl default). */
  | 'half-expand'
  /** Banker's rounding: 0.125 → 0.12, 0.135 → 0.14. */
  | 'half-even'
  /** Toward zero (truncate). */
  | 'down';

const B0 = BigInt(0);
const B1 = BigInt(1);
const B2 = BigInt(2);
const B10 = BigInt(10);

/** Default fractional digits kept by `div`. */
export const DIV_SCALE = 20;

/**
 * Largest decimal exponent / scale accepted from input. A JS number never
 * needs more than ~345 digits (5e-324); the cap stops a hostile string like
 * '1e99999999' from allocating a gigantic bigint.
 */
const MAX_EXPONENT = 400;
/** Largest power of ten ever materialised (products of two max-scale values, plus div headroom). */
const MAX_POW10 = 2000;

export const ZERO: Decimal = Object.freeze({ m: B0, s: 0 });
export const ONE: Decimal = Object.freeze({ m: B1, s: 0 });

const POW10: bigint[] = [B1];

/** 10^n as a bigint (memoised). */
export function pow10(n: number): bigint {
  if (!Number.isInteger(n) || n < 0 || n > MAX_POW10) {
    throw new RangeError(`pow10: exponent out of range (${n})`);
  }
  while (POW10.length <= n) POW10.push(POW10[POW10.length - 1]! * B10);
  return POW10[n]!;
}

function abs(v: bigint): bigint {
  return v < B0 ? -v : v;
}

/** Strip trailing zeros so equal values have one representation. */
export function normalize(d: Decimal): Decimal {
  let { m, s } = d;
  if (m === B0) return ZERO;
  while (s > 0 && m % B10 === B0) {
    m /= B10;
    s -= 1;
  }
  return m === d.m && s === d.s ? d : { m, s };
}

export function isDecimal(v: unknown): v is Decimal {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Decimal).m === 'bigint' &&
    typeof (v as Decimal).s === 'number' &&
    Number.isInteger((v as Decimal).s) &&
    (v as Decimal).s >= 0
  );
}

const DECIMAL_RE = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * Parse a plain or exponent decimal string ('12.50', '-3', '1.5e-7', '.5').
 * Throws SyntaxError on anything else (no grouping separators, no locale
 * commas: use `parseAmount` for user input).
 */
export function parseDecimal(input: string): Decimal {
  const text = input.trim();
  const match = DECIMAL_RE.exec(text);
  if (!match) throw new SyntaxError(`Not a decimal number: "${input}"`);
  const sign = match[1];
  const intPart = match[2] ?? '';
  const fracPart = match[3] ?? '';
  const expPart = match[4];
  if (intPart.length === 0 && fracPart.length === 0) {
    throw new SyntaxError(`Not a decimal number: "${input}"`);
  }
  const exp = expPart === undefined ? 0 : Number(expPart);
  if (!Number.isSafeInteger(exp) || Math.abs(exp) > MAX_EXPONENT) {
    throw new RangeError(`Decimal exponent out of range: "${input}"`);
  }
  const digits = `${intPart}${fracPart}`.replace(/^0+(?=\d)/, '');
  if (digits.length > MAX_EXPONENT) throw new RangeError(`Decimal too long: "${input}"`);
  let m = BigInt(digits.length === 0 ? '0' : digits);
  let s = fracPart.length - exp;
  if (s < 0) {
    m *= pow10(-s);
    s = 0;
  }
  if (s > MAX_EXPONENT) throw new RangeError(`Decimal scale out of range: "${input}"`);
  if (sign === '-') m = -m;
  return normalize({ m, s });
}

/**
 * The exact decimal a finite JS number PRINTS as (its shortest round-trip
 * form): `fromNumber(0.1)` is exactly 1/10, not the binary approximation.
 * That is the value PostgREST meant when it serialised a `numeric`.
 */
export function fromNumber(n: number): Decimal {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new RangeError(`Not a finite number: ${String(n)}`);
  }
  return parseDecimal(String(n));
}

/** Coerce any DecimalInput. Throws on NaN/Infinity/garbage. */
export function toDecimal(v: DecimalInput): Decimal {
  if (isDecimal(v)) return normalize(v);
  if (typeof v === 'number') return fromNumber(v);
  if (typeof v === 'bigint') return { m: v, s: 0 };
  if (typeof v === 'string') return parseDecimal(v);
  throw new TypeError(`Not a decimal input: ${String(v)}`);
}

/** Like toDecimal but returns null instead of throwing (null/undefined → null). */
export function tryDecimal(v: unknown): Decimal | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  if (typeof v !== 'number' && typeof v !== 'string' && typeof v !== 'bigint' && !isDecimal(v)) return null;
  try {
    return toDecimal(v as DecimalInput);
  } catch {
    return null;
  }
}

function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
  if (a.s === b.s) return [a.m, b.m, a.s];
  if (a.s > b.s) return [a.m, b.m * pow10(a.s - b.s), a.s];
  return [a.m * pow10(b.s - a.s), b.m, b.s];
}

export function add(a: DecimalInput, b: DecimalInput): Decimal {
  const [x, y, s] = align(toDecimal(a), toDecimal(b));
  return normalize({ m: x + y, s });
}

export function sub(a: DecimalInput, b: DecimalInput): Decimal {
  const [x, y, s] = align(toDecimal(a), toDecimal(b));
  return normalize({ m: x - y, s });
}

export function neg(a: DecimalInput): Decimal {
  const d = toDecimal(a);
  return d.m === B0 ? ZERO : { m: -d.m, s: d.s };
}

export function mul(a: DecimalInput, b: DecimalInput): Decimal {
  const x = toDecimal(a);
  const y = toDecimal(b);
  return normalize({ m: x.m * y.m, s: x.s + y.s });
}

/** Exact sum of any number of values (order-independent by construction). */
export function sum(values: Iterable<DecimalInput>): Decimal {
  let acc = ZERO;
  for (const v of values) acc = add(acc, v);
  return acc;
}

/** Integer division `n / d` rounded with `mode` (d !== 0). */
function divRound(n: bigint, d: bigint, mode: RoundingMode): bigint {
  if (d === B0) throw new RangeError('Division by zero');
  if (d < B0) {
    n = -n;
    d = -d;
  }
  const q = n / d; // truncates toward zero
  const r = n - q * d; // same sign as n
  if (r === B0 || mode === 'down') return q;
  const twice = abs(r) * B2;
  const away =
    mode === 'half-expand'
      ? twice >= d
      : twice > d || (twice === d && q % B2 !== B0); // half-even: tie → the even neighbour
  if (!away) return q;
  return n < B0 ? q - B1 : q + B1;
}

/**
 * `a / b`, keeping `scale` fractional digits (rounded with `mode`, default
 * half-even). Throws RangeError on division by zero.
 */
export function div(a: DecimalInput, b: DecimalInput, scale: number = DIV_SCALE, mode: RoundingMode = 'half-even'): Decimal {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_EXPONENT) {
    throw new RangeError(`div: scale out of range (${scale})`);
  }
  const x = toDecimal(a);
  const y = toDecimal(b);
  if (y.m === B0) throw new RangeError('Division by zero');
  // x / y = (x.m · 10^y.s) / (y.m · 10^x.s); times 10^scale for the result digits.
  const n = x.m * pow10(y.s + scale);
  const d = y.m * pow10(x.s);
  return normalize({ m: divRound(n, d, mode), s: scale });
}

/** Round to `scale` fractional digits (no-op when already that precise). */
export function round(a: DecimalInput, scale: number, mode: RoundingMode = 'half-expand'): Decimal {
  if (!Number.isInteger(scale) || scale < 0) throw new RangeError(`round: scale out of range (${scale})`);
  const d = toDecimal(a);
  if (d.s <= scale) return d;
  return normalize({ m: divRound(d.m, pow10(d.s - scale), mode), s: scale });
}

/** -1 / 0 / 1. */
export function cmp(a: DecimalInput, b: DecimalInput): -1 | 0 | 1 {
  const [x, y] = align(toDecimal(a), toDecimal(b));
  return x === y ? 0 : x < y ? -1 : 1;
}

export function eq(a: DecimalInput, b: DecimalInput): boolean {
  return cmp(a, b) === 0;
}

export function isZero(a: DecimalInput): boolean {
  return toDecimal(a).m === B0;
}

export function sign(a: DecimalInput): -1 | 0 | 1 {
  const d = toDecimal(a);
  return d.m === B0 ? 0 : d.m < B0 ? -1 : 1;
}

/**
 * Plain decimal string, never exponent notation: '1234.5', '-0.001', '0'.
 * `minFractionDigits` pads with zeros ('12.5' → '12.50' for 2).
 */
export function toPlainString(a: DecimalInput, minFractionDigits = 0): string {
  const d = toDecimal(a);
  const negative = d.m < B0;
  let digits = abs(d.m).toString();
  let intPart: string;
  let fracPart = '';
  if (d.s > 0) {
    digits = digits.padStart(d.s + 1, '0');
    intPart = digits.slice(0, digits.length - d.s);
    fracPart = digits.slice(digits.length - d.s);
  } else {
    intPart = digits;
  }
  if (fracPart.length < minFractionDigits) fracPart = fracPart.padEnd(minFractionDigits, '0');
  const isZeroValue = d.m === B0;
  return `${negative && !isZeroValue ? '-' : ''}${intPart}${fracPart ? `.${fracPart}` : ''}`;
}

/** Nearest JS number (for display/formatting only; round first). */
export function toNumber(a: DecimalInput): number {
  const n = Number(toPlainString(a));
  return Object.is(n, -0) ? 0 : n;
}
