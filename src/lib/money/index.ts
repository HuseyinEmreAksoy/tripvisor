/**
 * Money library (M5 Y2.2, ADR-0012) — the one place conversions, totals and
 * rounding live. Pure: no I/O, no Intl, no React. The data hooks that feed it
 * are in src/api/expense-fx.ts and src/api/trip-expenses.ts.
 *
 *   import { summarizeTripMoney, convertExpense, parseAmount } from '@/lib/money';
 *
 * Rules every consumer relies on:
 *   - arithmetic is exact (decimal.ts); round ONLY at display — a MoneyValue's
 *     `value` is already rounded to the currency's minor units (JPY 0, KWD 3);
 *   - conversion order = the analytics MV (0038): same currency ×1 → frozen
 *     fx_rate only if fx_home_currency = current home → EUR table on fx_date
 *     → otherwise PENDING (excluded from totals, reported per original
 *     currency; never 1:1, never a rate into another currency).
 */
export * from './types';
export {
  type Decimal,
  type DecimalInput,
  type RoundingMode,
  DIV_SCALE,
  ONE,
  ZERO,
  add,
  cmp,
  div,
  eq,
  fromNumber,
  isDecimal,
  isZero,
  mul,
  neg,
  normalize,
  parseDecimal,
  round,
  sign,
  sub,
  sum,
  toDecimal,
  toNumber,
  toPlainString,
  tryDecimal,
} from './decimal';
export {
  FX_BASE,
  currencyMinorUnits,
  fromMinorUnits,
  isCurrencyCode,
  moneyValue,
  normalizeCurrency,
  roundMoney,
  toMinorUnits,
  zeroMoney,
} from './currency';
export {
  type ConversionContext,
  type ExpenseConversion,
  CROSS_RATE_SCALE,
  LATEST,
  applyRate,
  bookRate,
  convertAmount,
  convertExpense,
  crossRate,
  eurRate,
  expenseInHome,
  isIsoDate,
} from './convert';
export { MONEY_CATEGORIES, type SummarizeOptions, emptyTripMoneySummary, summarizeTripMoney } from './summary';
export {
  type ParseAmountError,
  type ParseAmountOptions,
  type ParseAmountResult,
  decimalSeparatorFor,
  parseAmount,
} from './parse';
export {
  type HomeChangePlan,
  type RateFillGroup,
  type RateNeed,
  LATEST_REQUEST,
  addDaysIso,
  fxRequestDate,
  localIsoDate,
  mergeRateNeeds,
  missingRateNeeds,
  needsRateFill,
  needsRederive,
  planHomeCurrencyChange,
  planRateFills,
  rateFillPatch,
  rateNeeds,
  wantedRateDate,
} from './reconcile';
