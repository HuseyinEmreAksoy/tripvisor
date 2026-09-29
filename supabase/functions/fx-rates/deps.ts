// fx-rates — supabase-js wiring for FxDeps (see handler.ts).
//
// Client: one service-role client with a 5 s per-request timeout
// (_shared/service-usage.ts has the justification): fx_rates writes and the
// consume_service_usage RPC are service-role only (0034 / 0037). Reads are
// global public reference data (no trip scope, no RLS decision to bypass).
//
// Per-user fill cap: 0037 ships no per-user FX counter, so fills are counted
// in service_usage under a PSEUDONYMOUS per-user name
// ('fxu_' + 32 hex of HMAC-SHA256(service key, user id)); see
// pseudonymousUsageKey. Same atomic, fail-closed consume_service_usage.

import {
  type AdminLike,
  consumeServiceUsage,
  pseudonymousUsageKey,
  timedAdminClient,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from '../_shared/service-usage.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import type { FxDeps } from './handler.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { decodeSource, encodeSource, FX_BASE, type RateRow, type Snapshot } from './rates.ts';

interface FxRow {
  quote: string;
  rate: number | string;
  source: string;
  fetched_at: string;
  rate_date?: string;
}

/** fx_rates rows (one rate_date) -> Snapshot. Undecodable rows are skipped. */
export function rowsToSnapshot(date: string, rows: readonly FxRow[]): Snapshot | null {
  const map = new Map<string, RateRow>();
  let newest = 0;
  for (const r of rows) {
    const decoded = decodeSource(r.source, date);
    const rate = typeof r.rate === 'string' ? Number(r.rate) : r.rate;
    if (!decoded || !Number.isFinite(rate) || rate <= 0) continue;
    map.set(r.quote, { quote: r.quote, rate, source: decoded.source, publishedDate: decoded.publishedDate });
    const t = Date.parse(r.fetched_at);
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  if (map.size === 0) return null;
  // fetchedAt = the newest row: a refresh upserts every row it got, so the
  // newest fetched_at is "when this table was last refreshed". (A quote that
  // vanished upstream keeps its older row and must not pin the table stale.)
  return { date, rows: map, fetchedAt: newest };
}

export function supabaseDeps(): FxDeps {
  // @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
  const env = (k: string): string | undefined => Deno.env.get(k);
  let admin: AdminLike | null = null;
  const client = (): AdminLike => {
    if (admin) return admin;
    const url = env('SUPABASE_URL');
    const key = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new Error('Supabase admin env vars missing');
    admin = timedAdminClient(url, key);
    return admin;
  };

  async function loadDay(date: string): Promise<{ snapshot: Snapshot | null; error: string | null }> {
    const { data, error } = await client()
      .from('fx_rates')
      .select('quote, rate, source, fetched_at')
      .eq('base', FX_BASE)
      .eq('rate_date', date)
      .limit(1000);
    if (error) return { snapshot: null, error: String(error.message) };
    return { snapshot: rowsToSnapshot(date, (data ?? []) as FxRow[]), error: null };
  }

  return {
    async loadSnapshot(date) {
      try {
        return await loadDay(date);
      } catch (e) {
        return { snapshot: null, error: String(e) };
      }
    },

    async loadLatestBefore(beforeDate, minDate) {
      try {
        const { data, error } = await client()
          .from('fx_rates')
          .select('rate_date')
          .eq('base', FX_BASE)
          .lt('rate_date', beforeDate)
          .gte('rate_date', minDate)
          .order('rate_date', { ascending: false })
          .limit(1);
        if (error) return { snapshot: null, error: String(error.message) };
        const day = (data as Array<{ rate_date: string }> | null)?.[0]?.rate_date;
        if (!day) return { snapshot: null, error: null };
        return await loadDay(day);
      } catch (e) {
        return { snapshot: null, error: String(e) };
      }
    },

    async saveSnapshot(date, rows, fetchedAtIso) {
      try {
        const { error } = await client()
          .from('fx_rates')
          .upsert(
            rows.map((r) => ({
              base: FX_BASE,
              quote: r.quote,
              rate_date: date,
              rate: r.rate,
              source: encodeSource(r, date),
              fetched_at: fetchedAtIso,
            })),
            { onConflict: 'base,quote,rate_date' },
          );
        return { error: error ? String(error.message) : null };
      } catch (e) {
        return { error: String(e) };
      }
    },

    async consumeService(service, units, cap) {
      try {
        return await consumeServiceUsage(client(), service, units, cap);
      } catch {
        return 'unavailable';
      }
    },

    async consumeUserFills(userId, cap) {
      try {
        const secret = env('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        if (!secret) return 'unavailable';
        const key = await pseudonymousUsageKey('fxu', userId, secret);
        return await consumeServiceUsage(client(), key, 1, cap);
      } catch {
        return 'unavailable';
      }
    },

    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    contact: env('UPSTREAM_CONTACT'),
  };
}
