// _shared/service-usage.ts: service-role plumbing shared by fx-rates and
// poi-recommend (M5 Y1.3): the usage counters from migration 0037, a timed
// admin client, and a cached app_config reader.
//
// Service-role justification: every write these functions make is to
// SERVICE-ROLE-ONLY objects: fx_rates (0034) and poi_cache (0037) have no
// client write grants, and consume_service_usage / consume_poi_quota are
// EXECUTE-granted to service_role only (0037 §6), so a user can never burn
// the global Overpass budget or another user's quota. The user id passed to
// any consume_* call is always the GoTrue-verified caller from requireUser,
// never request input. Reads here touch only public reference data
// (exchange rates, OSM/Wikipedia caches, kill switches) and are not
// trip-scoped, so there is no RLS decision the service role could bypass.

// @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export type UsageOutcome = 'ok' | 'exceeded' | 'unavailable';

/**
 * Minimal structural view of the supabase-js client used here. Declared
 * locally so this file type-checks without the esm.sh types (repo tsc) and
 * so tests can pass a hand-rolled fake.
 */
export interface AdminLike {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  // deno-lint-ignore no-explicit-any -- supabase-js's query builder is a deep generic chain; callers keep their own row types.
  from(table: string): any;
}

/** Postgres/RPC boolean -> outcome. Anything unexpected fails CLOSED. */
export function toOutcome(res: { data: unknown; error: unknown }): UsageOutcome {
  if (res.error) return 'unavailable';
  if (res.data === true) return 'ok';
  if (res.data === false) return 'exceeded';
  return 'unavailable';
}

/** Service-role client whose every request has a hard timeout (rule 7). */
export function timedAdminClient(url: string, serviceKey: string, timeoutMs = 5_000): AdminLike {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
      },
    },
  }) as AdminLike;
}

/** 0037 consume_service_usage: global per-service, per-UTC-day cap. Fails closed. */
export async function consumeServiceUsage(
  admin: AdminLike,
  service: string,
  units: number,
  cap: number,
): Promise<UsageOutcome> {
  try {
    const res = await admin.rpc('consume_service_usage', { p_service: service, p_units: units, p_cap: cap });
    return toOutcome(res);
  } catch {
    return 'unavailable';
  }
}

/** 0037 consume_poi_quota: per-user poi-recommend cap over ai_usage.poi_requests. Fails closed. */
export async function consumePoiQuota(
  admin: AdminLike,
  userId: string,
  units: number,
  cap: number,
): Promise<UsageOutcome> {
  try {
    const res = await admin.rpc('consume_poi_quota', { p_user: userId, p_units: units, p_cap: cap });
    return toOutcome(res);
  } catch {
    return 'unavailable';
  }
}

/**
 * A per-user counter name for service_usage that does not reveal the user:
 * `<prefix>_<first 32 hex of HMAC-SHA256(secret, userId)>`. service_usage is
 * readable by every signed-in user (0037), so a raw user id there would leak
 * who did what; the HMAC keeps the counter per-user but unlinkable.
 * Fits 0037's `^[a-z][a-z0-9_]{0,39}$` when the prefix is <= 7 chars.
 */
export async function pseudonymousUsageKey(prefix: string, userId: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(userId)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex.slice(0, 32)}`;
}

/**
 * app_config reader with a per-isolate cache (same 60 s rhythm as
 * _shared/routing.ts). Never throws; null = no row / unreadable. Failures
 * are cached too, so a flapping DB can't add latency to every request.
 */
export function makeConfigReader(
  admin: AdminLike,
  ttlMs = 60_000,
  now: () => number = Date.now,
): (key: string) => Promise<string | null> {
  const cache = new Map<string, { value: string | null; at: number }>();
  return async (key: string) => {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    let value: string | null = null;
    try {
      const { data, error } = await admin.from('app_config').select('value').eq('key', key).maybeSingle();
      if (!error && data && typeof (data as { value?: unknown }).value === 'string') {
        value = (data as { value: string }).value;
      }
    } catch {
      // swallow: absent config = defaults
    }
    cache.set(key, { value, at: now() });
    return value;
  };
}
