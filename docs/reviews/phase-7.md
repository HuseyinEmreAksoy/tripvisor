# Phase 7 — Pre-exit review

**Date**: 2026-04-25
**Reviewer**: `reviewer` sub-agent (read-only)
**Scope**: Uncommitted Phase 7 diff per planner Step 7.9 — trip archive/duplicate + Settings screen + delete-account.

## Summary

- **RLS / authorization**: holds. `archived_at` is a column on `trips` and is governed by the existing `trips_owner_all` policy. The new partial index `trips_user_active_idx` does not bypass RLS.
- **IDOR / Edge Function**: clean. `delete-account` derives `userId` from `auth.getUser(token)` (verified JWT), never from a request-body field.
- **Service-role exposure**: clean. `grep -r "SUPABASE_SERVICE_ROLE_KEY" src app` returns no matches; only Deno code references it.
- **`duplicate_trip` ownership**: correct. RPC checks `auth.uid()`, looks up source `user_id`, raises `not_authorized` (42501) on mismatch and `not_found` (P0002) on missing — all before any insert.
- **Google ToS**: clean. Duplicate path clones only `google_place_id`, `lat`, `lng` + user-authored fields. `details_refreshed_at` not copied; `day_index`/`order_in_day`/`anchor_place_id`/`archived_at` reset.
- **PII in logs**: clean. Edge Function logs `requestId`, `fn`, `stage`, `userId` (UUID, not PII). Email never read or logged. Settings screen has no `console.*` calls.
- **Destructive confirms**: present on Delete trip and Delete account, platform-split (`Alert.alert` native, `window.confirm` web).
- **Order-of-ops**: matches planner's safer-on-partial-failure rationale — auth-delete first, trips cleanup second.
- **Optimistic updates**: `useArchiveTrip` / `useUnarchiveTrip` use canonical `cancelQueries` → snapshot → `setQueryData` → `onError` rollback → `onSettled` invalidate.

## Critical findings

**None.**

## High findings

**None.**

## Medium findings

### M1 — Settings sign-out race after Delete account succeeds
- **Severity**: medium
- **Category**: correctness (UX)
- **Location**: `app/(app)/settings.tsx`
- **Observation**: After successful delete-account, the screen called `qc.clear()` then `signOut.mutate()`. Between auth-delete completing server-side and the local `signOut` resolving, the auth gate could re-trigger queries that 401, causing brief flicker of error toasts.
- **Disposition**: **Fixed.** Switched to `await signOut.mutateAsync()` before `qc.clear()` so the local JWT is gone before any re-fetch can happen.

### M2 — Optimistic-update rollback may regress parallel mutations
- **Severity**: medium
- **Category**: correctness
- **Location**: `src/api/trips.ts` (`useArchiveTrip` / `useUnarchiveTrip` `onMutate`/`onError`)
- **Observation**: If two archive calls fire in rapid succession, the second `onMutate` snapshots the post-first optimistic state; if the first errors, its rollback also undoes the second.
- **Disposition**: **Parked.** Acceptable trade-off for v1; the trips list mutation flow is single-tap-driven, not bulk. Follow-up: either gate UI to one-at-a-time or drop optimistic updates entirely.

## Low findings

### L1 — `useArchiveTrip` doesn't optimistically insert into the destination list
- **Severity**: low
- **Category**: UX consistency
- **Disposition**: Park. Optional polish.

### L2 — `BottomSheet.web.tsx` focus-restoration can target a stale element
- **Severity**: low
- **Category**: a11y polish
- **Disposition**: Park.

### L3 — `confirm.ts` re-exports from `confirm.web` even on native typecheck
- **Severity**: low
- **Category**: maintainability
- **Disposition**: Park. Add a "must keep web + native signatures identical" comment if they ever diverge.

### L4 — `delete_account_cascade()` RPC is unused but granted to authenticated
- **Severity**: low
- **Category**: minor surface area
- **Location**: `supabase/migrations/0004_trip_lifecycle.sql`
- **Observation**: Edge Function explicitly does NOT call this RPC (uses direct service-role delete). The RPC remains executable by any authenticated client, which would silently nuke trip data without going through auth-row-first ordering.
- **Disposition**: **Parked.** Lean toward dropping the RPC in a follow-up; not a security hole (gated by `auth.uid()`) but a footgun.

### L5 — `TripCard` uses `@ts-expect-error` on `e.stopPropagation`
- **Severity**: low
- **Category**: type safety
- **Disposition**: Park. Pragmatic — RN web event types lack `stopPropagation` while the runtime supports it.

## Sign-off

**SHIP.**

No critical or high findings. The Phase 7 surface is the highest-risk we've shipped (account deletion, service-role usage, archive/duplicate semantics) and the implementation handles every check the planner called out: JWT-derived `userId` (no IDOR), service-role contained to Deno, ownership-checked RPC, ToS-respecting duplicate, no PII logging, gated destructive actions, correct order-of-ops on partial failure, correct optimistic-update rollback shape. M1 fixed; M2 + lows parked as follow-ups.

## Files referenced

- `supabase/migrations/0004_trip_lifecycle.sql`
- `supabase/migrations/0001_init.sql` (cross-ref)
- `supabase/functions/delete-account/index.ts`
- `supabase/functions/delete-account/README.md`
- `src/api/trips.ts`
- `src/api/types.ts`
- `app/(app)/settings.tsx`
- `app/(app)/trips.tsx`
- `src/components/TripCard.tsx`
- `src/components/TripActionsSheet.tsx`
- `src/components/BottomSheet.web.tsx`
- `src/theme/ThemeProvider.tsx`
- `src/lib/confirm.{web,native,ts}`
- `docs/reviews/phase-5.md` (format reference)
- `docs/adr/0006-trip-duplicate-semantics.md` (decision reference)
