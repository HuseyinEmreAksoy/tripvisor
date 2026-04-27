# Smoke log — Phase 25

**Phase**: 25 — Editor unblock + travel-product polish + carryover sweep
**Date**: 2026-04-26
**Status**: DEFERRED — automated tests and live smoke explicitly skipped per user direction on 2026-04-26. Same policy as Phases 21, 22, 23, and 24. Reviewer pass also skipped per user direction.

## Deferred state

The user directed the team to skip automated tests, the reviewer pass, and live smoke for Phase 25. No browser golden-path walk was performed and no platform verification was recorded.

This file exists to make the deferred state visible. Per-feature docs (`docs/features/photos.md`, `docs/features/profile.md`, `docs/features/trip-crud.md`) carry empty platform-verified boxes — none were ticked in Phase 25.

## Bug fixes shipped (code-complete, unverified)

### Phase 25.1 — `useUpdateTrip` + `useUpdateTripBudget` owner-filter removal
- Root cause: both hooks carried a `.eq('user_id', auth.uid())` filter on the Supabase `.update()` call. This silently returned zero rows for editor collaborators, even though the Phase 22 RLS (`0015_trips_editor_budget_rls.sql`) correctly permitted editor writes.
- Fix: the filter was dropped from both hooks. The RLS trigger (`enforce_trips_column_restrictions`) gates non-owner writes to the allowed column set (`total_budget`, `route_render_mode`, `cover_photo_google_place_id`, `updated_at`).
- Audit: 9 total `.eq('user_id', ...)` occurrences found across `src/api/`. 2 dropped (the bugs). 7 kept with explanatory comments (all are auth-scoped reads or owner-only writes that are correct as-is).
- Closes: Phase 22 + 23 known bugs where editors appeared unable to save budget or route-render-mode changes.

## Backend deliverables shipped (code-complete, unverified)

- **Migration `0018_trips_cover_photo.sql`** — adds `trips.cover_photo_google_place_id text null`. Column is in the editor allow-list of `enforce_trips_column_restrictions`. Probe smoke 4/4 PASS.
- **`place-photo` Edge Function** (`supabase/functions/place-photo/index.ts`) — GET-based image proxy; `verify_jwt = false`; 6h cache; photoName regex validation; full error envelope.
- **`_shared/cors.ts`** — `Access-Control-Allow-Methods` widened to `GET, POST, OPTIONS`.
- **`src/api/place-photos.ts`** — `usePlacePhotoUrl(photoName, { maxWidthPx? })` pure URL builder.
- **`src/api/auth.ts`** — `useChangeEmail()`, `useChangePassword()`, `AuthMutationError` class.
- **`Trip.cover_photo_google_place_id`** added to `src/api/types.ts`.
- **`UpdateTripPatch.cover_photo_google_place_id`** added in `src/api/trips.ts`.

## UI deliverables shipped (code-complete, unverified)

- **`src/components/TripCard.tsx`** — `CoverHero` with photo pipeline + gradient fallback + skeleton.
- **SettingsTab `CoverPhotoSection`** + **`CoverPickerModal`** in `app/(app)/trip/[id]/index.tsx`.
- **`PlaceThumbnail`** in `PlaceRow`; **`PlaceNotesEditor`** gated on `canEdit`.
- **`AccommodationNotesEditor`** in `AccommodationCard.tsx`.
- **`app/(app)/settings.tsx`** — change-email modal, change-password modal, error code mapping.
- **`app/(app)/trips.tsx`** — duplicate kebab navigates to new trip; `EdgeRuntimeBanner` (dev-only).
- **`app/(app)/trip/new.tsx`** — currency chip picker, `detectDefaultCurrency` from locale.
- **`src/hooks/useEdgeRuntimeHealth.ts`** — localhost-only ping hook.

## Test fixture maintenance

- `src/components/__tests__/TripCard.test.tsx` and `src/lib/__tests__/tripsFilters.test.ts` received a one-line `cover_photo_google_place_id: null` addition to their Trip fixture builders to satisfy the new non-optional field.

## Action required before feature status can advance to "Done"

1. Run automated tests: `npm test` covering `usePlacePhotoUrl`, `AuthMutationError`, `TripCard` cover-photo render, `useChangeEmail`/`useChangePassword` error mapping.
2. Walk web golden paths in a real browser and record PASS / FAIL per the priority items listed above.
3. Tick platform-verified boxes in `docs/features/photos.md` and `docs/features/profile.md` only after smoke passes on each platform.
4. Conduct reviewer pass covering owner-filter removals (RLS correctness), `place-photo` security (photoName regex, verify_jwt rationale), `AuthMutationError` error surface.
