/**
 * Shared types for the "AI edit" diff flow (v2 Phase N4, step 4.1).
 *
 * Mirrors src/components/ai-plan/types.ts: a type-only module shared by the
 * diff-preview UI (src/components/ai-edit/AiEditSheet.tsx) and the apply/undo
 * orchestration hook (src/hooks/useAiEditApply.ts) — no runtime dependency in
 * either direction.
 */
import type { AiDraftPlace, Uuid } from '@/api';

/**
 * One user-approved change from an `AiEditDiff`, ready to commit through the
 * normal trip-places mutations. Day numbers inside (`place.dayHint`, `toDay`)
 * are 1-BASED — the AI-surface convention — and the apply layer converts to
 * 0-based `trip_places.day_index` with `-1` (exactly like useAiDraftCommit).
 */
export type AiEditOp =
  | { kind: 'add'; place: AiDraftPlace }
  | { kind: 'remove'; tripPlaceId: Uuid; name: string }
  | { kind: 'move'; tripPlaceId: Uuid; name: string; toDay: number }
  | { kind: 'duration'; tripPlaceId: Uuid; name: string; visitMinutes: number };
