# Phase 9 — Pre-exit review

**Date**: 2026-04-25
**Reviewer**: `reviewer` sub-agent (read-only)
**Scope**: Uncommitted Phase 9 diff per planner Step 9.7 — per-place notes editor, per-day notes, in-repo Markdown renderer, M2 mutation cleanup.

## Summary

- **RLS / authorization**: clean. `notes` is an additive nullable column on `public.trip_days`; the existing `trip_days_via_trip` policy gates rows via the parent `trips.user_id` and inherits to new columns automatically. `useUpdateTripDay` threads `trip_id` through the upsert payload (defense-in-depth).
- **Markdown XSS surface**: clean. No `dangerouslySetInnerHTML` in `MarkdownText.tsx` or `render.ts`. Protocol allow-list (`https://`, `http://`, `mailto:`) is case-insensitive (lower-cased before comparison) and `trimStart()`-aware. Adversarial inputs (`javascript:`, `JaVaScRiPt:`, `data:`, `**unbalanced`, `[unclosed`, nested `**bold *italic*`) all degrade to literal text or harmlessly malformed output — no path emits an unvalidated href.
- **Tokenizer perf**: linear-pass character walker. Only regex is `/^\d+\.\s/` (anchored, bounded; no nested quantifiers).
- **M2 closure**: confirmed. `commitBudget` / `commitMode` no longer call `supabase.from(...)` directly; both go through `useUpdateTrip(tripId).mutate(...)` which invalidates `tripsKeys.detail(tripId)` and `tripsKeys.all`.
- **Debounce timer cleanup**: `useDebouncedCallback` clears its timer in a `useEffect` cleanup. `PlaceNotesEditor` and `DayNotesEditor` both consume it.
- **PII in logs**: clean. `console.*` returns zero hits across `src/lib/markdown/`, `src/components/MarkdownText.tsx`, `src/api/trip-days.ts`, the trip detail screen, and the print page.
- **`useUpdateTripPlace` reuse**: confirmed. Step 9.4 reuses the existing mutation.
- **`duplicate_trip` consistency**: per planner spec, `trip_days.notes` intentionally NOT cloned (the RPC clones only `trip_places`). Consistent with ADR-0006.
- **Cross-platform**: `TextInput multiline` works on iOS / Android / Web; `Linking.openURL` works on all three; no platform splits required.

## Critical findings

**None.**

## High findings

**None.**

## Medium findings

**None.**

## Low findings

### L1 — `dangerouslySetInnerHTML` in `print.tsx` (pre-existing, not Phase 9)
- **Severity**: low (informational)
- **Location**: `app/(app)/trip/[id]/print.tsx`
- **Observation**: Phase 8's `<style dangerouslySetInnerHTML={{ __html: css }} />` injects a hardcoded CSS template literal with no user-input interpolation. Safe. False-positive for Phase 9 grep.
- **Disposition**: Not Phase 9 scope.

### L2 — Italic tokenizer matches across whitespace boundaries
- **Severity**: low
- **Category**: correctness (UX polish)
- **Location**: `src/lib/markdown/render.ts`
- **Observation**: An input like `**bold *italic*` (unclosed bold, opens italic mid-stream) renders the `*` after `bold` as italic-open and matches the `*` before `italic` as italic-close. Stylistic quirk, not a security issue. CommonMark proper would re-balance differently, but ADR-0008 explicitly chose a closed minimal grammar.
- **Disposition**: Park. Document in ADR-0008 follow-up if needed.

### L3 — `MarkdownText` `style` prop typed as `any`
- **Severity**: low
- **Category**: type safety
- **Location**: `src/components/MarkdownText.tsx`
- **Observation**: `style?: any` with eslint-disable. Tightening to `StyleProp<TextStyle>` would surface correct typing at every consumer site.
- **Disposition**: Park; quick fix on next touch.

### L4 — `useDebouncedCallback` does not flush on unmount
- **Severity**: low
- **Category**: correctness (UX edge case)
- **Location**: `src/lib/hooks/useDebouncedCallback.ts`
- **Observation**: Cleanup cancels the pending timer rather than flushing it. If a user types and immediately navigates away within 500ms, the last keystrokes are silently dropped. This is the safer default — a flush could fire a mutation against a torn-down query client.
- **Disposition**: Park. Consider `onBlur` flushing on `TextInput` in a future polish phase.

### L5 — `dayNotesIndex` Map rebuilt on every TanStack refetch
- **Severity**: low
- **Category**: perf nit
- **Location**: `app/(app)/trip/[id]/index.tsx`, `app/(app)/trip/[id]/print.tsx`
- **Observation**: TanStack Query returns a new array reference on every refetch even if data is identical, so the `Map` rebuilds unnecessarily. Negligible at typical day counts (≤14). Same pattern as existing `byDay` / `byId`.
- **Disposition**: Park.

## Sign-off

**SHIP.**

No critical, high, or medium findings. The Markdown XSS boundary is sound (allow-list is case-insensitive, whitespace-tolerant, and the failing branch correctly emits literal text). RLS inheritance on `trip_days.notes` is verified. `useUpdateTripDay` threads `trip_id` for defense-in-depth and invalidates both `tripDaysKeys.forTrip` and `tripsKeys.detail`. M2 is closed. Debounce cleanup is centralized and reused.

## Files referenced

- `supabase/migrations/0006_trip_day_notes.sql`
- `supabase/migrations/0001_init.sql` (RLS cross-ref)
- `src/api/trip-days.ts`
- `src/api/trips.ts`
- `src/api/trip-places.ts`
- `src/api/types.ts`
- `src/lib/markdown/render.ts`
- `src/components/MarkdownText.tsx`
- `src/lib/hooks/useDebouncedCallback.ts`
- `app/(app)/trip/[id]/index.tsx`
- `app/(app)/trip/[id]/print.tsx`
- `docs/adr/0008-notes-markdown-renderer.md` (decision reference)
- `docs/reviews/phase-8.md` (format reference)
