// _shared/routing.ts — routing-provider plumbing shared by the two routing
// Edge Functions (distance-matrix, directions-polyline).
//
// v2 Phase N5 (D2 RESOLVED): openrouteservice (ORS) free API becomes the
// switchable PRIMARY routing backend; Google stays the hard default AND the
// automatic fallback on ANY ORS failure. The functions' response contracts
// are byte-compatible regardless of provider — clients cannot tell (and must
// never need to know) which backend served them.
//
// What lives here: everything the two functions SHARE — provider resolution,
// the ORS profile map / base URL / timeout, the ORS error type, a tiny
// per-isolate circuit breaker, and `tryOrs` (the attempt-with-fallback-logging
// wrapper). What deliberately does NOT live here: the actual ORS
// request/response mapping per endpoint — that is contract, and contract
// stays in the owning function (same split as _shared/ai.ts).
//
// Provider resolution order (resolveRoutingProvider):
//   1. `app_config` row key='routing_provider' — cheap PostgREST SELECT with a
//      1s timeout, ALL errors swallowed, result cached in-module for 60s.
//      This is the redeploy-free kill-switch (migration 0022): flip the row in
//      the dashboard and every isolate follows within ~60s.
//   2. `ROUTING_PROVIDER` Edge Function secret — the deploy-time default.
//   3. 'google' — the hard default. IMPORTANT: with no row and no env set,
//      behavior is EXACTLY the pre-N5 Google path; nothing changes until an
//      operator explicitly flips a switch.
//   Unknown values at any layer (e.g. a future 'osrm') are treated as ABSENT
//   and the chain keeps falling through — fail-safe is always Google.
//
// Why no SupabaseClient parameter: these two functions are the hottest
// optimizer paths and today import zero supabase-js. The probe needs exactly
// one anon-readable row, so a raw PostgREST GET (with AbortController for a
// precise 1s budget) keeps cold starts lean and the dependency graph flat.

import { log } from './logger.ts';

// ----- Types / constants ------------------------------------------------------

export type RoutingProvider = 'google' | 'ors';
export type ProviderSource = 'app_config' | 'env' | 'default';

export interface ResolvedProvider {
  provider: RoutingProvider;
  source: ProviderSource;
}

/** Modes ORS can serve. Transit has NO ORS profile — always Google. */
export type OrsRoutableMode = 'driving' | 'walking' | 'bicycling';

export const ORS_BASE_URL = 'https://api.openrouteservice.org';

/** ORS profile names per transport mode (https://openrouteservice.org/dev). */
export const ORS_PROFILE: Record<OrsRoutableMode, string> = {
  driving: 'driving-car',
  walking: 'foot-walking',
  bicycling: 'cycling-regular',
};

/** Same outer budget as the Google Routes calls in both functions. */
export const ORS_TIMEOUT_MS = 10_000;

/**
 * Thrown by the per-function ORS callers so `tryOrs` can log a precise
 * fallback reason ('ors_http_429', 'ors_bad_response', ...).
 */
export class OrsError extends Error {
  readonly reason: string;
  readonly detail: string | undefined;
  constructor(reason: string, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'OrsError';
    this.reason = reason;
    this.detail = detail;
  }
}

// ----- app_config probe (cached) ----------------------------------------------

// Captured at module-load time ON PURPOSE: the Deno test suites for both
// functions swap `globalThis.fetch` to fake the Google/ORS upstream and assert
// on the calls they capture — the config probe is infra plumbing, not part of
// the functions' outbound contract, and must stay invisible to those mocks.
// (Belt-and-braces: in `deno test` runs SUPABASE_URL is unset anyway, so the
// probe is skipped entirely.) Tests for THIS module inject via _setConfigFetch.
let configFetch: typeof fetch | undefined = globalThis.fetch?.bind(globalThis);

const CONFIG_PROBE_TIMEOUT_MS = 1_000;
const CONFIG_CACHE_TTL_MS = 60_000;

let configCache: { value: RoutingProvider | null; at: number } | null = null;

function isProvider(v: unknown): v is RoutingProvider {
  return v === 'google' || v === 'ors';
}

/**
 * Read app_config.routing_provider. Never throws; null = no row / unknown
 * value / table missing (migration 0022 not applied) / DB unreachable —
 * callers fall through to env, then 'google'. Cached 60s per isolate, so the
 * hot path pays one ~30ms PostgREST GET per minute at most (worst case 1s on
 * a hung probe). Failure is cached too: a flapping DB cannot add 1s to every
 * routing call.
 */
async function readAppConfigProvider(): Promise<RoutingProvider | null> {
  const now = Date.now();
  if (configCache && now - configCache.at < CONFIG_CACHE_TTL_MS) {
    return configCache.value;
  }

  let value: RoutingProvider | null = null;
  const url = Deno.env.get('SUPABASE_URL');
  // anon is enough — migration 0022 grants SELECT to anon (least privilege);
  // service role is only a fallback for unusual local setups.
  const key = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (url && key && configFetch) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG_PROBE_TIMEOUT_MS);
    try {
      const res = await configFetch(
        `${url}/rest/v1/app_config?select=value&key=eq.routing_provider`,
        {
          headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
          signal: controller.signal,
        },
      );
      if (res.ok) {
        const rows = (await res.json()) as Array<{ value?: unknown }>;
        const v = Array.isArray(rows) ? rows[0]?.value : undefined;
        if (isProvider(v)) value = v;
      } else {
        // Drain so the connection can be reused; result stays null.
        await res.text().catch(() => '');
      }
    } catch {
      // Swallow by design — an absent/unreachable config must never break or
      // slow routing beyond the 1s probe budget.
    } finally {
      clearTimeout(timer);
    }
  }

  configCache = { value, at: now };
  return value;
}

/** See resolution order in the file header. Never throws. */
export async function resolveRoutingProvider(): Promise<ResolvedProvider> {
  const fromDb = await readAppConfigProvider();
  if (fromDb) return { provider: fromDb, source: 'app_config' };

  const fromEnv = Deno.env.get('ROUTING_PROVIDER');
  if (isProvider(fromEnv)) return { provider: fromEnv, source: 'env' };

  return { provider: 'google', source: 'default' };
}

// ----- Circuit breaker ---------------------------------------------------------

// Module-level (per-isolate) on purpose: Supabase Edge isolates are per-
// function and short-lived; a distributed breaker would be overkill. Worst
// case after an isolate recycle: 3 extra failed ORS attempts, each capped at
// ORS_TIMEOUT_MS and each auto-falling back to Google.

const ORS_BREAKER_THRESHOLD = 3; // consecutive failures to open
const ORS_BREAKER_COOLDOWN_MS = 5 * 60_000; // skip ORS for 5 minutes

let orsConsecutiveFailures = 0;
let orsOpenUntil = 0;

export function orsBreakerOpen(): boolean {
  return Date.now() < orsOpenUntil;
}

export function recordOrsFailure(): void {
  orsConsecutiveFailures += 1;
  if (orsConsecutiveFailures >= ORS_BREAKER_THRESHOLD) {
    orsOpenUntil = Date.now() + ORS_BREAKER_COOLDOWN_MS;
    orsConsecutiveFailures = 0; // fresh count when the cooldown expires
  }
}

export function recordOrsSuccess(): void {
  orsConsecutiveFailures = 0;
}

// ----- tryOrs — attempt ORS, log + arm fallback on any failure ------------------

/**
 * Runs an ORS call with the full failure envelope: breaker check, key check,
 * success/failure recording, and the `{ provider_fallback: 'google', reason }`
 * log line. Returns null on ANY failure — the caller then proceeds down its
 * existing (pre-N5, untouched) Google path. Never throws.
 *
 * Failure reasons: 'breaker_open' | 'missing_ors_key' | 'ors_timeout' |
 * 'ors_http_<status>' | 'ors_bad_response' | 'ors_error'. Only real call
 * attempts feed the breaker (a missing key short-circuits without counting).
 */
export async function tryOrs<T>(opts: {
  requestId: string;
  fn: string;
  call: (orsKey: string) => Promise<T>;
}): Promise<T | null> {
  if (orsBreakerOpen()) {
    log({
      requestId: opts.requestId,
      fn: opts.fn,
      level: 'warn',
      provider_fallback: 'google',
      reason: 'breaker_open',
    });
    return null;
  }

  const orsKey = Deno.env.get('ORS_API_KEY');
  if (!orsKey) {
    log({
      requestId: opts.requestId,
      fn: opts.fn,
      level: 'warn',
      provider_fallback: 'google',
      reason: 'missing_ors_key',
    });
    return null;
  }

  const start = Date.now();
  try {
    const out = await opts.call(orsKey);
    recordOrsSuccess();
    return out;
  } catch (err) {
    recordOrsFailure();
    const reason =
      err instanceof OrsError
        ? err.reason
        : err instanceof DOMException && err.name === 'AbortError'
          ? 'ors_timeout'
          : 'ors_error';
    log({
      requestId: opts.requestId,
      fn: opts.fn,
      level: 'warn',
      provider_fallback: 'google',
      reason,
      detail: err instanceof OrsError ? err.detail : String(err).slice(0, 300),
      orsMs: Date.now() - start,
    });
    return null;
  }
}

// ----- Test hooks ----------------------------------------------------------------

/** Test-only: reset cache + breaker state between Deno test cases. */
export function _resetRoutingStateForTests(): void {
  configCache = null;
  orsConsecutiveFailures = 0;
  orsOpenUntil = 0;
}

/** Test-only: inject a fetch for the app_config probe (captured at load otherwise). */
export function _setConfigFetchForTests(f: typeof fetch | undefined): void {
  configFetch = f ?? globalThis.fetch?.bind(globalThis);
}
