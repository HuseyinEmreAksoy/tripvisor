// ai-edit — AI editing, gap-fill suggestions, and import grounding
// (v2 Phase N4, BUILD-LOG N4.1–N4.3; plan-v2.md v2.1 §N4).
//
// Principle (docs/v2/architecture.md §AI pipeline): the LLM proposes, Google
// Places grounds, the optimizer disposes — and the user decides. Every action
// here is PREVIEW-ONLY: this function NEVER writes trip_places / trip_days /
// trips. The client renders the diff/suggestions/resolved list and commits
// accepted changes through the normal hooks (which invalidate themselves).
//
// Contract (action-discriminated body, manage-collaborators pattern):
//
//   POST { action: 'edit', tripId, instruction (5..1000), idempotencyKey (8..64) }
//     -> 200 {
//          runId, status: 'ok' | 'partial',
//          diff: {
//            adds: AiDraftPlace[],                          // grounded; dayHint 1-based
//            removes: [{ tripPlaceId, name }],
//            moves: [{ tripPlaceId, name, toDay }],         // toDay 1-based
//            durationChanges: [{ tripPlaceId, name, visitMinutes }],
//            notes: string | null,
//          },
//          unresolved: string[],                            // add-names Google couldn't ground
//          usage: { runsToday, dailyLimit },
//        }
//
//   POST { action: 'suggest', tripId, dayIndex (0-based trip_places.day_index),
//          slackMinutes (30..480), idempotencyKey }
//     -> 200 { runId, status, suggestions: AiDraftPlace[],  // dayHint = dayIndex + 1
//              unresolved: string[], usage: { runsToday, dailyLimit } }
//
//   POST { action: 'ground', names: string[] (1..30, each 2..120), destination?,
//          idempotencyKey }
//     -> 200 { runId, resolved: [{ name, googlePlaceId, lat, lng }],
//              unresolved: string[],
//              usage: { groundingToday, dailyLimit } }      // 100-name/day budget
//
//   GET ?ping -> { ok: true, fn: 'ai-edit' }
//
//   AiDraftPlace = { name, googlePlaceId, lat, lng, visitMinutes, category, dayHint }
//   (identical shape to ai-itinerary's draft places, so the client reuses its types).
//
// Day-number conventions (deliberate, documented in src/api/ai.ts too):
//   - INPUT  `suggest.dayIndex` is the DB's 0-based trip_places.day_index —
//     the caller reads slack off the existing itinerary.
//   - OUTPUT `dayHint` / `toDay` are 1-based (same convention as the N3 draft
//     review screen, which converts to 0-based day_index on commit).
//
// Error envelope ({ error: { code, message } }, mirrors ai-itinerary/AiError):
//   invalid_input 400 · not_authenticated 401 · method_not_allowed 405 ·
//   quota_exceeded 429 · ai_misconfigured 500 · db_error 500 ·
//   llm_failed 502 · upstream_timeout 504
//
// Quotas (C4, ai_usage ledger via increment_ai_usage RPC):
//   - 'edit' / 'suggest' count against the shared DAILY_RUN_LIMIT (10/day,
//     same ai_runs counter as ai-itinerary plans).
//   - 'ground' is LLM-free and does NOT consume a run. It is budgeted against
//     ai_usage.grounding_calls instead: DAILY_GROUNDING_LIMIT (100) grounded
//     names/user/day. Note grounding_calls is the SHARED Google-metered
//     counter (plan/edit/suggest grounding increments it too), so the budget
//     is conservative by design — it protects the Google free credit.
//
// D4 / R2 data-minimization posture (NON-NEGOTIABLE):
//   The LLM payload carries ONLY user-authored context — trip title
//   (destination), place user_titles, day numbers, visit minutes, and the
//   instruction/slack. NEVER Google-derived data: no leg durations, ratings,
//   reviews, hours, or coordinates. Internal UUIDs are also withheld: places
//   are presented to the LLM as opaque aliases p1..pN and mapped back
//   server-side (more reliable structured output, zero id leakage).
//
// Idempotency: same pattern as ai-itinerary (trip_ai_runs UNIQUE
// (user_id, idempotency_key); successful runs replay for free; failures
// write no row so the key stays free for the retry). Replay lookups filter
// on `kind` so a key can never replay across action types.
//
// Secrets: GEMINI_API_KEY / GROQ_API_KEY (>=1 required for edit/suggest;
// NOT needed for ground), GOOGLE_MAPS_SERVER_KEY (required for all actions).

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
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
  type GroundBias,
  type LlmAttempt,
} from '../_shared/ai.ts';

const FN = 'ai-edit';

/** Cap on LLM-proposed adds per edit — keeps grounding spend bounded. */
const MAX_EDIT_ADDS = 10;
/** Suggestions returned per gap-fill run (LLM is asked for 2–4). */
const MAX_SUGGESTIONS = 4;
/**
 * Grounding budget for the LLM-free 'ground' action: grounded names per
 * user per UTC day, enforced against the shared ai_usage.grounding_calls
 * counter. Constant lives here, not the DB (0021 note) — tuning is a redeploy.
 */
const DAILY_GROUNDING_LIMIT = 100;
/**
 * Hard cap on places sent as LLM context. Beyond this the context is
 * truncated (and logged) — diff ops can only reference what the LLM saw.
 */
const MAX_CONTEXT_PLACES = 100;

// ----- Request validation (action-discriminated) ------------------------------

const EditSchema = z.object({
  action: z.literal('edit'),
  tripId: z.string().uuid(),
  instruction: z.string().min(5).max(1000),
  idempotencyKey: z.string().min(8).max(64),
});

const SuggestSchema = z.object({
  action: z.literal('suggest'),
  tripId: z.string().uuid(),
  /** 0-based trip_places.day_index of the day to fill. */
  dayIndex: z.number().int().min(0).max(365),
  slackMinutes: z.number().int().min(30).max(480),
  idempotencyKey: z.string().min(8).max(64),
});

const GroundSchema = z.object({
  action: z.literal('ground'),
  names: z.array(z.string().min(2).max(120)).min(1).max(30),
  destination: z.string().min(1).max(120).optional(),
  idempotencyKey: z.string().min(8).max(64),
});

const BodySchema = z.discriminatedUnion('action', [EditSchema, SuggestSchema, GroundSchema]);

// ----- LLM output schemas -------------------------------------------------------
//
// Like ai-itinerary: NO lat/lng anywhere (LLM coordinates are never trusted —
// grounding supplies the real ones) and unbounded day numbers are clamped in
// code rather than failing an already-paid-for generation.

const LlmEditSchema = z.object({
  adds: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        category: z.string().max(60).nullish(),
        visitMinutes: z.number().int().min(15).max(480),
        dayHint: z.number().int(),
      }),
    )
    .default([]),
  removes: z.array(z.object({ id: z.string().min(1).max(24) })).default([]),
  moves: z
    .array(z.object({ id: z.string().min(1).max(24), toDay: z.number().int() }))
    .default([]),
  durationChanges: z
    .array(
      z.object({
        id: z.string().min(1).max(24),
        visitMinutes: z.number().int().min(15).max(480),
      }),
    )
    .default([]),
  notes: z.string().max(2000).nullish(),
});
type LlmEdit = z.infer<typeof LlmEditSchema>;

const LlmSuggestSchema = z.object({
  suggestions: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        category: z.string().max(60).nullish(),
        visitMinutes: z.number().int().min(15).max(480),
      }),
    )
    .min(1),
});
type LlmSuggest = z.infer<typeof LlmSuggestSchema>;

/**
 * Parse + validate an edit diff. An ALL-EMPTY diff is valid ("nothing to
 * change" is an honest answer to e.g. "remove the museum" on a museum-free
 * trip) — unlike a plan, emptiness is not a provider failure here.
 */
function parseEditJson(text: string): LlmEdit | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = LlmEditSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Parse + validate suggestions. Zero suggestions IS a provider failure. */
function parseSuggestJson(text: string): LlmSuggest | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = LlmSuggestSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// Gemini structured output (generationConfig.responseSchema, OpenAPI subset,
// UPPERCASE type enums — same dialect as ai-itinerary).
const GEMINI_EDIT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    adds: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          category: { type: 'STRING', nullable: true },
          visitMinutes: { type: 'INTEGER' },
          dayHint: { type: 'INTEGER' },
        },
        required: ['name', 'visitMinutes', 'dayHint'],
      },
    },
    removes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { id: { type: 'STRING' } },
        required: ['id'],
      },
    },
    moves: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { id: { type: 'STRING' }, toDay: { type: 'INTEGER' } },
        required: ['id', 'toDay'],
      },
    },
    durationChanges: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { id: { type: 'STRING' }, visitMinutes: { type: 'INTEGER' } },
        required: ['id', 'visitMinutes'],
      },
    },
    notes: { type: 'STRING', nullable: true },
  },
  required: ['adds', 'removes', 'moves', 'durationChanges'],
};

// Groq strict json_schema: every property required, additionalProperties
// false everywhere, optionals expressed as nullable unions.
const GROQ_EDIT_SCHEMA = {
  name: 'itinerary_edit_diff',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      adds: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            category: { type: ['string', 'null'] },
            visitMinutes: { type: 'integer' },
            dayHint: { type: 'integer' },
          },
          required: ['name', 'category', 'visitMinutes', 'dayHint'],
        },
      },
      removes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      moves: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' }, toDay: { type: 'integer' } },
          required: ['id', 'toDay'],
        },
      },
      durationChanges: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' }, visitMinutes: { type: 'integer' } },
          required: ['id', 'visitMinutes'],
        },
      },
      notes: { type: ['string', 'null'] },
    },
    required: ['adds', 'removes', 'moves', 'durationChanges', 'notes'],
  },
};

const GEMINI_SUGGEST_SCHEMA = {
  type: 'OBJECT',
  properties: {
    suggestions: {
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
  required: ['suggestions'],
};

const GROQ_SUGGEST_SCHEMA = {
  name: 'day_fill_suggestions',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      suggestions: {
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
    required: ['suggestions'],
  },
};

// Static instructions only — user data goes exclusively into the user message.
const EDIT_PREAMBLE = [
  'You are a travel itinerary editor.',
  'You receive the destination, the trip’s current places as a JSON array (each item: id, title, day, visitMinutes — day is 1-based; day null means the unscheduled ideas bucket), and the owner’s instruction.',
  'Return the SMALLEST diff that satisfies the instruction.',
  'Rules:',
  '- removes, moves and durationChanges MUST reference the given ids EXACTLY as written. Never invent ids.',
  '- adds are NEW real places that physically exist at or near the destination. Never invent places, never re-add a place already in the trip. Use each place’s common, searchable map name. At most 10 adds.',
  '- dayHint (for adds) and toDay (for moves) are 1-based day numbers.',
  '- visitMinutes must be realistic for the place type, between 15 and 480.',
  '- Only change what the instruction asks for; leave everything else untouched. Empty arrays are valid.',
  '- notes: at most one short sentence summarising the change (or null).',
  '- Output ONLY JSON matching the schema. No markdown, no extra keys.',
].join('\n');

const SUGGEST_PREAMBLE = [
  'You are a travel itinerary assistant filling spare time in one day of a trip.',
  'You receive the destination, the places already planned for that day (titles + visit minutes), and the spare minutes available.',
  'Propose 2 to 4 ADDITIONAL real places that fit the spare time.',
  'Rules:',
  '- ONLY real places that physically exist at or near the destination, ideally close in spirit to the day’s existing places. Never invent places.',
  '- Never repeat a place already planned.',
  '- Use each place’s common, searchable map name. No commentary inside the name field.',
  '- Each suggestion’s visitMinutes MUST be at most the spare minutes, at least 15, and realistic for the place type.',
  '- Output ONLY JSON matching the schema. No markdown, no extra keys.',
].join('\n');

// ----- Domain types --------------------------------------------------------------

/** Same shape as ai-itinerary's draft places — the client reuses its type. */
interface AiDraftPlace {
  name: string;
  googlePlaceId: string;
  lat: number;
  lng: number;
  visitMinutes: number;
  category: string | null;
  dayHint: number;
}

interface AiEditDiff {
  adds: AiDraftPlace[];
  removes: Array<{ tripPlaceId: string; name: string }>;
  moves: Array<{ tripPlaceId: string; name: string; toDay: number }>;
  durationChanges: Array<{ tripPlaceId: string; name: string; visitMinutes: number }>;
  notes: string | null;
}

interface GroundedName {
  name: string;
  googlePlaceId: string;
  lat: number;
  lng: number;
}

/** trip_places columns loaded as edit/suggest context (user JWT — RLS-gated). */
interface PlaceRow {
  id: string;
  user_title: string | null;
  google_place_id: string;
  day_index: number | null;
  visit_duration_minutes: number;
  lat: number;
  lng: number;
}

type RunKind = 'edit' | 'suggest' | 'ground';
type RunStatus = 'ok' | 'partial';

interface HandlerCtx {
  user: SupabaseClient;
  userId: string;
  origin: string | null;
  requestId: string;
  startedAt: number;
}

// ----- Shared per-action plumbing --------------------------------------------------

function titleOf(row: PlaceRow): string {
  return row.user_title?.trim() || '(untitled place)';
}

interface ReplayRow {
  id: string;
  status: RunStatus;
  draft: Record<string, unknown> | null;
}

/**
 * Idempotent-replay lookup. Filters on `kind` (in addition to the 0020
 * UNIQUE pair) so an idempotency key can never replay across action types.
 * Only ok/partial rows are written by this function, but the status filter
 * stays explicit (same reasoning as ai-itinerary).
 */
async function loadReplay(
  user: SupabaseClient,
  userId: string,
  idempotencyKey: string,
  kind: RunKind,
  requestId: string,
): Promise<{ row: ReplayRow | null; dbError: string | null }> {
  const { data, error } = await user
    .from('trip_ai_runs')
    .select('id, status, draft')
    .eq('user_id', userId)
    .eq('idempotency_key', idempotencyKey)
    .eq('kind', kind)
    .in('status', ['ok', 'partial'])
    .maybeSingle<ReplayRow>();
  if (error) {
    log({ requestId, fn: FN, level: 'error', stage: 'idempotency', err: error.message });
    return { row: null, dbError: error.message };
  }
  return { row: data ?? null, dbError: null };
}

interface InsertRunArgs {
  userId: string;
  tripId: string | null;
  kind: RunKind;
  idempotencyKey: string;
  model: string;
  promptHash: string;
  status: RunStatus;
  draft: unknown;
  tokensIn: number | null;
  tokensOut: number | null;
}

/**
 * Audit/idempotency row, written with the USER client so trip_ai_runs RLS
 * (own-rows insert, append-only) is enforced on the function itself.
 * `conflict` = 23505: a concurrent request with the same key won the race —
 * caller converges by re-reading the winner via loadReplay.
 */
async function insertRun(
  user: SupabaseClient,
  args: InsertRunArgs,
  requestId: string,
): Promise<{ runId: string | null; conflict: boolean }> {
  const { data, error } = await user
    .from('trip_ai_runs')
    .insert({
      user_id: args.userId,
      trip_id: args.tripId,
      kind: args.kind,
      idempotency_key: args.idempotencyKey,
      model: args.model,
      prompt_hash: args.promptHash,
      status: args.status,
      draft: args.draft,
      tokens_in: args.tokensIn,
      tokens_out: args.tokensOut,
    })
    .select('id')
    .single<{ id: string }>();
  if (error || !data) {
    const conflict = error?.code === '23505';
    log({
      requestId,
      fn: FN,
      level: conflict ? 'warn' : 'error',
      stage: 'insert',
      err: error?.message ?? 'insert returned no row',
    });
    return { runId: null, conflict };
  }
  return { runId: data.id, conflict: false };
}

/**
 * Load the trip (title doubles as the destination) + its places under the
 * caller's JWT — RLS is the access proof; an invisible trip is
 * indistinguishable from a missing one (invalid_input, no existence oracle).
 */
async function loadTripContext(
  user: SupabaseClient,
  tripId: string,
  requestId: string,
): Promise<
  | { ok: true; trip: { id: string; title: string }; places: PlaceRow[] }
  | { ok: false; code: 'invalid_input' | 'db_error'; message: string }
> {
  const { data: trip, error: tripErr } = await user
    .from('trips')
    .select('id, title')
    .eq('id', tripId)
    .maybeSingle<{ id: string; title: string }>();
  if (tripErr) {
    log({ requestId, fn: FN, level: 'error', stage: 'trip_load', err: tripErr.message });
    return { ok: false, code: 'db_error', message: tripErr.message };
  }
  if (!trip) {
    return { ok: false, code: 'invalid_input', message: 'tripId not found or not accessible' };
  }
  const { data: places, error: placesErr } = await user
    .from('trip_places')
    .select('id, user_title, google_place_id, day_index, visit_duration_minutes, lat, lng')
    .eq('trip_id', tripId)
    .order('day_index', { ascending: true, nullsFirst: false })
    .order('order_in_day', { ascending: true });
  if (placesErr) {
    log({ requestId, fn: FN, level: 'error', stage: 'places_load', err: placesErr.message });
    return { ok: false, code: 'db_error', message: placesErr.message };
  }
  return { ok: true, trip, places: (places ?? []) as PlaceRow[] };
}

function missingLlmKeysResponse(origin: string | null): Response {
  return errorResponse(
    'ai_misconfigured',
    'No LLM key configured. Set GEMINI_API_KEY and/or GROQ_API_KEY as Edge Function secrets. See docs/v2/tech-stack.md and .env.example.',
    500,
    origin,
  );
}

function missingGoogleKeyResponse(origin: string | null): Response {
  return errorResponse(
    'ai_misconfigured',
    'Google Maps server key is not configured (required for grounding). See docs/google-maps-setup.md.',
    500,
    origin,
  );
}

// ----- action: edit ----------------------------------------------------------------

async function handleEdit(body: z.infer<typeof EditSchema>, ctx: HandlerCtx): Promise<Response> {
  const { user, userId, origin, requestId, startedAt } = ctx;

  // 1. Idempotency replay (zero spend).
  const replay = await loadReplay(user, userId, body.idempotencyKey, 'edit', requestId);
  if (replay.dbError) return errorResponse('db_error', replay.dbError, 500, origin);
  if (replay.row?.draft) {
    const runsToday = (await readUsageToday(user, userId, FN)).aiRuns;
    log({
      requestId,
      fn: FN,
      level: 'info',
      stage: 'replay',
      action: 'edit',
      runId: replay.row.id,
      status: replay.row.status,
      durationMs: Date.now() - startedAt,
    });
    const stored = replay.row.draft as unknown as { diff: AiEditDiff; unresolved: string[] };
    return jsonResponse(
      {
        runId: replay.row.id,
        status: replay.row.status,
        diff: stored.diff,
        unresolved: stored.unresolved,
        usage: { runsToday, dailyLimit: DAILY_RUN_LIMIT },
      },
      { origin },
    );
  }

  // 2. Quota — shared ai_runs counter with ai-itinerary (read-then-spend,
  // soft guard; same accepted race as N3).
  const usage = await readUsageToday(user, userId, FN);
  if (usage.aiRuns >= DAILY_RUN_LIMIT) {
    log({ requestId, fn: FN, level: 'info', stage: 'quota', action: 'edit', runsToday: usage.aiRuns });
    return errorResponse(
      'quota_exceeded',
      `Daily AI limit reached (${DAILY_RUN_LIMIT}/day). Try again tomorrow.`,
      429,
      origin,
    );
  }

  // 3. Config (before any spend).
  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  const groqKey = Deno.env.get('GROQ_API_KEY');
  const googleKey = Deno.env.get('GOOGLE_MAPS_SERVER_KEY');
  if (!geminiKey && !groqKey) {
    log({ requestId, fn: FN, level: 'error', err: 'missing_llm_keys' });
    return missingLlmKeysResponse(origin);
  }
  if (!googleKey) {
    log({ requestId, fn: FN, level: 'error', err: 'missing_server_key' });
    return missingGoogleKeyResponse(origin);
  }

  // 4. Trip + places (RLS proves access; preview needs viewer visibility —
  // committing the diff goes through editor-gated client mutations anyway).
  const tripCtx = await loadTripContext(user, body.tripId, requestId);
  if (!tripCtx.ok) {
    return errorResponse(tripCtx.code, tripCtx.message, tripCtx.code === 'db_error' ? 500 : 400, origin);
  }
  const { trip } = tripCtx;
  const context = tripCtx.places.slice(0, MAX_CONTEXT_PLACES);
  if (tripCtx.places.length > MAX_CONTEXT_PLACES) {
    log({
      requestId,
      fn: FN,
      level: 'warn',
      stage: 'context',
      err: 'context_truncated',
      total: tripCtx.places.length,
      kept: MAX_CONTEXT_PLACES,
    });
  }

  // 5. LLM payload — D4: user-authored context ONLY (titles, day numbers,
  // visit minutes, instruction, trip title). Places are exposed as opaque
  // aliases p1..pN; UUIDs and Google-derived data never reach the LLM.
  const aliasOf = new Map<string, PlaceRow>();
  const placesForLlm = context.map((p, i) => {
    const alias = `p${i + 1}`;
    aliasOf.set(alias, p);
    return {
      id: alias,
      title: titleOf(p),
      day: p.day_index === null ? null : p.day_index + 1,
      visitMinutes: p.visit_duration_minutes,
    };
  });
  const userPayload = [
    `Destination: ${trip.title}`,
    `Current places: ${placesForLlm.length > 0 ? JSON.stringify(placesForLlm) : '(no places yet)'}`,
    `Instruction: ${body.instruction}`,
  ].join('\n');

  const llmStart = Date.now();
  const attempt: LlmAttempt<LlmEdit> | null = await runLlmWithFallback(
    { geminiKey, groqKey },
    {
      system: EDIT_PREAMBLE,
      user: userPayload,
      geminiResponseSchema: GEMINI_EDIT_SCHEMA,
      groqJsonSchema: GROQ_EDIT_SCHEMA,
      parse: parseEditJson,
    },
    requestId,
    FN,
  );
  const llmMs = Date.now() - llmStart;

  const admin = makeAdminClient();
  const promptHash = await sha256Hex(body.instruction);

  if (!attempt) {
    // LLM spend was dispatched — count the run so a failure loop can't burn
    // provider quota. No row is written: the key stays free for the retry.
    await incrementAiUsage(admin, userId, 1, 0, requestId, FN);
    log({
      requestId,
      fn: FN,
      level: 'error',
      stage: 'llm',
      action: 'edit',
      err: 'all_providers_failed',
      promptHash,
      llmMs,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(
      'llm_failed',
      'AI editing is temporarily unavailable. Please try again.',
      502,
      origin,
    );
  }

  // 6. Validate the diff against the loaded places. Unknown aliases are
  // DROPPED (and logged) — the LLM may only touch what it was shown.
  // No-op moves/duration changes and ops on removed places are pruned so
  // the preview shows only real changes.
  const maxDay1 = Math.max(
    1,
    ...context.map((p) => (p.day_index === null ? 0 : p.day_index + 1)),
  );
  // +1 headroom: "move X to a new day" is a legitimate edit.
  const clampDay = (d: number) => Math.min(Math.max(1, Math.trunc(d)), maxDay1 + 1);

  let droppedIds = 0;
  const removedAliases = new Set<string>();
  const removes: AiEditDiff['removes'] = [];
  for (const r of attempt.output.removes) {
    const row = aliasOf.get(r.id);
    if (!row) {
      droppedIds++;
      continue;
    }
    if (removedAliases.has(r.id)) continue;
    removedAliases.add(r.id);
    removes.push({ tripPlaceId: row.id, name: titleOf(row) });
  }

  const movedAliases = new Set<string>();
  const moves: AiEditDiff['moves'] = [];
  for (const m of attempt.output.moves) {
    const row = aliasOf.get(m.id);
    if (!row) {
      droppedIds++;
      continue;
    }
    if (removedAliases.has(m.id) || movedAliases.has(m.id)) continue;
    const toDay = clampDay(m.toDay);
    if (row.day_index !== null && row.day_index + 1 === toDay) continue; // no-op
    movedAliases.add(m.id);
    moves.push({ tripPlaceId: row.id, name: titleOf(row), toDay });
  }

  const changedAliases = new Set<string>();
  const durationChanges: AiEditDiff['durationChanges'] = [];
  for (const c of attempt.output.durationChanges) {
    const row = aliasOf.get(c.id);
    if (!row) {
      droppedIds++;
      continue;
    }
    if (removedAliases.has(c.id) || changedAliases.has(c.id)) continue;
    if (c.visitMinutes === row.visit_duration_minutes) continue; // no-op
    changedAliases.add(c.id);
    durationChanges.push({ tripPlaceId: row.id, name: titleOf(row), visitMinutes: c.visitMinutes });
  }

  if (droppedIds > 0) {
    log({ requestId, fn: FN, level: 'warn', stage: 'diff_validate', err: 'unknown_ids_dropped', droppedIds });
  }

  const seenAddNames = new Set<string>();
  const proposedAdds: Array<{ name: string; category: string | null; visitMinutes: number; dayHint: number }> = [];
  for (const a of attempt.output.adds) {
    const name = a.name.trim();
    const nameKey = name.toLowerCase();
    if (!name || seenAddNames.has(nameKey)) continue;
    seenAddNames.add(nameKey);
    proposedAdds.push({
      name,
      category: a.category?.trim() || null,
      visitMinutes: a.visitMinutes,
      dayHint: clampDay(a.dayHint),
    });
    if (proposedAdds.length >= MAX_EDIT_ADDS) break;
  }

  // 7. Ground the adds — biased to the trip's first placed coordinates
  // (50km circle) + the destination text (shared loop, _shared/ai.ts).
  const bias: GroundBias = { destination: trip.title };
  const anchor = context[0];
  if (anchor) bias.near = { lat: anchor.lat, lng: anchor.lng };
  const existingPlaceIds = new Set(context.map((p) => p.google_place_id));

  const groundStart = Date.now();
  const adds: AiDraftPlace[] = [];
  const unresolved: string[] = [];
  const seenPlaceIds = new Set<string>();
  let detailsCalls = 0;
  let groundErrors = 0;

  const outcomes =
    proposedAdds.length > 0
      ? await groundNames(proposedAdds.map((a) => a.name), bias, googleKey, requestId, FN)
      : [];
  for (let i = 0; i < proposedAdds.length; i++) {
    const a = proposedAdds[i]!;
    const outcome = outcomes[i]!;
    detailsCalls += outcome.detailsCalls;
    if (outcome.kind === 'resolved') {
      // Never propose adding a place the trip already has — the LLM was
      // told not to, but grounding is the reliable check.
      if (existingPlaceIds.has(outcome.googlePlaceId)) {
        log({ requestId, fn: FN, level: 'info', stage: 'ground', skipped: 'already_in_trip' });
        continue;
      }
      if (seenPlaceIds.has(outcome.googlePlaceId)) continue;
      seenPlaceIds.add(outcome.googlePlaceId);
      adds.push({
        name: outcome.canonicalName,
        googlePlaceId: outcome.googlePlaceId,
        lat: outcome.lat,
        lng: outcome.lng,
        visitMinutes: a.visitMinutes,
        category: a.category,
        dayHint: a.dayHint,
      });
    } else {
      if (outcome.kind === 'error') groundErrors++;
      // Partial-grounding UX: never silently drop — the client surfaces
      // "couldn't find these N places" for user fix-up.
      unresolved.push(a.name);
    }
  }
  const groundMs = Date.now() - groundStart;

  // 8. Transient grounding failure AND nothing else in the diff: Google was
  // unreachable and the preview would be empty — 504, persist NOTHING (a
  // stored all-miss diff would poison the replay). If removes/moves/duration
  // changes exist the diff is still useful: degrade to status 'partial'.
  const hasNonAddOps = removes.length + moves.length + durationChanges.length > 0;
  if (adds.length === 0 && groundErrors > 0 && !hasNonAddOps) {
    await incrementAiUsage(admin, userId, 1, detailsCalls, requestId, FN);
    log({
      requestId,
      fn: FN,
      level: 'error',
      stage: 'grounding',
      action: 'edit',
      err: 'grounding_unavailable',
      proposed: proposedAdds.length,
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

  const status: RunStatus = unresolved.length > 0 ? 'partial' : 'ok';
  const diff: AiEditDiff = {
    adds,
    removes,
    moves,
    durationChanges,
    notes: attempt.output.notes?.trim() || null,
  };

  // 9. Ledger first (reflects real spend even if the insert fails), then the
  // audit/idempotency row under the user JWT.
  await incrementAiUsage(admin, userId, 1, detailsCalls, requestId, FN);
  const ins = await insertRun(
    user,
    {
      userId,
      tripId: body.tripId,
      kind: 'edit',
      idempotencyKey: body.idempotencyKey,
      model: attempt.model,
      promptHash,
      status,
      draft: { diff, unresolved },
      tokensIn: attempt.tokensIn,
      tokensOut: attempt.tokensOut,
    },
    requestId,
  );
  if (!ins.runId) {
    if (ins.conflict) {
      const winner = await loadReplay(user, userId, body.idempotencyKey, 'edit', requestId);
      if (winner.row?.draft) {
        const stored = winner.row.draft as unknown as { diff: AiEditDiff; unresolved: string[] };
        return jsonResponse(
          {
            runId: winner.row.id,
            status: winner.row.status,
            diff: stored.diff,
            unresolved: stored.unresolved,
            usage: { runsToday: usage.aiRuns + 1, dailyLimit: DAILY_RUN_LIMIT },
          },
          { origin },
        );
      }
      // Same key, different kind — a client bug, surfaced honestly.
      return errorResponse(
        'invalid_input',
        'idempotencyKey was already used by a different request',
        400,
        origin,
      );
    }
    return errorResponse('db_error', 'Failed to record the AI run', 500, origin);
  }

  log({
    requestId,
    fn: FN,
    level: 'info',
    action: 'edit',
    runId: ins.runId,
    status,
    model: attempt.model,
    promptHash,
    contextPlaces: context.length,
    proposedAdds: proposedAdds.length,
    adds: adds.length,
    removes: removes.length,
    moves: moves.length,
    durationChanges: durationChanges.length,
    unresolved: unresolved.length,
    droppedIds,
    detailsCalls,
    tokensIn: attempt.tokensIn,
    tokensOut: attempt.tokensOut,
    llmMs,
    groundMs,
    durationMs: Date.now() - startedAt,
  });

  return jsonResponse(
    {
      runId: ins.runId,
      status,
      diff,
      unresolved,
      usage: { runsToday: usage.aiRuns + 1, dailyLimit: DAILY_RUN_LIMIT },
    },
    { origin },
  );
}

// ----- action: suggest ---------------------------------------------------------------

async function handleSuggest(
  body: z.infer<typeof SuggestSchema>,
  ctx: HandlerCtx,
): Promise<Response> {
  const { user, userId, origin, requestId, startedAt } = ctx;

  // 1. Idempotency replay.
  const replay = await loadReplay(user, userId, body.idempotencyKey, 'suggest', requestId);
  if (replay.dbError) return errorResponse('db_error', replay.dbError, 500, origin);
  if (replay.row?.draft) {
    const runsToday = (await readUsageToday(user, userId, FN)).aiRuns;
    log({
      requestId,
      fn: FN,
      level: 'info',
      stage: 'replay',
      action: 'suggest',
      runId: replay.row.id,
      status: replay.row.status,
      durationMs: Date.now() - startedAt,
    });
    const stored = replay.row.draft as unknown as {
      suggestions: AiDraftPlace[];
      unresolved: string[];
    };
    return jsonResponse(
      {
        runId: replay.row.id,
        status: replay.row.status,
        suggestions: stored.suggestions,
        unresolved: stored.unresolved,
        usage: { runsToday, dailyLimit: DAILY_RUN_LIMIT },
      },
      { origin },
    );
  }

  // 2. Quota (shared ai_runs counter — a suggest run counts like a plan/edit).
  const usage = await readUsageToday(user, userId, FN);
  if (usage.aiRuns >= DAILY_RUN_LIMIT) {
    log({ requestId, fn: FN, level: 'info', stage: 'quota', action: 'suggest', runsToday: usage.aiRuns });
    return errorResponse(
      'quota_exceeded',
      `Daily AI limit reached (${DAILY_RUN_LIMIT}/day). Try again tomorrow.`,
      429,
      origin,
    );
  }

  // 3. Config.
  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  const groqKey = Deno.env.get('GROQ_API_KEY');
  const googleKey = Deno.env.get('GOOGLE_MAPS_SERVER_KEY');
  if (!geminiKey && !groqKey) {
    log({ requestId, fn: FN, level: 'error', err: 'missing_llm_keys' });
    return missingLlmKeysResponse(origin);
  }
  if (!googleKey) {
    log({ requestId, fn: FN, level: 'error', err: 'missing_server_key' });
    return missingGoogleKeyResponse(origin);
  }

  // 4. Trip + places.
  const tripCtx = await loadTripContext(user, body.tripId, requestId);
  if (!tripCtx.ok) {
    return errorResponse(tripCtx.code, tripCtx.message, tripCtx.code === 'db_error' ? 500 : 400, origin);
  }
  const { trip, places } = tripCtx;
  const dayPlaces = places.filter((p) => p.day_index === body.dayIndex);

  // 5. LLM — D4: titles + visit minutes + slack + destination only.
  const planned = dayPlaces.map((p) => ({
    title: titleOf(p),
    visitMinutes: p.visit_duration_minutes,
  }));
  const userPayload = [
    `Destination: ${trip.title}`,
    `Already planned for this day: ${planned.length > 0 ? JSON.stringify(planned) : '(nothing yet)'}`,
    `Spare minutes available: ${body.slackMinutes}`,
  ].join('\n');

  const llmStart = Date.now();
  const attempt: LlmAttempt<LlmSuggest> | null = await runLlmWithFallback(
    { geminiKey, groqKey },
    {
      system: SUGGEST_PREAMBLE,
      user: userPayload,
      geminiResponseSchema: GEMINI_SUGGEST_SCHEMA,
      groqJsonSchema: GROQ_SUGGEST_SCHEMA,
      parse: parseSuggestJson,
    },
    requestId,
    FN,
  );
  const llmMs = Date.now() - llmStart;

  const admin = makeAdminClient();
  // No free-text prompt exists for this action — hash the canonical request
  // params (satisfies the NOT NULL sha256 column without inventing PII).
  const promptHash = await sha256Hex(
    `suggest:${body.tripId}:${body.dayIndex}:${body.slackMinutes}`,
  );

  if (!attempt) {
    await incrementAiUsage(admin, userId, 1, 0, requestId, FN);
    log({
      requestId,
      fn: FN,
      level: 'error',
      stage: 'llm',
      action: 'suggest',
      err: 'all_providers_failed',
      llmMs,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(
      'llm_failed',
      'AI suggestions are temporarily unavailable. Please try again.',
      502,
      origin,
    );
  }

  // 6. Filter: fit the slack (oversize suggestions are useless — dropped and
  // logged), dedupe, skip places already planned that day, cap at 4.
  const dayTitleKeys = new Set(dayPlaces.map((p) => titleOf(p).toLowerCase()));
  const seenNames = new Set<string>();
  let oversize = 0;
  const proposals: Array<{ name: string; category: string | null; visitMinutes: number }> = [];
  for (const s of attempt.output.suggestions) {
    const name = s.name.trim();
    const nameKey = name.toLowerCase();
    if (!name || seenNames.has(nameKey) || dayTitleKeys.has(nameKey)) continue;
    if (s.visitMinutes > body.slackMinutes) {
      oversize++;
      continue;
    }
    seenNames.add(nameKey);
    proposals.push({ name, category: s.category?.trim() || null, visitMinutes: s.visitMinutes });
    if (proposals.length >= MAX_SUGGESTIONS) break;
  }
  if (oversize > 0) {
    log({ requestId, fn: FN, level: 'warn', stage: 'suggest_filter', err: 'oversize_dropped', oversize });
  }

  // 7. Ground — biased to the day's first place, else the trip's first place,
  // else the destination text alone.
  const bias: GroundBias = { destination: trip.title };
  const anchor = dayPlaces[0] ?? places[0];
  if (anchor) bias.near = { lat: anchor.lat, lng: anchor.lng };
  const existingPlaceIds = new Set(places.map((p) => p.google_place_id));

  const groundStart = Date.now();
  const suggestions: AiDraftPlace[] = [];
  const unresolved: string[] = [];
  const seenPlaceIds = new Set<string>();
  let detailsCalls = 0;
  let groundErrors = 0;

  const outcomes =
    proposals.length > 0
      ? await groundNames(proposals.map((p) => p.name), bias, googleKey, requestId, FN)
      : [];
  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i]!;
    const outcome = outcomes[i]!;
    detailsCalls += outcome.detailsCalls;
    if (outcome.kind === 'resolved') {
      if (existingPlaceIds.has(outcome.googlePlaceId)) {
        log({ requestId, fn: FN, level: 'info', stage: 'ground', skipped: 'already_in_trip' });
        continue;
      }
      if (seenPlaceIds.has(outcome.googlePlaceId)) continue;
      seenPlaceIds.add(outcome.googlePlaceId);
      suggestions.push({
        name: outcome.canonicalName,
        googlePlaceId: outcome.googlePlaceId,
        lat: outcome.lat,
        lng: outcome.lng,
        visitMinutes: p.visitMinutes,
        category: p.category,
        // 1-based, like every dayHint in the AI surface (client converts to
        // 0-based day_index on commit).
        dayHint: body.dayIndex + 1,
      });
    } else {
      if (outcome.kind === 'error') groundErrors++;
      unresolved.push(p.name);
    }
  }
  const groundMs = Date.now() - groundStart;

  // 8. Suggestions are the run's ONLY content — if there were proposals and
  // every grounding call transport-failed, the run is transient (504) and
  // not persisted. (Zero proposals after filtering is different: that's an
  // honest "nothing fits" — persisted and replayable below.)
  if (suggestions.length === 0 && groundErrors > 0) {
    await incrementAiUsage(admin, userId, 1, detailsCalls, requestId, FN);
    log({
      requestId,
      fn: FN,
      level: 'error',
      stage: 'grounding',
      action: 'suggest',
      err: 'grounding_unavailable',
      proposed: proposals.length,
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

  const status: RunStatus = unresolved.length > 0 ? 'partial' : 'ok';

  await incrementAiUsage(admin, userId, 1, detailsCalls, requestId, FN);
  const ins = await insertRun(
    user,
    {
      userId,
      tripId: body.tripId,
      kind: 'suggest',
      idempotencyKey: body.idempotencyKey,
      model: attempt.model,
      promptHash,
      status,
      draft: { suggestions, unresolved },
      tokensIn: attempt.tokensIn,
      tokensOut: attempt.tokensOut,
    },
    requestId,
  );
  if (!ins.runId) {
    if (ins.conflict) {
      const winner = await loadReplay(user, userId, body.idempotencyKey, 'suggest', requestId);
      if (winner.row?.draft) {
        const stored = winner.row.draft as unknown as {
          suggestions: AiDraftPlace[];
          unresolved: string[];
        };
        return jsonResponse(
          {
            runId: winner.row.id,
            status: winner.row.status,
            suggestions: stored.suggestions,
            unresolved: stored.unresolved,
            usage: { runsToday: usage.aiRuns + 1, dailyLimit: DAILY_RUN_LIMIT },
          },
          { origin },
        );
      }
      return errorResponse(
        'invalid_input',
        'idempotencyKey was already used by a different request',
        400,
        origin,
      );
    }
    return errorResponse('db_error', 'Failed to record the AI run', 500, origin);
  }

  log({
    requestId,
    fn: FN,
    level: 'info',
    action: 'suggest',
    runId: ins.runId,
    status,
    model: attempt.model,
    dayIndex: body.dayIndex,
    slackMinutes: body.slackMinutes,
    proposed: proposals.length,
    suggestions: suggestions.length,
    unresolved: unresolved.length,
    oversize,
    detailsCalls,
    tokensIn: attempt.tokensIn,
    tokensOut: attempt.tokensOut,
    llmMs,
    groundMs,
    durationMs: Date.now() - startedAt,
  });

  return jsonResponse(
    {
      runId: ins.runId,
      status,
      suggestions,
      unresolved,
      usage: { runsToday: usage.aiRuns + 1, dailyLimit: DAILY_RUN_LIMIT },
    },
    { origin },
  );
}

// ----- action: ground -----------------------------------------------------------------

async function handleGround(
  body: z.infer<typeof GroundSchema>,
  ctx: HandlerCtx,
): Promise<Response> {
  const { user, userId, origin, requestId, startedAt } = ctx;

  // 1. Idempotency replay.
  const replay = await loadReplay(user, userId, body.idempotencyKey, 'ground', requestId);
  if (replay.dbError) return errorResponse('db_error', replay.dbError, 500, origin);
  if (replay.row?.draft) {
    const groundingToday = (await readUsageToday(user, userId, FN)).groundingCalls;
    log({
      requestId,
      fn: FN,
      level: 'info',
      stage: 'replay',
      action: 'ground',
      runId: replay.row.id,
      status: replay.row.status,
      durationMs: Date.now() - startedAt,
    });
    const stored = replay.row.draft as unknown as {
      resolved: GroundedName[];
      unresolved: string[];
    };
    return jsonResponse(
      {
        runId: replay.row.id,
        resolved: stored.resolved,
        unresolved: stored.unresolved,
        usage: { groundingToday, dailyLimit: DAILY_GROUNDING_LIMIT },
      },
      { origin },
    );
  }

  // 2. Clean the input list: trim, drop too-short leftovers, dedupe
  // case-insensitively (original casing preserved for the response).
  const seenKeys = new Set<string>();
  const names: string[] = [];
  for (const raw of body.names) {
    const name = raw.trim();
    if (name.length < 2) continue;
    const key = name.toLowerCase();
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    names.push(name);
  }
  if (names.length === 0) {
    return errorResponse('invalid_input', 'names contained no usable entries', 400, origin);
  }

  // 3. Grounding budget — NOT the 10-run quota. grounding_calls is the
  // shared Google-metered counter, so the whole batch must fit today's
  // remaining budget (predictable reject beats a partial mystery).
  const usage = await readUsageToday(user, userId, FN);
  if (usage.groundingCalls + names.length > DAILY_GROUNDING_LIMIT) {
    log({
      requestId,
      fn: FN,
      level: 'info',
      stage: 'quota',
      action: 'ground',
      groundingToday: usage.groundingCalls,
      requested: names.length,
    });
    return errorResponse(
      'quota_exceeded',
      `Daily place-lookup budget reached (${usage.groundingCalls}/${DAILY_GROUNDING_LIMIT} used today, ${names.length} requested). Try again tomorrow or import fewer names.`,
      429,
      origin,
    );
  }

  // 4. Config — ground is LLM-free: ONLY the Google key is required.
  const googleKey = Deno.env.get('GOOGLE_MAPS_SERVER_KEY');
  if (!googleKey) {
    log({ requestId, fn: FN, level: 'error', err: 'missing_server_key' });
    return missingGoogleKeyResponse(origin);
  }

  // 5. Pure grounding loop (no LLM call anywhere on this path).
  const groundStart = Date.now();
  const resolved: GroundedName[] = [];
  const unresolved: string[] = [];
  const seenPlaceIds = new Set<string>();
  let detailsCalls = 0;
  let groundErrors = 0;

  const outcomes = await groundNames(
    names,
    { destination: body.destination },
    googleKey,
    requestId,
    FN,
  );
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!;
    const outcome = outcomes[i]!;
    detailsCalls += outcome.detailsCalls;
    if (outcome.kind === 'resolved') {
      // Two input names can resolve to the same real place — keep the first
      // (the place IS in the result once; logged, not user-facing noise).
      if (seenPlaceIds.has(outcome.googlePlaceId)) {
        log({ requestId, fn: FN, level: 'info', stage: 'ground', skipped: 'duplicate_place' });
        continue;
      }
      seenPlaceIds.add(outcome.googlePlaceId);
      resolved.push({
        // Canonical Google displayName — exposes wrong groundings in the
        // import review UI (same convention as ai-itinerary drafts).
        name: outcome.canonicalName,
        googlePlaceId: outcome.googlePlaceId,
        lat: outcome.lat,
        lng: outcome.lng,
      });
    } else {
      if (outcome.kind === 'error') groundErrors++;
      unresolved.push(name);
    }
  }
  const groundMs = Date.now() - groundStart;

  const admin = makeAdminClient();

  // 6. Nothing resolved AND >=1 transport failure: Google unreachable, not
  // "these places don't exist" — transient 504, no row (key stays free),
  // spend still recorded.
  if (resolved.length === 0 && groundErrors > 0) {
    await incrementAiUsage(admin, userId, 0, detailsCalls, requestId, FN);
    log({
      requestId,
      fn: FN,
      level: 'error',
      stage: 'grounding',
      action: 'ground',
      err: 'grounding_unavailable',
      requested: names.length,
      groundErrors,
      detailsCalls,
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

  // 7. Ledger (runs = 0 — ground never consumes an AI run), then the row.
  await incrementAiUsage(admin, userId, 0, detailsCalls, requestId, FN);

  const status: RunStatus = unresolved.length > 0 ? 'partial' : 'ok';
  const promptHash = await sha256Hex(JSON.stringify(names));
  const ins = await insertRun(
    user,
    {
      userId,
      tripId: null,
      kind: 'ground',
      idempotencyKey: body.idempotencyKey,
      model: 'none', // LLM-free by design
      promptHash,
      status,
      draft: { resolved, unresolved },
      tokensIn: null,
      tokensOut: null,
    },
    requestId,
  );
  if (!ins.runId) {
    if (ins.conflict) {
      const winner = await loadReplay(user, userId, body.idempotencyKey, 'ground', requestId);
      if (winner.row?.draft) {
        const stored = winner.row.draft as unknown as {
          resolved: GroundedName[];
          unresolved: string[];
        };
        return jsonResponse(
          {
            runId: winner.row.id,
            resolved: stored.resolved,
            unresolved: stored.unresolved,
            usage: {
              groundingToday: usage.groundingCalls + detailsCalls,
              dailyLimit: DAILY_GROUNDING_LIMIT,
            },
          },
          { origin },
        );
      }
      return errorResponse(
        'invalid_input',
        'idempotencyKey was already used by a different request',
        400,
        origin,
      );
    }
    return errorResponse('db_error', 'Failed to record the AI run', 500, origin);
  }

  log({
    requestId,
    fn: FN,
    level: 'info',
    action: 'ground',
    runId: ins.runId,
    status,
    requested: names.length,
    resolved: resolved.length,
    unresolved: unresolved.length,
    detailsCalls,
    groundMs,
    durationMs: Date.now() - startedAt,
  });

  return jsonResponse(
    {
      runId: ins.runId,
      resolved,
      unresolved,
      usage: {
        groundingToday: usage.groundingCalls + detailsCalls,
        dailyLimit: DAILY_GROUNDING_LIMIT,
      },
    },
    { origin },
  );
}

// ----- Handler ---------------------------------------------------------------------

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

  // Auth: user id comes EXCLUSIVELY from the verified JWT.
  const user = makeUserClient(req);
  const token = extractBearer(req);
  if (!token) {
    return errorResponse('not_authenticated', 'Missing bearer token', 401, origin);
  }
  const { data: userData, error: authErr } = await user.auth.getUser(token);
  if (authErr || !userData?.user) {
    return errorResponse('not_authenticated', 'Invalid or expired token', 401, origin);
  }

  const ctx: HandlerCtx = { user, userId: userData.user.id, origin, requestId, startedAt };
  switch (body.action) {
    case 'edit':
      return handleEdit(body, ctx);
    case 'suggest':
      return handleSuggest(body, ctx);
    case 'ground':
      return handleGround(body, ctx);
    default:
      // Unreachable: the discriminated union admits exactly the three
      // actions above. Kept as a runtime guard (and so the app tsconfig,
      // which can't resolve the zod URL import, still sees a total function).
      return errorResponse('invalid_input', 'Unknown action', 400, origin);
  }
}

Deno.serve(handler);
