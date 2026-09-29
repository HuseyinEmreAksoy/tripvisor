/**
 * expense-fx.ts — M5 Y2.2 money data layer (ADR-0012): the I/O around the
 * pure money library (`src/lib/money`).
 *
 *   resolveEntryFxRate   freeze a rate when an expense is created / its currency
 *                        changes: identity → cached ("last-known rate map",
 *                        persisted under the 'fx' root) → fx-rates (short
 *                        timeout) → otherwise PENDING (fx_rate NULL).
 *   fetchFxRateBook /    the `fx_rates` table read (EUR-based, exact fx_date —
 *   useFxRateBook        the same lookup the analytics MV does) for step 3.
 *   warmFxRates          ask fx-rates to fill the table for given days (after a
 *                        home-currency change, or for rows still pending).
 *   reconciler           fills `fx_rate` on pending rows on reconnect / app
 *                        focus / backoff: `updateExpense(id, { fx_rate, fx_date,
 *                        fx_home_currency })` through Tier-1 (offline-safe
 *                        queue) or PostgREST (flag-off), owner/editor only.
 *   useMoneySummaries    per-trip TripMoneySummary (home totals, per-currency
 *                        breakdown, pending report) from rows + trips.
 *
 * Conversion order (never duplicated here — see src/lib/money/convert.ts):
 * same currency ×1 → frozen fx_rate only into the CURRENT home → EUR table on
 * fx_date → PENDING (excluded, reported per original currency).
 *
 * This module never imports trip-expenses.ts / trips.ts (they import it), so
 * it reads rows and trips from the Tier-1 store and the TanStack cache.
 */
import { useEffect, useMemo } from 'react';
import { onlineManager, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';
import { supabase } from './supabase';
import {
  FxError,
  type FxPairRate,
  type FxRatesResponse,
  fetchFxRate,
  fetchFxRates,
  fxKeys,
  fxStaleTime,
  useFxRate,
  useFxRates,
} from './fx';
import { tripExpensesKeys, tripsKeys } from './_keys';
import type { Trip, TripCollaboratorRole, TripExpense, Uuid } from './types';
import { isTier1SyncActive, updateExpense as syncUpdateExpense } from '@/sync/mutations';
import { getTier1SyncUserId } from '@/sync/hydrate';
import { tier1Store$ } from '@/sync/store';
import {
  type CurrencyCode,
  type MoneyValue,
  type RateBook,
  type RateMode,
  type RateNeed,
  type TripMoneySummary,
  FX_BASE,
  LATEST_REQUEST,
  applyRate,
  crossRate,
  fxRequestDate,
  isIsoDate,
  localIsoDate,
  mergeRateNeeds,
  missingRateNeeds,
  moneyValue,
  needsRateFill,
  normalizeCurrency,
  planRateFills,
  rateFillPatch,
  rateNeeds,
  summarizeTripMoney,
  toNumber,
  tryDecimal,
  wantedRateDate,
} from '@/lib/money';

// ===========================================================================
// Trip money context (home currency, start date, owner) from local caches
// ===========================================================================

export interface TripMoneyContext {
  tripId: Uuid;
  /** `trips.currency` (normalised), or null when unknown. */
  home: CurrencyCode | null;
  startDate: string | null;
  /** `trips.user_id`; null for an unacked local create (the engine user owns it). */
  ownerId: Uuid | null;
}

type TripLike = Partial<Pick<Trip, 'id' | 'user_id' | 'currency' | 'start_date'>>;

function tripFromCaches(qc: QueryClient, tripId: Uuid): TripLike | null {
  if (isTier1SyncActive()) {
    const row = tier1Store$.trips[tripId]?.peek() as TripLike | undefined;
    if (row) return row;
  }
  const detail = qc.getQueryData<Trip | null>(tripsKeys.detail(tripId));
  if (detail) return detail;
  for (const [, data] of qc.getQueriesData<unknown>({ queryKey: tripsKeys.all })) {
    if (!Array.isArray(data)) continue;
    const hit = (data as TripLike[]).find((t) => t && t.id === tripId);
    if (hit) return hit;
  }
  return null;
}

function toContext(tripId: Uuid, trip: TripLike): TripMoneyContext {
  return {
    tripId,
    home: normalizeCurrency(trip.currency),
    startDate: typeof trip.start_date === 'string' ? trip.start_date : null,
    ownerId: (trip.user_id as Uuid | undefined) ?? null,
  };
}

/** Synchronous: the trip's money context from the Tier-1 store / query cache, or null. */
export function peekTripMoneyContext(qc: QueryClient, tripId: Uuid): TripMoneyContext | null {
  const trip = tripFromCaches(qc, tripId);
  return trip ? toContext(tripId, trip) : null;
}

/** Like {@link peekTripMoneyContext}, falling back to one PostgREST read when online. */
export async function loadTripMoneyContext(
  qc: QueryClient,
  tripId: Uuid,
  timeoutMs = ENTRY_FX_TIMEOUT_MS,
): Promise<TripMoneyContext | null> {
  const cached = peekTripMoneyContext(qc, tripId);
  if (cached?.home || !onlineManager.isOnline()) return cached;
  try {
    const { data, error } = await withTimeout(
      Promise.resolve(
        supabase.from('trips').select('id, user_id, currency, start_date').eq('id', tripId).maybeSingle(),
      ),
      timeoutMs,
    );
    if (error || !data) return cached;
    return toContext(tripId, data as TripLike);
  } catch {
    return cached;
  }
}

// ===========================================================================
// Small async helpers
// ===========================================================================

/** How long an expense save waits for fx-rates before saving "rate pending". */
export const ENTRY_FX_TIMEOUT_MS = 4000;

class FxTimeoutError extends Error {
  constructor() {
    super('fx lookup timed out');
    this.name = 'FxTimeoutError';
  }
}

/** Race `promise` against a timer. The underlying request keeps running (and still fills the cache). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new FxTimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export type FxFailureKind = 'offline' | 'unavailable' | 'quota' | 'unsupported' | 'timeout' | 'error';

/** Map an fx-rates failure to what the caller should do (pending + retry vs give up). */
export function classifyFxFailure(err: unknown): FxFailureKind {
  if (err instanceof FxTimeoutError) return 'timeout';
  if (err instanceof FxError) {
    switch (err.code) {
      case 'unsupported_currency':
        return 'unsupported';
      case 'quota_exceeded':
        return 'quota';
      case 'rates_unavailable':
      case 'quota_unavailable':
      case 'auth_unavailable':
      case 'internal_error':
        return 'unavailable';
      default:
        return 'error';
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/network request failed|failed to fetch|networkerror|load failed|fetch failed/i.test(message)) return 'offline';
  if (err instanceof Error && err.name === 'FunctionsFetchError') return 'offline';
  return 'error';
}

// ===========================================================================
// The last-known rate map (TanStack cache, persisted under 'fx')
// ===========================================================================

/** A cached 'latest' rate older than this is not frozen into a new expense. */
export const LATEST_MAX_AGE_DAYS = 7;

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

function usableDate(requestDate: string, dataDate: string | undefined, today: string): boolean {
  if (!dataDate || !isIsoDate(dataDate)) return false;
  if (requestDate === LATEST_REQUEST) return daysBetween(dataDate, today) <= LATEST_MAX_AGE_DAYS;
  return true;
}

export interface CachedFxRate {
  rate: number;
  /** The date the rate belongs to (becomes fx_date). */
  date: string;
}

/**
 * `to` per 1 `from` for `requestDate` ('latest' or a past day) from anything
 * already in the query cache (a `useFxRate` pair, an EUR/`from`/`to` rates
 * table, or an fx_rates book day). null when nothing usable is cached.
 */
export function findCachedFxRate(
  qc: QueryClient,
  fromCode: CurrencyCode,
  toCode: CurrencyCode,
  requestDate: string,
  today: string = localIsoDate(),
): CachedFxRate | null {
  const from = normalizeCurrency(fromCode);
  const to = normalizeCurrency(toCode);
  if (!from || !to) return null;
  if (from === to) return { rate: 1, date: requestDate === LATEST_REQUEST ? today : requestDate };
  const pair = qc.getQueryData<FxPairRate>(fxKeys.pair(from, to, requestDate));
  if (pair && pair.rate > 0 && usableDate(requestDate, pair.date, today)) return { rate: pair.rate, date: pair.date };

  for (const [key, data] of qc.getQueriesData<FxRatesResponse>({ queryKey: [...fxKeys.all, 'rates'] })) {
    if (!data || key[3] !== requestDate || !usableDate(requestDate, data.date, today)) continue;
    const base = normalizeCurrency(data.base);
    if (!base) continue;
    const day: Record<string, number> = { ...data.rates };
    // Rebase the table on EUR when needed: rates are `quote per 1 base`.
    let eurDay: Record<string, number> | null = null;
    if (base === FX_BASE) eurDay = day;
    else if (typeof day[FX_BASE] === 'number' && day[FX_BASE]! > 0) {
      const perEur = 1 / day[FX_BASE]!; // base units per 1 EUR
      eurDay = { [base]: perEur };
      for (const [code, r] of Object.entries(day)) if (code !== FX_BASE) eurDay[code] = r * perEur;
    } else if (base === from && typeof day[to] === 'number' && day[to]! > 0) {
      return { rate: day[to]!, date: data.date };
    } else if (base === to && typeof day[from] === 'number' && day[from]! > 0) {
      const inverse = crossRate({ [from]: day[from]! }, from, FX_BASE); // 1 / rate, 30 digits
      if (inverse) return { rate: toNumber(inverse), date: data.date };
    }
    if (eurDay) {
      const rate = crossRate(eurDay, from, to);
      if (rate) return { rate: toNumber(rate), date: data.date };
    }
  }

  if (requestDate !== LATEST_REQUEST) {
    for (const [, book] of qc.getQueriesData<RateBook>({ queryKey: [...fxKeys.all, 'book'] })) {
      const rate = crossRate(book?.[requestDate], from, to);
      if (rate) return { rate: toNumber(rate), date: requestDate };
    }
  }
  return null;
}

// ===========================================================================
// Entry-time resolution (create / currency change)
// ===========================================================================

export type EntryFxResolution =
  | { status: 'resolved'; rate: number; fxDate: string; source: 'identity' | 'cache' | 'network' }
  | { status: 'pending'; fxDate: string; reason: FxFailureKind | 'no_home' };

/**
 * The rate to freeze for an expense of `from` in a trip whose home is `to`,
 * wanted for `wantedDate` (≤ today, see wantedRateDate). Never throws: any
 * failure is `pending` (the row saves with fx_rate NULL and the reconciler
 * fills it later). Offline it answers immediately.
 */
export async function resolveEntryFxRate(
  qc: QueryClient,
  args: { from: CurrencyCode; to: CurrencyCode | null; wantedDate: string; today?: string; timeoutMs?: number },
): Promise<EntryFxResolution> {
  const today = args.today ?? localIsoDate();
  const from = normalizeCurrency(args.from);
  const to = normalizeCurrency(args.to);
  const wanted = isIsoDate(args.wantedDate) && args.wantedDate <= today ? args.wantedDate : today;
  if (!from || !to) return { status: 'pending', fxDate: wanted, reason: 'no_home' };
  if (from === to) return { status: 'resolved', rate: 1, fxDate: wanted, source: 'identity' };

  const requestDate = fxRequestDate(wanted, today);
  const cached = findCachedFxRate(qc, from, to, requestDate, today);
  if (cached) return { status: 'resolved', rate: cached.rate, fxDate: cached.date, source: 'cache' };

  if (!onlineManager.isOnline()) return { status: 'pending', fxDate: wanted, reason: 'offline' };
  try {
    const pair = await withTimeout(
      qc.fetchQuery({
        queryKey: fxKeys.pair(from, to, requestDate),
        queryFn: () => fetchFxRate(from, to, requestDate),
        staleTime: fxStaleTime(requestDate),
        retry: false,
      }),
      args.timeoutMs ?? ENTRY_FX_TIMEOUT_MS,
    );
    if (!(pair.rate > 0)) return { status: 'pending', fxDate: wanted, reason: 'error' };
    return { status: 'resolved', rate: pair.rate, fxDate: isIsoDate(pair.date) ? pair.date : wanted, source: 'network' };
  } catch (err) {
    return { status: 'pending', fxDate: wanted, reason: classifyFxFailure(err) };
  }
}

// ===========================================================================
// The fx_rates table (EUR-based; step 3 of the conversion order)
// ===========================================================================

function needDates(needs: readonly RateNeed[]): string[] {
  return [...new Set(needs.map((n) => n.date))].sort();
}

function needCodes(needs: readonly RateNeed[]): string[] {
  return [...new Set(needs.flatMap((n) => n.currencies))].filter((c) => c !== FX_BASE).sort();
}

/** Query key of one table read (the union of days × codes). Root 'fx' → persisted. */
export function fxBookKey(needs: readonly RateNeed[]) {
  return [...fxKeys.all, 'book', needDates(needs).join(','), needCodes(needs).join(',')] as const;
}

const BOOK_DATE_CHUNK = 50;

/**
 * Read `fx_rates` (authenticated SELECT, no Edge Function, no quota) for the
 * given days and codes: `book[date][quote]` = quote per 1 EUR. Days or codes
 * the table does not have yet are simply absent (step 3 then stays pending
 * for them until warmed).
 */
export async function fetchFxRateBook(needs: readonly RateNeed[]): Promise<RateBook> {
  const dates = needDates(needs);
  const codes = needCodes(needs);
  const book: Record<string, Record<string, number>> = {};
  if (dates.length === 0 || codes.length === 0) return book;
  for (let i = 0; i < dates.length; i += BOOK_DATE_CHUNK) {
    const chunk = dates.slice(i, i + BOOK_DATE_CHUNK);
    const { data, error } = await supabase
      .from('fx_rates')
      .select('quote, rate, rate_date')
      .eq('base', FX_BASE)
      .in('rate_date', chunk)
      .in('quote', codes);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ quote: string; rate: number | string; rate_date: string }>) {
      const rate = Number(row.rate);
      if (!Number.isFinite(rate) || rate <= 0) continue;
      (book[row.rate_date] ??= {})[row.quote] = rate;
    }
  }
  return book;
}

/** Table rates for `needs` (disabled when empty). Past days are final: long stale time. */
export function useFxRateBook(needs: readonly RateNeed[], options: { enabled?: boolean } = {}) {
  return useQuery<RateBook, Error>({
    queryKey: fxBookKey(needs),
    enabled: (options.enabled ?? true) && needs.length > 0,
    staleTime: 30 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
    queryFn: () => fetchFxRateBook(needs),
  });
}

// ===========================================================================
// Warming (fill the table for given days via fx-rates)
// ===========================================================================

export interface WarmFxReport {
  needs: RateNeed[];
  /** Days now answered from a real table for that day. */
  warmed: string[];
  /** Days that could not be warmed (and why: an FxFailureKind, 'stale' or 'missing'). */
  failed: Array<{ date: string; reason: string }>;
  /** The per-user fill quota ran out; the rest was not attempted. */
  quotaExceeded: boolean;
  /** Nothing was attempted because the device is offline. */
  offline: boolean;
}

/**
 * Ask fx-rates for the EUR table of each `need` (quotes = its codes). The
 * function stores what it fetched under that day, which is what step 3 and
 * the analytics MV read. Cache hits are free; fills count against the
 * per-user daily cap, so this stops at the first quota_exceeded.
 */
export async function warmFxRates(
  qc: QueryClient,
  needs: readonly RateNeed[],
  opts: { today?: string } = {},
): Promise<WarmFxReport> {
  const today = opts.today ?? localIsoDate();
  const report: WarmFxReport = { needs: [...needs], warmed: [], failed: [], quotaExceeded: false, offline: false };
  if (needs.length === 0) return report;
  if (!onlineManager.isOnline()) {
    report.offline = true;
    return report;
  }
  for (const need of needs) {
    const quotes = need.currencies.filter((c) => c !== FX_BASE);
    if (quotes.length === 0) continue;
    const date = fxRequestDate(need.date, today);
    try {
      const res = await qc.fetchQuery({
        queryKey: fxKeys.rates({ base: FX_BASE, date, quotes }),
        queryFn: () => fetchFxRates({ base: FX_BASE, date, quotes }),
        staleTime: fxStaleTime(date),
        retry: false,
      });
      if (res.stale) report.failed.push({ date: need.date, reason: 'stale' });
      else if ((res.missing ?? []).length > 0) report.failed.push({ date: need.date, reason: 'missing' });
      else report.warmed.push(need.date);
    } catch (err) {
      const kind = classifyFxFailure(err);
      report.failed.push({ date: need.date, reason: kind });
      if (kind === 'quota') {
        report.quotaExceeded = true;
        break;
      }
      if (kind === 'offline') {
        report.offline = true;
        break;
      }
    }
  }
  await qc.invalidateQueries({ queryKey: [...fxKeys.all, 'book'] });
  return report;
}

/** Session memo so a summary warms each missing (day, codes) at most once per window. */
const warmAttempts = new Map<string, number>();
const WARM_RETRY_MS = 30 * 60 * 1000;

function takeWarmAttempts(needs: readonly RateNeed[], now: number): RateNeed[] {
  const fresh: RateNeed[] = [];
  for (const need of needs) {
    const key = `${need.date}|${need.currencies.join(',')}`;
    const last = warmAttempts.get(key);
    if (last !== undefined && now - last < WARM_RETRY_MS) continue;
    warmAttempts.set(key, now);
    fresh.push(need);
  }
  return fresh;
}

/** Test seam: forget the auto-warm memo. */
export function _resetFxWarmMemoForTests(): void {
  warmAttempts.clear();
}

// ===========================================================================
// Reading expense rows without importing trip-expenses.ts
// ===========================================================================

/** Live rows from the Tier-1 store (when active) plus every cached expenses query, deduped by id. */
export function collectKnownExpenses(qc: QueryClient): TripExpense[] {
  const out = new Map<string, TripExpense>();
  if (isTier1SyncActive()) {
    const record = tier1Store$.tripExpenses.peek() as Record<string, TripExpense> | undefined;
    for (const row of Object.values(record ?? {})) {
      if (row && row.deleted !== true) out.set(row.id, row);
    }
  }
  for (const [, data] of qc.getQueriesData<unknown>({ queryKey: tripExpensesKeys.all })) {
    if (!Array.isArray(data)) continue;
    for (const row of data as TripExpense[]) {
      if (row && row.id && row.deleted !== true && !out.has(row.id)) out.set(row.id, row);
    }
  }
  return [...out.values()];
}

function tier1ExpenseRow(id: string): TripExpense | undefined {
  if (!isTier1SyncActive()) return undefined;
  return tier1Store$.tripExpenses[id]?.peek() as TripExpense | undefined;
}

// ===========================================================================
// The reconciler (fills pending fx_rate)
// ===========================================================================

export interface ReconcileReport {
  groups: number;
  filled: number;
  /** Groups not written: no permission (viewer), unknown trip or unsupported currency. */
  skipped: number;
  /** Groups whose rate could not be fetched this time (will retry). */
  failed: number;
  /** Groups left for a later pass (more than MAX_GROUPS_PER_PASS were due). */
  deferred: number;
  quotaExceeded: boolean;
  offline: boolean;
}

/** Codes fx-rates answered 422 for this session: never retried until restart. */
const unsupportedCodes = new Set<string>();
/** Groups handled per pass (bounds the Edge Function calls one reconnect can trigger). */
const MAX_GROUPS_PER_PASS = 20;

async function callerUserId(): Promise<string | null> {
  const engineUser = getTier1SyncUserId();
  if (engineUser) return engineUser;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

async function editorTripIds(qc: QueryClient, userId: string): Promise<Partial<Record<Uuid, TripCollaboratorRole>>> {
  return qc.fetchQuery({
    // NOT under a persisted root; memory-only for the session.
    queryKey: ['fx-reconciler', 'roles', userId],
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trip_collaborators')
        .select('trip_id, role')
        .eq('user_id', userId)
        .eq('status', 'accepted');
      if (error) throw error;
      return Object.fromEntries(
        ((data ?? []) as Array<{ trip_id: Uuid; role: TripCollaboratorRole }>).map((r) => [r.trip_id, r.role]),
      ) as Partial<Record<Uuid, TripCollaboratorRole>>;
    },
  });
}

/**
 * Owner or editor only. Viewers are read-only under RLS, and a Tier-1 write
 * the server rejects would be retried forever, so a viewer's client must
 * never attempt one.
 */
async function canWriteExpenses(qc: QueryClient, tripId: Uuid, userId: string): Promise<boolean> {
  const ctx = peekTripMoneyContext(qc, tripId);
  if (ctx) {
    if (ctx.ownerId === userId) return true;
    // An unacked local trip create has no user_id yet: only the engine user's store can hold one.
    if (ctx.ownerId === null && isTier1SyncActive() && tier1Store$.trips[tripId]?.peek()) return true;
  }
  try {
    const roles = await editorTripIds(qc, userId);
    return roles[tripId] === 'editor';
  } catch {
    return false;
  }
}

async function writeRateFill(
  qc: QueryClient,
  row: TripExpense,
  patch: { fx_rate: number; fx_date: string; fx_home_currency: string },
): Promise<boolean> {
  const inStore = tier1ExpenseRow(row.id);
  if (inStore) {
    try {
      // The UndoEntry is discarded: a background fill is not a user edit.
      syncUpdateExpense(row.id, patch, 'Fill exchange rate');
      return true;
    } catch {
      return false; // not writable / invalid → leave it pending
    }
  }
  try {
    const { error } = await supabase
      .from('trip_expenses')
      .update(patch)
      .eq('id', row.id)
      // Only while still pending: never clobber a rate someone set meanwhile.
      .is('fx_rate', null);
    return !error;
  } catch {
    return false;
  }
}

/**
 * One reconcile pass over every expense row this client knows about. Safe to
 * call any time; offline it returns immediately. Never throws.
 */
export async function reconcilePendingFxRates(
  qc: QueryClient,
  opts: { today?: string } = {},
): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    groups: 0,
    filled: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
    quotaExceeded: false,
    offline: false,
  };
  if (!onlineManager.isOnline()) {
    report.offline = true;
    return report;
  }
  const today = opts.today ?? localIsoDate();
  const rows = collectKnownExpenses(qc);
  const groups = planRateFills(rows, (tripId) => peekTripMoneyContext(qc, tripId)?.home ?? null, {
    today,
    startDateOf: (tripId) => peekTripMoneyContext(qc, tripId)?.startDate ?? null,
  });
  report.groups = groups.length;
  if (groups.length === 0) return report;

  const userId = await callerUserId();
  if (!userId) {
    report.skipped = groups.length;
    return report;
  }

  const touchedTrips = new Set<Uuid>();
  report.deferred = Math.max(0, groups.length - MAX_GROUPS_PER_PASS);
  for (const group of groups.slice(0, MAX_GROUPS_PER_PASS)) {
    if (unsupportedCodes.has(group.from) || unsupportedCodes.has(group.to)) {
      report.skipped += 1;
      continue;
    }
    if (!(await canWriteExpenses(qc, group.tripId, userId))) {
      report.skipped += 1;
      continue;
    }
    let rate: number;
    let rateDate: string;
    const cached = findCachedFxRate(qc, group.from, group.to, group.requestDate, today);
    if (cached) {
      rate = cached.rate;
      rateDate = cached.date;
    } else {
      try {
        const pair = await withTimeout(
          qc.fetchQuery({
            queryKey: fxKeys.pair(group.from, group.to, group.requestDate),
            queryFn: () => fetchFxRate(group.from, group.to, group.requestDate),
            staleTime: fxStaleTime(group.requestDate),
            retry: false,
          }),
          PASS_FETCH_TIMEOUT_MS,
        );
        rate = pair.rate;
        rateDate = isIsoDate(pair.date) ? pair.date : group.date;
      } catch (err) {
        const kind = classifyFxFailure(err);
        if (kind === 'unsupported') {
          unsupportedCodes.add(group.from);
          report.skipped += 1;
          continue;
        }
        report.failed += 1;
        if (kind === 'quota') {
          report.quotaExceeded = true;
          break;
        }
        if (kind === 'offline') {
          report.offline = true;
          break;
        }
        continue;
      }
    }
    let patch: ReturnType<typeof rateFillPatch>;
    try {
      patch = rateFillPatch(rate, rateDate, group.to);
    } catch {
      report.failed += 1;
      continue;
    }
    // Re-read after the fetch: the user may have edited or deleted a row meanwhile.
    const freshRows = new Map(collectKnownExpenses(qc).map((r) => [r.id, r] as const));
    for (const id of group.ids) {
      const current = tier1ExpenseRow(id) ?? freshRows.get(id);
      if (!current || !needsRateFill(current, group.to)) continue;
      if (normalizeCurrency(current.currency) !== group.from) continue;
      if (await writeRateFill(qc, current, patch)) {
        report.filled += 1;
        touchedTrips.add(group.tripId);
      }
    }
  }
  for (const tripId of touchedTrips) {
    void qc.invalidateQueries({ queryKey: tripExpensesKeys.forTrip(tripId) });
  }
  if (touchedTrips.size > 0) void qc.invalidateQueries({ queryKey: [...tripExpensesKeys.all, 'mine'] });
  return report;
}

// ── scheduling: reconnect / app focus / backoff, ref-counted ────────────────

const MIN_PASS_INTERVAL_MS = 15_000;
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];
/** Offline re-poll (native has no reconnect event here, see attachTriggers). */
const OFFLINE_RETRY_MS = [30_000, 60_000, 120_000];
const QUOTA_BACKOFF_MS = 60 * 60_000;
const INITIAL_DELAY_MS = 1500;
/** Upper bound for one rate fetch inside a pass (a captive portal can hang a request). */
const PASS_FETCH_TIMEOUT_MS = 15_000;

interface ReconcilerState {
  qc: QueryClient | null;
  holders: number;
  running: Promise<void> | null;
  rerun: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  lastRunAt: number;
  backoffStep: number;
  detach: Array<() => void>;
  lastReport: ReconcileReport | null;
}

const state: ReconcilerState = {
  qc: null,
  holders: 0,
  running: null,
  rerun: false,
  timer: null,
  lastRunAt: 0,
  backoffStep: 0,
  detach: [],
  lastReport: null,
};

function clearTimer(): void {
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

function schedule(delayMs: number): void {
  if (state.holders === 0) return;
  clearTimer();
  state.timer = setTimeout(() => {
    state.timer = null;
    void runPass();
  }, Math.max(0, delayMs));
}

async function runPass(): Promise<void> {
  const qc = state.qc;
  if (!qc || state.holders === 0) return;
  if (state.running) {
    state.rerun = true;
    return;
  }
  state.lastRunAt = Date.now();
  state.running = (async () => {
    let report: ReconcileReport;
    try {
      report = await reconcilePendingFxRates(qc);
    } catch {
      report = { groups: 0, filled: 0, skipped: 0, failed: 1, deferred: 0, quotaExceeded: false, offline: false };
    }
    state.lastReport = report;
    if (report.quotaExceeded) {
      schedule(QUOTA_BACKOFF_MS);
    } else if (report.offline && report.failed > 0) {
      schedule(OFFLINE_RETRY_MS[Math.min(state.backoffStep, OFFLINE_RETRY_MS.length - 1)]!);
      state.backoffStep += 1;
    } else if (report.failed > 0) {
      schedule(BACKOFF_MS[Math.min(state.backoffStep, BACKOFF_MS.length - 1)]!);
      state.backoffStep += 1;
    } else {
      state.backoffStep = 0;
      if (report.deferred > 0) schedule(MIN_PASS_INTERVAL_MS);
    }
  })();
  try {
    await state.running;
  } finally {
    state.running = null;
  }
  if (state.rerun) {
    state.rerun = false;
    // Never shorten a backoff the pass just scheduled.
    if (state.timer === null) schedule(MIN_PASS_INTERVAL_MS);
  }
}

/**
 * Ask for a reconcile pass soon. Throttled (≥ 15 s apart) unless `force`
 * (reconnect). A no-op while no money hook is mounted.
 */
export function requestFxReconcile(opts: { force?: boolean } = {}): void {
  if (state.holders === 0) return;
  const sinceLast = Date.now() - state.lastRunAt;
  const wait = opts.force ? 0 : Math.max(0, MIN_PASS_INTERVAL_MS - sinceLast);
  if (state.timer !== null && !opts.force) return; // one already queued
  schedule(wait);
}

function attachTriggers(): void {
  const add = (fn: () => void) => state.detach.push(fn);
  // TanStack's onlineManager (web: window online/offline events).
  try {
    add(
      onlineManager.subscribe((online) => {
        if (online) requestFxReconcile({ force: true });
      }),
    );
  } catch {
    // ignore
  }
  // App focus (native AppState; react-native-web maps it to page visibility).
  try {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') requestFxReconcile();
    });
    add(() => sub?.remove?.());
  } catch {
    // ignore
  }
  // Native reconnect: onlineManager is not wired to NetInfo in this app, and
  // subscribing to NetInfo from here would crash unmocked Jest workers
  // (async native-reachability TypeError). Instead a pass that finds the
  // device offline re-polls on OFFLINE_RETRY_MS (a fetch that fails locally,
  // no server cost), so the fill lands within a couple of minutes of
  // reconnecting; app focus triggers a pass immediately.
}

/**
 * Start (ref-counted) the background reconciler bound to `qc`. Returns the
 * release function. The first holder runs a pass shortly after mount.
 */
export function acquireFxReconciler(qc: QueryClient): () => void {
  // The app has one QueryClient; a newer holder (tests, a remount) rebinds.
  state.qc = qc;
  state.holders += 1;
  if (state.holders === 1) {
    attachTriggers();
    schedule(INITIAL_DELAY_MS);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.holders = Math.max(0, state.holders - 1);
    if (state.holders === 0) {
      clearTimer();
      for (const fn of state.detach.splice(0)) {
        try {
          fn();
        } catch {
          // ignore
        }
      }
      state.qc = null;
      state.backoffStep = 0;
      state.rerun = false;
    }
  };
}

/** Mount the reconciler for as long as the calling component lives (money hooks do this). */
export function useFxReconciler(): void {
  const qc = useQueryClient();
  useEffect(() => acquireFxReconciler(qc), [qc]);
}

/** Last pass outcome (diagnostics / tests). */
export function getLastFxReconcileReport(): ReconcileReport | null {
  return state.lastReport;
}

/** Test seam: drop the session memo of unsupported codes. */
export function _resetFxReconcilerForTests(): void {
  unsupportedCodes.clear();
  state.lastReport = null;
  state.lastRunAt = 0;
}

// ===========================================================================
// Live preview while typing ("≈ ₺1.234,50")
// ===========================================================================

export interface ExpenseFxPreviewInput {
  /** The typed amount (a number, or the exact string from parseAmount). */
  amount: number | string | null | undefined;
  /** The expense's currency. */
  currency: string | null | undefined;
  /** The trip's home currency. */
  home: string | null | undefined;
  /** Trip start date + the expense's day pick the rate date exactly as the save does. */
  tripStartDate?: string | null;
  dayIndex?: number | null;
  enabled?: boolean;
}

export interface ExpenseFxPreview {
  /** amount × rate in the home currency (display-rounded `value`), or null. */
  converted: MoneyValue | null;
  /** Home units per 1 unit of `currency`, or null while unknown. */
  rate: number | null;
  /** The day the rate belongs to. */
  rateDate: string | null;
  sameCurrency: boolean;
  isLoading: boolean;
  /** No rate available now (offline with nothing cached, fx-rates down): the save will be "rate pending". */
  unavailable: boolean;
}

/**
 * The live conversion the expense sheet shows while typing. It reads and
 * fills the SAME cache entry the save uses, so the previewed rate is the
 * rate that gets frozen (when it is still fresh at save time).
 */
export function useExpenseFxPreview(input: ExpenseFxPreviewInput): ExpenseFxPreview {
  const from = normalizeCurrency(input.currency);
  const to = normalizeCurrency(input.home);
  const today = localIsoDate();
  const wanted = wantedRateDate({ fx_date: null, day_index: input.dayIndex ?? null }, { tripStartDate: input.tripStartDate ?? null, today });
  const requestDate = fxRequestDate(wanted, today);
  const foreign = Boolean(from && to && from !== to);
  const query = useFxRate(from ?? undefined, to ?? undefined, requestDate, {
    enabled: (input.enabled ?? true) && foreign,
  });
  const amount = tryDecimal(input.amount);
  if (!from || !to) {
    return { converted: null, rate: null, rateDate: null, sameCurrency: false, isLoading: false, unavailable: false };
  }
  if (!foreign) {
    return {
      converted: amount ? moneyValue(amount, to) : null,
      rate: 1,
      rateDate: wanted,
      sameCurrency: true,
      isLoading: false,
      unavailable: false,
    };
  }
  const rate = query.data?.rate ?? null;
  return {
    converted: amount && rate ? applyRate(amount, rate, to) : null,
    rate,
    rateDate: query.data?.date ?? null,
    sameCurrency: false,
    isLoading: query.isLoading,
    unavailable: !query.data && (query.isError || (!query.isFetching && query.fetchStatus === 'paused')),
  };
}

// ===========================================================================
// Summaries (home totals + per-currency breakdown + pending)
// ===========================================================================

/** The trip columns a summary needs. `Trip` satisfies it. */
export interface MoneyTripInput {
  id: Uuid;
  /** Home currency (`trips.currency`). */
  currency: string | null | undefined;
  total_budget?: number | null;
}

export interface UseMoneySummariesOptions {
  /** 'entry' (frozen rates, default) or 'today' (today's rate for every foreign row). */
  rateMode?: RateMode;
  /**
   * Ask fx-rates to fill table days that step 3 needs but the table lacks
   * (at most once per 30 min per day+codes). Default true.
   */
  autoWarm?: boolean;
  enabled?: boolean;
}

export interface MoneySummariesResult {
  /** Keyed by trip id; undefined until trips and expenses are both loaded. */
  data: Record<Uuid, TripMoneySummary> | undefined;
  /** A rate table (or today's rates) is loading. Totals render meanwhile; pending may shrink. */
  isFetchingRates: boolean;
  ratesError: Error | null;
  /** RateMode 'today' only: today's rates could not be loaded (rows show as pending). */
  todayRatesUnavailable: boolean;
}

/**
 * Per-trip money summaries for any set of trips + their expense rows (the
 * trip detail passes one trip; analytics can pass all of them). Mounts the
 * background reconciler while in use.
 */
export function useMoneySummaries(
  trips: readonly MoneyTripInput[] | undefined,
  expenses: readonly TripExpense[] | undefined,
  options: UseMoneySummariesOptions = {},
): MoneySummariesResult {
  const qc = useQueryClient();
  const rateMode: RateMode = options.rateMode ?? 'entry';
  const enabled = options.enabled ?? true;
  const autoWarm = options.autoWarm ?? true;
  useFxReconciler();

  const homes = useMemo(() => {
    const map = new Map<Uuid, CurrencyCode>();
    for (const trip of trips ?? []) {
      const home = normalizeCurrency(trip.currency);
      if (home) map.set(trip.id, home);
    }
    return map;
  }, [trips]);

  const rowsByTrip = useMemo(() => {
    const map = new Map<Uuid, TripExpense[]>();
    for (const row of expenses ?? []) {
      if (!row || row.deleted === true) continue;
      const list = map.get(row.trip_id);
      if (list) list.push(row);
      else map.set(row.trip_id, [row]);
    }
    return map;
  }, [expenses]);

  const needs = useMemo(
    () => mergeRateNeeds([...homes.entries()].map(([tripId, home]) => rateNeeds(rowsByTrip.get(tripId) ?? [], home))),
    [homes, rowsByTrip],
  );
  const needsKey = JSON.stringify(needs);
  const bookQuery = useFxRateBook(needs, { enabled: enabled && rateMode === 'entry' });

  const todayCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const [tripId, home] of homes) {
      for (const row of rowsByTrip.get(tripId) ?? []) {
        const code = normalizeCurrency(row.currency);
        if (!code || code === home) continue;
        codes.add(code);
        codes.add(home);
      }
    }
    codes.delete(FX_BASE);
    return [...codes].sort();
  }, [homes, rowsByTrip]);
  const todayQuery = useFxRates(
    rateMode === 'today' && todayCodes.length > 0 ? { base: FX_BASE, date: 'latest', quotes: todayCodes } : undefined,
    { enabled },
  );

  const data = useMemo(() => {
    if (!enabled || !trips || !expenses) return undefined;
    const out: Record<Uuid, TripMoneySummary> = {};
    for (const trip of trips) {
      const home = homes.get(trip.id);
      if (!home) continue;
      out[trip.id] = summarizeTripMoney(rowsByTrip.get(trip.id) ?? [], {
        home,
        book: bookQuery.data,
        rateMode,
        todayRates: todayQuery.data?.rates,
        budget: trip.total_budget ?? null,
      });
    }
    return out;
  }, [enabled, trips, expenses, homes, rowsByTrip, bookQuery.data, rateMode, todayQuery.data]);

  // Self-heal: warm table days step 3 needs but the table lacks (home changed, or rows still pending).
  useEffect(() => {
    if (!enabled || !autoWarm || rateMode !== 'entry' || !bookQuery.isSuccess) return;
    const missing = missingRateNeeds(bookQuery.data, needs);
    if (missing.length === 0 || !onlineManager.isOnline()) return;
    const fresh = takeWarmAttempts(missing, Date.now());
    if (fresh.length === 0) return;
    void warmFxRates(qc, fresh).catch(() => undefined);
    // needsKey stands in for `needs` (stable identity across equal content).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, autoWarm, rateMode, bookQuery.isSuccess, bookQuery.data, needsKey, qc]);

  // Rows waiting for a fill → nudge the reconciler (throttled; hydration may land after mount).
  const pendingFillCount = useMemo(() => {
    let n = 0;
    for (const [tripId, home] of homes) for (const row of rowsByTrip.get(tripId) ?? []) if (needsRateFill(row, home)) n += 1;
    return n;
  }, [homes, rowsByTrip]);
  useEffect(() => {
    if (enabled && pendingFillCount > 0) requestFxReconcile();
  }, [enabled, pendingFillCount]);

  const todayMissing =
    rateMode === 'today' &&
    todayCodes.length > 0 &&
    (todayQuery.isError || (todayQuery.isSuccess && todayCodes.some((c) => !((todayQuery.data?.rates[c] ?? 0) > 0))));

  return {
    data,
    isFetchingRates: bookQuery.isFetching || todayQuery.isFetching,
    ratesError: (bookQuery.error as Error | null) ?? (todayQuery.error as Error | null) ?? null,
    todayRatesUnavailable: Boolean(todayMissing),
  };
}
