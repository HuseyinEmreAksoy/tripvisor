// Tripvisor M5 Y1.3 — exchange-rate client for the `fx-rates` Edge Function
// (ADR-0012). Frankfurter/ECB rates, cached per day in Postgres server-side.
//
// Contract (supabase/functions/fx-rates/handler.ts, contractVersion 1):
//   rates       { base, date, rateDate, rates: {Q: n}, rate?, missing?, source, stale, meta }
//               rates[Q] = Q units per 1 `base` unit, unrounded (round at display).
//               `date` is the requested day (today in UTC for "latest");
//               `rateDate` is the publication day behind the numbers (a
//               Saturday expense gets Friday's ECB set). `stale: true` means
//               upstream was down and an older cached day was served.
//   currencies  { date, rateDate, currencies: [{ code, ecb }], stale, meta }
//
// Money model reminder (ADR-0012 §3, 0034): an expense stores its original
// `amount` + `currency`, and `fx_rate` = HOME units per 1 ORIGINAL unit plus
// `fx_date`. That is exactly `fetchFxRate(original, home, date).rate`.
//
// Query keys are LOCAL (shared-file rule for parallel waves): Y2.2 owns
// `_keys.ts` and the persister allowlist, and may re-home these keys there.
// The root is 'fx'. Nothing here is Google data, so persisting it is allowed
// (ADR-0012 §4), but that opt-in is Y2.2's, not this file's.

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from './supabase';
import { EdgeFunctionError, tryParseEdgeFunctionError } from './_errors';

// ===========================================================================
// Types
// ===========================================================================

export const FX_CONTRACT_VERSION = 1;

export type FxSource = 'frankfurter-ecb' | 'frankfurter' | 'currency-api';

export interface FxRatesResponse {
  base: string;
  /** Requested day, YYYY-MM-DD (UTC today for "latest"). */
  date: string;
  /** Publication day of the rates used, <= date. */
  rateDate: string;
  /** Quote units per 1 base unit, unrounded. */
  rates: Record<string, number>;
  /** Present only when exactly one quote was requested. */
  rate?: number;
  /** Requested quotes with no available rate. */
  missing?: string[];
  source: FxSource | 'mixed';
  stale: boolean;
  meta: { contractVersion: number; cache: 'hit' | 'miss' | 'stale' };
}

export interface FxCurrency {
  code: string;
  /** Published by the ECB (official reference rate) vs. blended from other central banks. */
  ecb: boolean;
}

export interface FxCurrenciesResponse {
  date: string;
  rateDate: string;
  currencies: FxCurrency[];
  stale: boolean;
  meta: { contractVersion: number; cache: 'hit' | 'miss' | 'stale' };
}

export interface FxRatesParams {
  /** ISO 4217, default 'EUR'. */
  base?: string;
  /** YYYY-MM-DD or 'latest' (default). */
  date?: string;
  /** ISO 4217 codes; omit for the full table. */
  quotes?: string[];
}

/** One conversion: `rate` = `to` units per 1 `from` unit. */
export interface FxPairRate {
  from: string;
  to: string;
  rate: number;
  date: string;
  rateDate: string;
  source: FxSource | 'mixed';
  stale: boolean;
}

/**
 * Typed error for the `fx-rates` envelope. Known codes:
 *   invalid_input 400 · not_authenticated 401 · unsupported_currency 422 ·
 *   quota_exceeded 429 · quota_unavailable 503 · rates_unavailable 503 ·
 *   auth_unavailable 503 · internal_error 500
 * `rates_unavailable` / `quota_*` are transient: an expense entered then
 * should be saved with `fx_rate = null` ("rate pending", ADR-0012 §4).
 */
export class FxError extends EdgeFunctionError {
  constructor(code: string, message: string, status: number) {
    super(code, message, status);
    this.name = 'FxError';
  }
}

const NON_RETRYABLE = new Set(['invalid_input', 'not_authenticated', 'unsupported_currency', 'quota_exceeded']);

/** True for failures that will not fix themselves on retry. */
export function isPermanentFxError(err: unknown): boolean {
  return err instanceof FxError && NON_RETRYABLE.has(err.code);
}

// ===========================================================================
// Keys (local; see header)
// ===========================================================================

function normCode(c: string): string {
  return c.trim().toUpperCase();
}

function normParams(p: FxRatesParams): { base: string; date: string; quotes: string[] } {
  return {
    base: normCode(p.base ?? 'EUR'),
    date: p.date ?? 'latest',
    quotes: [...new Set((p.quotes ?? []).map(normCode))].sort(),
  };
}

export const fxKeys = {
  all: ['fx'] as const,
  rates: (p: FxRatesParams) => {
    const n = normParams(p);
    return [...fxKeys.all, 'rates', n.base, n.date, n.quotes.join(',')] as const;
  },
  currencies: () => [...fxKeys.all, 'currencies'] as const,
};

// ===========================================================================
// Response validation (defence in depth on the contract; additive fields pass)
// ===========================================================================

const metaSchema = z.object({
  contractVersion: z.number(),
  cache: z.enum(['hit', 'miss', 'stale']),
});

const sourceSchema = z.enum(['frankfurter-ecb', 'frankfurter', 'currency-api', 'mixed']);

const ratesSchema = z.object({
  base: z.string(),
  date: z.string(),
  rateDate: z.string(),
  rates: z.record(z.number().positive()),
  rate: z.number().positive().optional(),
  missing: z.array(z.string()).optional(),
  source: sourceSchema,
  stale: z.boolean(),
  meta: metaSchema,
});

const currenciesSchema = z.object({
  date: z.string(),
  rateDate: z.string(),
  currencies: z.array(z.object({ code: z.string(), ecb: z.boolean() })),
  stale: z.boolean(),
  meta: metaSchema,
});

// ===========================================================================
// Fetchers (plain async: usable outside React, e.g. the Y2.2 expense facade)
// ===========================================================================

async function invokeFx(body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke('fx-rates', { body });
  if (error) {
    const typed = await tryParseEdgeFunctionError(error, FxError);
    if (typed) throw typed;
    throw error;
  }
  return data;
}

/** Rates for one day relative to `base` (default EUR, latest, full table). */
export async function fetchFxRates(params: FxRatesParams = {}): Promise<FxRatesResponse> {
  const n = normParams(params);
  const body: Record<string, unknown> = { base: n.base, date: n.date };
  if (n.quotes.length > 0) body.quotes = n.quotes;
  return ratesSchema.parse(await invokeFx(body)) as FxRatesResponse;
}

/**
 * `to` units per 1 `from` unit on `date` (default latest). For an expense:
 * `fetchFxRate(expense.currency, trip.currency, expense.date)` gives the
 * `fx_rate` to freeze, and `rateDate`/`date` the `fx_date`.
 */
export async function fetchFxRate(from: string, to: string, date: string = 'latest'): Promise<FxPairRate> {
  const f = normCode(from);
  const t = normCode(to);
  if (f === t) {
    // No network for the identity. "latest" resolves to today (UTC) like the server does.
    const day = date === 'latest' ? new Date().toISOString().slice(0, 10) : date;
    return { from: f, to: t, rate: 1, date: day, rateDate: day, source: 'frankfurter-ecb', stale: false };
  }
  const res = await fetchFxRates({ base: f, date, quotes: [t] });
  const rate = res.rates[t];
  if (rate === undefined) throw new FxError('unsupported_currency', `No rate available for ${t}`, 422);
  return { from: f, to: t, rate, date: res.date, rateDate: res.rateDate, source: res.source, stale: res.stale };
}

/** Every currency fx-rates can convert today, with the ECB flag. */
export async function fetchFxCurrencies(): Promise<FxCurrenciesResponse> {
  return currenciesSchema.parse(await invokeFx({ action: 'currencies' })) as FxCurrenciesResponse;
}

// ===========================================================================
// Hooks
// ===========================================================================

const HOUR = 60 * 60 * 1000;
/** §M5: the client caches latest FX for 6 h (the server refreshes on the same rhythm). */
const LATEST_STALE_MS = 6 * HOUR;
/** A past day's rates never change; keep them for the session. */
const HISTORICAL_STALE_MS = 24 * HOUR;

function retry(failureCount: number, error: unknown): boolean {
  if (isPermanentFxError(error)) return false;
  return failureCount < 2;
}

/** Rates table for one day. Pass `undefined` to hold the query. */
export function useFxRates(params: FxRatesParams | undefined, options: { enabled?: boolean } = {}) {
  const isLatest = (params?.date ?? 'latest') === 'latest';
  return useQuery<FxRatesResponse, FxError | Error>({
    queryKey: params ? fxKeys.rates(params) : [...fxKeys.all, 'rates', 'none'],
    enabled: (options.enabled ?? true) && params !== undefined,
    staleTime: isLatest ? LATEST_STALE_MS : HISTORICAL_STALE_MS,
    gcTime: 24 * HOUR,
    retry,
    queryFn: () => fetchFxRates(params ?? {}),
  });
}

/** One pair (`to` per 1 `from`) on `date` (default latest). */
export function useFxRate(
  from: string | undefined,
  to: string | undefined,
  date: string = 'latest',
  options: { enabled?: boolean } = {},
) {
  const ready = !!from && !!to;
  const f = ready ? normCode(from!) : '';
  const t = ready ? normCode(to!) : '';
  return useQuery<FxPairRate, FxError | Error>({
    queryKey: [...fxKeys.all, 'pair', f, t, date] as const,
    enabled: (options.enabled ?? true) && ready,
    staleTime: date === 'latest' ? LATEST_STALE_MS : HISTORICAL_STALE_MS,
    gcTime: 24 * HOUR,
    retry,
    queryFn: () => fetchFxRate(f, t, date),
  });
}

/** Supported currency list (for the picker). */
export function useFxCurrencies(options: { enabled?: boolean } = {}) {
  return useQuery<FxCurrenciesResponse, FxError | Error>({
    queryKey: fxKeys.currencies(),
    enabled: options.enabled ?? true,
    staleTime: 24 * HOUR,
    gcTime: 24 * HOUR,
    retry,
    queryFn: fetchFxCurrencies,
  });
}
