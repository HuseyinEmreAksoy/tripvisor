// _shared/ai.ts — shared AI plumbing for the ai-* Edge Functions
// (ai-itinerary since N3; ai-edit since N4 — BUILD-LOG N4.1–N4.3).
//
// Extracted from ai-itinerary/index.ts verbatim where possible, with two
// generalizations so both functions stay thin:
//   1. The LLM provider callers (Gemini 2.5 Flash structured responseSchema
//      -> Groq strict json_schema fallback) are parameterized over an
//      `LlmTask<T>` — system preamble, user payload, both provider schemas,
//      and a parse function — so each caller keeps its own output contract
//      while sharing transport, timeouts, fallback order, and logging.
//   2. The grounding loop accepts a `GroundBias` that supports BOTH text
//      bias (destination appended to the autocomplete input — what
//      ai-itinerary has always done) and coordinate bias (a 50km
//      locationBias circle, used by ai-edit when the trip already has
//      placed coordinates).
//
// What deliberately does NOT live here: zod body schemas, LLM output
// schemas, response shapes, quota semantics per action — those are contract,
// and contract stays in the owning function (one bounded capability each).
//
// Google ToS / D4 posture (enforced by construction):
//   - Grounding requests ONLY `id,location,displayName` via field mask, so
//     nothing ToS-restricted (ratings/reviews/photos/hours) can ever enter a
//     caller's persisted draft.
//   - These helpers never compose LLM payloads — callers own that, and
//     callers must send user-authored content only.

import { fetchWithTimeout } from './fetch-with-timeout.ts';
import { log } from './logger.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// ----- Tunables (shared across ai-* functions) -------------------------------

export const LLM_TIMEOUT_MS = 20_000;
export const GROUNDING_TIMEOUT_MS = 8_000;
/** Grounding politeness: batches of 5 names, at most 2 batches in flight. */
export const GROUNDING_BATCH_SIZE = 5;
export const GROUNDING_BATCH_CONCURRENCY = 2;

export const GEMINI_MODEL = 'gemini-2.5-flash';
export const GROQ_MODEL = 'openai/gpt-oss-20b';

/**
 * Daily AI-run quota per user (risk C4), shared by ai-itinerary plans and
 * ai-edit edit/suggest actions — they all increment the same
 * `ai_usage.ai_runs` counter. Lives in code, not the DB (migration 0020 §d /
 * 0021): tuning it is a function redeploy, not a migration.
 */
export const DAILY_RUN_LIMIT = 10;

// ----- Small helpers ---------------------------------------------------------

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, '0');
  return out;
}

/** UTC calendar day — matches Postgres current_date on Supabase (UTC). */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function extractBearer(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? (match[1] ?? null) : null;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ----- LLM providers ---------------------------------------------------------

export interface LlmAttempt<T> {
  output: T;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

/**
 * One structured-output LLM task. `parse` must return null on ANY failure
 * (unparseable JSON, schema mismatch, semantically-empty output) — null is
 * the signal that triggers provider fallback.
 */
export interface LlmTask<T> {
  /** Static instructions only — user data goes exclusively into `user`. */
  system: string;
  /** The user message. Callers must include user-authored content only (D4). */
  user: string;
  /** Gemini generationConfig.responseSchema (OpenAPI subset, UPPERCASE types). */
  geminiResponseSchema: unknown;
  /** Groq response_format.json_schema payload (strict json_schema). */
  groqJsonSchema: unknown;
  parse: (text: string) => T | null;
}

export async function callGemini<T>(
  apiKey: string,
  task: LlmTask<T>,
  requestId: string,
  fn: string,
): Promise<LlmAttempt<T> | null> {
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: task.system }] },
          contents: [{ role: 'user', parts: [{ text: task.user }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: task.geminiResponseSchema,
          },
        }),
      },
      LLM_TIMEOUT_MS,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      log({
        requestId,
        fn,
        level: 'warn',
        stage: 'llm_gemini',
        status: res.status,
        body: text.slice(0, 300),
        durationMs: Date.now() - start,
      });
      return null;
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    const output = task.parse(text);
    if (!output) {
      log({
        requestId,
        fn,
        level: 'warn',
        stage: 'llm_gemini',
        err: 'unparseable_or_invalid_json',
        durationMs: Date.now() - start,
      });
      return null;
    }
    return {
      output,
      model: GEMINI_MODEL,
      tokensIn: json.usageMetadata?.promptTokenCount ?? null,
      tokensOut: json.usageMetadata?.candidatesTokenCount ?? null,
    };
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    log({
      requestId,
      fn,
      level: 'warn',
      stage: 'llm_gemini',
      err: isAbort ? 'timeout' : String(err),
      durationMs: Date.now() - start,
    });
    return null;
  }
}

export async function callGroq<T>(
  apiKey: string,
  task: LlmTask<T>,
  requestId: string,
  fn: string,
): Promise<LlmAttempt<T> | null> {
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: 'system', content: task.system },
            { role: 'user', content: task.user },
          ],
          response_format: { type: 'json_schema', json_schema: task.groqJsonSchema },
        }),
      },
      LLM_TIMEOUT_MS,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      log({
        requestId,
        fn,
        level: 'warn',
        stage: 'llm_groq',
        status: res.status,
        body: text.slice(0, 300),
        durationMs: Date.now() - start,
      });
      return null;
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const output = task.parse(json.choices?.[0]?.message?.content ?? '');
    if (!output) {
      log({
        requestId,
        fn,
        level: 'warn',
        stage: 'llm_groq',
        err: 'unparseable_or_invalid_json',
        durationMs: Date.now() - start,
      });
      return null;
    }
    return {
      output,
      model: GROQ_MODEL,
      tokensIn: json.usage?.prompt_tokens ?? null,
      tokensOut: json.usage?.completion_tokens ?? null,
    };
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    log({
      requestId,
      fn,
      level: 'warn',
      stage: 'llm_groq',
      err: isAbort ? 'timeout' : String(err),
      durationMs: Date.now() - start,
    });
    return null;
  }
}

/**
 * Gemini first, Groq on 4xx/5xx/timeout/garbage. Returns null when every
 * configured provider failed. The caller maps that to `llm_failed`. The run
 * reserved before this call stays counted, because spend was dispatched.
 */
export async function runLlmWithFallback<T>(
  keys: { geminiKey: string | undefined; groqKey: string | undefined },
  task: LlmTask<T>,
  requestId: string,
  fn: string,
): Promise<LlmAttempt<T> | null> {
  let attempt: LlmAttempt<T> | null = null;
  if (keys.geminiKey) attempt = await callGemini(keys.geminiKey, task, requestId, fn);
  if (!attempt && keys.groqKey) attempt = await callGroq(keys.groqKey, task, requestId, fn);
  return attempt;
}

// ----- Grounding -------------------------------------------------------------
//
// Each name is grounded through the same Places (New) chain the interactive
// add-place flow uses: :autocomplete (top prediction) -> :get. One session
// token per name ties the pair into a single billed Details session. Field
// mask is `id,location,displayName` ONLY — no ToS-restricted content
// (ratings/reviews/photos/hours) is requested, so nothing restricted can
// leak into a persisted draft.
//
// Outcomes are tri-state so callers can tell "Google looked and found
// nothing" (no_match -> unresolved[], user fixes up) apart from "Google was
// unreachable / errored" (error). Callers treat "every name errored and
// nothing resolved" as transient (504) and persist NOTHING — caching an
// all-miss result would poison the idempotent replay for that key.

/**
 * Location bias for grounding. `destination` is appended to the search input
 * ("Louvre, Paris" pins the right city — text is the lever when no
 * coordinates exist yet). `near` adds a 50km locationBias circle — stronger,
 * used when the trip already has placed coordinates. Both may be set.
 */
export interface GroundBias {
  destination?: string;
  near?: { lat: number; lng: number };
}

/** Max circle radius accepted by Places (New) autocomplete locationBias. */
const GROUND_BIAS_RADIUS_METERS = 50_000;

export type GroundOutcome =
  | {
      kind: 'resolved';
      googlePlaceId: string;
      lat: number;
      lng: number;
      canonicalName: string;
      detailsCalls: number;
    }
  | { kind: 'no_match'; detailsCalls: number }
  | { kind: 'error'; detailsCalls: number };

export async function groundPlaceName(
  name: string,
  bias: GroundBias,
  apiKey: string,
  requestId: string,
  fn: string,
): Promise<GroundOutcome> {
  const input = bias.destination ? `${name}, ${bias.destination}` : name;
  const sessionToken = crypto.randomUUID();
  let detailsCalls = 0;
  try {
    const acBody: Record<string, unknown> = { input, sessionToken };
    if (bias.near) {
      acBody.locationBias = {
        circle: {
          center: { latitude: bias.near.lat, longitude: bias.near.lng },
          radius: GROUND_BIAS_RADIUS_METERS,
        },
      };
    }
    const acRes = await fetchWithTimeout(
      'https://places.googleapis.com/v1/places:autocomplete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'suggestions.placePrediction.placeId',
        },
        body: JSON.stringify(acBody),
      },
      GROUNDING_TIMEOUT_MS,
    );
    if (!acRes.ok) {
      const text = await acRes.text().catch(() => '');
      log({
        requestId,
        fn,
        level: 'warn',
        stage: 'ground_autocomplete',
        status: acRes.status,
        body: text.slice(0, 200),
      });
      return { kind: 'error', detailsCalls };
    }
    const acJson = (await acRes.json()) as {
      suggestions?: Array<{ placePrediction?: { placeId?: string } }>;
    };
    const placeId = acJson.suggestions?.[0]?.placePrediction?.placeId;
    if (!placeId) return { kind: 'no_match', detailsCalls };

    const detailsUrl = new URL(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    );
    // Session token propagation — closes the autocomplete session so the
    // pair bills as one Details session instead of two ad-hoc calls.
    detailsUrl.searchParams.set('sessionToken', sessionToken);
    detailsCalls = 1;
    const detRes = await fetchWithTimeout(
      detailsUrl.toString(),
      {
        method: 'GET',
        headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'id,location,displayName' },
      },
      GROUNDING_TIMEOUT_MS,
    );
    if (!detRes.ok) {
      const text = await detRes.text().catch(() => '');
      log({
        requestId,
        fn,
        level: 'warn',
        stage: 'ground_details',
        status: detRes.status,
        body: text.slice(0, 200),
      });
      return { kind: 'error', detailsCalls };
    }
    const det = (await detRes.json()) as {
      id?: string;
      location?: { latitude?: number; longitude?: number };
      displayName?: { text?: string };
    };
    if (!det.id || det.location?.latitude === undefined || det.location?.longitude === undefined) {
      return { kind: 'error', detailsCalls };
    }
    return {
      kind: 'resolved',
      googlePlaceId: det.id,
      lat: det.location.latitude,
      lng: det.location.longitude,
      // Surface the CANONICAL Google name so review surfaces expose wrong
      // groundings ("Joe's Pizza" resolving in the wrong city).
      canonicalName: det.displayName?.text?.trim() || name,
      detailsCalls,
    };
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    log({
      requestId,
      fn,
      level: 'warn',
      stage: 'ground',
      err: isAbort ? 'timeout' : String(err),
    });
    return { kind: 'error', detailsCalls };
  }
}

/**
 * Ground a list of names with the shared batching policy (batches of
 * GROUNDING_BATCH_SIZE, at most GROUNDING_BATCH_CONCURRENCY in flight).
 * Order-preserving: `result[i]` is the outcome for `names[i]`, so callers
 * can zip outcomes back to their own per-item context.
 */
export async function groundNames(
  names: readonly string[],
  bias: GroundBias,
  apiKey: string,
  requestId: string,
  fn: string,
): Promise<GroundOutcome[]> {
  const out: GroundOutcome[] = new Array(names.length);
  const indexed = names.map((name, i) => ({ name, i }));
  const batches = chunk(indexed, GROUNDING_BATCH_SIZE);
  for (let b = 0; b < batches.length; b += GROUNDING_BATCH_CONCURRENCY) {
    const wave = batches.slice(b, b + GROUNDING_BATCH_CONCURRENCY);
    await Promise.all(
      wave.map((batch) =>
        Promise.all(
          batch.map(async ({ name, i }) => {
            out[i] = await groundPlaceName(name, bias, apiKey, requestId, fn);
          }),
        ),
      ),
    );
  }
  return out;
}

// ----- ai_usage ledger (C4 quota) ---------------------------------------------
//
// Enforcement model (migration 0031, audit #8). Before 0031 the flow was
// read, then check, then LLM, then increment, so N concurrent requests at
// 9/10 all passed the check. Now:
//   1. readUsageToday: a cheap early 429 plus the `usage` numbers in
//      responses. Display and fast-fail only, NEVER the gate.
//   2. consumeAiQuota: the gate. An ATOMIC check-and-reserve RPC runs
//      immediately BEFORE the first upstream spend (the LLM call, or the
//      Google grounding loop for ai-edit `ground`). It fails CLOSED:
//      'error' -> the caller returns 500 db_error and spends nothing.
//   3. incrementAiUsage: post-hoc, uncapped spend recorded after the fact
//      (grounding details calls made after a reserved LLM run).
//   4. refundAiQuota: gives back the unused part of a reservation (ground
//      names that never reached a details call). It clamps at 0 in SQL.
// A failed LLM run is NOT refunded. Dispatched spend counts, so a failure
// loop can't burn unmetered provider quota (0020 §b policy, unchanged).

export interface UsageToday {
  aiRuns: number;
  groundingCalls: number;
}

/** Outcome of an atomic quota reservation (consume_ai_quota, migration 0031). */
export type QuotaReservation = 'reserved' | 'blocked' | 'error';

export interface QuotaRequest {
  /** AI runs to reserve (1 for plan/edit/suggest, 0 for ground). */
  runs: number;
  /** Grounding (Places details) calls to reserve up front (ground: one per name). */
  grounding: number;
  /** Cap on today's ai_runs after the reservation; null = uncapped. */
  runCap: number | null;
  /** Cap on today's grounding_calls after the reservation; null = uncapped. */
  groundingCap: number | null;
}

/**
 * ATOMIC check-and-reserve on today's ledger row (service-role RPC
 * `consume_ai_quota`, migration 0031). A single INSERT … ON CONFLICT DO
 * UPDATE … WHERE under-caps statement, so concurrent callers serialize on the
 * row and at most `cap` of them win. `blocked` means nothing was written.
 * Never throws: RPC/transport failures return 'error', and callers must
 * FAIL CLOSED (no upstream spend) on it.
 */
export async function consumeAiQuota(
  admin: SupabaseClient,
  userId: string,
  quota: QuotaRequest,
  requestId: string,
  fn: string,
): Promise<QuotaReservation> {
  try {
    const { data, error } = await admin.rpc('consume_ai_quota', {
      p_user: userId,
      p_runs: quota.runs,
      p_grounding: quota.grounding,
      p_run_cap: quota.runCap,
      p_grounding_cap: quota.groundingCap,
    });
    if (error) {
      log({ requestId, fn, level: 'error', stage: 'quota_reserve', err: error.message });
      return 'error';
    }
    return data === true ? 'reserved' : 'blocked';
  } catch (err) {
    log({ requestId, fn, level: 'error', stage: 'quota_reserve', err: String(err) });
    return 'error';
  }
}

/**
 * Give back an UNUSED part of a reservation (service-role RPC
 * `refund_ai_quota`, migration 0031; clamped at 0 server-side). `day` is the
 * UTC day captured just BEFORE the reservation. At a midnight straddle this
 * can only under-refund, never credit the wrong day. No-op for zero amounts.
 * Never throws (fail-safe: a missed refund only over-counts the caller's own
 * usage).
 */
export async function refundAiQuota(
  admin: SupabaseClient,
  userId: string,
  refund: { runs: number; grounding: number; day: string },
  requestId: string,
  fn: string,
): Promise<void> {
  const runs = Math.max(0, Math.trunc(refund.runs));
  const grounding = Math.max(0, Math.trunc(refund.grounding));
  if (runs === 0 && grounding === 0) return;
  try {
    const { error } = await admin.rpc('refund_ai_quota', {
      p_user: userId,
      p_runs: runs,
      p_grounding: grounding,
      p_day: refund.day,
    });
    if (error) {
      log({ requestId, fn, level: 'warn', stage: 'quota_refund', err: error.message });
    }
  } catch (err) {
    log({ requestId, fn, level: 'warn', stage: 'quota_refund', err: String(err) });
  }
}

/**
 * Today's ledger row for the caller (zeros when no row yet). Best-effort: a
 * read failure logs and returns zeros rather than failing the run. Since 0031
 * this read is display/fast-fail only; consumeAiQuota is the gate.
 */
export async function readUsageToday(
  user: SupabaseClient,
  userId: string,
  fn: string,
): Promise<UsageToday> {
  const { data, error } = await user
    .from('ai_usage')
    .select('ai_runs, grounding_calls')
    .eq('user_id', userId)
    .eq('day', todayUtc())
    .maybeSingle<{ ai_runs: number; grounding_calls: number }>();
  if (error) {
    log({ fn, level: 'warn', stage: 'usage_read', err: error.message });
    return { aiRuns: 0, groundingCalls: 0 };
  }
  return { aiRuns: data?.ai_runs ?? 0, groundingCalls: data?.grounding_calls ?? 0 };
}

/**
 * Uncapped post-hoc ledger write via the SECURITY DEFINER RPC (migration 0020
 * §c) under the service-role client. auth.uid() is NULL for service role,
 * which is what lets the function stamp the caller's row. Since 0031 it only
 * records spend that happened AFTER a consumeAiQuota reservation (grounding
 * details calls following a reserved LLM run). It never gates. Never throws
 * (fail-open bookkeeping).
 */
export async function incrementAiUsage(
  admin: SupabaseClient,
  userId: string,
  runs: number,
  grounding: number,
  requestId: string,
  fn: string,
): Promise<void> {
  if (runs <= 0 && grounding <= 0) return; // nothing spent: skip the round trip
  const { error } = await admin.rpc('increment_ai_usage', {
    p_user_id: userId,
    p_runs: runs,
    p_grounding: grounding,
    p_routing: 0,
  });
  if (error) {
    log({ requestId, fn, level: 'warn', stage: 'usage_increment', err: error.message });
  }
}
