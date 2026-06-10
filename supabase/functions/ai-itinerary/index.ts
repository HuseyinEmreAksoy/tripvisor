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
//   2. Quota — ai_usage row for today (UTC); >= DAILY_PLAN_LIMIT -> 429.
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

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { fetchWithTimeout } from '../_shared/fetch-with-timeout.ts';
import { log, newRequestId } from '../_shared/logger.ts';
import { makeAdminClient, makeUserClient } from '../_shared/supabase-admin.ts';

const FN = 'ai-itinerary';

const LLM_TIMEOUT_MS = 20_000;
const GROUNDING_TIMEOUT_MS = 8_000;
/** Daily plan quota per user (migration 0020 §d: constant lives here, not in the DB). */
const DAILY_PLAN_LIMIT = 10;
/** Mirrors optimize-trip's MAX_PLACES — drafts beyond this can't be optimized anyway. */
const MAX_DRAFT_PLACES = 25;
/** Grounding politeness: batches of 5 names, at most 2 batches in flight. */
const GROUNDING_BATCH_SIZE = 5;
const GROUNDING_BATCH_CONCURRENCY = 2;

const GEMINI_MODEL = 'gemini-2.5-flash';
const GROQ_MODEL = 'openai/gpt-oss-20b';

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

interface LlmAttempt {
  output: LlmOutput;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

// ----- Small helpers ---------------------------------------------------------

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, '0');
  return out;
}

/** UTC calendar day — matches Postgres current_date on Supabase (UTC). */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function extractBearer(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? (match[1] ?? null) : null;
}

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

// ----- LLM providers ---------------------------------------------------------

async function callGemini(
  apiKey: string,
  userPayload: string,
  requestId: string,
): Promise<LlmAttempt | null> {
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PREAMBLE }] },
          contents: [{ role: 'user', parts: [{ text: userPayload }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: GEMINI_RESPONSE_SCHEMA,
          },
        }),
      },
      LLM_TIMEOUT_MS,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      log({
        requestId,
        fn: FN,
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
    const output = parseLlmJson(text);
    if (!output) {
      log({
        requestId,
        fn: FN,
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
      fn: FN,
      level: 'warn',
      stage: 'llm_gemini',
      err: isAbort ? 'timeout' : String(err),
      durationMs: Date.now() - start,
    });
    return null;
  }
}

async function callGroq(
  apiKey: string,
  userPayload: string,
  requestId: string,
): Promise<LlmAttempt | null> {
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
            { role: 'system', content: SYSTEM_PREAMBLE },
            { role: 'user', content: userPayload },
          ],
          response_format: { type: 'json_schema', json_schema: GROQ_JSON_SCHEMA },
        }),
      },
      LLM_TIMEOUT_MS,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      log({
        requestId,
        fn: FN,
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
    const output = parseLlmJson(json.choices?.[0]?.message?.content ?? '');
    if (!output) {
      log({
        requestId,
        fn: FN,
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
      fn: FN,
      level: 'warn',
      stage: 'llm_groq',
      err: isAbort ? 'timeout' : String(err),
      durationMs: Date.now() - start,
    });
    return null;
  }
}

// ----- Grounding -------------------------------------------------------------
//
// Each unique LLM name is grounded through the same Places (New) chain the
// interactive add-place flow uses: :autocomplete (top prediction) -> :get.
// One session token per name ties the pair into a single billed Details
// session. Field mask is `id,location,displayName` ONLY — no ToS-restricted
// content (ratings/reviews/photos/hours) is requested, so nothing restricted
// can leak into the persisted draft.
//
// Outcomes are tri-state so the handler can tell "Google looked and found
// nothing" (no_match -> unresolved[], user fixes up) apart from "Google was
// unreachable / errored" (error). If EVERY name errors and nothing resolved,
// the run is transient-failed (504) and deliberately NOT persisted — caching
// an all-miss draft would poison the idempotent replay for that key.

type GroundOutcome =
  | { kind: 'resolved'; googlePlaceId: string; lat: number; lng: number; canonicalName: string; detailsCalls: number }
  | { kind: 'no_match'; detailsCalls: number }
  | { kind: 'error'; detailsCalls: number };

async function groundPlaceName(
  llmName: string,
  destination: string | undefined,
  apiKey: string,
  requestId: string,
): Promise<GroundOutcome> {
  // Location bias: the destination is appended to the search input ("Louvre,
  // Lisbon" finds nothing; "Louvre, Paris" pins the right city). No
  // coordinates are available pre-grounding, so text bias is the lever.
  const input = destination ? `${llmName}, ${destination}` : llmName;
  const sessionToken = crypto.randomUUID();
  let detailsCalls = 0;
  try {
    const acRes = await fetchWithTimeout(
      'https://places.googleapis.com/v1/places:autocomplete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'suggestions.placePrediction.placeId',
        },
        body: JSON.stringify({ input, sessionToken }),
      },
      GROUNDING_TIMEOUT_MS,
    );
    if (!acRes.ok) {
      const text = await acRes.text().catch(() => '');
      log({
        requestId,
        fn: FN,
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
        fn: FN,
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
      // Surface the CANONICAL Google name in the draft so the review screen
      // exposes wrong groundings ("Joe's Pizza" resolving in the wrong city).
      canonicalName: det.displayName?.text?.trim() || llmName,
      detailsCalls,
    };
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    log({
      requestId,
      fn: FN,
      level: 'warn',
      stage: 'ground',
      err: isAbort ? 'timeout' : String(err),
    });
    return { kind: 'error', detailsCalls };
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
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
    const usage = await readUsage(user, userId);
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
        usage: { runsToday: usage, dailyLimit: DAILY_PLAN_LIMIT },
      },
      { origin },
    );
  }

  // ---- 2. Quota --------------------------------------------------------------
  // Read-then-spend (not atomic): two perfectly concurrent requests at 9/10
  // can both pass and land at 11. Accepted for a soft free-tier guard — the
  // ledger still records true spend, and the next request is blocked.
  const runsToday = await readUsage(user, userId);
  if (runsToday >= DAILY_PLAN_LIMIT) {
    log({ requestId, fn: FN, level: 'info', stage: 'quota', runsToday });
    return errorResponse(
      'quota_exceeded',
      `Daily AI planning limit reached (${DAILY_PLAN_LIMIT}/day). Try again tomorrow.`,
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
  let attempt: LlmAttempt | null = null;
  if (geminiKey) attempt = await callGemini(geminiKey, userPayload, requestId);
  if (!attempt && groqKey) attempt = await callGroq(groqKey, userPayload, requestId);
  const llmMs = Date.now() - llmStart;

  const admin = makeAdminClient();
  const promptHash = await sha256Hex(body.prompt);

  if (!attempt) {
    // An upstream LLM call was dispatched (>=1 provider configured) — count
    // the run in the ledger even though it failed, so a failure loop can't
    // burn unmetered Gemini RPD / Groq quota. No trip_ai_runs row is written
    // (migration 0020 §b: the idempotency key must stay free for the retry).
    await incrementUsage(admin, userId, 1, 0, requestId);
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

  const batches = chunk(proposed, GROUNDING_BATCH_SIZE);
  for (let i = 0; i < batches.length; i += GROUNDING_BATCH_CONCURRENCY) {
    const wave = batches.slice(i, i + GROUNDING_BATCH_CONCURRENCY);
    const waveResults = await Promise.all(
      wave.map((batch) =>
        Promise.all(
          batch.map(async (p) => ({
            proposed: p,
            outcome: await groundPlaceName(p.name, body.destination, googleKey, requestId),
          })),
        ),
      ),
    );
    for (const batchResults of waveResults) {
      for (const { proposed: p, outcome } of batchResults) {
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
    }
  }
  const groundMs = Date.now() - groundStart;

  // Nothing resolved AND at least one transport-level failure: Google was
  // unreachable, not "these places don't exist". Treat as transient (504)
  // and persist NOTHING — a stored all-miss draft would poison the
  // idempotent replay for this key. Spend still hits the ledger.
  if (places.length === 0 && groundErrors > 0) {
    await incrementUsage(admin, userId, 1, detailsCalls, requestId);
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
  await incrementUsage(admin, userId, 1, detailsCalls, requestId);

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
            usage: { runsToday: runsToday + 1, dailyLimit: DAILY_PLAN_LIMIT },
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
      usage: { runsToday: runsToday + 1, dailyLimit: DAILY_PLAN_LIMIT },
    },
    { origin },
  );
}

// Today's ai_runs count for the caller (0 when no row yet). Best-effort: a
// read failure logs and returns 0 rather than failing the run — the ledger
// is a soft guard, not a billing system.
async function readUsage(user: ReturnType<typeof makeUserClient>, userId: string): Promise<number> {
  const { data, error } = await user
    .from('ai_usage')
    .select('ai_runs')
    .eq('user_id', userId)
    .eq('day', todayUtc())
    .maybeSingle<{ ai_runs: number }>();
  if (error) {
    log({ fn: FN, level: 'warn', stage: 'usage_read', err: error.message });
    return 0;
  }
  return data?.ai_runs ?? 0;
}

// Ledger write via the SECURITY DEFINER RPC (migration 0020 §c) under the
// service-role client — auth.uid() is NULL for service role, which is what
// lets the function stamp the caller's row. Never throws.
async function incrementUsage(
  admin: ReturnType<typeof makeAdminClient>,
  userId: string,
  runs: number,
  grounding: number,
  requestId: string,
): Promise<void> {
  const { error } = await admin.rpc('increment_ai_usage', {
    p_user_id: userId,
    p_runs: runs,
    p_grounding: grounding,
    p_routing: 0,
  });
  if (error) {
    log({ requestId, fn: FN, level: 'warn', stage: 'usage_increment', err: error.message });
  }
}

Deno.serve(handler);
