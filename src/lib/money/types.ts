/**
 * Money library types (M5 Y2.2, ADR-0012). Structural on purpose: the lib
 * never imports `src/api` at runtime, and a `TripExpense` row (src/api/types.ts)
 * satisfies {@link MoneyExpense} as-is.
 *
 * Conversion order (identical to the analytics MV after 0038 and to the
 * TripExpense JSDoc; see convert.ts):
 *   1. currency NULL or === home                          → × 1
 *   2. fx_rate set AND fx_home_currency === home          → × fx_rate (frozen)
 *   3. fx_date set AND the EUR table has both legs that day → × rate(home)/rate(currency)
 *   4. otherwise PENDING: excluded from converted totals, reported per
 *      ORIGINAL currency. Never × a rate into another currency, never 1:1.
 */

/** ISO 4217 alphabetic code ('EUR', 'TRY', 'JPY'). Shape-checked, open set. */
export type CurrencyCode = string;

/** 'YYYY-MM-DD' (a calendar date, no time zone). */
export type IsoDate = string;

/** The expense columns the money lib reads. `TripExpense` satisfies it. */
export interface MoneyExpense {
  id: string;
  trip_id?: string;
  /** Original amount in `currency` (numeric; PostgREST sends a JSON number). */
  amount: number | string;
  kind?: string;
  category?: string;
  day_index?: number | null;
  deleted?: boolean;
  created_at?: string;
  /** Original ISO code. NULL/absent = legacy row = the trip's home currency at rate 1. */
  currency?: CurrencyCode | null;
  /** HOME units per 1 original unit, frozen at entry. NULL = rate pending. */
  fx_rate?: number | string | null;
  /** Date of the rate (or the wanted date while pending). */
  fx_date?: IsoDate | null;
  /** The home currency `fx_rate` converts INTO. */
  fx_home_currency?: CurrencyCode | null;
}

/**
 * EUR-based rates by day, exactly the `fx_rates` table shape:
 * `book[date][quote]` = quote units per 1 EUR. EUR itself is implicit (1).
 * The key `'latest'` holds today's table for the "at today's rate" view.
 */
export type RateBook = Readonly<Record<string, Readonly<Record<CurrencyCode, number>>>>;

/** One day of EUR-based rates (`RateBook[date]`). */
export type DayRates = Readonly<Record<CurrencyCode, number>>;

/** Which rate set a view converts with. */
export type RateMode =
  /** The rate frozen at entry (steps 1–4 above). The default. */
  | 'entry'
  /** Today's rate for every foreign row (the Y3.2 "at today's rate" toggle). */
  | 'today';

/** How a converted row got its rate. */
export type ConversionMethod =
  /** currency === home. */
  | 'same_currency'
  /** currency NULL (legacy row): the home currency at rate 1. */
  | 'legacy'
  /** Step 2: the frozen fx_rate (it converts into the current home). */
  | 'frozen'
  /** Step 3: re-derived from the EUR table on fx_date (home changed, or the fill has not run yet). */
  | 'rederived'
  /** Today's rate (RateMode 'today'). */
  | 'today';

/** Why a row is pending (step 4). */
export type PendingReason =
  /** fx_rate NULL and no table rates on fx_date yet: waiting for the reconciler. */
  | 'rate_pending'
  /** Frozen into an OLD home currency and no table rates on fx_date yet: warm fx-rates. */
  | 'home_changed'
  /** No fx_date to look rates up with (should not happen for M5 rows). */
  | 'no_fx_date'
  /** RateMode 'today' and today's rates for this pair are not loaded. */
  | 'today_rate_missing';

/**
 * A money amount ready for both display and further math.
 * `value` is ALREADY ROUNDED to the currency's minor units (half away from
 * zero) — pass it straight to `formatMoney(value, currency)`. `exact` is the
 * unrounded decimal string; feed it back into the lib (`toDecimal(exact)`)
 * if you need to compute on it, never the rounded `value`.
 */
export interface MoneyValue {
  currency: CurrencyCode;
  /** Exact, unrounded decimal string (e.g. '1234.56789'). */
  exact: string;
  /** Rounded to the currency's minor units — display only. */
  value: number;
}

/** Actual vs estimated pair (both in the same currency). */
export interface KindTotals {
  actual: MoneyValue;
  estimated: MoneyValue;
}

/** Per-row outcome, for the expense list ("≈ ₺123", "rate pending" chip). */
export type RowMoney =
  | {
      status: 'converted';
      method: ConversionMethod;
      /** The original amount in its own currency. */
      original: MoneyValue;
      /** The converted amount in the home currency. */
      home: MoneyValue;
      /** Home units per 1 original unit that was applied (display with care; unrounded). */
      rate: number;
    }
  | {
      status: 'pending';
      reason: PendingReason;
      original: MoneyValue;
    }
  | {
      status: 'invalid';
      /** A non-finite / negative amount or a malformed currency code. Excluded everywhere. */
      reason: 'amount' | 'currency' | 'kind';
    };

export interface CategoryTotals extends KindTotals {
  /** `estimated - actual` in the home currency (sign is meaningful). */
  remaining: MoneyValue;
  /** Live rows in this category (converted + pending). */
  count: number;
}

export interface DayTotals extends KindTotals {
  /** `trip_expenses.day_index` (0-based), or null for trip-level rows. */
  dayIndex: number | null;
  count: number;
  pendingCount: number;
}

/** One ORIGINAL currency's slice of a trip (the per-currency breakdown). */
export interface CurrencyBreakdown {
  currency: CurrencyCode;
  /** Live rows in this currency (converted + pending). */
  count: number;
  /** Every live row of this currency, in the ORIGINAL currency. */
  original: KindTotals;
  /** The converted rows of this currency, in the HOME currency. */
  converted: KindTotals;
  /** The pending rows of this currency, in the ORIGINAL currency. */
  pending: KindTotals & { count: number };
}

/** "Not yet converted" report — mirrors get_my_trip_stats() pending_* (0038). */
export interface PendingReport {
  count: number;
  /** Ids of the pending rows (for the chip / a "retry" affordance). */
  ids: string[];
  /** { [original ISO]: amount } for actual rows, in the ORIGINAL currency. */
  actualByCurrency: Record<CurrencyCode, MoneyValue>;
  /** Same for estimated rows. */
  estimatedByCurrency: Record<CurrencyCode, MoneyValue>;
}

export interface TripMoneySummary {
  /** The trip's home currency (`trips.currency`) every converted value is in. */
  home: CurrencyCode;
  rateMode: RateMode;
  /** Converted rows only (pending rows are NEVER in here). */
  total: KindTotals;
  /** All six categories are always present (a zero slot for empty ones). Unknown categories fold into 'other'. */
  byCategory: Record<MoneyCategory, CategoryTotals>;
  /** Sorted by day index ascending, trip-level (null) last. Only days with rows. */
  byDay: DayTotals[];
  /** Home currency first, then by converted total (desc), then code. */
  byCurrency: CurrencyBreakdown[];
  pending: PendingReport;
  /** `trips.total_budget` in the home currency, or null when not set. */
  budget: MoneyValue | null;
  /** `budget - total.actual`, or null without a budget. */
  remaining: MoneyValue | null;
  /** Per-row outcome keyed by expense id (live rows only). */
  rows: Record<string, RowMoney>;
  counts: {
    /** Live rows considered (excludes tombstones). */
    total: number;
    converted: number;
    pending: number;
    invalid: number;
  };
  /** How many converted rows used each method (e.g. show a "re-derived" note). */
  methods: Record<ConversionMethod, number>;
}

/** The six `trip_expenses.category` values (0010 CHECK). */
export type MoneyCategory = 'accommodation' | 'food' | 'transport' | 'shopping' | 'activities' | 'other';
