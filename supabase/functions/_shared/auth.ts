// _shared/auth.ts — caller authentication + per-user daily quota for the
// Google/ORS-metered Edge Functions.
//
// Security audit 2026-09-29:
//   #2 places-autocomplete / place-details / distance-matrix /
//      directions-polyline relied on gateway `verify_jwt`, and the PUBLIC
//      anon key passes that check (it is a validly signed JWT with
//      role=anon and no `sub`). Anyone holding the app bundle could drive
//      billed Google calls: up to 25x25 = 625 matrix elements per request.
//      `requireUser` closes that. It resolves the bearer token to a real
//      auth.users row via GoTrue (`auth.getUser(token)`), so anon and
//      service-role keys get a 401.
//   #2 (cont.) `consumeQuota` adds a per-user, per-UTC-day ceiling on top,
//      backed by the atomic `consume_usage_quota` RPC (migration 0032) over
//      the existing `ai_usage` ledger (0020 §c).
//
// Error envelope: the shared `{ error: { code, message } }` shape.
//   not_authenticated 401 · auth_unavailable 503 · server_misconfigured 500 ·
//   quota_exceeded 429 (+ Retry-After: seconds until 00:00 UTC) ·
//   quota_unavailable 503 (quota RPC failed; the guard fails CLOSED)

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { errorResponse, jsonResponse } from './errors.ts';
import { log } from './logger.ts';

// ============================================================================
// requireUser
// ============================================================================

/** GoTrue round-trip budget. The call is cheap; a hung auth server must not hold the function. */
const AUTH_TIMEOUT_MS = 5_000;

export function extractBearer(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token ? token : null;
}

export interface AuthedUser {
  /** auth.users.id, taken from GoTrue's answer and never from the request body. */
  id: string;
  /**
   * The caller's original `Authorization` header value. Forward it
   * verbatim when one Edge Function calls another on the user's behalf
   * (optimize-trip → distance-matrix / directions-polyline). The downstream
   * function then authenticates, and meters, the same user.
   */
  authHeader: string;
}

export type RequireUserResult =
  | { ok: true; user: AuthedUser }
  | { ok: false; response: Response };

export type TokenCheck =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 500 | 503; code: string; message: string };

export type TokenVerifier = (token: string) => Promise<TokenCheck>;

/**
 * Decode (NOT verify) a JWT payload. Used only to REJECT early. A token
 * without a `sub` claim (the anon key, the service-role key) can never map
 * to a user, so it gets a 401 without a GoTrue round-trip. That keeps the
 * anon-key abuse path cheap for us. Acceptance always comes from GoTrue.
 */
function jwtHasSubject(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return true; // not a JWT we can pre-screen; let GoTrue decide
  try {
    const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const payload = JSON.parse(json) as { sub?: unknown };
    return typeof payload.sub === 'string' && payload.sub.length > 0;
  } catch {
    return true; // malformed. GoTrue will reject it with a proper answer
  }
}

let authClient: { key: string; client: SupabaseClient } | null = null;

function getAuthClient(url: string, anon: string): SupabaseClient {
  const key = `${url}|${anon}`;
  if (authClient?.key === key) return authClient.client;
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      // Rule 7: every outbound fetch has a timeout, including supabase-js's.
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
        return fetch(input, { ...init, signal: controller.signal }).finally(() =>
          clearTimeout(timer),
        );
      },
    },
  });
  authClient = { key, client };
  return client;
}

const defaultVerifier: TokenVerifier = async (token) => {
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) {
    return {
      ok: false,
      status: 500,
      code: 'server_misconfigured',
      message: 'Supabase env vars missing',
    };
  }
  try {
    const { data, error } = await getAuthClient(url, anon).auth.getUser(token);
    if (!error && data?.user?.id) return { ok: true, userId: data.user.id };
    // AuthRetryableFetchError = network failure (status 0) or a 5xx from
    // GoTrue. That is our outage, not a bad token: answer 503 so clients
    // retry instead of treating the session as dead.
    const status = (error as { status?: unknown } | null)?.status;
    const name = (error as { name?: unknown } | null)?.name;
    if (
      name === 'AuthRetryableFetchError' ||
      (typeof status === 'number' && (status === 0 || status >= 500))
    ) {
      return {
        ok: false,
        status: 503,
        code: 'auth_unavailable',
        message: 'Authentication service unavailable',
      };
    }
    return { ok: false, status: 401, code: 'not_authenticated', message: 'Invalid or expired token' };
  } catch {
    return {
      ok: false,
      status: 503,
      code: 'auth_unavailable',
      message: 'Authentication service unavailable',
    };
  }
};

let verifier: TokenVerifier = defaultVerifier;

/**
 * Resolve the caller to a real user or produce the error Response to return.
 *
 *   const auth = await requireUser(req, { fn: FN, requestId, origin });
 *   if (!auth.ok) return auth.response;
 *   const userId = auth.user.id;
 *
 * Call it AFTER `?ping` / preflight / method checks, which stay public for
 * health monitoring, and BEFORE parsing the body or spending anything.
 */
export async function requireUser(
  req: Request,
  ctx: { fn: string; requestId: string; origin: string | null },
): Promise<RequireUserResult> {
  const token = extractBearer(req);
  if (!token) {
    return {
      ok: false,
      response: errorResponse('not_authenticated', 'Missing bearer token', 401, ctx.origin),
    };
  }
  if (!jwtHasSubject(token)) {
    log({ requestId: ctx.requestId, fn: ctx.fn, level: 'warn', stage: 'auth', err: 'token_without_sub' });
    return {
      ok: false,
      response: errorResponse(
        'not_authenticated',
        'A signed-in user session is required',
        401,
        ctx.origin,
      ),
    };
  }
  const check = await verifier(token);
  if (!check.ok) {
    log({ requestId: ctx.requestId, fn: ctx.fn, level: 'warn', stage: 'auth', err: check.code });
    return { ok: false, response: errorResponse(check.code, check.message, check.status, ctx.origin) };
  }
  return {
    ok: true,
    user: { id: check.userId, authHeader: req.headers.get('Authorization') ?? `Bearer ${token}` },
  };
}

// ============================================================================
// Per-user daily quota (migration 0032 · consume_usage_quota)
// ============================================================================

/**
 * Daily per-user ceilings (UTC day buckets, same as the AI quota). They sit
 * well inside Google's monthly free tier for a small friends-and-family user
 * base. Their job is to stop ONE account (compromised or scripted) from
 * draining the shared $200 credit. They are not a billing system. The hard
 * backstop is the per-API quota cap in the GCP console (see the deploy notes).
 *
 *   places_autocomplete  300 requests. About 60 place searches of 5
 *                        keystrokes each. Session-token autocompletes that
 *                        end in a details call are billed per session, so
 *                        this is generous.
 *   place_details        150 calls. Covers a cold start of the trips list
 *                        (one lean `photos` call per card), a 25-place trip
 *                        (one per row), plus detail screens, with room to
 *                        spare. Rows degrade to the placeholder cover when
 *                        the cap is hit.
 *   routing_elements     2000 billable elements. distance-matrix counts
 *                        origins × destinations (a max-size 25-place optimize
 *                        is 625). directions-polyline counts 1 per route, or
 *                        2 when > 10 intermediates (Google's Pro SKU prices
 *                        that at about 2x). ORS-served calls count too: ORS
 *                        has its own free-tier ceiling.
 *   photo_sign           300 photo names via `POST place-photo`. That is the
 *                        fallback signer for photos whose place-details
 *                        signature is missing or expired. Each signed URL
 *                        unlocks at most one billed Google photo fetch per
 *                        cache miss.
 *
 * Tuning is a function redeploy, not a migration. The DB takes the cap as
 * a parameter.
 */
export const DAILY_QUOTA = {
  places_autocomplete: 300,
  place_details: 150,
  routing_elements: 2000,
  photo_sign: 300,
} as const;

export type QuotaKind = keyof typeof DAILY_QUOTA;

const QUOTA_LABEL: Record<QuotaKind, string> = {
  places_autocomplete: 'place search',
  place_details: 'place details',
  routing_elements: 'route calculation',
  photo_sign: 'place photo',
};

export type QuotaRpc = (args: {
  p_user: string;
  p_kind: QuotaKind;
  p_units: number;
  p_cap: number;
}) => Promise<{ data: unknown; error: { message: string } | null }>;

let adminForQuota: SupabaseClient | null = null;

/**
 * Service-role justification: `consume_usage_quota` is EXECUTE-granted to
 * service_role ONLY (migration 0032). If `authenticated` could call it, any
 * user could burn another user's daily budget, or pre-probe their own with
 * p_cap games. The user id passed is always the GoTrue-verified caller from
 * `requireUser`, never request input.
 */
const defaultQuotaRpc: QuotaRpc = async (args) => {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return { data: null, error: { message: 'service env missing' } };
  if (!adminForQuota) {
    adminForQuota = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
          return fetch(input, { ...init, signal: controller.signal }).finally(() =>
            clearTimeout(timer),
          );
        },
      },
    });
  }
  try {
    const { data, error } = await adminForQuota.rpc('consume_usage_quota', args);
    return { data, error: error ? { message: error.message } : null };
  } catch (err) {
    return { data: null, error: { message: String(err) } };
  }
};

let quotaRpc: QuotaRpc = defaultQuotaRpc;

export type QuotaOutcome = 'ok' | 'exceeded' | 'unavailable';

/**
 * Atomically add `units` to today's counter for `kind` if the total stays
 * within DAILY_QUOTA[kind]. Returns 'exceeded' when it would not. Nothing
 * is consumed in that case, so a 429 retry storm cannot wind the counter up.
 * Call it BEFORE the upstream spend.
 *
 * FAILS CLOSED: an RPC error or timeout returns 'unavailable' (-> 503
 * quota_unavailable, which is transient and retryable), never 'ok'. Failing
 * open would let a caller who can slow the DB past the 5s RPC timeout
 * bypass the cap, exactly when it matters. It also matches 0033's invite
 * quota. Deploy order: migration 0032 BEFORE these functions.
 */
export async function consumeQuota(args: {
  userId: string;
  kind: QuotaKind;
  units: number;
  requestId: string;
  fn: string;
}): Promise<QuotaOutcome> {
  const cap = DAILY_QUOTA[args.kind];
  const units = Math.max(1, Math.ceil(args.units));
  if (units > cap) return 'exceeded';
  const { data, error } = await quotaRpc({
    p_user: args.userId,
    p_kind: args.kind,
    p_units: units,
    p_cap: cap,
  });
  if (error) {
    log({
      requestId: args.requestId,
      fn: args.fn,
      level: 'error',
      stage: 'quota',
      kind: args.kind,
      err: error.message,
      fail_closed: true,
    });
    return 'unavailable';
  }
  if (data === false) {
    log({
      requestId: args.requestId,
      fn: args.fn,
      level: 'info',
      stage: 'quota',
      kind: args.kind,
      units,
      cap,
      outcome: 'exceeded',
    });
    return 'exceeded';
  }
  if (data !== true) {
    // Unexpected payload. Fail closed, same as an error.
    log({
      requestId: args.requestId,
      fn: args.fn,
      level: 'error',
      stage: 'quota',
      kind: args.kind,
      err: 'unexpected_rpc_result',
      fail_closed: true,
    });
    return 'unavailable';
  }
  return 'ok';
}

/**
 * Response for a non-'ok' consumeQuota outcome:
 *   exceeded    -> 429 quota_exceeded (+ Retry-After to 00:00 UTC)
 *   unavailable -> 503 quota_unavailable (transient; clients may retry)
 */
export function quotaDeniedResponse(
  outcome: Exclude<QuotaOutcome, 'ok'>,
  kind: QuotaKind,
  origin: string | null,
): Response {
  if (outcome === 'exceeded') return quotaExceededResponse(kind, origin);
  return jsonResponse(
    {
      error: {
        code: 'quota_unavailable',
        message: 'Usage check is temporarily unavailable. Please retry shortly.',
      },
    },
    { status: 503, origin, headers: { 'Retry-After': '5' } },
  );
}

/** Seconds until the next 00:00 UTC, when the quota day rolls over. Never below 1. */
export function secondsUntilUtcMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - nowMs) / 1000));
}

/** The 429 every metered function returns. Same envelope as ai-itinerary's quota_exceeded. */
export function quotaExceededResponse(
  kind: QuotaKind,
  origin: string | null,
  nowMs: number = Date.now(),
): Response {
  const limit = DAILY_QUOTA[kind];
  return jsonResponse(
    {
      error: {
        code: 'quota_exceeded',
        message: `Daily ${QUOTA_LABEL[kind]} limit reached (${limit}/day). It resets at 00:00 UTC.`,
        kind,
        limit,
      },
    },
    { status: 429, origin, headers: { 'Retry-After': String(secondsUntilUtcMidnight(nowMs)) } },
  );
}

// ============================================================================
// Shared request helper
// ============================================================================

/**
 * Human-readable Zod failure without importing zod here: duck-typed on
 * `.issues`, so it also works where zod resolves to `any` (for example the
 * repo-level tsc).
 */
export function describeInvalidInput(err: unknown): string {
  const issues = (err as { issues?: unknown } | null)?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    return issues
      .map((i) => {
        const m = (i as { message?: unknown } | null)?.message;
        return typeof m === 'string' ? m : 'Invalid value';
      })
      .join('; ');
  }
  return 'Invalid JSON';
}

// ============================================================================
// Test hooks
// ============================================================================

/** Test-only: replace the GoTrue verifier (null restores the real one). */
export function _setTokenVerifierForTests(fn: TokenVerifier | null): void {
  verifier = fn ?? defaultVerifier;
}

/** Test-only: replace the consume_usage_quota RPC (null restores the real one). */
export function _setQuotaRpcForTests(fn: QuotaRpc | null): void {
  quotaRpc = fn ?? defaultQuotaRpc;
}
