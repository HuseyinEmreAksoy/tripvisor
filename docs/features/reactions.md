# Place reactions

**Status**: 🚧 In progress
**Owner agents**: ui-specialist, backend-specialist
**Depends on**: Trip collaboration (Phase 21 — `user_can_access_trip` SQL helper required for RLS)

## Platforms verified
- ☐ iOS
- ☐ Android
- ☐ Web
(Smoke and automated tests deferred per user direction on 2026-04-26.)

## User story
As a trip planner (or collaborator), I want to mark places I liked or didn't like with a simple thumbs-up / thumbs-down control, so that I can quickly build a personal catalog of favorites and avoid re-visiting places I didn't enjoy.

## UI

### Screens
- **Itinerary tab** (`app/(app)/trip/[id]/index.tsx` — `PlaceRow`): small `ReactionChip` (size `sm`, 36 px) on the right side of each place row.
- **Place detail** (`app/(app)/place/[placeId].tsx`): large `ReactionChip` (size `lg`, 48 px with label text) shown when the screen is reached with `tripPlaceId` + `tripId` query params; hidden otherwise (direct place-search usage).
- **Settings tab** (`app/(app)/trip/[id]/index.tsx` — `SettingsTab`): two catalog sections "You liked" and "You didn't like", each listing place names with `Day N · #M` positions. Sections are hidden when empty. Tap navigates to place detail.

### Key interactions
- Tapping the thumbs-up or thumbs-down button sets the reaction and highlights the active button with the day-color tint.
- Tapping the active button a second time clears the reaction (toggle to null / DELETE the row).
- Reaction chip is in its own `Pressable` region; it does not propagate to the row's existing `onPress` (which opens place detail).

### Component
`src/components/ReactionChip.tsx` — single cross-platform component (no `.native`/`.web` split).

### Platform differences
None. The component uses React Native primitives only, which compile identically on all three platforms.

## Data

### Tables touched
- `trip_place_reactions` (new in Phase 24, migration `0017_trip_place_reactions.sql`)

### Schema

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk` | `gen_random_uuid()` |
| `trip_place_id` | `uuid fk trip_places` | cascade on delete |
| `user_id` | `uuid fk auth.users` | cascade on delete |
| `reaction` | `text` | CHECK IN (`liked`, `disliked`) |
| `created_at` | `timestamptz` | `now()` |
| `updated_at` | `timestamptz` | maintained by `set_updated_at` trigger |

**Unique constraint**: `(trip_place_id, user_id)` — one active reaction per user per place.

### Multi-user model
Each collaborator has their own row. A viewer-collaborator can SELECT all reactions for the trips they can access but can only INSERT/UPDATE/DELETE rows where `user_id = auth.uid()`. This enables future cross-collaborator reaction UIs without a schema change.

### RLS
- **SELECT**: `user_can_access_trip(trip_places.trip_id, auth.uid(), 'viewer')` via a join through `trip_places.trip_id`.
- **INSERT / UPDATE / DELETE**: `user_id = auth.uid()` AND viewer-level access on the parent trip.

## APIs

### Edge Functions called
None — reactions are written directly to Supabase via the JS client (no proxy needed; no Google data involved).

### Client API (`src/api/trip-place-reactions.ts`)
- `useTripPlaceReaction(tripPlaceId, userId)` — single row query.
- `useTripReactions(tripId)` — all reactions for a trip (Settings catalog + analytics).
- `useAllUserReactions()` — all reactions for the current user across all trips (analytics).
- `useSetTripPlaceReaction()` — upsert mutation; `onConflict: 'trip_place_id,user_id'`; `null` reaction triggers DELETE. Optimistic update + rollback on error.

Query keys in `src/api/_keys.ts` as `tripPlaceReactionsKeys`.

## Edge cases

- **Collaborator reacts to a shared trip**: each collaborator has their own row; reactions are independent. A viewer can react but cannot edit the trip's places.
- **Un-rating**: passing `reaction: null` to `useSetTripPlaceReaction` issues a DELETE, not a null update. The optimistic cache removes the row; rollback reinstates it if the DELETE fails.
- **Place deleted**: `ON DELETE CASCADE` on `trip_place_id` removes all reactions for that place automatically.
- **Trip deleted**: cascades through `trip_places` to `trip_place_reactions`.
- **Place reached without `tripPlaceId`**: the ReactionChip on the place detail screen is hidden; no hook is called.
- **Non-member attempts to write**: RLS blocks at the DB level; the client mutation returns a 403-equivalent error; no optimistic update is persisted.

## Test plan
Deferred per user direction on 2026-04-26 (same policy as Phases 21–23).

When executed:
- **Unit**: `useSetTripPlaceReaction` optimistic rollback on error; query key invalidation hits `forTripPlace`, `forTrip`, `mine`.
- **Component**: `ReactionChip` renders all three states (liked / disliked / null); tap on active state calls `onChange(null)`; hit area does not propagate to parent Pressable.
- **Integration / RLS**: two-user test — viewer can SELECT but only owner/editor rows where `user_id = auth.uid()` are writable; non-member SELECT returns empty.
- **Manual native smoke (iOS + Android)**: reactions persist across navigation; Settings catalog sections appear/disappear correctly.

## Known limitations
- Cross-collaborator reaction visibility (e.g., "your travel partner liked this too") is not surfaced in the UI. The data layer supports it (`useTripReactions` returns all users' rows). Deferred to Phase 25+.
- Reaction data is not included in the JSON account export (Phase 10). Adding it requires a Phase 25+ follow-up.
