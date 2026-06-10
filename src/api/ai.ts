import { useMutation } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { Uuid } from './types';
import { EdgeFunctionError, tryParseEdgeFunctionError } from './_errors';

// ============================================================
// AI itinerary generation (v2 Phase N3 — "Plan my trip")
// ============================================================
//
// Client wrapper for the `ai-itinerary` Edge Function. The function returns
// a DRAFT — it never writes trip_places — so this mutation invalidates
// NOTHING: the draft-review screen owns the result and commits accepted
// places through the normal trip-places hooks (which invalidate themselves).
//
// Works identically on iOS / Android / Web: `supabase.functions.invoke`
// rides the shared Supabase client (secure-store sessions on native,
// localStorage on web) with no per-platform branching.

/**
 * One grounded place inside an AI draft.
 *
 * `name` is the canonical Google displayName (falls back to the LLM's
 * proposed name) so the review screen exposes wrong groundings. `lat`/`lng`
 * come from Google place-details — LLM coordinates are never used.
 * `dayHint` is the LLM's 1-based day suggestion, clamped server-side to
 * `1..dayCount`; the optimizer produces the final day split on commit.
 */
export interface AiDraftPlace {
  name: string;
  googlePlaceId: string;
  lat: number;
  lng: number;
  /** LLM visit-time estimate, validated server-side to 15..480 minutes. */
  visitMinutes: number;
  category: string | null;
  dayHint: number;
}

/**
 * The staged draft returned by `ai-itinerary` (also persisted server-side in
 * `trip_ai_runs.draft` for idempotent replay). `unresolved` lists LLM place
 * names Google could not ground — the review screen must surface them
 * ("couldn't find these N places") for user fix-up; they are never silently
 * dropped. ToS note: every field here is durable-safe (names + place id +
 * coordinates only — no ratings/reviews/photos/hours).
 */
export interface AiDraft {
  places: AiDraftPlace[];
  unresolved: string[];
  /** Optional trip-level note from the LLM (e.g. pacing advice). */
  notes: string | null;
  dayCount: number;
}

/** Per-user daily usage echoed by the Edge Function (UTC day buckets). */
export interface AiUsage {
  runsToday: number;
  dailyLimit: number;
}

/** `'partial'` = some names unresolved (`draft.unresolved.length > 0`). */
export type AiRunStatus = 'ok' | 'partial';

export interface GenerateItineraryInput {
  /** Free-text trip request, 10..2000 chars (the only user text sent to the LLM). */
  prompt: string;
  /** Optional trip to associate the run with; must be visible to the caller. */
  tripId?: Uuid;
  /** Desired day count, 1..14. Omitted = the LLM infers it from the prompt. */
  days?: number;
  /** Destination used for LLM context + grounding location bias (max 120 chars). */
  destination?: string;
  /**
   * Idempotency key (8..64 chars). Auto-generated per `mutate()` call when
   * omitted. Callers building "try again" UX should generate ONE key per
   * planning intent and pass it on every retry: if the previous attempt
   * actually completed server-side (e.g. the client timed out waiting), the
   * retry replays the stored draft for free instead of double-billing the
   * LLM + Google grounding quota.
   */
  idempotencyKey?: string;
}

export interface GenerateItineraryResult {
  /** `trip_ai_runs.id` of this run (stable across idempotent replays). */
  runId: Uuid;
  status: AiRunStatus;
  draft: AiDraft;
  usage: AiUsage;
}

/**
 * Typed error thrown by `useGenerateItinerary` when the `ai-itinerary` Edge
 * Function returns the structured `{ error: { code, message } }` envelope.
 * Mirrors `OptimizeError` / `PlacesError` (Phase 20 Step 6 hierarchy).
 *
 * Known codes (mirrors `supabase/functions/ai-itinerary/index.ts`):
 *   - `invalid_input`      — 400 — body failed validation, or tripId not visible
 *   - `not_authenticated`  — 401 — missing / invalid JWT
 *   - `method_not_allowed` — 405 — non-POST request
 *   - `quota_exceeded`     — 429 — daily plan limit reached (quota-exhausted UX;
 *                                   resets at midnight UTC)
 *   - `ai_misconfigured`   — 500 — server is missing LLM and/or Google keys
 *   - `db_error`           — 500 — Postgres failure
 *   - `llm_failed`         — 502 — both LLM providers failed; transient, retry
 *   - `upstream_timeout`   — 504 — grounding transport failure; transient, retry
 *                                   (nothing persisted — same key is safe to reuse)
 *
 * Network-only failures (no envelope) fall through as the original `Error`
 * from `supabase.functions.invoke` — the mutation error type is
 * `AiError | Error`.
 */
export class AiError extends EdgeFunctionError {
  constructor(code: string, message: string, status: number) {
    super(code, message, status);
    this.name = 'AiError';
  }
}

// crypto.randomUUID() is available in Expo SDK 52+ (Hermes global) and on
// web; the fallback covers any environment where it isn't (mirrors
// makeSessionToken in AccommodationEditSheet). The fallback comfortably
// satisfies the server's 8..64-char constraint.
function makeIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to fallback
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Mutation hook invoking the `ai-itinerary` Edge Function.
 *
 * Follows the `useOptimizeTrip` invoke pattern (`supabase.functions.invoke`
 * + `tryParseEdgeFunctionError`). Deliberately NO query invalidation: the
 * function writes only its own audit row (`trip_ai_runs`) and the usage
 * ledger — no trip-scoped cache is stale after a run. The returned draft is
 * handed to the draft-review screen; committing it goes through the normal
 * trip-places mutations.
 */
export function useGenerateItinerary() {
  return useMutation<GenerateItineraryResult, AiError | Error, GenerateItineraryInput>({
    mutationFn: async (input) => {
      const body = {
        prompt: input.prompt,
        ...(input.tripId ? { tripId: input.tripId } : {}),
        ...(input.days !== undefined ? { days: input.days } : {}),
        ...(input.destination ? { destination: input.destination } : {}),
        idempotencyKey: input.idempotencyKey ?? makeIdempotencyKey(),
      };
      const { data, error } = await supabase.functions.invoke<GenerateItineraryResult>(
        'ai-itinerary',
        { body },
      );
      if (error) {
        const typed = await tryParseEdgeFunctionError(error, AiError);
        if (typed) throw typed;
        throw error;
      }
      if (!data) throw new Error('ai-itinerary returned no data');
      return data;
    },
  });
}
