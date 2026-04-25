# notes-journal

**Status**: ✅ Done (Web). Native deferred to user smoke.
**Owner agents**: ui-specialist, backend-specialist
**Depends on**: trip-crud, manual-edit (trip_places.notes already existed from Phase 3)
**Shipped on**: 2026-04-25 — Phase 9

## Platforms verified
- ☐ iOS — deferred to user smoke
- ☐ Android — deferred to user smoke
- ☑ Web — visual smoke confirmed 2026-04-25 (place notes editor, day notes editor, print page Markdown rendering)

## Intent
Turn the previously unused `trip_places.notes` column into a real journal surface, add a new per-day notes field on `trip_days`, and render both through a closed Markdown subset on the print page. Bundles the M2 mutation cleanup from the Phase 8 review: `commitBudget` and `commitMode` on the trip detail screen now go through `useUpdateTrip` instead of bypassing TanStack Query via raw Supabase calls.

## Scope
- Per-place notes editor: inline on each `PlaceRow` of the trip detail screen. Debounced 500ms write. Show-more/show-less toggle for notes longer than 120 characters.
- Per-day notes editor: collapsible section between `DaySummaryCard` and `DraggableItinerary` for each day. Default-collapsed. Debounced 500ms write.
- In-repo Markdown renderer (`src/lib/markdown/render.ts` + `src/components/MarkdownText.tsx`): renders both note types on the print page with no new library dependency.
- Print page integration: `app/(app)/trip/[id]/print.tsx` passes `place.notes` and `day.notes` through `<MarkdownText>` instead of plain `<Text>`.
- M2 closure: `UpdateTripPatch` widened to include `daily_hours_budget` and `transport_mode`; `commitBudget`/`commitMode` callers migrated to `useUpdateTrip(tripId).mutate(...)`.

## Markdown subset
Supported constructs (everything else falls through as literal text):

| Syntax | Output |
|---|---|
| `**bold**` | Bold text |
| `*italic*` | Italic text |
| `- item` | Unordered list item |
| `1. item` | Ordered list item |
| `[text](url)` | Hyperlink |

Protocol allow-list for links: `https://`, `http://`, `mailto:`. Any other scheme (e.g. `javascript:`, `data:`) renders as literal text. The allow-list check is case-insensitive and `trimStart()`-aware. See [ADR-0008](../adr/0008-notes-markdown-renderer.md) for the rationale for an in-repo subset over a third-party library.

## Data model
Migration: `supabase/migrations/0006_trip_day_notes.sql`

New column on `public.trip_days`:

| Column | Type | Nullable | Default |
|---|---|---|---|
| `notes` | `text` | yes | `null` |

No new tables. No RLS changes — the existing `trip_days_via_trip` policy (scoped via `trips.user_id`) inherits to the new column automatically.

`trip_places.notes text` already existed from Phase 3 and is unchanged.

Note on `duplicate_trip`: per ADR-0006, the RPC clones only `trip_places` rows. `trip_days.notes` is intentionally not cloned — per-day notes belong to the source trip's specific run of the optimizer.

## API surface
- `src/api/trip-days.ts` (new) — `tripDaysKeys`, `useTripDays(tripId)`, `useUpdateTripDay()`. Mutation accepts `{ id, trip_id, day_index, notes }` and upserts on `(trip_id, day_index)`. Zod-validated: `notes: z.string().max(2000).nullish()`. On success invalidates `tripDaysKeys.forTrip(trip_id)` and `tripsKeys.detail(tripId)`.
- `src/api/trips.ts` — `UpdateTripPatch` widened with `daily_hours_budget` and `transport_mode` (M2 closure).
- `src/api/types.ts` — `TripDay.notes: string | null`.
- `src/api/index.ts` — re-exports `./trip-days`.
- `useUpdateTripPlace` (pre-existing, Phase 3) — reused for per-place notes writes; no changes needed.

## UX
- 2000-character cap on all notes fields (enforced via `maxLength={2000}` on `TextInput` and Zod on the API layer).
- 500ms debounce on all writes; timer cancelled (not flushed) on unmount via `src/lib/hooks/useDebouncedCallback.ts`.
- Per-place: notes > 120 chars are truncated to the first 120 + ellipsis when not focused; a "Show more" / "Show less" toggle expands/collapses. State is component-local and resets on navigation.
- Per-day: collapsed by default; pressing the section header expands to a full multi-line `TextInput` with placeholder "Add notes for this day" when empty.
- Empty string saves as `null`.

## Security
- No `dangerouslySetInnerHTML` anywhere in the renderer or its consumers. Links on web use React-escaped attributes; on native `Linking.openURL` handles opening.
- Protocol allow-list prevents `javascript:` and `data:` URL injection via Markdown link syntax.
- Tokenizer is a linear-pass character walker; the only regex (`/^\d+\.\s/`) is anchored and bounded — no nested unbounded quantifiers, no backtracking risk.

## Open follow-ups
See `docs/reviews/phase-9.md` for full reviewer findings. All are low severity and parked:

- **L1** — Pre-existing `<style dangerouslySetInnerHTML>` in `print.tsx` (Phase 8 CSS injection; hardcoded template literal, no user input — informational only).
- **L2** — Italic tokenizer matches across unbalanced bold markers (cosmetic quirk; ADR-0008 explicitly chose a closed grammar).
- **L3** — `MarkdownText` `style` prop typed as `any`; tighten to `StyleProp<TextStyle>` on next touch.
- **L4** — `useDebouncedCallback` cancels on unmount rather than flushing; last keystroke within the debounce window may be lost on rapid navigation.
- **L5** — `dayNotesIndex` Map rebuilt on every TanStack refetch (negligible at typical day counts).
