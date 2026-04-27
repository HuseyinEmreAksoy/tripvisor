# trip-lifecycle

**Status**: ✅ Done (Web). Native deferred to user smoke.
**Owner agents**: backend-specialist, ui-specialist
**Depends on**: trip-crud
**Shipped on**: 2026-04-25 — commit a2a24e3 (Phase 7). Phase 25 (2026-04-26): duplicate kebab now navigates to the new trip's detail screen via `useDuplicateTrip().mutateAsync` + `router.push`.

## Platforms verified
- ☐ iOS — deferred to user smoke
- ☐ Android — deferred to user smoke
- ☑ Web — visual smoke confirmed 2026-04-25

## User story
As a trip planner, I want to archive trips I am not actively working on, duplicate a trip as a starting point for a new itinerary, and permanently delete trips I no longer need, so that my active trips list stays clean without losing data I might want to revisit.

## UI
- Screen(s): `app/(app)/trips.tsx` (trips list) and `src/components/TripCard.tsx` (per-card overflow).
- Key interactions:
  - TripCard overflow trigger (three-dot icon, `accessibilityLabel="Trip actions"`) opens `src/components/TripActionsSheet.tsx` (bottom sheet).
  - Sheet actions: Archive (or Unarchive if already archived), Duplicate, Delete (destructive).
  - Active / Archived segmented control at the top of the trips list switches the `useTrips({ archived })` filter.
  - Archived trips show an inline "Archived" `StatusPill` when viewed in the Archived tab.
  - `BottomSheet.web.tsx` uses `position: 'fixed'` so the sheet covers the full viewport on web.
- Platform differences: `BottomSheet.native.tsx` / `BottomSheet.web.tsx` are platform-split (pre-existing). No new native-only surface introduced.

## Data
- Tables touched: `public.trips`
- New columns: `archived_at timestamptz nullable default null` on `public.trips`
- New index: `trips_user_active_idx` — `create index if not exists trips_user_active_idx on public.trips(user_id) where archived_at is null` (partial, keeps the default-list query fast)
- New RPCs:
  - `public.duplicate_trip(p_trip_id uuid) returns uuid` — security definer; verifies `auth.uid() = trips.user_id`; inserts new trip row (`title || ' (copy)'`, `archived_at = null`, `anchor_place_id = null`); bulk-inserts cloned `trip_places` rows (copies `google_place_id`, `lat`, `lng`, `user_title`, `category`, `visit_duration_minutes`, `notes`; does NOT copy `day_index` / `order_in_day`); does NOT clone `trip_legs` or `trip_days`; returns new trip id.
  - `public.delete_account_cascade() returns void` — security definer; deletes all `public.trips` rows for `auth.uid()` (cascade covers child tables). Called server-side by the `delete-account` Edge Function, not directly by the client. See open follow-up L4.
- RLS: no new policies needed; existing `trips` policy gates by `auth.uid() = user_id`; `archived_at` is a column on the already-gated table.
- Migration: `supabase/migrations/0004_trip_lifecycle.sql`
- ADR: [ADR-0006 — trip-duplicate semantics](../adr/0006-trip-duplicate-semantics.md)

## APIs
- Client mutations (all in `src/api/trips.ts`):
  - `useArchiveTrip()` — sets `archived_at = now()` via `.update({ archived_at: new Date().toISOString() })`; invalidates `['trips', 'list', { archived: false }]`.
  - `useUnarchiveTrip()` — sets `archived_at = null`; invalidates `['trips', 'list', { archived: true }]`.
  - `useDuplicateTrip()` — calls `.rpc('duplicate_trip', { p_trip_id })` → returns new trip id; invalidates `['trips', 'list', { archived: false }]`.
  - `useDeleteTrip()` — hard delete; invalidates both list cache keys.
- Query: `useTrips({ archived: boolean })` — filters via `.is('archived_at', null)` (active) or `.not('archived_at', 'is', null)` (archived). Default is `archived: false`. Query key: `['trips', 'list', { archived }]`; Active and Archived caches are independent.
- Type: `Trip` in `src/api/types.ts` widened with `archived_at: string | null`.
- Edge Function: `delete-account` (see `docs/features/settings.md`).

## Edge cases
- Duplicate of an archived trip: new trip is always `archived_at = null` regardless of source state.
- `anchor_place_id` on the source trip is not propagated to the duplicate (the old anchor id references a place row in the source trip; resolving it for the copy is non-trivial — dropped per ADR-0006, user re-picks).
- `day_index` / `order_in_day` are not cloned; the optimizer recomputes them on the next optimize run.
- Unarchive is idempotent: calling it on an already-active trip sets `archived_at = null` again with no harmful side effects.
- Parallel mutations (M2 — parked): if a user rapidly archives then unarchives before the first mutation settles, the optimistic-update rollback may surface a stale list briefly. Tracked as a follow-up; does not corrupt data.

## Test plan
- No tests authored in Phase 7 (test-specialist removed per user direction).
- Follow-up: unit tests for `useArchiveTrip` / `useDuplicateTrip` optimistic-update / rollback; Deno integration test for `duplicate_trip` RPC ownership check.

## Open follow-ups
- **M2** — parallel-mutation rollback footgun: rapid archive → unarchive before first mutation settles may flash a stale list. Parked.
- **L1** — no optimistic insert on Duplicate: the new trip appears only after cache invalidation resolves, not immediately. Parked.
- **L4** — `delete_account_cascade` RPC is exposed as a callable SQL function but is not intended to be called directly by clients (the Edge Function is the intended path). Consider revoking `execute` on it from `authenticated` role as a hardening step. Parked.

See `docs/reviews/phase-7.md` for the full reviewer findings.
