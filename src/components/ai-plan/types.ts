/**
 * Shared types for the AI "Plan my trip" flow (v2 Phase N3, steps 3.4 + 3.5).
 *
 * Lives in its own file because both the review UI (src/components/ai-plan/)
 * and the commit orchestration hook (src/hooks/useAiDraftCommit.ts) need the
 * commit payload shape — a type-only module avoids a runtime dependency in
 * either direction.
 */

/**
 * One AI-draft place plus the user's review-screen edits. `localId` is the
 * stable list identity — `googlePlaceId` alone can repeat when the LLM
 * suggests the same place twice (e.g. a market visited on two days).
 */
export interface DraftPlaceEdit {
  localId: string;
  name: string;
  googlePlaceId: string;
  lat: number;
  lng: number;
  /** Editable visit-time estimate, kept within the server's 15..480 range. */
  visitMinutes: number;
  category: string | null;
  /** 1-based day assignment shown in review; clamped to 1..dayCount. */
  dayHint: number;
  /** false = removed from the draft (renders dimmed; restorable). */
  kept: boolean;
}

/** A kept place, ready to commit (DraftPlaceEdit minus the review-only fields). */
export interface DraftCommitPlace {
  name: string;
  googlePlaceId: string;
  lat: number;
  lng: number;
  visitMinutes: number;
  category: string | null;
  /** 1-based; the commit layer converts to 0-based `day_index` and clamps. */
  dayHint: number;
}

/** What the review screen hands back when the user accepts the draft. */
export interface DraftCommitPayload {
  /** Trip title, trimmed, 1..120 chars (validated by the review screen). */
  title: string;
  places: DraftCommitPlace[];
}
