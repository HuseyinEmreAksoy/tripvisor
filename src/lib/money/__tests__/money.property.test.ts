/**
 * M5 Y2.2 — property-based checks for the money library (fast-check).
 *
 * The invariants that matter to a traveller:
 *   - no drift: a total is the exact sum of its rows, whatever the order;
 *   - every breakdown (category, day, currency) sums to the same total;
 *   - a pending row is never inside a converted total, and is reported in
 *     full in its original currency;
 *   - a frozen rate into ANOTHER home currency never influences a total;
 *   - parse(format(x)) === x in both app languages.
 *
 * Run longer locally with: FC_NUM_RUNS=2000 npx jest money.property
 */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';
import {
  type Decimal,
  ZERO,
  add,
  cmp,
  div,
  mul,
  normalize,
  round,
  sub,
  sum,
  toDecimal,
  toPlainString,
} from '../decimal';
import { currencyMinorUnits, fromMinorUnits, toMinorUnits } from '../currency';
import { convertExpense, crossRate } from '../convert';
import { parseAmount } from '../parse';
import { summarizeTripMoney } from '../summary';
import type { MoneyExpense, RateBook } from '../types';

const NUM_RUNS = Number(process.env.FC_NUM_RUNS) || 150;
const big = (v: string) => BigInt(v);

// ── arbitraries ─────────────────────────────────────────────────────────────

const arbDecimal: fc.Arbitrary<Decimal> = fc
  .tuple(fc.bigInt({ min: big('-1000000000000000'), max: big('1000000000000000') }), fc.integer({ min: 0, max: 8 }))
  .map(([m, s]) => normalize({ m, s }));

const arbNonZero = arbDecimal.filter((d) => d.m !== big('0'));

const CODES = ['EUR', 'TRY', 'USD', 'JPY', 'KWD', 'GBP'] as const;
const DATES = ['2026-09-20', '2026-09-21', '2026-09-22'] as const;
const CATEGORIES = ['accommodation', 'food', 'transport', 'shopping', 'activities', 'other', 'spa'] as const;

/** A 2..4-decimal positive rate that survives the JSON round trip. */
const arbRate = fc.integer({ min: 1, max: 5_000_000 }).map((n) => n / 10_000);

/** An amount in minor units of its currency, as PostgREST would send it (a JSON number). */
function amountFor(code: string, minor: number): number {
  return Number(toPlainString(fromMinorUnits(minor, code)));
}

const arbExpense: fc.Arbitrary<MoneyExpense> = fc
  .record({
    currency: fc.option(fc.constantFrom(...CODES), { nil: null, freq: 8 }),
    minor: fc.integer({ min: 0, max: 50_000_000 }),
    kind: fc.constantFrom('actual', 'estimated'),
    category: fc.constantFrom(...CATEGORIES),
    day: fc.option(fc.integer({ min: 0, max: 6 }), { nil: null }),
    frozen: fc.option(arbRate, { nil: null }),
    fxHome: fc.constantFrom(...CODES),
    fxDate: fc.option(fc.constantFrom(...DATES), { nil: null, freq: 6 }),
    deleted: fc.integer({ min: 0, max: 9 }).map((n) => n === 0),
  })
  .map((r) => {
    const code = r.currency ?? 'EUR';
    return {
      id: '',
      trip_id: 't1',
      amount: amountFor(code, r.minor),
      kind: r.kind,
      category: r.category,
      day_index: r.day,
      currency: r.currency,
      fx_rate: r.frozen,
      fx_date: r.fxDate,
      fx_home_currency: r.frozen === null ? null : r.fxHome,
      deleted: r.deleted,
    } satisfies MoneyExpense;
  });

const arbExpenses = fc
  .array(arbExpense, { maxLength: 40 })
  .map((rows) => rows.map((row, i) => ({ ...row, id: `e${i}` })));

/** A book that may be missing any leg on any date. */
const arbBook: fc.Arbitrary<RateBook> = fc
  .array(
    fc.tuple(fc.constantFrom(...DATES), fc.constantFrom('TRY', 'USD', 'JPY', 'KWD', 'GBP'), arbRate),
    { maxLength: 15 },
  )
  .map((entries) => {
    const book: Record<string, Record<string, number>> = {};
    for (const [date, code, rate] of entries) (book[date] ??= {})[code] = rate;
    return book;
  });

const arbHome = fc.constantFrom(...CODES);

/** A permutation of `rows`, driven by fast-check (shrinkable, reproducible). */
function permute<T>(rows: T[], keys: number[]): T[] {
  return rows
    .map((row, i) => ({ row, key: keys[i] ?? 0, i }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map((x) => x.row);
}

function dec(value: { exact: string }): Decimal {
  return toDecimal(value.exact);
}

// ── decimal core ────────────────────────────────────────────────────────────

describe('decimal arithmetic is exact', () => {
  it('add is commutative and associative; sub inverts add', () => {
    fc.assert(
      fc.property(arbDecimal, arbDecimal, arbDecimal, (a, b, c) => {
        expect(add(a, b)).toEqual(add(b, a));
        expect(add(add(a, b), c)).toEqual(add(a, add(b, c)));
        expect(sub(add(a, b), b)).toEqual(normalize(a));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('mul distributes over add', () => {
    fc.assert(
      fc.property(arbDecimal, arbDecimal, arbDecimal, (a, b, c) => {
        expect(mul(a, add(b, c))).toEqual(add(mul(a, b), mul(a, c)));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('div is within half a unit of the 20th digit', () => {
    const bound = toDecimal('0.000000000000000000005'); // 5e-21
    fc.assert(
      fc.property(arbDecimal, arbNonZero, (a, b) => {
        const q = div(a, b);
        const residual = sub(mul(q, b), a);
        const absResidual = residual.m < big('0') ? { m: -residual.m, s: residual.s } : residual;
        const absB = b.m < big('0') ? { m: -b.m, s: b.s } : b;
        expect(cmp(absResidual, mul(absB, bound))).toBeLessThanOrEqual(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('round(half-expand) is within half a unit and has at most `scale` digits', () => {
    fc.assert(
      fc.property(arbDecimal, fc.integer({ min: 0, max: 4 }), (a, scale) => {
        const r = round(a, scale);
        expect(r.s).toBeLessThanOrEqual(scale);
        const diff = sub(r, a);
        const absDiff = diff.m < big('0') ? { m: -diff.m, s: diff.s } : diff;
        expect(cmp(absDiff, div(5, 10 ** (scale + 1), scale + 1))).toBeLessThanOrEqual(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('minor units round-trip for 0-, 2- and 3-decimal currencies', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 50 }), fc.constantFrom('JPY', 'EUR', 'KWD'), (units, code) => {
        expect(toMinorUnits(fromMinorUnits(units, code), code)).toBe(units);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ── totals ──────────────────────────────────────────────────────────────────

describe('no drift in totals', () => {
  it('a same-currency total is the exact integer sum of minor units, in any order', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10_000_000 }), { maxLength: 60 }),
        fc.array(fc.integer(), { maxLength: 60 }),
        fc.constantFrom('EUR', 'JPY', 'KWD'),
        (units, keys, code) => {
          const rows: MoneyExpense[] = units.map((u, i) => ({
            id: `r${i}`,
            amount: amountFor(code, u),
            kind: 'actual',
            currency: code,
          }));
          const expected = toPlainString(fromMinorUnits(units.reduce((a, b) => a + b, 0), code));
          const s1 = summarizeTripMoney(rows, { home: code });
          const s2 = summarizeTripMoney(permute(rows, keys), { home: code });
          expect(s1.total.actual.exact).toBe(expected);
          expect(s2.total.actual.exact).toBe(expected);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('naive float summing drifts; the lib does not (0.1 × n)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), (n) => {
        const rows: MoneyExpense[] = Array.from({ length: n }, (_, i) => ({
          id: `r${i}`,
          amount: 0.1,
          kind: 'actual',
          currency: 'EUR',
        }));
        const total = summarizeTripMoney(rows, { home: 'EUR' }).total.actual.exact;
        expect(total).toBe(toPlainString(div(n, 10)));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('every breakdown sums to the total, and the total is order-independent', () => {
    fc.assert(
      fc.property(arbExpenses, arbBook, arbHome, fc.array(fc.integer(), { maxLength: 40 }), (rows, book, home, keys) => {
        const s = summarizeTripMoney(rows, { home, book });
        for (const kind of ['actual', 'estimated'] as const) {
          const total = dec(s.total[kind]);
          expect(sum(Object.values(s.byCategory).map((c) => dec(c[kind])))).toEqual(total);
          expect(sum(s.byDay.map((d) => dec(d[kind])))).toEqual(total);
          expect(sum(s.byCurrency.map((c) => dec(c.converted[kind])))).toEqual(total);
        }
        expect(s.counts.converted + s.counts.pending + s.counts.invalid).toBe(s.counts.total);
        const shuffled = summarizeTripMoney(permute(rows, keys), { home, book });
        expect(shuffled.total).toEqual(s.total);
        expect(shuffled.pending.actualByCurrency).toEqual(s.pending.actualByCurrency);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('pending rows are never in a converted total and are reported in full per original currency', () => {
    fc.assert(
      fc.property(arbExpenses, arbBook, arbHome, (rows, book, home) => {
        const s = summarizeTripMoney(rows, { home, book });
        let convertedActual: Decimal = ZERO;
        const pendingActual = new Map<string, Decimal>();
        for (const row of rows) {
          if (row.deleted || row.kind !== 'actual') continue;
          const c = convertExpense(row, { home, book });
          if (c.status === 'converted') convertedActual = add(convertedActual, c.homeAmount);
          if (c.status === 'pending') {
            // NEVER 1:1: a pending row has a foreign currency.
            expect(c.currency).not.toBe(home);
            pendingActual.set(c.currency, add(pendingActual.get(c.currency) ?? ZERO, c.amount));
          }
        }
        expect(dec(s.total.actual)).toEqual(convertedActual);
        expect(Object.keys(s.pending.actualByCurrency).sort()).toEqual([...pendingActual.keys()].sort());
        for (const [code, amount] of pendingActual) {
          expect(dec(s.pending.actualByCurrency[code]!)).toEqual(amount);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a frozen rate into ANOTHER home currency never influences the result', () => {
    fc.assert(
      fc.property(arbExpense, arbRate, arbRate, arbBook, arbHome, (row, r1, r2, book, home) => {
        const other = home === 'EUR' ? 'TRY' : 'EUR';
        const a = convertExpense({ ...row, fx_rate: r1, fx_home_currency: other }, { home, book });
        const b = convertExpense({ ...row, fx_rate: r2, fx_home_currency: other }, { home, book });
        expect(a).toEqual(b);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('with no rate table, a foreign row converts only through a frozen rate into the current home', () => {
    fc.assert(
      fc.property(arbExpense, arbHome, (row, home) => {
        const c = convertExpense(row, { home });
        if (c.status !== 'converted' || row.currency === null || row.currency === home) return;
        expect(c.method).toBe('frozen');
        expect(row.fx_home_currency).toBe(home);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('cross rates through EUR are consistent (A→B→A ≈ 1)', () => {
    fc.assert(
      fc.property(arbRate, arbRate, (ra, rb) => {
        const day = { AAA: ra, BBB: rb };
        const product = mul(crossRate(day, 'AAA', 'BBB')!, crossRate(day, 'BBB', 'AAA')!);
        const error = sub(product, 1);
        const absError = error.m < big('0') ? { m: -error.m, s: error.s } : error;
        expect(cmp(absError, '0.000000000000001')).toBeLessThanOrEqual(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ── parse ∘ format ──────────────────────────────────────────────────────────

/** What a tr/en keypad or formatter would show (grouping + the language's decimal). */
function formatFixed(units: number, code: string, language: 'tr' | 'en', grouped: boolean): string {
  const digits = currencyMinorUnits(code);
  const plain = toPlainString(fromMinorUnits(units, code), digits);
  const [intPart, frac] = plain.split('.') as [string, string | undefined];
  const dec = language === 'tr' ? ',' : '.';
  const grp = language === 'tr' ? '.' : ',';
  const int = grouped ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, grp) : intPart;
  return frac ? `${int}${dec}${frac}` : int;
}

describe('parseAmount(format(x)) === x', () => {
  it('holds for tr and en, grouped or not, in 0/2/3-decimal currencies', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99_999_999_999 }),
        fc.constantFrom('EUR', 'TRY', 'JPY', 'KWD'),
        fc.constantFrom('tr' as const, 'en' as const),
        fc.boolean(),
        (units, code, language, grouped) => {
          const text = formatFixed(units, code, language, grouped);
          const parsed = parseAmount(text, { language, currency: code });
          expect(parsed).toEqual({
            ok: true,
            value: Number(toPlainString(fromMinorUnits(units, code))),
            exact: toPlainString(fromMinorUnits(units, code)),
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
