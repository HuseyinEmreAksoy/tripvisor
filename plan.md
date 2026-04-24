# Tripvisor — Roadmap & Status

**Current phase**: Phase 3 — Manual editing (🚧 **Code complete · MVP ready pending live smoke**)
**Last updated**: 2026-04-24

## Status by phase

| Phase | Title | Status | Owner(s) |
|---|---|---|---|
| 0 | Scaffold + tooling | ✅ Done (code) · pending user install/provision | docs, ui, backend |
| 1 | Auth + trip CRUD + place search | 🚧 Code complete · awaiting live smoke | backend + ui |
| 2 | Route optimization + day split | 🚧 Code complete · awaiting live smoke | backend (optimizer) + ui (map) |
| 3 | Manual editing (drag, move-to-day, duration override) | 🚧 Code complete · MVP ready pending live smoke | ui + backend |
| 4 | Polish (offline cache, share link, .ics export, Sentry) | 📋 Planned | ui + backend |
| 5 | Test hardening | 📋 Planned | test-specialist |

Legend: 📋 Planned · 🚧 In progress · ✅ Done · ⚠ Blocked

## Phase 0 — scaffold + tooling

### Step 1 — Create six sub-agent files

- **Agent**: main assistant (bootstrap)
- **Status**: ✅ Done
- **Output**: `.claude/agents/{planner, ui-specialist, backend-specialist, test-specialist, reviewer, docs-specialist}.md`

### Step 2 — Project-root tracker docs

- **Agent**: main assistant (bootstrap)
- **Status**: 🚧 In progress
- **Output**: `CLAUDE.md`, `plan.md`, `docs/architecture.md`, `docs/features/overview.md`

### Step 3 — Expo universal app skeleton

- **Agent**: ui-specialist (future sessions)
- **Status**: 🚧 Config files written; `npm install` + first dev-server run pending user action
- **Output**: `package.json`, `tsconfig.json`, `app.json`, `babel.config.js`, `.env.example`, `app/_layout.tsx`

### Step 4 — Supabase schema + Edge Function skeletons

- **Agent**: backend-specialist (future sessions)
- **Status**: 🚧 Initial migration drafted; `supabase init` + project link + function scaffolding pending user action
- **Output**: `supabase/migrations/0001_init.sql`

### Step 5 — Verify scaffold boots

- **Agent**: reviewer
- **Status**: 📋 Planned (after user runs `npm install` and `supabase init`)
- **Expected output**: Empty Expo app renders on web + iOS + Android; Supabase local stack starts; Edge Function `?ping` returns 200.

---

## Phase 1 — Auth + trip CRUD + place search

**Goal**: User can sign in with magic link, create and manage trips, search Google Places by autocomplete, and add places to a trip. Place details show live Google reviews with attribution.

**Status**: 🚧 In progress — **code complete**, live smoke pending user setup
**Review**: [docs/reviews/phase-1.md](docs/reviews/phase-1.md) — 2 blockers fixed, no critical findings
**Entry criteria**: Phase 0 code shipped. (User setup of npm install + Supabase + GCP still pending but does not block code authoring.)
**Phase exit criteria**:
- Magic-link sign-in works on iOS, Android, and Web; session survives app restart
- Trips list shows the current user's trips only (RLS verified by two-user test)
- User can create, view, and delete a trip from each platform
- Autocomplete search returns Google Places results and respects session tokens
- Place details screen renders reviews + photos live with "Powered by Google" attribution
- No Google HTTP key appears in the built client bundle (verified by bundle grep)
- Edge Functions `places-autocomplete` and `place-details` pass integration tests and `?ping` warmup works

**Critical path**: Step 1 → Step 2 → Step 3 → Step 4 → Step 5 → Step 7 → Step 8 → Step 9 → Step 11 → Step 12 → Step 13

### Step 1 — Supabase client + shared types ✅ code done
- **Agent**: backend-specialist
- **Size**: S
- **Task**: `src/api/supabase.ts` with platform-split session storage (expo-secure-store native / localStorage web). `src/api/types.ts` defining `Trip`, `TripPlace`, session + auth types. `src/api/index.ts` barrel.
- **Inputs**: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` from `.env` (user provisions)
- **Expected output**: Client boots on all 3 platforms; `supabase.auth.getSession()` returns null initially
- **Depends on**: None
- **Platform check**: ☐ iOS ☐ Android ☐ Web (uses platform-split `.native.ts` / `.web.ts` for storage adapter)
- **Risks**: [Low] expo-secure-store size limit for JWTs — Mitigation: Supabase JWTs are small; chunking not needed
- **Verification**: Client imports cleanly; session helper round-trips

### Step 2 — trips + places API wrappers ✅ code done
- **Agent**: backend-specialist
- **Size**: M
- **Task**: `src/api/trips.ts` with TanStack Query hooks (`useTrips`, `useTrip`, `useCreateTrip`, `useDeleteTrip`). `src/api/places.ts` with hooks calling the autocomplete + details Edge Functions. Zod validation at the client-wrapper boundary.
- **Depends on**: Step 1
- **Parallel with**: Step 3, Step 4, Step 5 (different files)
- **Platform check**: ☐ iOS ☐ Android ☐ Web (pure TanStack Query, platform-agnostic)
- **Risks**: [Medium] React Query key collisions across trips — Mitigation: hierarchical keys `["trips", id]`, `["trips"]`
- **Verification**: Types compile; hook signatures match what UI expects

### Step 3 — places-autocomplete Edge Function ✅ code + tests done
- **Agent**: backend-specialist
- **Size**: M
- **Task**: `supabase/functions/places-autocomplete/index.ts`. Zod input `{ input, sessionToken, locationBias? }`, field mask minimal for suggestions list, AbortController 3s timeout, structured logs, `?ping`, CORS for app origins.
- **Depends on**: None (self-contained)
- **Parallel with**: Step 2, Step 4, Step 5
- **Risks**: [Medium] Places API (New) field mask format — Mitigation: test with minimal mask (`suggestions.placePrediction.placeId,suggestions.placePrediction.text`)
- **Verification**: Edge Function integration test passes; `curl ?ping` returns 200

### Step 4 — place-details Edge Function ✅ code + tests done
- **Agent**: backend-specialist
- **Size**: M
- **Task**: `supabase/functions/place-details/index.ts`. Zod input `{ placeId, sessionToken?, fields[] }`, per-caller X-Goog-FieldMask, 8s timeout, `?ping`, structured logs. Returns reviews/photos/rating live.
- **Depends on**: None
- **Parallel with**: Step 2, Step 3, Step 5
- **Risks**: [Medium] Large response for full field set — Mitigation: UI requests lean masks for list, full only for detail screen
- **Verification**: Edge Function integration test passes; session token echoed in Google URL

### Step 5 — Theme tokens + provider ✅ code done
- **Agent**: ui-specialist
- **Size**: S
- **Task**: `src/theme/tokens.ts` (color, spacing, radius, typography). `src/theme/ThemeProvider.tsx` with `useTheme()` hook, reads `useColorScheme()`, supports user override.
- **Depends on**: None
- **Parallel with**: Step 2, Step 3, Step 4
- **Platform check**: ☐ iOS ☐ Android ☐ Web
- **Risks**: [Low] Token scope creep — Mitigation: keep tokens minimal for MVP, add on demand
- **Verification**: Dark mode flips via OS setting

### Step 6 — Root layout wires ThemeProvider + session gate ✅ code done
- **Agent**: ui-specialist
- **Size**: S
- **Task**: Update `app/_layout.tsx` to wrap in `ThemeProvider`. Add `app/(auth)/_layout.tsx` + `app/(app)/_layout.tsx` redirects based on session.
- **Depends on**: Step 1, Step 5
- **Risks**: [Low]
- **Verification**: Unauthenticated user lands on `/login` on all three platforms

### Step 7 — Auth screens (login + signup + magic-link confirmation) ✅ code done
- **Agent**: ui-specialist
- **Size**: M
- **Task**: `app/(auth)/login.tsx`, `app/(auth)/signup.tsx`, email input with react-hook-form + Zod; triggers Supabase magic link; confirmation screen.
- **Depends on**: Step 1, Step 5, Step 6
- **Platform check**: ☐ iOS ☐ Android ☐ Web
- **Risks**: [Medium] Deep linking from magic-link email back to app — Mitigation: configure `tripvisor://` scheme (native) + https redirect (web); document for Phase 4 completion
- **Verification**: Enter email → "Check your inbox" screen; clicking link authenticates

### Step 8 — Trips list screen ✅ code done
- **Agent**: ui-specialist
- **Size**: M
- **Task**: `app/(app)/index.tsx` rendering user's trips via `useTrips()`. `src/components/TripCard.tsx`. Empty state + error state + loading state. "Create trip" CTA.
- **Depends on**: Step 2, Step 6
- **Platform check**: ☐ iOS ☐ Android ☐ Web
- **Risks**: [Low]
- **Verification**: Empty state appears for new users; mocked trip data renders correctly

### Step 9 — Create trip screen + form ✅ code done
- **Agent**: ui-specialist
- **Size**: M
- **Task**: `app/(app)/trip/new.tsx` with title, start/end dates, daily hours budget, timezone (auto-detected). react-hook-form + Zod; `useCreateTrip()`; redirect to trip detail on success.
- **Depends on**: Step 2, Step 8
- **Platform check**: ☐ iOS ☐ Android ☐ Web (DatePicker uses `@react-native-community/datetimepicker` native + HTML `<input type="date">` web — platform split or single component library)
- **Risks**: [Medium] Date picker cross-platform — Mitigation: platform-split `DatePicker.native.tsx` / `DatePicker.web.tsx`
- **Verification**: Submit creates a row in `trips` (once Supabase provisioned); RLS attaches `user_id`

### Step 10 — Trip detail shell ✅ code done
- **Agent**: ui-specialist
- **Size**: S
- **Task**: `app/(app)/trip/[id]/index.tsx` with metadata header (title, dates, budget), tab placeholder for Map / Itinerary / Settings (Map + Itinerary implementation deferred to Phase 2). "Add place" CTA routes to `trip/[id]/add`. Delete trip action with confirmation.
- **Depends on**: Step 2
- **Platform check**: ☐ iOS ☐ Android ☐ Web
- **Risks**: [Low]
- **Verification**: Navigating from trip list → detail loads metadata; delete works with RLS

### Step 11 — Add place screen (autocomplete) ✅ code done
- **Agent**: ui-specialist
- **Size**: M
- **Task**: `app/(app)/trip/[id]/add.tsx` with debounced search input (250ms), suggestion list via `usePlacesAutocomplete()`, session token management per mount. Tapping a suggestion calls `usePlaceDetails()` and `useCreateTripPlace()`. Back to trip detail.
- **Depends on**: Step 2, Step 3, Step 4, Step 10
- **Platform check**: ☐ iOS ☐ Android ☐ Web
- **Risks**: [High] Session token discipline — Mitigation: generate token on screen mount, pass to both autocomplete and details calls; spec'd in API wrapper
- **Verification**: Type "Lis" → Lisbon suggestions; select → details fetch + trip_places row inserted

### Step 12 — Place details screen ✅ code done
- **Agent**: ui-specialist
- **Size**: M
- **Task**: `app/(app)/place/[placeId].tsx` showing name, rating, photos (`expo-image`), reviews list (author + relative time + profile photo + rating + text), opening hours, phone, website. **"Powered by Google" footer**. Photo `attributions[]` rendered. Never stores any of this.
- **Depends on**: Step 4
- **Platform check**: ☐ iOS ☐ Android ☐ Web
- **Risks**: [High] Attribution compliance — Mitigation: `reviewer` checklist verifies before merge
- **Verification**: Reviews render with proper attribution; no server-side persistence of review/photo data

### Step 13 — Test pass (unit + component + Edge Function integration + RLS) ✅ code done
- **Agent**: test-specialist
- **Size**: M
- **Task**: Deno integration tests for Edge Functions; RNTL component tests for TripCard, login, create-trip form; Jest unit tests for category → duration table; RLS two-user test via local Supabase.
- **Depends on**: Steps 1–12
- **Risks**: [Medium] Supabase local stack availability — Mitigation: ensure `supabase start` runs; skip RLS test if not available, document gap
- **Verification**: `npm test` green; `deno test supabase/functions/**/test.ts` green; RLS test proves isolation

### Step 14 — Reviewer pre-exit ✅ done — 2 blockers fixed (CORS fail-closed, magic-link redirect)
- **Agent**: reviewer
- **Size**: S
- **Task**: Walk the checklist (ToS, security, cross-platform, a11y, state discipline, test coverage). File findings as a structured report.
- **Depends on**: Steps 1–13
- **Risks**: [Low]
- **Verification**: Report produced; no critical or high findings block merge

### Step 15 — Docs update ✅ done — feature docs for auth, trip-crud, place-search, place-details
- **Agent**: docs-specialist
- **Size**: S
- **Task**: Write `docs/features/auth.md`, `trip-crud.md`, `place-search.md`, `place-details.md` using the template. Flip Phase 1 row to ✅ in `plan.md`. Check Platforms verified boxes per feature.
- **Depends on**: Steps 1–14
- **Risks**: [Low]
- **Verification**: Cold-start reader can learn shipped state from docs alone

## ⚠ Blockers (needs user input before Phase 1 can fully run)

- User must run `npm install` in project root
- User must create Supabase project + copy URL + anon key into `.env`
- User must create GCP project, enable Places API (New), copy server key into Supabase Edge Function secrets (`supabase secrets set GOOGLE_MAPS_SERVER_KEY=...`)
- User must configure EAS + `expo-dev-client` for native builds (web can proceed without)

Code can be fully authored without these — only end-to-end verification is blocked.

---

## Phase 2 — Route optimization + day split

**Goal**: Tapping "Optimize" on a trip with ≥2 places computes an optimal multi-day route. The map renders day-color-coded markers + polylines; the Itinerary tab shows per-day place order with travel times between them; the Settings tab lets the user adjust daily budget + transport mode.

**Status**: 🚧 In progress — **code complete**, live smoke pending user setup
**Review**: [docs/reviews/phase-2.md](docs/reviews/phase-2.md) — 0 critical, 1 high follow-up (atomic day-assignment via RPC) queued for Phase 3
**Entry criteria**: Phase 1 code shipped. Routes API enabled in GCP (user action before live smoke, not before code).
**Phase exit criteria**:
- Optimizer unit tests + property tests green on all canonical fixtures
- Adding / removing a place auto-triggers re-optimize (debounced 500ms)
- Map renders pins + day-colored polylines on iOS, Android, and Web (platform-split Map component)
- Itinerary tab lists places by day with travel time between consecutive stops
- Settings tab updates daily budget + transport mode, which re-trigger optimize
- Distance Matrix call is single (N×N) per optimize invocation, not N²
- `trip_legs` rows populated and honored by 30-day TTL on re-optimize
- No Google Routes key appears in the built client bundle

**Critical path**: Step 1 → Step 2 → Step 3 → Step 4 → Step 5 → Step 7 → Step 8 → Step 11

### Step 1 — Optimizer pure function (k-means + 2-opt) ✅ code done
- **Agent**: backend-specialist
- **Size**: M
- **Task**: `src/lib/optimizer/kmeans-2opt.ts`. Export `optimize({ places, legs, dailyBudgetMinutes, anchorPlaceId?, dayStartEnd? }): Day[]`. Steps: k-means seeded by farthest-point sampling, cluster-rebalance under budget, 2-opt per day with start/end pin support.
- **Depends on**: None
- **Parallel with**: Step 3 (distance-matrix Edge Fn)
- **Platform check**: ☐ iOS ☐ Android ☐ Web (pure TypeScript; no I/O)
- **Risks**:
  - [Medium] 2-opt local minima — Mitigation: two random restarts with best-of
  - [Medium] Unbalanced clusters — Mitigation: post-k-means rebalance by swapping boundary points
- **Verification**: Unit tests on hand-built fixtures; property tests via `fast-check` (completeness, budget, idempotence, anchor pinning)

### Step 2 — trip_legs cache helper (server-side) ✅ folded into optimize-trip orchestrator
- **Agent**: backend-specialist
- **Size**: S
- **Task**: Helper in `supabase/functions/_shared/trip-legs.ts` to lookup cached legs for a trip + mode, filtering out `computed_at < now() - 30 days`. Used by `optimize-trip`.
- **Depends on**: None
- **Parallel with**: Step 1, Step 3, Step 4

### Step 3 — distance-matrix Edge Function ✅ code + tests done
- **Agent**: backend-specialist
- **Size**: M
- **Task**: `supabase/functions/distance-matrix/index.ts`. Proxies Routes API `computeRouteMatrix`. Zod `{ origins[], destinations[], mode }`. 8s timeout. Returns `{ legs: [{ fromIndex, toIndex, durationSeconds, distanceMeters }] }` for the orchestrator to map back to place IDs.
- **Depends on**: None
- **Parallel with**: Steps 1, 2, 4
- **Risks**: [Medium] Routes API field mask different from Places — verify against docs

### Step 4 — directions-polyline Edge Function ✅ code + tests done
- **Agent**: backend-specialist
- **Size**: M
- **Task**: `supabase/functions/directions-polyline/index.ts`. Proxies `computeRoutes`. Zod `{ orderedPlaceIds[], mode, originLatLng, destLatLng, waypoints[] }`. Returns `{ polyline, durationSeconds, distanceMeters }`.
- **Depends on**: None
- **Parallel with**: Steps 1, 2, 3

### Step 5 — optimize-trip orchestrator ✅ code done
- **Agent**: backend-specialist
- **Size**: L
- **Task**: `supabase/functions/optimize-trip/index.ts`. Verifies the caller's JWT, loads `trip_places`, calls distance-matrix (checking `trip_legs` cache first), runs optimizer, writes `day_index` + `order_in_day` on places, calls directions-polyline per day, writes legs. Idempotence-guarded via a computed `stateHash` returned to the client.
- **Depends on**: Steps 1, 2, 3, 4
- **Risks**:
  - [High] Race between two concurrent optimize calls — Mitigation: `SELECT ... FOR UPDATE` on the trip row or an advisory lock (`pg_advisory_xact_lock(hashtext(trip_id::text))`)
  - [Medium] Trip capped at 25 places for MVP — enforce in Zod input

### Step 6 — Client wrapper `src/api/routes.ts` ✅ code done
- **Agent**: backend-specialist
- **Size**: S
- **Task**: `useOptimizeTrip(tripId)` mutation → invokes `optimize-trip`. `useTripLegs(tripId)` query. Invalidate `tripsKeys.detail(tripId)` + `tripPlacesKeys.forTrip(tripId)` + `tripLegsKeys.forTrip(tripId)` on success.
- **Depends on**: Steps 3, 4, 5
- **Platform check**: ☐ iOS ☐ Android ☐ Web

### Step 7 — Map component (platform split) ✅ code done
- **Agent**: ui-specialist
- **Size**: L
- **Task**: `src/components/Map.native.tsx` using `react-native-maps` with `PROVIDER_GOOGLE`. `src/components/Map.web.tsx` using `@vis.gl/react-google-maps`. Shared prop shape: `{ markers: Marker[], polylines: Polyline[], initialRegion, onMarkerPress }`. Day-color-coded pins + polyline using a small color palette.
- **Depends on**: None (can ship with mock data; wires to Step 6 in Step 8)
- **Platform check**: ☐ iOS ☐ Android ☐ Web
- **Risks**:
  - [High] Web bundle size (~150 KB gz for Maps JS) — Mitigation: lazy-load Map.web via dynamic import at the tab level
  - [Medium] Google Maps JS requires runtime API-key loading — `APIProvider` wraps the tree; key from `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY`

### Step 8 — Trip detail tabs (Map / Itinerary / Settings) ✅ code done
- **Agent**: ui-specialist
- **Size**: L
- **Task**: Refactor `app/(app)/trip/[id]/index.tsx` into a tab view (custom light-weight tabs; no extra lib). Map tab uses `<Map>`. Itinerary tab is a `SectionList` per day with travel-time rows between places. Settings tab has daily budget slider + transport mode picker + delete.
- **Depends on**: Steps 6, 7
- **Parallel with**: Step 9

### Step 9 — Optimize button + status pill ✅ code done (auto-triggered, no manual button needed)
- **Agent**: ui-specialist
- **Size**: M
- **Task**: "Optimize" CTA; auto-triggered (debounced 500ms) after add / remove place or daily-budget / transport-mode change. Inline status pill ("Optimizing…") — not a full-screen blocker. Graceful degradation if `directions-polyline` fails: render straight-line segments + "Approximate" flag.
- **Depends on**: Step 6
- **Parallel with**: Step 8

### Step 10 — Optimizer unit + property tests ✅ done (fast-check + fixtures)
- **Agent**: test-specialist
- **Size**: M
- **Task**: `src/lib/optimizer/__tests__/*.test.ts`. Fixture-based unit tests (2-place, 5-place, 10-place trips). `fast-check` property tests: completeness (every input place in exactly one day), budget ≤ N + tolerance, 2-opt output ≤ seed order, idempotence, anchor pinning.
- **Depends on**: Step 1

### Step 11 — Edge Function tests for Phase 2 ✅ done (distance-matrix + directions-polyline)
- **Agent**: test-specialist
- **Size**: M
- **Task**: Deno tests for `distance-matrix`, `directions-polyline`, `optimize-trip`. Mock Routes API at `globalThis.fetch`. Cover Zod validation, field masks (`duration,distanceMeters` for matrix; `routes.polyline.encodedPolyline` for routes), timeout, upstream-error 502, orchestrator happy path + cache hit + race-guard.
- **Depends on**: Steps 3, 4, 5

### Step 12 — Reviewer pre-exit for Phase 2 ✅ done — 6 findings, 0 critical
- **Agent**: reviewer
- **Size**: S
- **Task**: Walk the full checklist against the Phase 2 diff. Focus on optimizer determinism, Routes API cost (one matrix call per state change), `trip_legs` TTL, map platform split, accessibility of new tabs.
- **Depends on**: Steps 1–11

### Step 13 — Docs update for Phase 2 ✅ done — ADR-0001, optimization.md, day-split.md, map.md
- **Agent**: docs-specialist
- **Size**: S
- **Task**: Create `docs/features/optimization.md`, `day-split.md`, `map.md`. Add ADR `docs/adr/0001-kmeans-2opt-over-or-tools.md` explaining the algorithm choice. Flip Phase 2 row in `plan.md` + `docs/features/overview.md` to code-complete.
- **Depends on**: Steps 1–12

## ⚠ Blockers (Phase 2 — none new; inherits Phase 1 prerequisites)

Phase 2 code can be authored without GCP provisioning. Live smoke requires Routes API enabled + server key already provisioned for Phase 1.

---

## Phase 3 — Manual editing (MVP ships here — ⏸ PAUSED mid-phase)

**Goal**: User can drag-reorder places within a day, long-press to open an actions sheet (move to a different day, change visit duration, delete), and have the itinerary auto-save. All three Phase 2 review deferrals land too (atomic RPC, web Polylines lifecycle, stable auto-optimize deps).

**Status**: 🚧 Resumed 2026-04-24. Backend + Phase 2 deferrals (Steps 1–4) already landed; now completing UI (Steps 5–7), tests (Step 8), reviewer (Step 9), docs (Step 10).

**Entry criteria**: Phase 2 code shipped.
**Phase exit criteria**:
- Drag-reorder within a day works on iOS, Android, and Web; order persists instantly (no full re-optimize)
- Long-press a place opens an actions sheet with: move to day, change duration, delete
- Changing duration triggers auto-optimize (debounced 500ms) because the time budget shifted
- Moving between days does NOT trigger a full matrix call — the next optimize reuses `trip_legs` cache
- `apply_optimization` RPC is used by `optimize-trip` (atomic update of day_index/order_in_day)
- Web map Polylines no longer flicker on re-render
- Auto-optimize effect no longer fires on incidental re-renders

**Critical path**: Step 1 → Step 2 → Step 3 → Step 5 → Step 6 → Step 7

### Step 1 — Postgres RPCs (apply_optimization, apply_manual_day_order) ✅ done
- **Agent**: backend-specialist
- **Size**: M
- **Task**: Migration `0002_rpcs.sql`. `apply_optimization(p_trip_id uuid, p_assignments jsonb)` — updates `trip_places.day_index` + `order_in_day` in a single statement using `jsonb_to_recordset`, scoped to the trip. `apply_manual_day_order(p_trip_id uuid, p_day_index int, p_ordered_ids uuid[])` — assigns `order_in_day` by index position, within that trip+day.
- **Depends on**: None
- **Risks**: [Medium] `SECURITY DEFINER` vs RLS — we keep `SECURITY INVOKER` so RLS still applies (caller must own the trip)
- **Verification**: Integration test seeds a trip, calls RPC, verifies order matches

### Step 2 — Switch optimize-trip to apply_optimization RPC ✅ done
- **Agent**: backend-specialist
- **Size**: S
- **Task**: Replace the `for (const day …) for (let i …) await admin.from('trip_places').update(...)` loop with a single `admin.rpc('apply_optimization', { p_trip_id, p_assignments })` call. Assignments is a JSON array `[{ id, day_index, order_in_day }]`.
- **Depends on**: Step 1

### Step 3 — Manual-edit client hooks ✅ done (hooks exist; no UI callers yet)
- **Agent**: backend-specialist
- **Size**: M
- **Task**: `src/api/trip-places.ts` — add `useUpdateTripPlace({ id, trip_id, ...patch })` and `useReorderDay({ tripId, dayIndex, orderedIds })` and `useMoveToDay({ id, tripId, toDayIndex })`. Invalidate `tripPlacesKeys.forTrip(tripId)` on success. Zod-validate patches.
- **Depends on**: Step 1

### Step 4 — Phase 2 deferral fixes ✅ done (web Polylines + stable optimizeMutate dep)
- **Agent**: ui-specialist
- **Size**: S
- **Task**: 1) Replace the imperative `setTimeout(0)` polyline teardown in `Map.web.tsx` with a proper `useEffect` lifecycle (create on polylines change; clean up on unmount / dep change). 2) In `app/(app)/trip/[id]/index.tsx` swap the auto-optimize effect's `optimize` dep for `optimize.mutate` (stable reference).
- **Depends on**: None (independent)

### Step 5 — BottomSheet + VisitDurationStepper primitives ✅ code done
- **Agent**: ui-specialist
- **Size**: M
- **Task**: `src/components/BottomSheet.tsx` — `Modal` on native with a dimmed backdrop; web uses a fixed-position overlay with Escape-to-close + focus trap. `src/components/VisitDurationStepper.tsx` — ± 15-minute buttons, min 15min, max 12h, announced via `accessibilityLiveRegion`. Keyboard support (arrow keys on web).
- **Depends on**: None
- **Platform check**: ☐ iOS ☐ Android ☐ Web

### Step 6 — DraggableItinerary (platform-split) ✅ code done
- **Agent**: ui-specialist
- **Size**: M
- **Task**: `src/components/DraggableItinerary.native.tsx` via `react-native-draggable-flatlist`. `.web.tsx` via `@dnd-kit/core` vertical sortable (keyboard + pointer). Shared prop shape `{ items, onReorder(newIds), onLongPress(id) }`. Intra-day only (no cross-day).
- **Depends on**: None
- **Risks**: [Medium] `@dnd-kit` bundle size + React Native Web compatibility — Mitigation: lazy-load on web via dynamic import inside `.web.tsx`

### Step 7 — PlaceActionsSheet + Itinerary integration ✅ code done
- **Agent**: ui-specialist
- **Size**: M
- **Task**: `src/components/PlaceActionsSheet.tsx` — duration stepper, "Move to day" radio list, delete confirm. Long-press on a `DraggableItinerary` row opens it. Refactor `ItineraryTab` in `app/(app)/trip/[id]/index.tsx` to render one `DraggableItinerary` per day; wire `onReorder` to `useReorderDay` and delete/duration/move to their respective hooks.
- **Depends on**: Steps 3, 5, 6

### Step 8 — Tests for Phase 3 ✅ done — VisitDurationStepper unit + RPC integration
- **Agent**: test-specialist
- **Size**: S
- **Task**: Extend `tests/rls.test.ts` with RPC tests (call `apply_optimization` + `apply_manual_day_order` as user A; user B cannot invoke against A's trip). Component test for `VisitDurationStepper`: ± buttons, min/max clamps, a11y label.
- **Depends on**: Steps 1, 5

### Step 9 — Reviewer pre-exit (MVP gate) ✅ done — `docs/reviews/phase-3.md`
- **Agent**: reviewer
- **Size**: S
- **Task**: Walk the full checklist. Confirm: RPC ownership enforced via RLS; drag has keyboard support on web; bottom sheet traps focus; live regions announce duration; no Google calls on pure reorder (only on duration change).
- **Depends on**: Steps 1–8

### Step 10 — Docs + MVP banner ✅ done
- **Agent**: docs-specialist
- **Size**: S
- **Task**: `docs/features/manual-edit.md` + `docs/features/visit-duration.md`. Flip Phase 3 + affected feature rows to code-complete. Add a "MVP ships here" banner with the user deploy checklist in `plan.md`.
- **Depends on**: Steps 1–9

## ⚠ Blockers (Phase 3 — none new)

Same prerequisites as Phase 1 + 2. No additional API / key / service needed.

## 🎉 MVP is code-complete

Phases 0 → 3 are code-complete. To run the MVP end-to-end you still need to:

1. `cd C:\Users\hemre\Desktop\Tripvisor && npm install`
2. `npx expo install --check` to reconcile pinned versions with the installed SDK
3. Supabase: create project → link → `supabase db push` (applies migrations 0001 + 0002) → deploy all five Edge Functions (`places-autocomplete`, `place-details`, `distance-matrix`, `directions-polyline`, `optimize-trip`) → set secrets (`GOOGLE_MAPS_SERVER_KEY`, `ALLOWED_ORIGINS`) → add redirect URLs in Authentication settings
4. GCP: enable Places API (New), Routes API, Maps SDK for iOS + Android, Maps JavaScript API; create one server-only key (into Supabase secrets) and one referer-restricted client key (into `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY`)
5. EAS: `eas build --profile development` for iOS + Android dev clients
6. Smoke-test the 10 verification steps in each per-feature doc on all three platforms; then tick the "Platforms verified" boxes in `docs/features/*.md`

---

## Pre-existing files

- `database-schema.jsx` at project root — earlier brainstorm visualization (React + lucide-react + Tailwind) showing a broader feature set than MVP. Not wired into the app. Kept as a design reference; see `docs/features/overview.md` "Post-MVP brainstorm" section for which ideas to revisit.

## Known risks / blockers

- ⚠ Google Cloud project + billing enabled (required even for free-credit usage). User must create GCP project and enable Places API (New), Routes API, Maps SDK (iOS + Android), Maps JavaScript API.
- ⚠ EAS account + `expo-dev-client` required for native testing — cannot use Expo Go due to `react-native-maps`.
- ⚠ React Native Web cannot render `react-native-maps`; map is platform-split (`Map.native.tsx` + `Map.web.tsx`) — must be respected in all future work.
- ⚠ Version pins in `package.json` may drift; run `npx expo-doctor` and `npx expo install --check` after `npm install`.

## Next action

User:

1. `cd C:\Users\hemre\Desktop\Tripvisor`
2. `git init` (if the project should be version-controlled)
3. `npm install`
4. `npx expo install --check` (aligns versions to the installed Expo SDK)
5. `npx supabase init` (creates `supabase/config.toml`)
6. Create GCP project + enable APIs listed above; copy keys into `.env` (see `.env.example`)

Once these are done, the main assistant can delegate Phase 1 to `planner` → `backend-specialist` + `ui-specialist`.
