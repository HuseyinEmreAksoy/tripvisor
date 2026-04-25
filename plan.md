# Tripvisor — Roadmap & Status

**Current phase**: Phase 7 — Done (web; native deferred)
**Last updated**: 2026-04-25

## Status by phase

| Phase | Title | Status | Owner(s) |
|---|---|---|---|
| 0 | Scaffold + tooling | ✅ Done (code) · pending user install/provision | docs, ui, backend |
| 1 | Auth + trip CRUD + place search | ✅ Done (web smoke green 2026-04-24; native smoke deferred to user) | backend + ui |
| 2 | Route optimization + day split | 🚧 Code complete · full smoke gated on Google Maps keys | backend (optimizer) + ui (map) |
| 3 | Manual editing (drag, move-to-day, duration override) | 🚧 Code complete · full smoke gated on Google Maps keys | ui + backend |
| 4 | Polish (offline cache, share link, .ics export, Sentry, empty states) | 🚧 Code complete · awaiting live smoke (closed out in Phase 6) | ui + backend |
| 5 | Test hardening (coverage, E2E, property, CI) | 🚧 Partial — source fixes shipped 2026-04-25; test-hardening exit criteria deferred | backend + ui |
| 6 | Phase 4 web close-out (live smoke + small polish) | 🚧 Partial — Step 6.0 (stack ready) + Step 6.4 (UX polish) shipped 2026-04-25; smoke (6.1–6.3, 6.5–6.7) skipped per user direction | backend + ui |
| 7 | Trip lifecycle (archive / duplicate) + Settings screen (theme toggle + delete account) | ✅ Done (web; native deferred to user smoke) | ui + backend |

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

## Phase 4 — Polish (offline cache, share link, .ics export, Sentry, empty states)

**Goal**: Ship the five polish features such that the MVP feels production-adjacent — itinerary reads offline, trips can be shared read-only via a link, each trip exports to a calendar `.ics`, unhandled errors land in Sentry (when configured), and every list/detail/form screen has a friendly empty state.

**Status**: 🚧 Code complete · awaiting live smoke (MVP-adjacent polish shipped)
**Entry criteria**:
- Phases 1–3 are code-complete (they are)
- User has answered the four Phase 4 blocker questions below (share-link route shape, Sentry org, ics timezone policy, offline cache eviction policy)
- Web Playwright smoke harness exists (it does — `e2e/web/`) and can be extended
**Phase exit criteria**:
- Offline cache: app opened with network disabled after a prior authenticated session shows the trips list and at least one previously-viewed trip detail (itinerary + pins), without any unhandled promise rejections, on iOS / Android / Web
- Share link: a signed read-only share link for a trip renders the itinerary + map (if web-map key present) on all three platforms while unauthenticated, respecting Google ToS (no persisted reviews, no photos rehydrated from the server); revoking the link returns 404
- `.ics` export: on all three platforms, a trip with ≥ 1 place produces a downloadable `.ics` file that imports cleanly into Google Calendar, Apple Calendar, and Outlook with one VEVENT per place anchored by trip start date + visit duration
- Sentry: when `EXPO_PUBLIC_SENTRY_DSN` is set, an unhandled error reaches the Sentry dashboard within 30s; when unset, the app runs identically (no init, no crash, no noisy logs)
- Empty states: trips list (no trips), trip detail (no places), add-place screen (no results / typing prompt), itinerary (no days yet) each render a friendly empty component with a single primary CTA; no screen shows a bare "Loading…" or whitespace after data resolves empty
- Map degradation: on web, if `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` is empty, Map.web renders a "Map unavailable — list view below" fallback instead of crashing, and share-link views fall back to the itinerary list
- Playwright web smoke (`docs/smoke/phase-4.md`) is green for: offline reload, share link open while logged-out, `.ics` download button present + downloads a non-empty file, empty-state copy visible
- No Google HTTP key appears in the built client bundle (bundle grep re-run)
- Bundle size on web grows by < 150 KB gz vs. Phase 3 baseline (Sentry + ics generator are both small; budget kept tight)

**Critical path**: Step 4.0 → Step 4.1 → Step 4.3 → Step 4.5 → Step 4.7 → Step 4.9 → Step 4.10 → Step 4.11 → Step 4.12

**Deferred to Phase 4b (explicitly NOT in scope now)**: ads, subscriptions, user-authored notes on places, user-authored reviews. These were floated in earlier brainstorms; leave untouched.

### ✅ Step 4.0 — Resolve Phase 4 design decisions
- **Agent**: planner (decision capture only — blocks everything else)
- **Size**: XS
- **Task**: Capture the four user answers from the blocker list below into `docs/adr/0002-share-link-shape.md` + `docs/adr/0003-sentry-init.md` + `docs/adr/0004-ics-timezone-policy.md` + `docs/adr/0005-offline-cache-policy.md`. Short ADRs (≤ 1 screen each).
- **Inputs**: user answers to the four blocker questions
- **Expected output**: four ADR files under `docs/adr/` with status `accepted`, date `2026-04-24`, one-line decisions
- **Depends on**: None (gate — everything else depends on this)
- **Parallel with**: (none)
- **Platform check**: N/A (doc-only)
- **Risks**:
  - [Blocker] ADRs cannot be written without user answers — Mitigation: do not start Phase 4 coding until ADRs land
- **Verification**: All four ADRs present, each links from the step that consumes its decision

### ✅ Step 4.1 — Share link backend (tokens + RLS + Edge Function)
- **Agent**: backend-specialist
- **Size**: M
- **Task**: Migration `supabase/migrations/0003_share_links.sql` adding `trip_shares (id uuid pk, trip_id uuid fk trips, token text unique, created_at timestamptz, revoked_at timestamptz)` with RLS (owner-only insert/update/delete; anonymous SELECT by token via Edge Function only). Edge Function `supabase/functions/share-trip/index.ts` with two operations: `create` (auth'd, writes a random 128-bit token) and `read` (anonymous, looks up by token, returns the trip + trip_places + trip_legs as read-only JSON; excludes `user_id`). New client wrappers in `src/api/share.ts` (`useCreateShareLink`, `useRevokeShareLink`). No review/photo/rating data is ever read or returned by `share-trip:read` — enforced by field selection.
- **Inputs**: ADR-0002 (route shape decision)
- **Expected output**: Migration runs clean locally; `share-trip` Edge Function `?ping` returns 200; `create` returns `{ token }`; `read` returns a read-only trip payload; RLS test proves anonymous cannot bypass the Edge Function
- **Depends on**: Step 4.0
- **Parallel with**: Step 4.2, Step 4.3, Step 4.4
- **Platform check**: N/A (server)
- **Risks**:
  - [High] Token enumeration — Mitigation: 128-bit random via `crypto.getRandomValues`, base64url encoded; never log tokens
  - [Medium] Anonymous SELECT bypassing RLS — Mitigation: keep RLS on `trip_shares` fully restrictive; Edge Function uses service role; client never hits table directly
- **Touched files**: `supabase/migrations/0003_share_links.sql`, `supabase/functions/share-trip/index.ts`, `src/api/share.ts`, `src/api/types.ts`, `src/api/index.ts`
- **Verification**: Deno integration test; RLS test proving anon role cannot read `trip_shares` or bypass to `trips` via a revoked token

### ✅ Step 4.2 — Offline cache wiring (TanStack Query persister verification + selective keys)
- **Agent**: backend-specialist
- **Size**: S
- **Task**: The persister is already installed in `app/_layout.tsx`. Add a query-key allowlist via `persistQueryClient` `dehydrateOptions.shouldDehydrateQuery` in a small helper `src/api/offline.ts` — persist `["trips"]`, `["trips", id]`, `["trip-places", id]`, `["trip-legs", id]`; **never persist** `["place-details", …]` (Google ToS) or `["places-autocomplete", …]`. Wire `networkMode: 'offlineFirst'` only for the allowlisted keys. Add `src/api/offline.ts` exporting `isOnline()` and a `useIsOnline()` hook backed by `@react-native-community/netinfo` on native and `window.navigator.onLine` + `online`/`offline` events on web (platform-split).
- **Inputs**: ADR-0005 (cache eviction policy — max age, max size)
- **Expected output**: `src/api/offline.ts` (platform-split); `app/_layout.tsx` edit consuming the allowlist helper; no review/photo cache persisted (grep AsyncStorage dump to confirm)
- **Depends on**: Step 4.0
- **Parallel with**: Step 4.1, Step 4.3, Step 4.4
- **Platform check**: ☐ iOS ☐ Android ☐ Web (native uses AsyncStorage wrapper already in place; web uses AsyncStorage-for-web which is backed by localStorage)
- **Risks**:
  - [Medium] Adding `@react-native-community/netinfo` increases bundle — Mitigation: check with `expo install --check`; confirm it supports all three platforms; fallback to navigator on web if package omits web
  - [Medium] Accidentally caching ToS-protected data — Mitigation: allowlist approach (default: do not persist) + test asserting only allowed keys appear in storage
- **Touched files**: `src/api/offline.native.ts`, `src/api/offline.web.ts`, `src/api/index.ts`, `app/_layout.tsx`
- **Verification**: Component test asserts the dehydrated cache snapshot contains only allowlisted keys after seeding a `place-details` query

### ✅ Step 4.3 — Sentry init (env-guarded, cross-platform)
- **Agent**: backend-specialist
- **Size**: S
- **Task**: Install `@sentry/react-native` (supports iOS + Android + Web via RN + Metro). Add `src/lib/sentry.ts` exporting `initSentry()` that no-ops unless `process.env.EXPO_PUBLIC_SENTRY_DSN` is set. Call `initSentry()` once at the top of `app/_layout.tsx` before any QueryClient setup. Configure `tracesSampleRate: 0.1`, `sendDefaultPii: false`, `release: Constants.expoConfig?.version`, `environment: __DEV__ ? 'dev' : 'production'`. Add an error boundary in `app/_layout.tsx` that reports caught errors via `Sentry.captureException`. Add `sentry-expo` or the official Expo integration per current Sentry docs (verify with WebFetch before coding).
- **Inputs**: ADR-0003 (org/project slug); `EXPO_PUBLIC_SENTRY_DSN` in `.env.example` (empty by default)
- **Expected output**: App runs identically with DSN unset; throwing a test error in dev with DSN set surfaces in Sentry dashboard within 30s; `@sentry/react-native` added to `package.json`; `.env.example` updated
- **Depends on**: Step 4.0
- **Parallel with**: Step 4.1, Step 4.2, Step 4.4
- **Platform check**: ☐ iOS ☐ Android ☐ Web (verify `@sentry/react-native` web support; if gaps, add `@sentry/browser` as a web-only branch via platform-split `sentry.native.ts` / `sentry.web.ts`)
- **Risks**:
  - [Medium] `@sentry/react-native` web path may require `@sentry/browser` — Mitigation: confirm docs; platform-split if needed
  - [Low] DSN accidentally committed — Mitigation: DSN lives in `.env` which is gitignored; `.env.example` stays blank
- **Touched files**: `src/lib/sentry.ts` (± `.native.ts` / `.web.ts`), `app/_layout.tsx`, `.env.example`, `package.json`
- **Verification**: `npm run web` with DSN unset boots normally; unit test ensures `initSentry()` early-returns when DSN is blank

### ✅ Step 4.4 — Map graceful degradation when web key missing
- **Agent**: ui-specialist
- **Size**: S
- **Task**: `src/components/Map.web.tsx` — detect empty `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` at module load; when missing, render a fallback component (`src/components/MapUnavailable.tsx`) showing "Map unavailable — list view below" + the markers rendered as a simple text list with names and day chips. `Map.native.tsx` keeps existing behavior (native keys are in `app.json`).
- **Inputs**: Existing `Map.web.tsx`
- **Expected output**: With web key blank, the Map tab shows the fallback, not a crash or blank iframe
- **Depends on**: None
- **Parallel with**: Step 4.1, Step 4.2, Step 4.3
- **Platform check**: Web-only surface (native path untouched — add a comment stating so)
- **Risks**:
  - [Low] Future devs may remove the guard — Mitigation: unit test asserts fallback renders with blank key
- **Touched files**: `src/components/Map.web.tsx`, `src/components/MapUnavailable.tsx`
- **Verification**: Component test with `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY=''` renders `MapUnavailable`

### ✅ Step 4.5 — `.ics` generator (pure function + download hook)
- **Agent**: backend-specialist
- **Size**: M
- **Task**: `src/lib/ics/generate.ts` — pure function `tripToIcs(trip, places, legs): string` producing a valid RFC 5545 calendar with one VEVENT per place. Anchor each event at `trip.start_date + day_index * 24h + cumulative duration within day`. Use `DTSTART;TZID=<trip.timezone>` per ADR-0004. Include `SUMMARY`, `LOCATION` (lat,lng), `DESCRIPTION` (place name + order). No external deps — hand-roll the CRLF-joined string. Add `src/api/ics.ts` with `useDownloadTripIcs(tripId)` — on web, triggers `<a download>` via a Blob; on native, uses `expo-file-system` + `expo-sharing` to write and share.
- **Inputs**: ADR-0004 (timezone policy — use trip.timezone or floating?)
- **Expected output**: Pure function covered by unit tests with golden-file fixtures; hook downloads a file named `tripvisor-<trip_slug>.ics` on all three platforms
- **Depends on**: Step 4.0
- **Parallel with**: Step 4.1, Step 4.2, Step 4.3, Step 4.4
- **Platform check**: ☐ iOS ☐ Android ☐ Web (platform-split the download hook: `ics.native.ts` uses `expo-sharing`, `ics.web.ts` uses Blob + anchor click)
- **Risks**:
  - [Medium] Calendar apps parse strictly — Mitigation: validate against the RFC 5545 grammar via a reference fixture; test imports into at least one calendar during smoke
  - [Low] File names on Windows vs. iOS — Mitigation: sanitize to `[a-z0-9-]+`
- **Touched files**: `src/lib/ics/generate.ts`, `src/api/ics.native.ts`, `src/api/ics.web.ts`, `src/api/index.ts`, `package.json` (maybe `expo-sharing`, `expo-file-system`)
- **Verification**: Unit test matches a golden `.ics` fixture byte-for-byte (modulo a mocked PRODID + DTSTAMP)

### ✅ Step 4.6 — EmptyState primitive component
- **Agent**: ui-specialist
- **Size**: S
- **Task**: `src/components/EmptyState.tsx` — takes `{ title, body, ctaLabel?, onPress?, icon? }` and renders a centered card with theme tokens. Reusable across trips list, trip detail, add-place, itinerary. A11y: `accessibilityRole="summary"`, focus moves to title on mount. Provide four curated copy variants in an adjacent `src/components/emptyStates.ts` registry.
- **Inputs**: Theme tokens (exist)
- **Expected output**: `EmptyState` renders consistently on all three platforms; registry exports the four variants as typed constants
- **Depends on**: None
- **Parallel with**: Step 4.1, Step 4.2, Step 4.3, Step 4.4, Step 4.5
- **Platform check**: ☐ iOS ☐ Android ☐ Web
- **Risks**: [Low]
- **Touched files**: `src/components/EmptyState.tsx`, `src/components/emptyStates.ts`
- **Verification**: Component test renders each variant; a11y label present

### ✅ Step 4.7 — Wire empty states into existing screens
- **Agent**: ui-specialist
- **Size**: S
- **Task**: Consume `EmptyState` in: `app/(app)/index.tsx` (no trips → "Plan your first trip"), `app/(app)/trip/[id]/index.tsx` itinerary tab (no places → "Add your first place"), `app/(app)/trip/[id]/add.tsx` (blank input → "Search for a place"; no results → "No results — try another query"). Replace any bare "Loading…" or blank branches.
- **Inputs**: `EmptyState` from Step 4.6
- **Expected output**: All four screens show the empty state at the right moment; no whitespace regressions
- **Depends on**: Step 4.6
- **Parallel with**: Step 4.8, Step 4.9
- **Platform check**: ☐ iOS ☐ Android ☐ Web
- **Risks**: [Low]
- **Touched files**: `app/(app)/index.tsx`, `app/(app)/trip/[id]/index.tsx`, `app/(app)/trip/[id]/add.tsx`
- **Verification**: Component tests; Playwright smoke hits each empty state

### ✅ Step 4.8 — Share-link UI (create + revoke in Settings tab; read-only trip route)
- **Agent**: ui-specialist
- **Size**: M
- **Task**: In the Settings tab of `app/(app)/trip/[id]/index.tsx`, add a "Share" section with "Create share link" button → calls `useCreateShareLink` → shows the link + copy-to-clipboard button (platform-split: `expo-clipboard` native, `navigator.clipboard` web) + "Revoke" button. Add a new route `app/share/[token].tsx` that: loads the trip via `useSharedTrip(token)` (calls `share-trip:read`), renders a read-only header, itinerary list, and map (or MapUnavailable fallback from Step 4.4). No auth required. "Powered by Google" footer when any place data shows. No "edit" affordances rendered anywhere on this route.
- **Inputs**: Step 4.1 (API wrappers), Step 4.4 (map fallback), ADR-0002 (route shape)
- **Expected output**: Authenticated user creates + copies + revokes a link from Settings; opening the link in an incognito tab shows the read-only trip view
- **Depends on**: Step 4.1, Step 4.4
- **Parallel with**: Step 4.7, Step 4.9
- **Platform check**: ☐ iOS ☐ Android ☐ Web (on native the "open share link" flow uses `expo-linking`; ensure `tripvisor://share/<token>` and `https://<domain>/share/<token>` both route to the same screen per ADR-0002)
- **Risks**:
  - [High] Deep-link parity between native scheme and web URL — Mitigation: single `app/share/[token].tsx` route; Expo Router + `scheme: "tripvisor"` in `app.json` already configured
  - [Medium] Showing place names/coords on a public URL — Mitigation: confirm with user that this is acceptable; names + coords are not ToS-restricted (reviews/photos/ratings are, and are never fetched by `share-trip:read`)
- **Touched files**: `app/(app)/trip/[id]/index.tsx`, `app/share/[token].tsx`, `src/components/ShareLinkCard.tsx`, `src/api/share.ts`
- **Verification**: Playwright test opens a share URL while logged-out and asserts the read-only view; component test asserts no edit controls present

### ✅ Step 4.9 — `.ics` export UI (Settings tab button)
- **Agent**: ui-specialist
- **Size**: S
- **Task**: Add "Export to calendar (.ics)" button to the Settings tab of `app/(app)/trip/[id]/index.tsx`. Disabled if `trip_places` is empty (empty-state guidance from Step 4.7 covers that). On tap, calls `useDownloadTripIcs(tripId)`. Show a success toast / banner on success, error on failure.
- **Inputs**: Step 4.5
- **Expected output**: On web, tapping triggers a file download; on native, triggers the share sheet with the `.ics` attachment
- **Depends on**: Step 4.5
- **Parallel with**: Step 4.7, Step 4.8
- **Platform check**: ☐ iOS ☐ Android ☐ Web
- **Risks**: [Low]
- **Touched files**: `app/(app)/trip/[id]/index.tsx`
- **Verification**: Playwright test asserts the download triggers and the blob is non-empty; native smoke is deferred user verification

### ✅ Step 4.10 — Tests for Phase 4
- **Agent**: test-specialist
- **Size**: M
- **Task**: (1) Unit tests: `.ics` golden-file fixture, `EmptyState` variants, `MapUnavailable` fallback when key blank, `initSentry()` no-op when DSN blank. (2) Integration: Deno test for `share-trip` Edge Function (create, read, revoke, read-after-revoke returns 404). (3) RLS test: anonymous cannot read `trip_shares` directly; anonymous with a revoked token cannot read trip data via Edge Function. (4) Component tests: empty states render on each of the four screens; share-link Settings section; Map.web fallback. (5) Offline cache assertion: dehydrated cache contains only allowlisted keys.
- **Inputs**: Steps 4.1–4.9 code
- **Expected output**: `npm test` green; `deno test supabase/functions/share-trip/test.ts` green; RLS test passes
- **Depends on**: Steps 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9
- **Parallel with**: (none — tests gate on code)
- **Platform check**: N/A (tests)
- **Risks**: [Medium] Sentry mock needs a stub transport to avoid network — Mitigation: mock `@sentry/react-native` init in tests
- **Touched files**: `src/lib/ics/__tests__/generate.test.ts`, `src/components/__tests__/EmptyState.test.tsx`, `src/components/__tests__/MapUnavailable.test.tsx`, `src/lib/__tests__/sentry.test.ts`, `supabase/functions/share-trip/test.ts`, `tests/rls.test.ts` (extend), `e2e/web/phase-4-polish.spec.ts`

### ✅ Step 4.11 — Live web smoke (Playwright) for Phase 4
- **Agent**: test-specialist
- **Size**: S
- **Task**: Extend `e2e/web/` with `phase-4-polish.spec.ts` covering: (a) create + open share link (anonymous context), (b) `.ics` download button appears + downloads non-empty file, (c) empty state visible on `/trips` when no trips seeded, (d) map fallback renders when `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` unset, (e) offline reload — Playwright `page.context().setOffline(true)` then reload → trips list still shows. Log the session to `docs/smoke/phase-4.md` with 🟢/🟡/🔴 per check. Native smoke deferred to user (no native-only surface added in Phase 4 beyond `expo-clipboard` + `expo-sharing`, noted as deferred).
- **Inputs**: Phase 4 code
- **Expected output**: `docs/smoke/phase-4.md` exists with per-check status; reviewer MUST NOT start if status contains a red blocker
- **Depends on**: Step 4.10
- **Parallel with**: (none)
- **Platform check**: Web surface (native deferred-to-user explicitly)
- **Risks**: [Medium] Playwright download handling differs from real browsers — Mitigation: use `page.waitForEvent('download')`
- **Touched files**: `e2e/web/phase-4-polish.spec.ts`, `docs/smoke/phase-4.md`
- **Verification**: Smoke log committed with all checks green (or any yellow explicitly justified)

### ✅ Step 4.12 — Reviewer pre-exit for Phase 4
- **Agent**: reviewer
- **Size**: S
- **Task**: Full checklist against Phase 4 diff. Focus: (1) Google ToS — no reviews/photos/ratings/hours persisted by `share-trip:read` or in offline cache (grep AsyncStorage schema + inspect share payload); (2) token handling (never logged, 128-bit random, anonymous SELECT fully blocked without Edge Function); (3) Sentry no-op path rigorously guards against DSN presence (no accidental network in dev); (4) cross-platform parity of share-link deep-linking; (5) bundle size delta < 150 KB gz; (6) no Google HTTP key in web bundle (re-grep `expo export --platform web`).
- **Inputs**: Steps 4.1–4.11
- **Expected output**: `docs/reviews/phase-4.md` with findings categorized critical / high / medium / low; no critical / high blocks merge
- **Depends on**: Step 4.11 (smoke must be green)
- **Parallel with**: (none)
- **Platform check**: N/A
- **Risks**: [Low]
- **Touched files**: `docs/reviews/phase-4.md` (reviewer only; planner does not author)
- **Verification**: Report produced; all critical/high resolved before docs step starts

### ✅ Step 4.13 — Docs + plan flip
- **Agent**: docs-specialist
- **Size**: S
- **Task**: Author `docs/features/offline.md`, `share.md`, `ics-export.md`, `sentry.md` (empty-states not a standalone feature — mention in each existing feature doc under "UX polish"). Flip Phase 4 row in `plan.md` + `docs/features/overview.md` to ✅ code-complete (pending live smoke on native). Add a new `docs/adr/` index line if one is maintained.
- **Inputs**: Phase 4 code + review report
- **Expected output**: Four new feature docs; plan.md and overview.md updated; all feature doc "Platforms verified" boxes unchecked (await user native smoke)
- **Depends on**: Step 4.12
- **Parallel with**: (none)
- **Platform check**: N/A
- **Risks**: [Low]
- **Touched files**: `docs/features/offline.md`, `docs/features/share.md`, `docs/features/ics-export.md`, `docs/features/sentry.md`, `docs/features/overview.md`, `plan.md`

## Phase 4 — shipped

Phase 4 shipped offline cache (7-day TanStack Query persister with ToS-safe allowlist), shareable read-only links (`/share/[token]` route + `trip_shares` table + `share-trip` Edge Function), `.ics` calendar export (pure RFC 5545 generator, VTIMEZONE for ~20 IANA zones, CRLF guard via `.gitattributes`), Sentry error monitoring (DSN-gated no-op, `tracesSampleRate: 0.1`, `sendDefaultPii: false`), and empty-state polish across all four primary screens. The reviewer found 3 high + 4 medium + 6 low severity findings across 14 items; 11 were fixed before ship (Problems 1–9, 11–13), 2 were parked with explicit justification — Problem 10 is pre-existing Phase 3 TypeScript debt (routed to Phase 5 hygiene) and Problem 14 is bundle size at the 150 KB gz boundary with no captured baseline (tracked in Phase 5). Next step is user-driven live smoke on iOS, Android, and web with a fully configured Google Maps environment, after which native "Platforms verified" boxes in each feature doc can be ticked and Phase 5 can begin.

## ⚠ Blockers (Phase 4 — four decisions needed from user before Step 4.0 can close)

All four resolved — see ADRs 0002–0005.

---

## Phase 5 — Test hardening (coverage, E2E, property, CI)

**Goal**: Backfill coverage gaps flagged across Phase 1–4 reviews, expand Playwright beyond smoke into happy + key unhappy paths, grow the optimizer property-test net, beef up RLS integration coverage, and wire a lightweight GitHub Actions CI that runs on every PR. Outcome: future changes have automated guardrails.

**Status**: 🚧 Partial — source-code fixes + CI workflow shipped; test-hardening (Steps 5.0–5.5, 5.7) deferred to a follow-up phase per user direction (test-specialist sub-agent removed mid-phase).
See `docs/reviews/phase-5.md` for the reviewer sign-off on the source-code-only changes.
**Entry criteria**:
- Phase 4 is code-complete (reviewer report clean, docs shipped)
- GitHub repo is public or has Actions minutes available (free tier: 2000 min/mo on private repos, unlimited on public — confirm)
**Phase exit criteria** (original — not yet met):
- Jest + Deno coverage reports show ≥ 80% lines on `src/lib/**` and `supabase/functions/**`; ≥ 60% on `src/api/**`; uncovered branches explicitly called out in each feature doc
- Playwright suite covers: signup/login flow (happy + unhappy), create-trip (happy + validation errors), add-place (happy + network error), optimize (happy + upstream 502), manual-edit (reorder + move-to-day + duration + delete), share-link (create + open + revoke + 404), `.ics` download, offline reload
- `fast-check` property tests on optimizer cover: all invariants from Phase 2 Step 10 **plus** stability under duplicate coordinates, all-same-coordinate degenerate case, anchor at first vs. middle vs. last position, shuffled input yielding identical output (via canonicalization)
- Deno tests for every Edge Function assert: Zod rejection for malformed input, 502 when upstream Google returns 500, CORS-deny when Origin not in `ALLOWED_ORIGINS`, field mask correctness, timeout behavior, `?ping` returns 200
- RLS integration tests cover every table: `trips`, `trip_places`, `trip_legs`, `trip_shares`; two-user scenario for each table proves isolation both on SELECT and UPDATE/DELETE
- GitHub Actions workflow `.github/workflows/ci.yml` runs on PR open/update: `npm ci`, `npm run lint`, `npm test`, `deno test supabase/functions/**/test.ts`; fails if any step fails; < 5 min wall-clock on a clean runner
- All tests pass on CI (proves the workflow actually runs them, not just that it exists)
- `docs/smoke/phase-5.md` web smoke: Playwright full suite runs in < 5 min on local and green

**Critical path**: Step 5.0 → Step 5.1 → Step 5.2 → Step 5.3 → Step 5.4 → Step 5.5 → Step 5.6 → Step 5.7 → Step 5.8

### Step 5.0 — Coverage gap analysis
- **Status**: 🚧 Deferred — `docs/reviews/phase-5-gaps.md` was authored but no follow-through review completed; test-specialist removed before step could close.
- **Agent**: reviewer
- **Size**: S
- **Task**: Run `npx jest --coverage` and `deno test --coverage=cov supabase/functions` locally; read `docs/reviews/phase-1.md` through `phase-4.md` for flagged gaps. Produce `docs/reviews/phase-5-gaps.md` listing each uncovered area by file + function, sorted by risk. Flag anything a bug could slip through.
- **Inputs**: All prior review reports + current coverage run
- **Expected output**: `docs/reviews/phase-5-gaps.md` with prioritized list
- **Depends on**: None
- **Parallel with**: (none — gates the rest)
- **Platform check**: N/A
- **Risks**: [Medium] Expo + Jest coverage can under-count platform-split files — Mitigation: run per-platform jest configs if needed; call out known false negatives
- **Touched files**: `docs/reviews/phase-5-gaps.md`
- **Verification**: Report exists; each subsequent step references a line item from it

### Step 5.1 — Optimizer property-test expansion
- **Status**: 🚧 Deferred — test files authored (`src/lib/optimizer/__tests__/property.test.ts`) but not reviewed or validated by test-specialist.
- **Agent**: test-specialist
- **Size**: M
- **Task**: Extend `src/lib/optimizer/__tests__/*.test.ts` with `fast-check` generators covering: duplicate coordinates (all places at same lat/lng), degenerate single-place trips, anchor pinning at first / middle / last position, permutation-invariance (shuffle input → canonicalize output → assert equal), and visitMinutes extremes (0 and 12h). Add shrinking-friendly generators.
- **Inputs**: Step 5.0 (gaps referencing optimizer)
- **Expected output**: New property tests in `src/lib/optimizer/__tests__/`; `npm test` green with `--coverage` showing lift
- **Depends on**: Step 5.0
- **Parallel with**: Step 5.2, Step 5.3, Step 5.4
- **Platform check**: N/A (pure function)
- **Risks**: [Medium] Property tests may be slow — Mitigation: cap `numRuns` at 100 for CI, 500 locally via env flag
- **Touched files**: `src/lib/optimizer/__tests__/property.test.ts`

### Step 5.2 — Edge Function Deno test coverage
- **Status**: 🚧 Deferred — expanded test files exist across 5 Edge Functions + new `supabase/functions/optimize-trip/test.ts`; not reviewed or validated by test-specialist.
- **Agent**: test-specialist
- **Size**: M
- **Task**: For each of `places-autocomplete`, `place-details`, `distance-matrix`, `directions-polyline`, `optimize-trip`, `share-trip`: ensure tests cover Zod rejection (malformed input → 400), upstream 500 → 502 shape, CORS deny when Origin missing/unlisted, field mask correctness (assert outgoing `X-Goog-FieldMask` header), timeout → 504, `?ping` → 200. Fill gaps flagged in Step 5.0.
- **Inputs**: Step 5.0
- **Expected output**: `deno test supabase/functions/**/test.ts` green with ≥ 80% coverage on function bodies
- **Depends on**: Step 5.0
- **Parallel with**: Step 5.1, Step 5.3, Step 5.4
- **Platform check**: N/A (server)
- **Risks**: [Low]
- **Touched files**: `supabase/functions/*/test.ts`

### Step 5.3 — RLS integration test expansion
- **Status**: 🚧 Deferred — `tests/rls.trip-places-legs.test.ts` authored with two-user matrix; not reviewed or validated by test-specialist against a live local Supabase stack.
- **Agent**: test-specialist
- **Size**: M
- **Task**: Extend `tests/rls.test.ts` with per-table two-user scenarios for `trips`, `trip_places`, `trip_legs`, `trip_shares`. For each: user A creates a row; user B should not see it via SELECT; user B should not UPDATE or DELETE it; anonymous role should not see it. Reuse the existing local-Supabase helpers.
- **Inputs**: Step 5.0
- **Expected output**: Extended `tests/rls.test.ts`; runs against local Supabase; green
- **Depends on**: Step 5.0
- **Parallel with**: Step 5.1, Step 5.2, Step 5.4
- **Platform check**: N/A
- **Risks**: [Medium] Requires local Supabase running for the suite — Mitigation: skip with clear message when not running; CI spins it up (Step 5.6)
- **Touched files**: `tests/rls.test.ts`

### Step 5.4 — Playwright happy + unhappy paths on web
- **Status**: 🚧 Deferred — `e2e/web/phase-5-happy.spec.ts`, `phase-5-unhappy.spec.ts`, and helpers in `e2e/web/helpers/` are authored but not validated against a live stack (21 tests skipped in smoke; no live Supabase during test run).
- **Agent**: test-specialist
- **Size**: L
- **Task**: Add `e2e/web/phase-5-full.spec.ts` (or split per feature) covering the full Phase 5 exit-criteria list. Use Playwright's `page.route()` to mock Edge Function responses for unhappy paths (502 on optimize, 400 on autocomplete, network offline during add-place). Use a seed helper to create fixture trips via Supabase service role before each test. Keep suite under 5 minutes wall-clock.
- **Inputs**: Step 5.0
- **Expected output**: `e2e/web/` suite covers all listed scenarios; `npm run test:e2e` green
- **Depends on**: Step 5.0
- **Parallel with**: Step 5.1, Step 5.2, Step 5.3
- **Platform check**: Web
- **Risks**:
  - [Medium] Flakiness on TanStack Query retries — Mitigation: disable retries via a test-mode QueryClient override
  - [Medium] Local Supabase must be running — Mitigation: `webServer` config already starts Expo; add a check + friendly skip if Supabase offline
- **Touched files**: `e2e/web/*.spec.ts`, `e2e/web/helpers/seed.ts`

### Step 5.5 — Code-coverage thresholds in Jest
- **Status**: 🚧 Deferred — thresholds are set in `jest.config.js` (global 50%, `src/lib/**` 80%, `src/api/**` 15%) and the `test:coverage` script exists in `package.json`, but the thresholds are aspirational and have not been stress-tested against the actual coverage output.
- **Agent**: test-specialist
- **Size**: S
- **Task**: Add `jest.config.js` `coverageThreshold` — `src/lib/**: 80% lines`, `src/api/**: 60% lines`, `global: 50% lines`. Emit HTML coverage report under `coverage/`. Hook `npm run test:coverage` script.
- **Inputs**: Steps 5.1–5.4 (coverage must already be high enough)
- **Expected output**: `npm test -- --coverage` fails when thresholds drop; passes with current code
- **Depends on**: Steps 5.1, 5.2, 5.3, 5.4
- **Parallel with**: (none)
- **Platform check**: N/A
- **Risks**: [Medium] Over-tight thresholds block future PRs — Mitigation: start conservative (the numbers above); raise in a follow-up if coverage grows
- **Touched files**: `jest.config.js` (or `jest.config.ts`), `package.json`

### Step 5.6 — GitHub Actions CI workflow
- **Status**: ✅ Done — `.github/workflows/ci.yml` shipped 2026-04-25 (commit `a2a24e3`). Runs Jest + Deno on PR + push to master. Playwright deferred to Phase 6. M2 globstar bug fixed by reviewer before ship (Deno step now passes `supabase/functions/` directory instead of glob). See `docs/reviews/phase-5.md`.
- **Agent**: backend-specialist
- **Size**: M
- **Task**: Create `.github/workflows/ci.yml` running on `pull_request` + `push` to `master`. Steps: checkout, setup-node 20, `npm ci`, `npm run lint`, `npm test -- --coverage`, setup-deno, `deno test supabase/functions/**/test.ts`. Cache `~/.npm` + Deno cache. Do **not** run Playwright in CI yet (needs browser + Supabase stack — Phase 6 concern); add a TODO comment. Do not leak secrets — use `secrets.SUPABASE_SERVICE_ROLE_KEY` only if integration tests need it, otherwise skip.
- **Inputs**: Steps 5.1–5.5 produce a green local baseline
- **Expected output**: PRs show a passing "CI" check; fails on any test/lint break; < 5 min wall-clock
- **Depends on**: Steps 5.1, 5.2, 5.3, 5.5
- **Parallel with**: Step 5.4
- **Platform check**: N/A (CI infra)
- **Risks**:
  - [Medium] Jest on Node 20 vs. Expo Metro mismatch — Mitigation: align via `jest-expo` already in deps
  - [Low] Action minutes on private repo — Mitigation: keep suite lean; confirm user plan in Step 5.0 decisions
- **Touched files**: `.github/workflows/ci.yml`

### Step 5.7 — Live web smoke + CI green on a PR
- **Status**: 🚧 Deferred — `docs/smoke/phase-5.md` exists with partial results (Jest 137 pass, Deno 60 pass, Playwright 21 skipped). Live CI run on a real PR is gated on the repo being pushed to GitHub, which is a pre-existing blocker.
- **Agent**: test-specialist
- **Size**: S
- **Task**: Open a throwaway PR containing only a whitespace change to trigger CI; observe the run; capture the summary + timings into `docs/smoke/phase-5.md`. Close PR without merge. Also run the full Playwright suite locally and log result.
- **Inputs**: Step 5.6
- **Expected output**: `docs/smoke/phase-5.md` with CI run URL + green checks + Playwright timings; reviewer MUST NOT start if red
- **Depends on**: Step 5.6
- **Parallel with**: (none)
- **Platform check**: Web + CI
- **Risks**: [Low]
- **Touched files**: `docs/smoke/phase-5.md`

### Step 5.8 — Reviewer pre-exit for Phase 5
- **Status**: ✅ Done (scoped to source-code changes only) — `docs/reviews/phase-5.md` authored 2026-04-25. Scoped narrowly: optimizer anchor fix, `optimize-trip` thenable fix, and CI workflow. No critical or high findings. M2 fixed (Deno glob); M1 (advisory lock no-op) + L1–L3 parked. Full coverage/E2E/property-test review not completed (deferred with Steps 5.0–5.5, 5.7).
- **Agent**: reviewer
- **Size**: S
- **Task**: Verify: (1) coverage thresholds enforced, (2) no flaky tests (re-run Playwright 3× locally), (3) CI workflow is minimal and fast, (4) RLS expansion actually probes both UPDATE and DELETE per table, (5) property-test `numRuns` tuned for CI time.
- **Inputs**: Phase 5 code
- **Expected output**: `docs/reviews/phase-5.md` with no critical/high findings
- **Depends on**: Step 5.7
- **Parallel with**: (none)
- **Platform check**: N/A
- **Risks**: [Low]

### Step 5.9 — Docs + plan flip
- **Status**: ✅ Done — `docs/features/test-hardening.md` written, `plan.md` and `docs/features/overview.md` updated 2026-04-25. Phase marked partial, not done.
- **Agent**: docs-specialist
- **Size**: S
- **Task**: Write a short `docs/features/test-hardening.md` (or a subsection under an existing "quality" doc) summarizing coverage thresholds, test kinds, CI contract, how to run locally. Flip Phase 5 row in `plan.md` to 🚧 Partial. Add a "Running the test suite" section to `CLAUDE.md`? — **NO**, planner must not edit `CLAUDE.md`; docs-specialist owns that if needed. Restate as a plan note for docs-specialist to consider requesting that edit via the main assistant.
- **Inputs**: Phase 5 code + review
- **Expected output**: Feature doc shipped; plan updated
- **Depends on**: Step 5.8
- **Parallel with**: (none)
- **Platform check**: N/A
- **Risks**: [Low]
- **Touched files**: `docs/features/test-hardening.md` (new), `plan.md`, `docs/features/overview.md`

## ⚠ Blockers (Phase 5)

1. **GitHub Actions plan / repo visibility**: Private repo free tier gives 2000 min/mo; public is unlimited. Confirm the repo visibility so Step 5.6 can size the CI budget (run Playwright in CI later, or keep it local-only). If private + low budget, keep CI lean as planned and defer Playwright-in-CI to a later phase.
2. **Test-specialist sub-agent removed 2026-04-25 by user**: Full test-hardening exit criteria (Steps 5.0–5.5, 5.7) deferred to a future phase. Test files were authored but are uncertified — they have not been reviewed or run against a live stack.

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

---

## Phase 6 — Phase 4 web close-out (live smoke + small polish)

**Goal**: Run the deferred Phase 4 web smoke end-to-end against local Supabase, fix any small breakage surfaced, and flip Phase 4 to ✅ Done on the web target. No new feature work; no Google Maps keys required (share / .ics / offline / Sentry / empty-states paths are key-independent).
**Status**: 🚧 **Partial** — Step 6.0 (stack ready) + Step 6.4 (UX polish: Button accessibilityLabel + jest config typo) shipped 2026-04-25. Steps 6.1–6.3, 6.5–6.7 (the actual smoke run + triage) **skipped per user direction** — user elected not to run live Playwright smoke, so Phase 4 stays 🚧 awaiting live smoke (now deferred indefinitely or to a future user-driven run). Steps 6.6, 6.8, 6.9 reduced to "no-op / partial" because there is nothing to review or flip.
**Last updated**: 2026-04-25

**Direction chosen**: Option C (Phase 4 live-smoke close-out + small UX polish), with a thin slice of Option B (verify the existing Playwright `phase-4-polish.spec.ts` actually passes against local Supabase, not just gate-skips). Rejected Option A because it needs Apple Developer + Google Play accounts the user has not provisioned. Rejected full Option B because the test-specialist sub-agent was removed mid-Phase-5 and the deferred coverage/property/RLS work needs that role.

**Entry criteria**:
- Phase 4 code-complete (already true — commit `a2a24e3`)
- User can run `npx supabase start` locally (Docker / Supabase CLI installed)
- User has filled `.env` with `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` and the local anon + service-role keys printed by `supabase start`
- User has applied migrations via `npx supabase db reset` (includes `0003_share_links.sql`)

**Phase exit criteria**:
- All 6 checks in `e2e/web/phase-4-polish.spec.ts` execute (no `test.skip`) and 5 of 6 are green; any single yellow must be explicitly justified in the smoke log (e.g. "Sentry DSN-present branch deferred to user smoke" — see Phase 4 Finding 1)
- `docs/smoke/phase-4.md` updated 2026-04-25 (or later) with per-check 🟢/🟡/🔴 status, replacing the current 🟡 Partial state
- Phase 4 row in this table flipped from "🚧 Code complete · awaiting live smoke" to "✅ Done (web; native deferred to user smoke)"
- `docs/features/overview.md` Phase 4 row reflects the same flip; web "Platforms verified" boxes ticked in `docs/features/{offline,share,ics-export,sentry}.md`
- Any small bugs surfaced during smoke and fixable in ≤ 1 hour each are shipped; anything bigger is logged in `docs/reviews/phase-6.md` as a follow-up and does NOT block this phase
- Native iOS / Android smoke remains deferred to user — explicitly noted, not a blocker

**Critical path**: Step 6.0 → Step 6.1 → Step 6.2 → Step 6.3 → Step 6.5 → Step 6.6 → Step 6.7 → Step 6.8 → Step 6.9

(Step 6.4 is parallel polish; not on the critical path.)

### Step 6.0 — Confirm local-stack readiness (no code)
- **Agent**: backend-specialist
- **Size**: S
- **Task**: Verify `supabase/config.toml` exists and `npx supabase start` boots (Postgres + Auth + Edge runtime). Confirm `.env` has `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Confirm `npx supabase db reset` applies all four migrations cleanly (including `0003_share_links.sql`). Capture the anon/service keys for use in Steps 6.2 + 6.5. **Do not modify any code.** If anything fails, stop and surface a blocker — do NOT auto-fix.
- **Inputs**: User-provisioned Docker + Supabase CLI; existing migrations in `supabase/migrations/`
- **Expected output**: Plain-text confirmation comment in the conversation log: "Supabase up at 127.0.0.1:54321; migrations applied; anon key + service key available for smoke." Anon URL reachable via `curl http://127.0.0.1:54321/rest/v1/` returning 401 (auth required, server alive).
- **Depends on**: None
- **Parallel with**: (none — gates the rest)
- **Platform check**: N/A (infra)
- **Risks**:
  - [Blocker] Supabase CLI not installed → Mitigation: stop and ask user to run `npm install -g supabase` (project rule forbids global installs by Claude — user must do this) or use `npx supabase` if version pin is available
  - [Medium] Migration `0003_share_links.sql` may fail on a fresh DB if a foreign-key constraint references a Phase 5 table that was added but not migrated — Mitigation: read the migration first; flag if it has new dependencies
- **Touched files**: None (read-only verification)
- **Verification**: `curl http://127.0.0.1:54321/rest/v1/` returns 401; `psql` / Supabase Studio shows `trips`, `trip_places`, `trip_legs`, `trip_shares` tables

### Step 6.1 — Boot the web app + sign in once for fixture session
- **Agent**: ui-specialist
- **Size**: S
- **Task**: `npm run web` to start the Expo dev server on `:8081`. Hit the magic-link sign-in flow once (email → Mailpit at `127.0.0.1:54324` → click link → land on `/trips`). Confirm session is persisted to localStorage (Phase 1 already shipped this). Create one fixture trip with 2–3 manually-added places via the UI (no Google Maps key needed — places can be entered as raw lat/lng via the existing manual add path, or from the autocomplete fallback if the app handles missing key gracefully). **Do not modify any code.**
- **Inputs**: Step 6.0 stack live; `.env` populated
- **Expected output**: Authenticated browser session stored; one trip exists in `public.trips` with ≥ 2 rows in `public.trip_places`. Browser tab left open for Step 6.2.
- **Depends on**: Step 6.0
- **Parallel with**: (none)
- **Platform check**: Web only (this phase is web close-out; native deferred)
- **Risks**:
  - [Medium] Manual place-add UI may require a Google Place ID and break without the autocomplete key. Mitigation: if blocked, seed `trip_places` directly via Supabase Studio with a hand-written `google_place_id` like `'manual-fixture-1'` and lat/lng — verify whether the schema permits this (`google_place_id` may have a unique constraint but not a Google-format check). If blocked here, surface as blocker and stop.
  - [Low] Magic-link delivery time → Mitigation: Mailpit is local, instant
- **Touched files**: None (UI interaction only); fixture rows in Supabase
- **Verification**: `/trips` shows the fixture trip; clicking it shows the trip detail screen with the 2–3 places

### Step 6.2 — Run `phase-4-polish.spec.ts` against the live stack
- **Agent**: backend-specialist
- **Size**: M
- **Task**: With Step 6.0 stack + Step 6.1 fixture in place, execute `npx playwright test --project=chromium e2e/web/phase-4-polish.spec.ts`. Capture per-check pass/fail/skip output verbatim. **Do not modify the spec file** unless it's outright broken (e.g. typo, wrong selector); if a check fails because the app misbehaves, route the failure to Step 6.3 for the owning specialist. Record raw output to a scratch file the smoke step (6.7) will summarise. Tests are best-effort; no separate review.
- **Inputs**: Steps 6.0, 6.1
- **Expected output**: One of three states per check — green (pass), red (fail with copied stack trace), or yellow (skipped with documented reason, e.g. Sentry DSN absent). Total 6 checks accounted for.
- **Depends on**: Step 6.1
- **Parallel with**: (none — direct sequence)
- **Platform check**: Web only
- **Risks**:
  - [Medium] Auth state in Playwright may not pick up the localStorage session from Step 6.1 (different browser context) — Mitigation: if Playwright opens a fresh context, the spec must seed its own auth via the helpers in `e2e/web/helpers/`; if that's broken, use Playwright's `storageState` option pointing at the Step 6.1 session export (one-line addition acceptable, scope-creep beyond that is a follow-up)
  - [High] One or more Phase 4 features may not work end-to-end — this is the whole point of the smoke; record findings, route fixes to Step 6.3
  - [Low] Playwright download handling for `.ics` differs from real browsers — Mitigation: Phase 4 spec already uses `page.waitForEvent('download')`
- **Touched files**: None (spec runs as-is)
- **Verification**: Command exits with at least 5/6 checks green or with a written justification per failure

### Step 6.3 — Triage + fix small failures from 6.2
- **Agent**: ui-specialist (most likely owner — share UI / empty states / map fallback) OR backend-specialist (if a failure traces to `share-trip` Edge Function or migration)
- **Size**: M
- **Task**: For each red check from Step 6.2, decide in 5 minutes whether the fix is ≤ 1 hour (in scope) or larger (parked as follow-up in `docs/reviews/phase-6.md`). Ship the small fixes. Examples of in-scope: missing `accessibilityLabel` causing a Playwright selector miss, a hard-coded URL pointing at a stale Edge Function path, a button label changed since the spec was written. Examples of parked: re-architecting share-token issuance, swapping the `.ics` library, fixing the Sentry DSN-coverage gap. **Tests for any fix are best-effort, written inline by the owning specialist; no separate test-specialist review.** If 6.2 was fully green, this step closes immediately as a no-op and the phase advances to Step 6.5.
- **Inputs**: Step 6.2 output
- **Expected output**: One commit per fix (small, focused); follow-up items appended to `docs/reviews/phase-6.md`; `docs/reviews/phase-6.md` exists even if empty (so 6.6 reviewer has something to read)
- **Depends on**: Step 6.2
- **Parallel with**: Step 6.4
- **Platform check**: Web; if a fix touches a `.native.tsx` file, mark the corresponding native verification as deferred to user
- **Risks**:
  - [Medium] Scope creep on "small fixes" — Mitigation: hard 1-hour-per-fix budget; if a fix exceeds it, park and continue
  - [Low] Re-running `phase-4-polish.spec.ts` after each fix slows feedback — Mitigation: re-run only the failing check during dev, full suite once at end of step
- **Touched files**: As needed in `app/`, `src/`, or `supabase/functions/share-trip/index.ts`. Migration files MUST NOT be edited (would require `db reset` and reseed); flag any required migration change as a parked follow-up.
- **Verification**: After fixes, re-run of `phase-4-polish.spec.ts` shows ≥ 5/6 green

### Step 6.4 — Two small UX polish items (parallel with 6.3)
- **Agent**: ui-specialist
- **Size**: S
- **Task**: Two specific polish items the user has not requested but which Phase 4 review (`docs/reviews/phase-4.md`) flagged at low severity and which can be batched here without scope creep:
  1. Fix the pre-existing `Button.test.tsx` loading-state accessibility regression (Phase 5 smoke Finding 1): add `accessibilityLabel` to the button wrapper so RNTL `getByRole('button', {name})` succeeds when the button is in `loading=true` state.
  2. Fix `jest.config.js` `setupFilesAfterEach` typo to `setupFilesAfterEnv` (Phase 5 smoke Finding 2). Confirm `jest-setup.ts` is empty or doesn't break tests when actually loaded — if it does break tests, revert and park.
- **Inputs**: Phase 5 smoke findings 1 + 2
- **Expected output**: Both fixes committed; `npm test` still green (or improved)
- **Depends on**: None
- **Parallel with**: Step 6.3
- **Platform check**: Web (Button is cross-platform, the fix should work on all three; native verification deferred to user)
- **Risks**:
  - [Low] Activating `setupFilesAfterEnv` may load a stale `jest-setup.ts` that breaks tests — Mitigation: read the file first; if it has stale content, scope is "fix typo" not "rewrite setup"; revert and park if the fix breaks tests
- **Touched files**: `src/components/Button.tsx`, `jest.config.js`
- **Verification**: `npm test` exits 0; previously failing `Button.test.tsx` cases now pass

### Step 6.5 — Re-run full Phase 4 spec end-to-end
- **Agent**: backend-specialist
- **Size**: S
- **Task**: After Step 6.3 fixes (if any) land, re-execute `npx playwright test --project=chromium e2e/web/phase-4-polish.spec.ts` once more, end-to-end, no flake-retries. Capture full output verbatim for the smoke log.
- **Inputs**: Step 6.3 fixes (or Step 6.2 output if 6.3 was a no-op)
- **Expected output**: Final test results to commit into `docs/smoke/phase-4.md` in Step 6.7
- **Depends on**: Step 6.3, Step 6.4 (if 6.4 changed jest config it should not affect Playwright, but we serialise to be safe)
- **Parallel with**: (none)
- **Platform check**: Web only
- **Risks**: [Low]
- **Touched files**: None
- **Verification**: ≥ 5/6 green; remaining yellow has a written justification (typically Sentry DSN-present branch)

### Step 6.6 — Reviewer pass on Phase 6 changes
- **Agent**: reviewer
- **Size**: S
- **Task**: Read every diff introduced in Phase 6 (Steps 6.3 + 6.4). Confirm: (1) no Google ToS violations re-introduced (no `rating`, `reviews`, `photos`, `opening_hours` persisted to AsyncStorage or to any new schema); (2) no Google HTTP API key ends up in the web bundle (re-grep `dist/` if a web export was performed; otherwise grep the source diff for `EXPO_PUBLIC_GOOGLE_MAPS_HTTP_KEY` or similar — there should be none); (3) RLS still holds on `trips`, `trip_places`, `trip_legs`, `trip_shares` (no new public-grant statements snuck in via fix commits); (4) accessibility fix in 6.4 doesn't paper over real screen-reader issues. **MUST NOT start if Step 6.5 shows a red blocker** — main assistant loops back to 6.3 first.
- **Inputs**: Phase 6 diff; Step 6.5 smoke result
- **Expected output**: `docs/reviews/phase-6.md` with critical / high / medium / low findings; no critical or high blocks the docs flip in Step 6.8
- **Depends on**: Step 6.5
- **Parallel with**: (none)
- **Platform check**: N/A
- **Risks**: [Low]
- **Touched files**: `docs/reviews/phase-6.md`
- **Verification**: Report committed; main assistant verifies no critical/high before Step 6.8

### Step 6.7 — Update the smoke log
- **Agent**: backend-specialist
- **Size**: S
- **Task**: Rewrite `docs/smoke/phase-4.md` to reflect the Step 6.5 results: per-check 🟢/🟡/🔴, dropping the current ⏸ "skipped due to environment prerequisites" lines. Keep the existing test-counts table and findings sections; append a new "Phase 6 close-out" section at the top noting the 2026-04-25-or-later run date, the build commit, and the disposition of each check. Native iOS/Android remains "deferred to user smoke" — keep that line. Also create / update `docs/smoke/phase-6.md` with a one-paragraph pointer to `docs/smoke/phase-4.md` and `docs/reviews/phase-6.md` for orientation.
- **Inputs**: Step 6.5 output
- **Expected output**: `docs/smoke/phase-4.md` shows ≥ 5/6 green at the top; `docs/smoke/phase-6.md` exists as a thin index page
- **Depends on**: Step 6.5
- **Parallel with**: Step 6.6
- **Platform check**: Web (native deferred line preserved)
- **Risks**: [Low]
- **Touched files**: `docs/smoke/phase-4.md`, `docs/smoke/phase-6.md`
- **Verification**: Smoke log shows current status; reviewer (6.6) reads it and signs off

### Step 6.8 — Docs + plan flip
- **Agent**: docs-specialist
- **Size**: S
- **Task**: Flip the Phase 4 row in the top-of-file table to "✅ Done (web; native deferred to user smoke)". Tick the web "Platforms verified" boxes in `docs/features/offline.md`, `docs/features/share.md`, `docs/features/ics-export.md`, `docs/features/sentry.md` (whichever already have such boxes — do not invent new ones; if a feature doc lacks the table, leave it alone and note the gap in `docs/reviews/phase-6.md` as a follow-up). Update `docs/features/overview.md` Phase 4 row similarly. Add a one-paragraph "Phase 6 — close-out" entry under the Phase 5 close-out section in this `plan.md`, summarising what shipped (smoke green; small accessibility fix on Button; jest config typo fixed). Also flip the Phase 6 row in this table to ✅ Done. Do NOT edit `CLAUDE.md` (planner project rule forbids; if `CLAUDE.md` needs a "running the smoke" note, route via main assistant).
- **Inputs**: Step 6.6 review (no critical/high); Step 6.7 smoke log
- **Expected output**: Tables + feature docs reflect the new state; `plan.md` has a Phase 6 close-out paragraph
- **Depends on**: Step 6.6, Step 6.7
- **Parallel with**: (none)
- **Platform check**: N/A
- **Risks**:
  - [Low] Feature docs may not have a "Platforms verified" table for every Phase 4 feature — Mitigation: scope is "tick where the box exists"; do not add new tables in this phase
- **Touched files**: `plan.md`, `docs/features/overview.md`, `docs/features/offline.md`, `docs/features/share.md`, `docs/features/ics-export.md`, `docs/features/sentry.md`
- **Verification**: Phase 4 row reads ✅ Done on web; Phase 6 row reads ✅ Done; feature-doc web boxes ticked

### Step 6.9 — Final sanity check
- **Agent**: reviewer
- **Size**: S
- **Task**: Read the final state of `plan.md` + `docs/features/overview.md` + `docs/smoke/phase-4.md`. Confirm: (1) Phase 4 row says ✅ Done web on every page; (2) no claim is made about native or about Google-Maps-gated checks (Phases 2/3 are still 🚧 awaiting keys); (3) `docs/reviews/phase-6.md` exists and is internally consistent with the smoke log; (4) no `test-specialist` was assigned anywhere in Phase 6. Surface any inconsistency for docs-specialist to fix; otherwise sign off.
- **Inputs**: Step 6.8 outputs
- **Expected output**: One-paragraph sign-off appended to `docs/reviews/phase-6.md`, or a list of doc inconsistencies for 6.8 to re-do
- **Depends on**: Step 6.8
- **Parallel with**: (none)
- **Platform check**: N/A
- **Risks**: [Low]
- **Touched files**: `docs/reviews/phase-6.md` (append-only)
- **Verification**: Sign-off paragraph present; phase is closed

## ⚠ Blockers (Phase 6 — must be cleared before Step 6.0)

1. **Local Supabase stack must be reachable**: User has to run `npx supabase start` and confirm Postgres + Auth + Edge runtime are healthy. Without this, every Step 6.0+ stalls. (Pre-existing project blocker, listed because Phase 6 is the first phase that hard-requires it.)
2. **`.env` must contain local anon + service-role keys**: Printed by `supabase start`. The smoke spec needs these via `process.env.EXPO_PUBLIC_SUPABASE_URL` etc. Not the same as the leaked-PAT rotation issue (which is about the Supabase Personal Access Token for CLI auth against the cloud project, irrelevant to local).
3. **Pre-existing blockers carried forward — NOT in scope for Phase 6**:
   - Google Maps API keys (Places API New + Routes API) — still ungated; Phase 2/3 smoke remains gated. Phase 6 does NOT attempt to clear these.
   - Leaked Supabase PAT rotation — still pending. Phase 6 uses local Supabase only; cloud PAT is irrelevant.
   - EAS account / Apple Developer / Google Play Developer — still pending. Phase 6 is web-only; native is explicitly deferred.

## Phase 6 — non-goals (explicit)

- **Not** running the Phase 5 deferred test work (Steps 5.0–5.5, 5.7) — that needs a `test-specialist` which the user has removed. Coverage thresholds, property-test certification, RLS expansion certification, and Playwright-in-CI all stay deferred.
- **Not** clearing any of the three pre-existing blockers above.
- **Not** running native (iOS/Android) smoke — deferred to user.
- **Not** addressing Phase 4 reviewer findings beyond the two small ones in Step 6.4.
- **Not** flipping Phases 2 / 3 status — they stay 🚧 until Google Maps keys are provisioned.

## Phase 7 — Trip lifecycle (archive / duplicate) + Settings screen (theme toggle + delete account)

**Goal**: Ship visible product progress on two independent surfaces that need no Google Maps keys, no EAS, and no native account: (a) per-trip Archive / Duplicate / Delete actions with a hidden-by-default "Archived" filter on the trips list, and (b) a minimal `/(app)/settings` screen exposing the user email, persisted theme preference (light / dark / system), and "Delete account" (cascade RPC + auth admin delete).
**Status**: ✅ Done — shipped 2026-04-25; reviewer sign-off (`docs/reviews/phase-7.md`); M1 fixed inline; M2 + lows parked as follow-ups.
**Last updated**: 2026-04-25

**Direction chosen**: Blend of Direction 2 (trip lifecycle) as the headline and Direction 1's smallest valuable slice (Settings screen with theme + delete account) as parallel polish. Rejected Direction 3 because it sits squarely on Google-key-gated optimizer territory. Rejected Direction 4 because it needs an EAS build to verify and the EAS account is unprovisioned. Rejected Direction 5 (cost rollup / printable view) as a single-direction phase because it adds less behavioural surface than archive + duplicate; it is parked as a Phase 8 candidate. The blended pick maximises shipping product per step: every step lands a user-visible feature or a small migration that unblocks one, and nothing depends on the three carried-forward blockers (Google keys, leaked PAT, EAS).

**Entry criteria**:
- Phase 6 partial close-out is the current state (no further action needed there)
- `src/api/trips.ts` and `src/components/TripCard.tsx` are stable (last touched in Phase 3); Phase 7 will extend, not rewrite
- `src/theme/ThemeProvider.tsx` already exposes a controllable theme context (confirmed via `src/theme/index.ts` export of `useThemeControls`); Phase 7 only persists the user's choice, not the provider rewiring
- User has NOT requested Google-keys provisioning, EAS provisioning, or PAT rotation in this phase — Phase 7 must not depend on any of those

**Phase exit criteria**:
- A user can open any trip card's overflow menu and choose **Archive** → the trip disappears from the default trips list and is reachable via an "Archived" filter / segmented control on `/trips`
- A user can choose **Duplicate** on any trip → a new trip appears in the list with title `"<original> (copy)"`, all `trip_places` rows cloned (with their `visit_duration_minutes` and `notes`), `trip_legs` deliberately NOT cloned (will be recomputed when optimizer runs), and the new trip is unarchived even if the source was archived
- A user can choose **Unarchive** on an archived trip → it returns to the default list
- The existing **Delete** action is reachable from the same overflow menu (no behavioural change; consolidation only)
- A user can navigate to `/(app)/settings`, see their email (read-only), pick Light / Dark / System theme, and the choice persists across reloads on web (AsyncStorage on native, `localStorage` via the same `storage` adapter on web)
- A user can press **Delete account** in Settings, confirm via a destructive-style confirmation dialog, and have all their trips + child rows + auth user deleted in one server-side call; the UI then signs them out and routes to `/(auth)/login`
- All three platforms (iOS, Android, Web) render the new Settings screen and the new TripCard overflow menu without layout breaks (visual confirmation; native verification deferred to user as standard for this project)
- `docs/features/overview.md` has a row for "Trip archive / duplicate" and "Account settings (theme, delete account)" with status reflecting Phase 7 completion
- A short ADR exists at `docs/adr/0001-trip-duplicate-semantics.md` recording the decision to clone places but not legs (so the optimizer recomputes), which is the only non-obvious design call in this phase

**Critical path**: Step 7.1 → Step 7.2 → Step 7.3 → Step 7.6 → Step 7.8 → Step 7.9 → Step 7.10

(Steps 7.4 and 7.5 are parallel UI work on the Settings surface; Step 7.7 parallels 7.6 on the same critical-path tier.)

### Step 7.1 — ADR for trip-duplicate semantics
- **Status**: ✅ Done
- **Agent**: planner
- **Size**: XS
- **Task**: Author `docs/adr/0001-trip-duplicate-semantics.md` recording: (1) duplicating a trip clones `trip_places` (with `user_title`, `category`, `visit_duration_minutes`, `notes`, `lat`, `lng`, `google_place_id`, but NOT `day_index` / `order_in_day` — those reset to `null` so the optimizer can re-place them); (2) does NOT clone `trip_legs` (recomputed on next optimize); (3) does NOT clone `trip_days` (recomputed); (4) the new trip is `archived_at = null` regardless of source state. Format per the planner ADR template (Context / Decision / Alternatives considered / Consequences). One screen max.
- **Inputs**: This phase plan; existing schema in `supabase/migrations/0001_init.sql`
- **Expected output**: `docs/adr/0001-trip-duplicate-semantics.md` exists; Step 7.3 RPC author reads it before writing SQL
- **Depends on**: None
- **Parallel with**: Step 7.2
- **Platform check**: N/A (doc only)
- **Risks**:
  - [Low] ADR may need a follow-up if Step 7.3 surfaces a constraint we missed (e.g. unique `(trip_id, google_place_id)` partial index forcing a different copy strategy) — Mitigation: re-edit ADR if needed; status stays "accepted" but the Decision section gets a one-line amendment
- **Touched files**: `docs/adr/0001-trip-duplicate-semantics.md`

### Step 7.2 — Migration: `trips.archived_at` + `duplicate_trip` RPC stub
- **Status**: ✅ Done
- **Agent**: backend-specialist
- **Size**: S
- **Task**: Add `supabase/migrations/0004_trip_lifecycle.sql` that: (1) adds `archived_at timestamptz` to `public.trips` (nullable, default null); (2) adds a partial index `create index if not exists trips_user_active_idx on public.trips(user_id) where archived_at is null;` to keep the default list query fast; (3) creates an empty stub `create or replace function public.duplicate_trip(p_trip_id uuid) returns uuid` that returns `null` for now and will be filled in Step 7.3 — the stub exists so this migration ships independently and Step 7.3 can `create or replace` it without re-migrating; (4) creates an empty stub `create or replace function public.delete_account_cascade() returns void` that returns `void` for now. Both stubs `language plpgsql security definer set search_path = public, auth` so Step 7.3 / 7.6 can fill them. RLS policies on `trips` already gate by `user_id`; verify the existing policy still permits filtering by `archived_at` from the client (it should — the column is on `trips`, the policy reads `auth.uid() = user_id`).
- **Inputs**: ADR from Step 7.1
- **Expected output**: New migration file applied via `npx supabase db reset` locally without error; `\d public.trips` shows the new column; `select public.duplicate_trip('00000000-0000-0000-0000-000000000000')` returns `null` without error; `select public.delete_account_cascade()` runs as a no-op
- **Depends on**: Step 7.1 (ADR)
- **Parallel with**: (none — gates 7.3, 7.6)
- **Platform check**: N/A (DB migration)
- **Risks**:
  - [Medium] `security definer` functions need `set search_path` to avoid the lint warning Supabase surfaces; Mitigation: include `set search_path = public, auth` on both stubs
  - [Low] Existing client queries in `src/api/trips.ts` use `.select('*')` which will now return `archived_at`; the TS type in `src/api/types.ts` must be updated in Step 7.7 — Mitigation: tracked as a Step 7.7 dependency
- **Touched files**: `supabase/migrations/0004_trip_lifecycle.sql`

### Step 7.3 — Implement `duplicate_trip` RPC
- **Status**: ✅ Done
- **Agent**: backend-specialist
- **Size**: M
- **Task**: Replace the stub with a real implementation: takes `p_trip_id uuid`; verifies `auth.uid() = (select user_id from trips where id = p_trip_id)` (raise `'not_authorized'` otherwise); inserts a new `trips` row with `title = original.title || ' (copy)'`, copies `daily_hours_budget`, `transport_mode`, `timezone`, `start_date`, `end_date`, `daily_hours_budget`, `anchor_place_id` set to `null` (the original anchor refers to a place in the source trip, which the duplicate will own a copy of — but resolving the new anchor id is non-trivial; per the ADR, drop the anchor and let the user re-pick), `archived_at = null`; bulk-inserts cloned `trip_places` rows (one row per source place, copying the columns listed in the ADR, leaving `day_index` and `order_in_day` null); does NOT touch `trip_legs` or `trip_days`; returns the new trip id. Wrap in a single transaction. **Do not write tests.**
- **Inputs**: Step 7.2 stub; ADR
- **Expected output**: `select public.duplicate_trip('<real-trip-id>')` returns a uuid; the new trip is queryable from the client and shows zero days / zero legs but the same place count as the source; calling with another user's trip id raises `'not_authorized'`
- **Depends on**: Step 7.2
- **Parallel with**: Step 7.5 (UI settings shell — disjoint files)
- **Platform check**: N/A (DB function)
- **Risks**:
  - [Medium] If `trip_places.google_place_id` has a unique-per-user constraint we forgot, the bulk insert will fail — Mitigation: read `0001_init.sql` constraints first; the schema as of `0001_init.sql` does NOT enforce uniqueness on `(trip_id, google_place_id)` so duplication is safe
  - [Low] `start_date` / `end_date` may collide with calendar logic if user duplicates and edits both — Mitigation: out of scope; just clone the values as-is
- **Touched files**: `supabase/migrations/0004_trip_lifecycle.sql` (the same file — `create or replace function` lets us extend the stub without a second migration); if the user requires a clean migration history, split into `0005_duplicate_trip_impl.sql` instead — backend-specialist's call

### Step 7.4 — Settings route shell + theme toggle UI
- **Status**: ✅ Done
- **Agent**: ui-specialist
- **Size**: M
- **Task**: Create `app/(app)/settings.tsx` (Expo Router file) with: (1) a `Heading` "Settings"; (2) a read-only field showing the signed-in user's email (`useUser()` from `src/api/auth.ts` or equivalent); (3) a `SegmentedControl` for theme with options Light / Dark / System; selecting one calls `useThemeControls().setMode(mode)` from `src/theme/ThemeProvider.tsx` and persists the choice via the existing platform `storage` adapter (`storage.web.ts` / `storage.native.ts`) under key `tripvisor.theme.mode`; (4) a placeholder slot for the "Delete account" button that Step 7.6 will fill — for this step, render a disabled `Button` labelled "Delete account" with `disabled` set so the layout is right but no destructive action ships yet. Wire `app/(app)/_layout.tsx` so `/settings` is reachable from the user's existing menu / sign-out area on the trips list — concretely, replace the bare "Sign out" button in `app/(app)/trips.tsx` with a small overflow that has Settings + Sign out, OR add a Settings link in the header. **No tests.**
- **Inputs**: Existing `useThemeControls`, `storage` adapter, `useSignOut`, `Button`, `SegmentedControl`, `Heading`, `Screen`
- **Expected output**: Navigating to `/settings` renders the screen on web (visual confirmation only); selecting Dark in the segmented control flips the app to dark colors; reloading the page preserves the choice; the Delete account button is rendered but disabled
- **Depends on**: None
- **Parallel with**: Step 7.5
- **Platform check**: All three (iOS, Android, Web). `storage.web.ts` and `storage.native.ts` already exist and are platform-correct. `SegmentedControl` is single-file (cross-platform). No native-only or web-only surface introduced.
- **Risks**:
  - [Medium] `useThemeControls` may not expose `setMode` with a System option today — Mitigation: ui-specialist reads `src/theme/ThemeProvider.tsx` first; if it only supports light/dark, extend it to accept `'system'` (use `Appearance.getColorScheme()` from RN) before wiring the segmented control. Keep the extension under ~20 lines; if it balloons, park "system" and ship Light/Dark only.
  - [Low] The trips list header may not have room for a new icon on narrow viewports — Mitigation: replace "Sign out" with a single "Settings" link and move Sign out into the Settings screen
- **Touched files**: `app/(app)/settings.tsx`, `app/(app)/trips.tsx`, possibly `src/theme/ThemeProvider.tsx`

### Step 7.5 — TripCard overflow menu (Archive / Duplicate / Delete)
- **Status**: ✅ Done
- **Agent**: ui-specialist
- **Size**: M
- **Task**: Add a small overflow trigger (three-dot button or `MoreVertical` icon) to `src/components/TripCard.tsx` that opens a `BottomSheet` (existing component, platform-split) with three actions: **Archive** (or **Unarchive** if `trip.archived_at != null`), **Duplicate**, **Delete** (destructive style — re-uses any existing destructive button styling, otherwise red `tintColor`). Each action calls a mutation hook (Step 7.7 will provide them) and dismisses the sheet on success. Wire pressing the overflow button so it does NOT propagate to the card's `onPress` (which navigates to the trip). Add `accessibilityLabel="Trip actions"` on the trigger and a sensible `accessibilityRole="button"` on each sheet item. Render an inline "Archived" pill (existing `StatusPill` component) on archived trips when shown in the Archived filter.
- **Inputs**: Existing `TripCard`, `BottomSheet`, `StatusPill`, `Button`
- **Expected output**: TripCard renders the overflow trigger on all three platforms; tapping it opens the bottom sheet; the three actions are visible and labelled; sheet dismisses on action; pressing the card body still navigates to the trip
- **Depends on**: None (uses placeholder/no-op handlers until Step 7.7 wires the real mutations — ui-specialist must wire to handlers passed in via props from `app/(app)/trips.tsx`, which Step 7.7 fills)
- **Parallel with**: Step 7.4
- **Platform check**: All three. `BottomSheet.native.tsx` + `BottomSheet.web.tsx` are pre-existing. Confirm the web variant supports tap-outside-to-dismiss (it should — Phase 4 used it for share UI).
- **Risks**:
  - [Medium] `BottomSheet.web.tsx` may render as a centered modal rather than a real bottom sheet on desktop; that's fine UX — ui-specialist should verify the rendered output looks deliberate, not broken
  - [Low] Hit area for the overflow icon may be too small on touch — Mitigation: 44×44 minimum hit area; use `hitSlop` if the icon itself is smaller
- **Touched files**: `src/components/TripCard.tsx` (overflow trigger + sheet wiring); possibly a new `src/components/TripActionsSheet.tsx` if the inline sheet bloats the file beyond ~150 lines

### Step 7.6 — Implement `delete_account_cascade` RPC
- **Status**: ✅ Done
- **Agent**: backend-specialist
- **Size**: S
- **Task**: Replace the Step 7.2 stub: `delete_account_cascade()` runs as `security definer`, captures `auth.uid()`, deletes all `public.trips` rows for that user (cascade handles `trip_days`, `trip_places`, `trip_legs`, `trip_shares`), then calls `auth.users` delete. Note: deleting from `auth.users` requires `service_role` — the RPC alone cannot self-delete the auth row. Two options: (a) the RPC deletes only the `public.*` rows and an Edge Function `delete-account` (new) calls `supabase.auth.admin.deleteUser()` server-side using the service role key; (b) skip the auth-row delete and rely on `on delete cascade` from `auth.users` to clean `public.*` (which would require admin to delete the auth user). Pick **(a)**: ship a new Edge Function at `supabase/functions/delete-account/index.ts` that (1) verifies the JWT, (2) calls the RPC to clean `public.*`, (3) calls `supabase.auth.admin.deleteUser(jwt.sub)`, (4) returns 200. The client (Step 7.8) calls the Edge Function, not the RPC directly. **No tests.**
- **Inputs**: Step 7.2 stub; existing Edge Function pattern in `supabase/functions/share-trip/index.ts`
- **Expected output**: Edge Function deployable locally; calling with a valid JWT removes the user's `trips` rows and the `auth.users` row; calling without a JWT returns 401; calling for a different user is impossible (the RPC reads `auth.uid()` from the JWT, not from the request body)
- **Depends on**: Step 7.2
- **Parallel with**: Step 7.7
- **Platform check**: N/A (server)
- **Risks**:
  - [Medium] `supabase.auth.admin.deleteUser` on the local stack uses the service role key from `.env`; the Edge Function must be configured to receive `SUPABASE_SERVICE_ROLE_KEY` as a function secret, not a public env — Mitigation: follow the pattern in `supabase/functions/share-trip/index.ts` which already uses service role for token issuance
  - [Medium] Race condition: if the RPC succeeds but the auth-admin call fails, the user has no trips but still has an auth row — recoverable but messy. Mitigation: order the calls auth-delete-first → cascade-cleanup-second so a failure leaves the user signed in with their data intact (safer); update the Edge Function accordingly
  - [Low] Local Mailpit may not deliver a "your account was deleted" email — Mitigation: out of scope; no email is sent
- **Touched files**: `supabase/migrations/0004_trip_lifecycle.sql` (RPC body), `supabase/functions/delete-account/index.ts` (new), possibly `supabase/functions/_shared/cors.ts` if the share-trip function uses a shared helper

### Step 7.7 — Client-side mutations: archive / unarchive / duplicate / delete + types
- **Status**: ✅ Done
- **Agent**: backend-specialist
- **Size**: M
- **Task**: Extend `src/api/trips.ts` with TanStack Query mutations: `useArchiveTrip()`, `useUnarchiveTrip()` (both update `archived_at`), `useDuplicateTrip()` (calls the `duplicate_trip` RPC, invalidates `['trips']` on success), `useDeleteTrip()` (already exists or close to it — confirm). Update the `useTrips()` query to accept an optional `{ archived: boolean }` argument that filters via `.is('archived_at', null)` or `.not('archived_at', 'is', null)`; default to `archived: false` for the existing call site. Update `src/api/types.ts` `Trip` shape to include `archived_at: string | null`. The `useTrips()` query key becomes `['trips', { archived }]` so the two filtered lists cache independently. Optimistic update on archive / unarchive: remove the trip from the active list (or move it to the archived list) immediately; rollback on error.
- **Inputs**: Step 7.2 (column exists), Step 7.3 (RPC works)
- **Expected output**: Hooks exported from `src/api/trips.ts` and re-exported from `src/api/index.ts`; calling `useArchiveTrip().mutate(tripId)` from a UI handler sets `archived_at` and the trips list updates without a manual `refetch`; calling `useDuplicateTrip().mutate(tripId)` returns the new trip id and the list shows the copy after invalidation
- **Depends on**: Step 7.2, Step 7.3
- **Parallel with**: Step 7.6
- **Platform check**: All three (pure JS / TanStack Query)
- **Risks**:
  - [Medium] Optimistic updates with TanStack Query require careful rollback wiring; if the mutation fails (e.g. RLS rejects), the list must revert — Mitigation: use the standard `onMutate` / `onError` / `onSettled` pattern; if it gets fiddly, drop optimistic updates and just invalidate on success (acceptable trade-off — the user already sees a brief loading state on Phase 1's existing mutations)
  - [Low] `Trip` type widening may cause TypeScript errors in unrelated files — Mitigation: run `tsc --noEmit` locally and fix any breakages in the same step (these will be `archived_at` references at most)
- **Touched files**: `src/api/trips.ts`, `src/api/types.ts`, `src/api/index.ts`

### Step 7.8 — Wire Settings screen Delete Account + trips list to the new mutations
- **Status**: ✅ Done
- **Agent**: ui-specialist
- **Size**: M
- **Task**: (a) In `app/(app)/settings.tsx`, replace the Step 7.4 disabled "Delete account" button with a real flow: pressing the button opens a destructive confirmation dialog (use a platform-appropriate confirm — `Alert.alert` on native, a `BottomSheet` or `window.confirm` on web; reuse what Phase 3 used for destructive trip-delete confirmations if it exists). On confirm, call the `delete-account` Edge Function via the existing `supabaseClient.functions.invoke('delete-account')` pattern. On 200, sign the user out (`useSignOut().mutate()`) which routes to `/(auth)/login`; on error, show an `EmptyState`-style inline error or a toast and stay put. (b) In `app/(app)/trips.tsx`, add a `SegmentedControl` (or simple two-tab `TabBar`) at the top of the list with options "Active" (default) and "Archived"; the selected tab controls the `archived` arg passed to `useTrips()`. (c) Wire `TripCard`'s overflow handlers to `useArchiveTrip` / `useUnarchiveTrip` / `useDuplicateTrip` / `useDeleteTrip` from Step 7.7. (d) After Duplicate succeeds, show a brief inline confirmation (existing toast or a `StatusPill` if no toast system; do NOT introduce a new toast lib) and let the list re-render via cache invalidation.
- **Inputs**: Steps 7.4, 7.5, 7.6, 7.7
- **Expected output**: All exit-criteria user flows work end-to-end on web (visual confirmation only); native deferred to user
- **Depends on**: Steps 7.4, 7.5, 7.6, 7.7
- **Parallel with**: (none — integration step)
- **Platform check**: All three. The destructive confirm differs per platform: `Alert.alert` on native, `window.confirm` (or BottomSheet) on web; ui-specialist must keep both branches in a `Platform.OS` split or a small `confirmDestructive.web.ts` / `.native.ts` helper.
- **Risks**:
  - [Medium] `window.confirm` is ugly on web; if ui-specialist would rather build an in-app modal, that's fine but cap it at one small new component (`DestructiveConfirm.tsx`) — do not redesign the modal system
  - [Medium] After Delete-account, the React Query cache still holds stale data; the redirect to `/(auth)/login` handles this in practice (auth state change clears protected queries on the next mount), but if the redirect doesn't fire, ui-specialist must `queryClient.clear()` after the Edge Function returns 200
  - [Low] The "Active" / "Archived" tabs may need a count badge — Mitigation: out of scope for v1; ship without counts
- **Touched files**: `app/(app)/settings.tsx`, `app/(app)/trips.tsx`, possibly `src/components/DestructiveConfirm.tsx` (new), `src/components/TripCard.tsx` (final wiring)

### Step 7.9 — Reviewer pass on Phase 7 changes
- **Status**: ✅ Done
- **Agent**: reviewer
- **Size**: S
- **Task**: Read every diff introduced in Phase 7. Confirm: (1) RLS still holds — the new `archived_at` column does not need a new policy because the existing `trips_user_id_idx` policy gates by `user_id`, but the reviewer must verify the new partial index `trips_user_active_idx` does not accidentally bypass RLS (indexes don't, but the SQL should be sanity-checked); (2) `delete_account_cascade` and the `delete-account` Edge Function correctly use the JWT `sub` claim, not a request-body user id (no IDOR); (3) the Edge Function receives `SUPABASE_SERVICE_ROLE_KEY` only on the server, never echoed to the client; (4) the trip-duplicate RPC has the `auth.uid()` ownership check before the insert; (5) no Google ToS regressions — the duplicate-trip code path must NOT clone any Google-derived fields beyond `google_place_id` + `lat` / `lng` (per the ADR); (6) the Settings screen does not log the user's email or any PII to Sentry / console; (7) destructive actions (Delete account, Delete trip) require explicit user confirmation. Write findings to `docs/reviews/phase-7.md` with critical / high / medium / low. **Tests are out of scope; reviewer reads code only, does not run tests or smokes.**
- **Inputs**: All Phase 7 diffs
- **Expected output**: `docs/reviews/phase-7.md` with findings; no critical or high blocks Step 7.10
- **Depends on**: Step 7.8
- **Parallel with**: (none)
- **Platform check**: N/A (review)
- **Risks**:
  - [Medium] If the reviewer surfaces a critical (e.g. IDOR in delete-account, RLS bypass in duplicate), Phase 7 must loop back to backend-specialist for a fix before 7.10 can run — Mitigation: budget one fix loop; if more than one critical surfaces, planner re-enters with a revised plan rather than patching inline
- **Touched files**: `docs/reviews/phase-7.md`

### Step 7.10 — Docs flip
- **Status**: ✅ Done
- **Agent**: docs-specialist
- **Size**: S
- **Task**: (a) Add two rows to `docs/features/overview.md`: "Trip archive / duplicate" → ✅ Done (web; native deferred to user smoke), Phase 7, doc `trip-lifecycle.md`; "Account settings (theme + delete account)" → ✅ Done (web; native deferred), Phase 7, doc `settings.md`. (b) Create `docs/features/trip-lifecycle.md` and `docs/features/settings.md` per the existing feature-doc template (intent / scope / API surface / data model / platforms verified table — leave iOS / Android boxes unticked, tick Web only). (c) Flip the Phase 7 row in `plan.md`'s top table to ✅ Done. (d) Append a one-paragraph "Phase 7 — close-out" entry under the Phase 6 partial-close-out paragraph, summarising shipped surface (archive / duplicate / settings / theme persistence / delete account). Do NOT edit `CLAUDE.md` (planner project rule).
- **Inputs**: Step 7.9 review (no critical / high)
- **Expected output**: Feature docs reflect the new state; `plan.md` Phase 7 row reads ✅ Done; the two new feature docs exist
- **Depends on**: Step 7.9
- **Parallel with**: (none)
- **Platform check**: N/A (docs)
- **Risks**:
  - [Low] Existing feature-doc template may have evolved between Phase 4 and now — Mitigation: docs-specialist reads `docs/features/share.md` as the most recent template and matches its shape
- **Touched files**: `plan.md`, `docs/features/overview.md`, `docs/features/trip-lifecycle.md` (new), `docs/features/settings.md` (new)

## ⚠ Blockers (Phase 7 — must be cleared before Step 7.2)

1. **Local Supabase stack must be reachable** for the migration to apply (`npx supabase db reset`). Same precondition as Phase 6 Step 6.0; if the user has not run `supabase start` since Phase 6, they need to before Step 7.2 lands.
2. **Pre-existing blockers carried forward — NOT in scope for Phase 7**:
   - Google Maps API keys — Phase 7 deliberately avoids any Google-keyed surface; no dependency.
   - Leaked Supabase PAT rotation — Phase 7 uses local Supabase only; cloud PAT is irrelevant.
   - EAS account / Apple Developer / Google Play Developer — Phase 7 is web-first; native verification deferred.

## Phase 7 — non-goals (explicit)

- **Tests** — no Jest, no Deno tests, no fast-check, no RLS integration tests, no `*.test.ts` / `*.spec.ts` files authored or modified. The `test-specialist` sub-agent is removed for the duration of the project.
- **Smokes** — no Playwright execution, no manual UI smoke checklists, no `docs/smoke/phase-7.md`.
- **Coverage / CI changes** — Phase 5 deferred work stays deferred; the existing `.github/workflows/` is not modified.
- **Google Maps work** — no Places API, no Routes API, no optimizer changes, no map polyline updates.
- **EAS / native builds** — no `eas.json` changes, no Apple / Google Play config, no native verification beyond visual confirmation by the implementing specialist on whatever simulator they happen to have running.
- **Native verification** — iOS / Android remain deferred to user smoke as standard for this project.
- **Phases 2 / 3 / 5 / 6 status flips** — Phase 7 does not touch their rows; they stay 🚧 / partial as recorded.
- **Trip-collaboration / sharing extensions** — out of scope; this phase is single-user lifecycle only.
- **Cost / itinerary visibility (Direction 5)** — parked as a Phase 8 candidate.
- **Bulk place ops / day rebalance (Direction 3)** — parked; touches Google-key-gated optimizer territory.

## Phase 7 — close-out

Shipped 2026-04-25. Phase 7 landed two independent user-visible surfaces with no dependency on Google Maps keys, EAS, or native provisioning. Trip lifecycle: the `trips.archived_at` column (migration `0004_trip_lifecycle.sql`), partial index `trips_user_active_idx`, `duplicate_trip` RPC (clones places only per ADR-0006, not legs), and `delete_account_cascade` RPC backed by the new `delete-account` Edge Function are all live on the local stack; client mutations `useArchiveTrip`, `useUnarchiveTrip`, `useDuplicateTrip`, and query-key partitioning ship in `src/api/trips.ts`. Settings screen: `app/(app)/settings.tsx` exposes email (read-only), Light/Dark/System theme picker with `Appearance` listener and persistence, Sign out, and Delete account with destructive confirm. The M1 race (sign-out after delete-account) was fixed inline. M2 (parallel-mutation rollback footgun) and all low findings from `docs/reviews/phase-7.md` are parked as follow-ups. Web golden path confirmed visually; iOS and Android deferred to user smoke.
