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
 * Typed error thrown by the AI hooks (`useGenerateItinerary` and the N4
 * `useAiEditTrip` / `useAiSuggest` / `useGroundPlaces`) when the
 * `ai-itinerary` / `ai-edit` Edge Functions return the structured
 * `{ error: { code, message } }` envelope. Mirrors `OptimizeError` /
 * `PlacesError` (Phase 20 Step 6 hierarchy). Both functions share one
 * deliberately-closed code set.
 *
 * Known codes (mirrors `supabase/functions/ai-itinerary/index.ts` and
 * `supabase/functions/ai-edit/index.ts`):
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

// ============================================================
// AI editing / suggestions / import grounding (v2 Phase N4)
// ============================================================
//
// Client wrappers for the `ai-edit` Edge Function (action-discriminated
// body: 'edit' | 'suggest' | 'ground'). Every action is PREVIEW-ONLY on the
// server — no trip data is written — so none of these mutations invalidate
// any query key: the preview UI owns the result and commits accepted
// changes through the normal trip-places hooks (which invalidate
// themselves).
//
// Day-number conventions (mirrors supabase/functions/ai-edit/README.md):
//   - INPUT  `AiSuggestInput.dayIndex` is the 0-based `trip_places.day_index`
//     (what the itinerary screen has in hand).
//   - OUTPUT `dayHint` / `toDay` are 1-BASED — the same convention as
//     `AiDraftPlace.dayHint` from `ai-itinerary`; the commit layer converts
//     to 0-based `day_index` (exactly like the N3 draft review does).

/** One reviewable removal inside an AI edit diff (name echoed server-side). */
export interface AiEditDiffRemove {
  tripPlaceId: Uuid;
  name: string;
}

/** One reviewable day-move inside an AI edit diff. `toDay` is 1-based. */
export interface AiEditDiffMove {
  tripPlaceId: Uuid;
  name: string;
  toDay: number;
}

/** One reviewable visit-duration change inside an AI edit diff. */
export interface AiEditDiffDurationChange {
  tripPlaceId: Uuid;
  name: string;
  /** New visit duration, validated server-side to 15..480 minutes. */
  visitMinutes: number;
}

/**
 * The previewable diff returned by `ai-edit` action 'edit'. Server-side
 * guarantees: every `tripPlaceId` referenced an existing place of the trip
 * at preview time (unknown LLM ids are dropped, never invented); no-op
 * moves/duration changes are pruned; `adds` are grounded `AiDraftPlace`s
 * (max 10, never duplicating a place already in the trip). An all-empty
 * diff is a VALID result ("nothing to change") — render `notes` and offer
 * retry, don't treat it as an error.
 */
export interface AiEditDiff {
  adds: AiDraftPlace[];
  removes: AiEditDiffRemove[];
  moves: AiEditDiffMove[];
  durationChanges: AiEditDiffDurationChange[];
  /** Optional one-line LLM summary of the change (or null). */
  notes: string | null;
}

export interface AiEditTripInput {
  /** Trip to edit; must be visible to the caller (RLS-checked server-side). */
  tripId: Uuid;
  /** Natural-language edit instruction, 5..1000 chars (the only free text sent to the LLM). */
  instruction: string;
  /**
   * Idempotency key (8..64 chars). Auto-generated per `mutate()` call when
   * omitted. "Try again" UX should generate ONE key per edit intent and pass
   * it on every retry: if the previous attempt completed server-side, the
   * retry replays the stored diff for free (zero LLM/grounding re-billing).
   */
  idempotencyKey?: string;
}

export interface AiEditResult {
  /** `trip_ai_runs.id` of this run (kind 'edit'; stable across replays). */
  runId: Uuid;
  /** `'partial'` = some proposed adds couldn't be grounded (`unresolved`). */
  status: AiRunStatus;
  diff: AiEditDiff;
  /** Add-names Google couldn't ground — surface for user fix-up, never drop. */
  unresolved: string[];
  usage: AiUsage;
}

/**
 * Mutation hook for `ai-edit` action `'edit'` — a natural-language edit
 * returned as a PREVIEWABLE DIFF (accept/reject in the UI; nothing is
 * written server-side). Counts against the shared 10-runs/day AI quota
 * (`quota_exceeded`, 429). Transient failures (`llm_failed` 502 /
 * `upstream_timeout` 504) persist nothing — retrying with the SAME
 * idempotency key is always safe and replays for free once a run has
 * succeeded. Deliberately NO query invalidation (preview only).
 */
export function useAiEditTrip() {
  return useMutation<AiEditResult, AiError | Error, AiEditTripInput>({
    mutationFn: async (input) => {
      const body = {
        action: 'edit' as const,
        tripId: input.tripId,
        instruction: input.instruction,
        idempotencyKey: input.idempotencyKey ?? makeIdempotencyKey(),
      };
      const { data, error } = await supabase.functions.invoke<AiEditResult>('ai-edit', { body });
      if (error) {
        const typed = await tryParseEdgeFunctionError(error, AiError);
        if (typed) throw typed;
        throw error;
      }
      if (!data) throw new Error('ai-edit returned no data');
      return data;
    },
  });
}

export interface AiSuggestInput {
  /** Trip to suggest for; must be visible to the caller. */
  tripId: Uuid;
  /** 0-based `trip_places.day_index` of the day to fill. */
  dayIndex: number;
  /** Spare minutes to fill, 30..480 (suggestions never exceed this). */
  slackMinutes: number;
  /** Same semantics as {@link AiEditTripInput.idempotencyKey}. */
  idempotencyKey?: string;
}

export interface AiSuggestResult {
  /** `trip_ai_runs.id` of this run (kind 'suggest'; stable across replays). */
  runId: Uuid;
  status: AiRunStatus;
  /**
   * 0–4 grounded fill-in places with `dayHint = dayIndex + 1` (1-based).
   * An EMPTY array is a valid honest result ("nothing fits the slack").
   */
  suggestions: AiDraftPlace[];
  /** Proposed names Google couldn't ground. */
  unresolved: string[];
  usage: AiUsage;
}

/**
 * Mutation hook for `ai-edit` action `'suggest'` — 2–4 grounded gap-fill
 * places for one day's spare minutes. Counts as a run against the shared
 * 10-runs/day quota. Same idempotency/retry semantics as `useAiEditTrip`
 * (hold one key per intent for "try again" UX; transient 502/504 persist
 * nothing, success replays free). NO query invalidation — the suggestions
 * are a preview; adding one goes through the normal add-place mutation.
 */
export function useAiSuggest() {
  return useMutation<AiSuggestResult, AiError | Error, AiSuggestInput>({
    mutationFn: async (input) => {
      const body = {
        action: 'suggest' as const,
        tripId: input.tripId,
        dayIndex: input.dayIndex,
        slackMinutes: input.slackMinutes,
        idempotencyKey: input.idempotencyKey ?? makeIdempotencyKey(),
      };
      const { data, error } = await supabase.functions.invoke<AiSuggestResult>('ai-edit', { body });
      if (error) {
        const typed = await tryParseEdgeFunctionError(error, AiError);
        if (typed) throw typed;
        throw error;
      }
      if (!data) throw new Error('ai-edit returned no data');
      return data;
    },
  });
}

/** One import name resolved to a real place (ToS-durable fields only). */
export interface GroundedPlace {
  /** Canonical Google displayName — may differ from the pasted input name. */
  name: string;
  googlePlaceId: string;
  lat: number;
  lng: number;
}

/** Per-user daily grounding budget echoed by the `ground` action. */
export interface GroundingUsage {
  /** Google-metered grounding calls so far today (shared across AI features). */
  groundingToday: number;
  /** 100/day — the import grounding budget (NOT the 10-runs AI quota). */
  dailyLimit: number;
}

export interface GroundPlacesInput {
  /** 1..30 place names to ground, each 2..120 chars (pasted list / Takeout-extracted). */
  names: string[];
  /** Optional location bias, e.g. the trip destination ("Louvre, Paris" beats "Louvre"). */
  destination?: string;
  /** Same semantics as {@link AiEditTripInput.idempotencyKey}. */
  idempotencyKey?: string;
}

export interface GroundPlacesResult {
  /** `trip_ai_runs.id` of this run (kind 'ground'; stable across replays). */
  runId: Uuid;
  /** Grounded places, deduped by place id (two inputs can hit one place). */
  resolved: GroundedPlace[];
  /** Input names that couldn't be grounded — surface for user fix-up. */
  unresolved: string[];
  usage: GroundingUsage;
}

/**
 * Mutation hook for `ai-edit` action `'ground'` — LLM-FREE grounding of a
 * pasted/imported names list (import feature; results feed the Ideas
 * bucket via the normal add-place mutations). Does NOT consume an AI run;
 * it is budgeted against a separate 100-grounded-names/day allowance
 * (`quota_exceeded` 429 when the whole batch wouldn't fit — the message
 * says how much is used). Same idempotency/retry semantics as the other
 * AI hooks: transient `upstream_timeout` (504) persists nothing, a
 * successful run replays free on the same key. NO query invalidation.
 */
export function useGroundPlaces() {
  return useMutation<GroundPlacesResult, AiError | Error, GroundPlacesInput>({
    mutationFn: async (input) => {
      const body = {
        action: 'ground' as const,
        names: input.names,
        ...(input.destination ? { destination: input.destination } : {}),
        idempotencyKey: input.idempotencyKey ?? makeIdempotencyKey(),
      };
      const { data, error } = await supabase.functions.invoke<GroundPlacesResult>('ai-edit', {
        body,
      });
      if (error) {
        const typed = await tryParseEdgeFunctionError(error, AiError);
        if (typed) throw typed;
        throw error;
      }
      if (!data) throw new Error('ai-edit returned no data');
      return data;
    },
  });
}
