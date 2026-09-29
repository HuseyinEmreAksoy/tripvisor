// memories-sweep — remove ORPHANED objects from the private `trip-memories`
// Storage bucket (M5 Y2.1; the 0038 §2d follow-up). Sweep logic: ./sweep.ts.
//
// Contract (contractVersion 1):
//   POST (internal callers only — see "Who may call")
//     body (optional JSON): { minAgeMinutes?: int >= 60 (default 60),
//                             batchSize?: 1..1000 (default 1000),
//                             maxBatches?: 1..20 (default 5),
//                             dryRun?: boolean (default false) }
//     -> { ok: true, dryRun, batches, candidates, removed, bytes, more,
//          errors: string[], meta: { contractVersion: 1, duration_ms } }
//   GET ?ping -> { ok: true, fn: 'memories-sweep' }   (public, health only)
//   Errors ({ error: { code, message } }): invalid_input 400 ·
//     not_authorized 401 · method_not_allowed 405 · server_misconfigured 500 ·
//     sweep_failed 502 (the candidates RPC or Storage failed; partial counts
//     are in the body of a 200 when some batches succeeded).
//
// Who may call (verify_jwt stays at its default TRUE — the gateway demands a
// validly signed JWT first — AND this handler checks explicitly, because a
// valid JWT alone includes every signed-in user and the public anon key):
//   1. `x-sweep-secret: <MEMORIES_SWEEP_SECRET>` — the pg_cron job (0039).
//      The secret is a function secret (`supabase secrets set
//      MEMORIES_SWEEP_SECRET=...`, >= 32 chars) mirrored in Supabase Vault as
//      `memories_sweep_secret`; the cron request carries the anon JWT in
//      `Authorization` only to pass the gateway. Least privilege: this secret
//      can trigger the sweep and nothing else.
//   2. `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` — operators / a
//      manual run. Compared byte-for-byte with the function's own env key.
//   Both comparisons are constant-time. Anything else → 401.
//
// Service-role justification: the candidates RPC is EXECUTE-granted to
// service_role only (0038) and orphans have no owning row, so no user's RLS
// could reach them. The function takes no trip/user input at all (no IDOR
// surface): it only deletes objects the database itself reports as
// ownerless and older than the age floor.
//
// Rule 7: every outbound request (RPC, Storage) goes through a 10 s
// AbortController timeout; no retries — the job is idempotent and runs
// hourly, so the next run picks up whatever this one missed.

// @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { handlePreflight } from '../_shared/cors.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { log, newRequestId } from '../_shared/logger.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { clampOptions, runSweep, type SweepDeps } from './sweep.ts';

const FN = 'memories-sweep';
export const CONTRACT_VERSION = 1;
/** Minimum length of MEMORIES_SWEEP_SECRET for the header path to be enabled at all. */
export const MIN_SECRET_LENGTH = 32;

// @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
const env = (k: string): string | undefined => Deno.env.get(k);

const bodySchema = z
  .object({
    minAgeMinutes: z.number().int().min(60).max(60 * 24 * 30).optional(),
    batchSize: z.number().int().min(1).max(1000).optional(),
    maxBatches: z.number().int().min(1).max(20).optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();

/** Constant-time string equality (length leak only). */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export type CallerKind = 'cron_secret' | 'service_role';

/** Who is calling? null = not allowed. Pure (env passed in) for the tests. */
export function authorizeCaller(
  req: Request,
  cfg: { serviceKey: string | undefined; sweepSecret: string | undefined },
): CallerKind | null {
  const secretHeader = req.headers.get('x-sweep-secret');
  if (secretHeader && cfg.sweepSecret && cfg.sweepSecret.length >= MIN_SECRET_LENGTH) {
    if (safeEqual(secretHeader, cfg.sweepSecret)) return 'cron_secret';
  }
  const auth = req.headers.get('Authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1]?.trim();
  if (token && cfg.serviceKey && safeEqual(token, cfg.serviceKey)) return 'service_role';
  return null;
}

// ---------------------------------------------------------------------------
// Real deps (service-role supabase-js with timeouts)
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 10_000;

async function supabaseDeps(): Promise<SweepDeps> {
  // @ts-ignore -- Deno URL import
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.45.0');
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Supabase admin env vars missing');
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
      },
    },
  });
  return {
    async candidates(minAge, limit) {
      try {
        const { data, error } = await admin.rpc('trip_memories_sweep_candidates', { p_min_age: minAge, p_limit: limit });
        return { data: (data ?? null) as never, error: error ? String(error.message) : null };
      } catch (e) {
        return { data: null, error: String(e) };
      }
    },
    async remove(names) {
      try {
        const { data, error } = await admin.storage.from('trip-memories').remove(names);
        if (error) return { removed: [], error: String(error.message) };
        const removed = ((data ?? []) as Array<{ name?: string }>).map((o) => String(o.name ?? '')).filter(Boolean);
        return { removed, error: null };
      } catch (e) {
        return { removed: [], error: String(e) };
      }
    },
  };
}

let depsOverride: SweepDeps | null = null;
/** Test hook: inject fake deps (null restores the real ones). */
export function _setSweepDepsForTests(deps: SweepDeps | null): void {
  depsOverride = deps;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(req: Request): Promise<Response> {
  const started = Date.now();
  const requestId = newRequestId();
  const origin = req.headers.get('origin');
  const url = new URL(req.url);

  if (req.method === 'GET' && url.searchParams.has('ping')) {
    return jsonResponse({ ok: true, fn: FN }, { origin });
  }
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') {
    return errorResponse('method_not_allowed', 'Use POST', 405, origin);
  }

  const caller = authorizeCaller(req, {
    serviceKey: env('SUPABASE_SERVICE_ROLE_KEY'),
    sweepSecret: env('MEMORIES_SWEEP_SECRET'),
  });
  if (!caller) {
    log({ requestId, fn: FN, level: 'warn', stage: 'auth', err: 'not_authorized' });
    return errorResponse('not_authorized', 'Internal endpoint', 401, origin);
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    const text = await req.text();
    parsed = bodySchema.parse(text.trim() ? JSON.parse(text) : {});
  } catch (e) {
    const issues = (e as { issues?: Array<{ message?: string }> })?.issues;
    const message = Array.isArray(issues) ? issues.map((i) => i.message ?? 'Invalid value').join('; ') : 'Invalid JSON';
    return errorResponse('invalid_input', message, 400, origin);
  }

  let deps: SweepDeps;
  try {
    deps = depsOverride ?? (await supabaseDeps());
  } catch (e) {
    log({ requestId, fn: FN, level: 'error', stage: 'deps', err: String(e) });
    return errorResponse('server_misconfigured', 'Supabase env missing', 500, origin);
  }

  const opts = clampOptions(parsed);
  const report = await runSweep(deps, opts);
  const duration_ms = Date.now() - started;
  log({
    requestId,
    fn: FN,
    level: report.errors.length > 0 ? 'error' : 'info',
    caller,
    dryRun: opts.dryRun,
    batches: report.batches,
    candidates: report.candidates,
    removed: report.removed,
    bytes: report.bytes,
    more: report.more,
    errors: report.errors,
    duration_ms,
  });

  if (report.errors.length > 0 && report.batches <= 1 && report.removed === 0) {
    return jsonResponse(
      { error: { code: 'sweep_failed', message: report.errors[0] }, meta: { contractVersion: CONTRACT_VERSION, duration_ms } },
      { status: 502, origin },
    );
  }
  return jsonResponse(
    {
      ok: true,
      dryRun: opts.dryRun,
      batches: report.batches,
      candidates: report.candidates,
      removed: report.removed,
      bytes: report.bytes,
      more: report.more,
      errors: report.errors,
      meta: { contractVersion: CONTRACT_VERSION, duration_ms },
    },
    { origin },
  );
}
