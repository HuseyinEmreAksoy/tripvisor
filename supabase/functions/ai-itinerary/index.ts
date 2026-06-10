// ai-itinerary — "Plan my trip" AI core (v2 Phase N3, BUILD-LOG N3.1–N3.3).
//
// Principle (docs/v2/architecture.md §AI pipeline): the LLM proposes, Google
// Places grounds, the optimizer disposes — and the user decides. This
// function returns a DRAFT only; it NEVER writes trip_places. The client's
// draft-review screen commits accepted places through the normal hooks.
//
// Contract:
//   POST {
//     prompt: string (10..2000),
//     tripId?: uuid,              // optional association; must be visible to caller
//     days?: int (1..14),
//     destination?: string,
//     idempotencyKey: string (8..64),
//   }
//   -> 200 {
//        runId: uuid,
//        status: 'ok' | 'partial',           // 'partial' = some names unresolved
//        draft: {
//          places: Array<{ name, googlePlaceId, lat, lng, visitMinutes, category, dayHint }>,
//          unresolved: string[],             // LLM names Google couldn't ground — user fix-up, never silent drops
//          notes: string | null,
//          dayCount: number,
//        },
//        usage: { runsToday: number, dailyLimit: number },
//      }
//   GET ?ping -> { ok: true, fn: 'ai-itinerary' }
//
// Error envelope (shared { error: { code, message } } shape):
//   not_authenticated 401 · invalid_input 400 · quota_exceeded 429 ·
//   ai_misconfigured 500 · llm_failed 502 · upstream_timeout 504 · db_error 500
//
// Pipeline:
//   1. Idempotency — SELECT trip_ai_runs by (user_id, idempotencyKey); a hit
//      with status ok/partial replays the stored draft with ZERO LLM/grounding
//      spend (client retries and timeouts never double-bill — risk C4).
//   2. Quota — ai_usage row for today (UTC); >= DAILY_RUN_LIMIT -> 429.
//   3. LLM — Gemini 2.5 Flash (responseSchema structured JSON) with Groq
//      gpt-oss-20b (strict json_schema) as fallback on 4xx/5xx/timeout/garbage.
//      D4 data-minimization: the payload carries ONLY the user's prompt +
//      destination + day count. No Google-derived content ever reaches an LLM.
//   4. Grounding — each unique proposed NAME goes through Places API (New)
//      :autocomplete -> :get with field mask `id,location,displayName` only
//      (nothing ToS-restricted), one session token per name so the pair bills
//      as a single Details session. LLM coordinates are never used — the
//      response schema deliberately has no lat/lng.
//   5. Persist the run (user JWT -> RLS) + increment the ai_usage ledger
//      (service-role RPC). Draft is staged in trip_ai_runs.draft — NO
//      trip_places writes.
//
// Secrets (Supabase Edge secrets — never bundled):
//   GEMINI_API_KEY, GROQ_API_KEY (>=1 required), GOOGLE_MAPS_SERVER_KEY (required).
//
// N4 refactor: the LLM provider callers (Gemini->Groq fallback), the
// grounding loop, and the ai_usage ledger helpers moved to _shared/ai.ts —
// shared with ai-edit. Behavior is unchanged; this file keeps only its own
// contract (schemas, preamble, draft shaping, handler).

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { log, newRequestId } from '../_shared/logger.ts';
import { makeAdminClient, makeUserClient } from '../_shared/supabase-admin.ts';
import {
  DAILY_RUN_LIMIT,
  extractBearer,
  groundNames,
  incrementAiUsage,
  readUsageToday,
  runLlmWithFallback,
  sha256Hex,
  type LlmAttempt,
} from '../_shared/ai.ts';

const FN = 'ai-itinerary';

/** Mirrors optimize-trip's MAX_PLACES — drafts beyond this can't be optimized anyway. */
const MAX_DRAFT_PLACES = 25;

// ----- Request validation ---------------------------------------------------

const BodySchema = z.object({
  prompt: z.string().min(10).max(2000),
  tripId: z.string().uuid().optional(),
  days: z.number().int().min(1).max(14).optional(),
  destination: z.string().min(1).max(120).optional(),
  idempotencyKey: z.string().min(8).max(64),
});

// ----- LLM output validation ------------------------------------------------
//
// The schema the LLM must produce. Deliberately NO lat/lng fields — LLM
// coordinates are never trusted; grounding supplies the real ones.
// dayHint is unbounded here and clamped in code: failing a whole (already
// paid-for) generation because a model emitted day 0 or day 15 would be
// wasteful; clamping recovers it.

const LlmPlaceSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.string().max(60).nullish(),
  visitMinutes: z.number().int().min(15).max(480),
});
const LlmOutputSchema = z.object({
  days: z
    .array(
      z.object({
        dayHint: z.number().int(),
        places: z.array(LlmPlaceSchema),
      }),
    )
    .min(1),
  notes: z.string().max(2000).nullish(),
});
type LlmOutput = z.infer<typeof LlmOutputSchema>;

// Gemini structured output (generationConfig.responseSchema, OpenAPI-subset
// with UPPERCASE type enums per the v1beta REST docs).
const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    days: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          dayHint: { type: 'INTEGER' },
          places: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' },
                category: { type: 'STRING', nullable: true },
                visitMinutes: { type: 'INTEGER' },
              },
              required: ['name', 'visitMinutes'],
            },
          },
        },
        required: ['dayHint', 'places'],
      },
    },
    notes: { type: 'STRING', nullable: true },
  },
  required: ['days'],
};

// Groq strict json_schema (OpenAI-compatible): strict mode requires every
// property listed in `required` and `additionalProperties: false` on every
// object; optionals are expressed as nullable union types.
const GROQ_JSON_SCHEMA = {
  name: 'itinerary_draft',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      days: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            dayHint: { type: 'integer' },
            places: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string' },
                  category: { type: ['string', 'null'] },
                  visitMinutes: { type: 'integer' },
                },
                required: ['name', 'category', 'visitMinutes'],
              },
            },
          },
          required: ['dayHint', 'places'],
        },
      },
      notes: { type: ['string', 'null'] },
    },
    required: ['days', 'notes'],
  },
};

// Static instructions only — user data goes exclusively into the user
// message (D4: prompt + destination + day count, nothing else).
const SYSTEM_PREAMBLE = [
  'You are a travel itinerary planner.',
  'Propose real places to visit for the trip request, grouped into days.',
  'Rules:',
  '- ONLY output places that physically exist at or near the requested destination. Never invent places.',
  "- Use each place's common, searchable map name. No commentary inside the name field.",
  '- visitMinutes must be realistic for the place type, typically between 30 and 240.',
  "- Respect the request's day count. dayHint is the 1-based day a place belongs to.",
  '- Aim for 3-6 places per day and never more than 25 places in total.',
  '- Output ONLY JSON matching the schema. No markdown, no extra keys.',
].join('\n');

// ----- Domain types ----------------------------------------------------------

interface AiDraftPlace {
  name: string;
  googlePlaceId: string;
  lat: number;
  lng: number;
  visitMinutes: number;
  category: string | null;
  dayHint: number;
}

interface AiDraft {
  places: AiDraftPlace[];
  unresolved: string[];
  notes: string | null;
  dayCount: number;
}

// ----- LLM output parsing ------------------------------------------------------

/** Parse + validate an LLM JSON string. Null on any failure (caller falls back). */
function parseLlmJson(text: string): LlmOutput | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = LlmOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const totalPlaces = parsed.data.days.reduce((n, d) => n + d.places.length, 0);
  if (totalPlaces === 0) return null; // an empty itinerary is a provider failure
  return parsed.data;
}

// ----- Handler ---------------------------------------------------------------

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const requestId = newRequestId();
  const startedAt = Date.now();

  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  if (url.searchParams.has('ping')) {
    return jsonResponse({ ok: true, fn: FN }, { origin });
  }

  if (req.method !== 'POST') {
    return errorResponse('method_not_allowed', 'Only POST is allowed', 405, origin);
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return errorResponse(
      'invalid_input',
      err instanceof z.ZodError ? err.issues.map((i) => i.message).join('; ') : 'Invalid JSON',
      400,
      origin,
    );
  }

  // ---- Auth: user id comes EXCLUSIVELY from the verified JWT ----------------
  const user = makeUserClient(req);
  const token = extractBearer(req);
  if (!token) {
    return errorResponse('not_authenticated', 'Missing bearer token', 401, origin);
  }
  const { data: userData, error: authErr } = await user.auth.getUser(token);
  if (authErr || !userData?.user) {
    return errorResponse('not_authenticated', 'Invalid or expired token', 401, origin);
  }
  const userId = userData.user.id;

  // ---- 1. Idempotency replay (zero spend) -----------------------------------
  // Only ok/partial rows exist in N3 (migration 0020 §b), but the status
  // filter is kept explicit so future failure-status writers can't get
  // replayed by accident.
  const { data: existing, error: replayErr } = await user
    .from('trip_ai_runs')
    .select('id, status, draft')
    .eq('user_id', userId)
    .eq('idempotency_key', body.idempotencyKey)
    .in('status', ['ok', 'partial'])
    .maybeSingle<{ id: string; status: 'ok' | 'partial'; draft: AiDraft | null }>();
  if (replayErr) {
    log({ requestId, fn: FN, level: 'error', stage: 'idempotency', err: replayErr.message });
    return errorResponse('db_error', replayErr.message, 500, origin);
  }
  if (existing?.draft) {
    const usage = (await readUsageToday(user, userId, FN)).aiRuns;
    log({
      requestId,
      fn: FN,
      level: 'info',
      stage: 'replay',
      runId: existing.id,
      status: existing.status,
      durationMs: Date.now() - startedAt,
    });
    return jsonResponse(
      {
        runId: existing.id,
        status: existing.status,
        draft: existing.draft,
        usage: { runsToday: usage, dailyLimit: DAILY_RUN_LIMIT },
      },
      { origin },
    );
  }

  // ---- 2. Quota --------------------------------------------------------------
  // Read-then-spend (not atomic): two perfectly concurrent requests at 9/10
  // can both pass and land at 11. Accepted for a soft free-tier guard — the
  // ledger still records true spend, and the next request is blocked.
  const runsToday = (await readUsageToday(user, userId, FN)).aiRuns;
  if (runsToday >= DAILY_RUN_LIMIT) {
    log({ requestId, fn: FN, level: 'info', stage: 'quota', runsToday });
    return errorResponse(
      'quota_exceeded',
      `Daily AI planning limit reached (${DAILY_RUN_LIMIT}/day). Try again tomorrow.`,
      429,
      origin,
    );
  }

  // ---- 3. Config check (before any spend) -------------------------------------
  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  const groqKey = Deno.env.get('GROQ_API_KEY');
  const googleKey = Deno.env.get('GOOGLE_MAPS_SERVER_KEY');
  if (!geminiKey && !groqKey) {
    log({ requestId, fn: FN, level: 'error', err: 'missing_llm_keys' });
    return errorResponse(
      'ai_misconfigured',
      'No LLM key configured. Set GEMINI_API_KEY and/or GROQ_API_KEY as Edge Function secrets. See docs/v2/tech-stack.md and .env.example.',
      500,
      origin,
    );
  }
  if (!googleKey) {
    log({ requestId, fn: FN, level: 'error', err: 'missing_server_key' });
    return errorResponse(
      'ai_misconfigured',
      'Google Maps server key is not configured (required for grounding). See docs/google-maps-setup.md.',
      500,
      origin,
    );
  }

  // ---- 4. Optional tripId must be visible to the caller (RLS-scoped) ----------
  // Kept inside the closed error-code set: an invisible/unknown trip is an
  // input problem from this contract's point of view (and pre-empts an ugly
  // FK/RLS failure at insert time).
  if (body.tripId) {
    const { data: trip, error: tripErr } = await user
      .from('trips')
      .select('id')
      .eq('id', body.tripId)
      .maybeSingle<{ id: string }>();
    if (tripErr) {
      log({ requestId, fn: FN, level: 'error', stage: 'trip_check', err: tripErr.message });
      return errorResponse('db_error', tripErr.message, 500, origin);
    }
    if (!trip) {
      return errorResponse('invalid_input', 'tripId not found or not accessible', 400, origin);
    }
  }

  // ---- 5. LLM: Gemini -> Groq fallback ----------------------------------------
  // D4 data-minimization: ONLY user-authored text + destination + day count.
  const userPayload = [
    `Trip request: ${body.prompt}`,
    `Destination: ${body.destination ?? 'infer it from the trip request'}`,
    `Number of days: ${body.days ?? 'infer from the trip request (between 1 and 14)'}`,
  ].join('\n');

  const llmStart = Date.now();
  const attempt: LlmAttempt<LlmOutput> | null = await runLlmWithFallback(
    { geminiKey, groqKey },
    {
      system: SYSTEM_PREAMBLE,
      user: userPayload,
      geminiResponseSchema: GEMINI_RESPONSE_SCHEMA,
      groqJsonSchema: GROQ_JSON_SCHEMA,
      parse: parseLlmJson,
    },
    requestId,
    FN,
  );
  const llmMs = Date.now() - llmStart;

  const admin = makeAdminClient();
  const promptHash = await sha256Hex(body.prompt);

  if (!attempt) {
    // An upstream LLM call was dispatched (>=1 provider configured) — count
    // the run in the ledger even though it failed, so a failure loop can't
    // burn unmetered Gemini RPD / Groq quota. No trip_ai_runs row is written
    // (migration 0020 §b: the idempotency key must stay free for the retry).
    await incrementAiUsage(admin, userId, 1, 0, requestId, FN);
    log({
      requestId,
      fn: FN,
      level: 'error',
      stage: 'llm',
      err: 'all_providers_failed',
      promptHash,
      llmMs,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(
      'llm_failed',
      'AI itinerary generation is temporarily unavailable. Please try again.',
      502,
      origin,
    );
  }

  // ---- 6. Flatten + clamp + dedupe + cap ---------------------------------------
  const dayCount =
    body.days ??
    Math.min(
      14,
      Math.max(1, attempt.output.days.length, ...attempt.output.days.map((d) => d.dayHint)),
    );

  const seenNames = new Set<string>();
  const proposed: Array<{ name: string; category: string | null; visitMinutes: number; dayHint: number }> = [];
  for (const day of attempt.output.days) {
    const dayHint = Math.min(Math.max(1, Math.trunc(day.dayHint)), dayCount);
    for (const p of day.places) {
      const name = p.name.trim();
      const nameKey = name.toLowerCase();
      // Exact-duplicate names collapse to one entry (not a "silent drop" —
      // the place is still in the draft once).
      if (!name || seenNames.has(nameKey)) continue;
      seenNames.add(nameKey);
      proposed.push({
        name,
        category: p.category?.trim() || null,
        visitMinutes: p.visitMinutes,
        dayHint,
      });
      if (proposed.length >= MAX_DRAFT_PLACES) break;
    }
    if (proposed.length >= MAX_DRAFT_PLACES) break;
  }

  // ---- 7. Grounding loop --------------------------------------------------------
  const groundStart = Date.now();
  const places: AiDraftPlace[] = [];
  const unresolved: string[] = [];
  const seenPlaceIds = new Set<string>();
  let detailsCalls = 0;
  let groundErrors = 0;

  // Shared batched loop (_shared/ai.ts; 5 per batch, 2 batches in flight).
  // Text bias only — no coordinates exist before grounding, so the
  // destination string is the lever.
  const outcomes = await groundNames(
    proposed.map((p) => p.name),
    { destination: body.destination },
    googleKey,
    requestId,
    FN,
  );
  for (let i = 0; i < proposed.length; i++) {
    const p = proposed[i]!;
    const outcome = outcomes[i]!;
    detailsCalls += outcome.detailsCalls;
    if (outcome.kind === 'resolved') {
      // Two LLM names can resolve to one real place ("The Louvre" /
      // "Louvre Museum") — keep the first; the place IS in the draft.
      if (seenPlaceIds.has(outcome.googlePlaceId)) continue;
      seenPlaceIds.add(outcome.googlePlaceId);
      places.push({
        name: outcome.canonicalName,
        googlePlaceId: outcome.googlePlaceId,
        lat: outcome.lat,
        lng: outcome.lng,
        visitMinutes: p.visitMinutes,
        category: p.category,
        dayHint: p.dayHint,
      });
    } else {
      if (outcome.kind === 'error') groundErrors++;
      // Partial-grounding UX: NEVER silently drop — the client renders
      // "couldn't find these N places" for user fix-up.
      unresolved.push(p.name);
    }
  }
  const groundMs = Date.now() - groundStart;

  // Nothing resolved AND at least one transport-level failure: Google was
  // unreachable, not "these places don't exist". Treat as transient (504)
  // and persist NOTHING — a stored all-miss draft would poison the
  // idempotent replay for this key. Spend still hits the ledger.
  if (places.length === 0 && groundErrors > 0) {
    await incrementAiUsage(admin, userId, 1, detailsCalls, requestId, FN);
    log({
      requestId,
      fn: FN,
      level: 'error',
      stage: 'grounding',
      err: 'grounding_unavailable',
      proposed: proposed.length,
      groundErrors,
      detailsCalls,
      llmMs,
      groundMs,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(
      'upstream_timeout',
      'Place lookup is temporarily unavailable. Please try again.',
      504,
      origin,
    );
  }

  const status: 'ok' | 'partial' = unresolved.length > 0 ? 'partial' : 'ok';
  const draft: AiDraft = {
    places,
    unresolved,
    notes: attempt.output.notes?.trim() || null,
    dayCount,
  };

  // ---- 8. Ledger first, then the audit/idempotency row -------------------------
  // Increment BEFORE the insert so the ledger reflects real upstream spend
  // even if the insert fails. Ledger failures are logged but never fail the
  // run (fail-open bookkeeping; at 10/day the worst case is one uncounted run).
  await incrementAiUsage(admin, userId, 1, detailsCalls, requestId, FN);

  // Written with the USER client so trip_ai_runs RLS (own-rows insert,
  // append-only) is enforced on the function itself.
  const { data: runRow, error: insErr } = await user
    .from('trip_ai_runs')
    .insert({
      user_id: userId,
      trip_id: body.tripId ?? null,
      kind: 'plan',
      idempotency_key: body.idempotencyKey,
      model: attempt.model,
      prompt_hash: promptHash,
      status,
      draft,
      tokens_in: attempt.tokensIn,
      tokens_out: attempt.tokensOut,
    })
    .select('id')
    .single<{ id: string }>();
  if (insErr || !runRow) {
    // 23505 = a concurrent request with the same key won the race while we
    // were generating. Converge: return the winner's stored draft.
    if (insErr?.code === '23505') {
      const { data: winner } = await user
        .from('trip_ai_runs')
        .select('id, status, draft')
        .eq('user_id', userId)
        .eq('idempotency_key', body.idempotencyKey)
        .in('status', ['ok', 'partial'])
        .maybeSingle<{ id: string; status: 'ok' | 'partial'; draft: AiDraft | null }>();
      if (winner?.draft) {
        log({ requestId, fn: FN, level: 'warn', stage: 'insert', err: 'idempotency_race_converged', runId: winner.id });
        return jsonResponse(
          {
            runId: winner.id,
            status: winner.status,
            draft: winner.draft,
            usage: { runsToday: runsToday + 1, dailyLimit: DAILY_RUN_LIMIT },
          },
          { origin },
        );
      }
    }
    log({
      requestId,
      fn: FN,
      level: 'error',
      stage: 'insert',
      err: insErr?.message ?? 'insert returned no row',
    });
    return errorResponse('db_error', 'Failed to record the AI run', 500, origin);
  }
  const runId = runRow.id;

  log({
    requestId,
    fn: FN,
    level: 'info',
    runId,
    status,
    model: attempt.model,
    promptHash,
    proposed: proposed.length,
    resolved: places.length,
    unresolved: unresolved.length,
    detailsCalls,
    tokensIn: attempt.tokensIn,
    tokensOut: attempt.tokensOut,
    llmMs,
    groundMs,
    durationMs: Date.now() - startedAt,
  });

  return jsonResponse(
    {
      runId,
      status,
      draft,
      usage: { runsToday: runsToday + 1, dailyLimit: DAILY_RUN_LIMIT },
    },
    { origin },
  );
}

Deno.serve(handler);
