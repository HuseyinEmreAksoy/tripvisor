# Tripvisor — Roadmap & Status

**Current phase**: Phase 21 — Budget tracking + collaboration + accommodation tracking
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
| 8 | Cost / itinerary visibility polish (per-trip cost rollup, per-day summary card, printable A4 view) | ✅ Done (web; native deferred to user smoke) | backend + ui |
| 9 | Notes / journal expansion (inline place notes, per-day notes, Markdown in print) + M2 mutation cleanup | ✅ Done (web; native deferred to user smoke) | ui + backend |
| 10 | Account data export (JSON download) + L4 debounce flush-on-blur bundle | ✅ Done (web; native deferred to user smoke) | backend + ui |
| 11 | Trips list polish (search + sort) + Phase 10 L2 fix | ✅ Done (web; native deferred to user smoke) | ui + backend |
| 12 | Advisory lock fix (Phase 5 M1) + Cost sort + Date filter (Phase 11 M1/L4 deferred) | ✅ Done (web; native deferred to user smoke) | backend + ui |
| 13 | DB-row mutex (closes Phase 12 C1 — PgBouncer advisory-lock weakness) | ✅ Done (web; native deferred to user smoke) | backend |
| 14 | Share link OG/Twitter meta tags (rich unfurl) | ✅ Done (web verified; native unaffected — Head is web-only no-op) | ui |
| 15 | Per-day map filter on trip detail | ✅ Done (web verified; native unaffected — shared component code, no platform-specific surface) | ui |
| 16 | Optimize error codes surfaced to UI | ✅ Done (web verified; native unaffected — shared client code, no platform-specific surface) | backend |
| 17 | Recent place searches in the add flow | ✅ Done (web verified; native shares same code path — AsyncStorage cross-platform) | ui |
| 18 | Duplicate place warning in add flow | ✅ Done (web verified; native shares same code path) | ui |
| 19 | Test restoration + share-revoke production bug fix | ✅ Done | test + ui + backend |
| 20 | UX / navigation / maps recovery + expense model cleanup | ✅ Done (web smoke green 2026-04-25; native deferred to user smoke) | ui + backend + docs |
| 21 | Budget tracking + collaboration + accommodation tracking | ✅ Code complete 2026-04-25 — automated tests + live smoke skipped per user direction; platforms unverified | backend + ui + docs |

Legend: 📋 Planned · 🚧 In progress · ✅ Done · ⚠ Blocked

## User-priority intake — 2026-04-25

1. The in-app UI is not visually interesting enough; it needs travel imagery and more engaging surfaces.
2. Users need clearer navigation and visible back affordances between pages.
3. Google Maps integration is currently broken.
4. Planning should emphasize duration / time more than generic `cost` labeling.
5. The login screen is too sparse and visually weak.
6. Add-place is currently blocked by `server_misconfigured: Google Maps server key is not configured`.
7. `test-specialist` should catch and report user-visible runtime/config issues, not focus only on code-level tests.
8. Budget tracking and trip sharing / collaboration are missing and should move into the active roadmap.
9. Accommodation tracking is missing and should move into the active roadmap.
10. `cost per km` is not the right expense model; expense entry should be category-based (`accommodation`, `food`, `transport`, `shopping`, etc.) with a total-trip budget.
11. The itinerary has a runtime error around markers / `useMemo`.
12. Web currently feels like a stretched mobile layout and needs desktop-specific treatment.

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
- **Status**: ✅ Done (scoped to source-code changes only) — `docs/reviews/phase-5.md` authored 2026-04-25. Scoped narrowly: optimizer anchor fix, `optimize-trip` thenable fix, and CI workflow. No critical or high findings. M2 fixed (Deno glob); M1 (advisory lock no-op) parked — closed by Phase 12; L1–L3 parked. Full coverage/E2E/property-test review not completed (deferred with Steps 5.0–5.5, 5.7).
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

## Phase 8 — close-out

Shipped 2026-04-25. Phase 8 turned the optimizer's already-cached `trip_legs` data into a usable road-trip artifact with zero new Google API calls. The `0005_trip_cost_meta.sql` migration adds `trips.currency` (fixed list: USD/EUR/GBP/TRY/JPY, check constraint) and `trips.cost_per_km numeric(8,4)` (default 0.20) to the schema. Client-side cost math (`Sigma leg.distance_meters / 1000 * cost_per_km`) lives in `TripCostRollup.tsx` (memoized per-trip rollup card) and `DaySummaryCard.tsx` (per-day place count, visit hours, drive time, distance, and cost). The trip detail screen gains an inline "Cost settings" section — currency SegmentedControl and debounced rate TextInput — wired to the new `useUpdateTrip(tripId)` mutation. A new route `app/(app)/trip/[id]/print.tsx` renders a read-only itinerary view on all three platforms; on web it injects an `@media print { @page { size: A4 portrait } ... }` stylesheet via runtime `require('expo-router/head')` and exposes a "Print this page" button that calls `window.print()` (gated by `Platform.OS === 'web'`); on native it renders the same content as a scrollable read-only view with an inline note directing users to the web to print. Reviewer sign-off: no critical or high findings; M1 (debounce timer not cleared on unmount) fixed inline; M2 (`commitBudget`/`commitMode` bypass pattern) and all low findings parked as Phase-9 candidates. Feature doc: `docs/features/cost-and-print.md`.

## Phase 9 — close-out

Shipped 2026-04-25. Phase 9 turned the previously unused `trip_places.notes` column into a real journal surface and added a paired per-day notes field. The `0006_trip_day_notes.sql` migration adds `trip_days.notes text` (nullable) with no RLS change — the existing `trip_days_via_trip` policy inherits to the new column automatically. On the trip detail screen, a `PlaceNotesEditor` renders inline on each place row (debounced 500ms write via the existing `useUpdateTripPlace`; show-more/show-less toggle for notes longer than 120 characters), and a `DayNotesEditor` sits between the `DaySummaryCard` and the draggable itinerary for each day (collapsed by default, debounced 500ms write via the new `useUpdateTripDay` hook, upserts on `(trip_id, day_index)` because the optimizer does not pre-create day rows). Both editors share the new `src/lib/hooks/useDebouncedCallback.ts` utility (stale-closure-safe, cancels on unmount). The print route at `app/(app)/trip/[id]/print.tsx` renders both note types through a new in-repo Markdown renderer (`src/lib/markdown/render.ts`, linear-pass tokenizer, ~105 LOC, no new dependencies) supporting bold, italic, unordered lists, ordered lists, and links with a `http(s):/`/`mailto:` protocol allow-list; rendering is handled by `src/components/MarkdownText.tsx` using RN primitives. The M2 follow-up from Phase 8 is closed: `commitBudget` and `commitMode` on the trip detail screen now go through `useUpdateTrip(tripId).mutate(...)` after `UpdateTripPatch` was widened to include `daily_hours_budget` and `transport_mode`, removing the last raw `supabase.from('trips').update(...)` caller from the screen. Reviewer sign-off: no critical, high, or medium findings; 5 low parks (see `docs/reviews/phase-9.md`). Design decision recorded in ADR-0008 (`docs/adr/0008-notes-markdown-renderer.md`). Feature doc: `docs/features/notes-journal.md`.

## Phase 10 — close-out

Shipped 2026-04-25. Phase 10 added a one-click data-export surface and closed the last open correctness finding from Phase 9. The new `supabase/functions/export-account/index.ts` Edge Function follows the same JWT-verification pattern as `delete-account` (anon-client `auth.getUser(token)`, then service-role reads scoped to the verified `userId`); it returns a flat `{ user_id, exported_at, trips, trip_places, trip_legs, trip_days }` object with deterministic `order('id', { ascending: true })` ordering so two consecutive exports are byte-identical. The shared `src/api/account-export.shared.ts` helper builds the JSON string and UTC-dated filename (`tripvisor-export-<YYYY-MM-DD>.json`); platform-split `src/api/account-export.web.ts` (Blob+anchor download with Safari `setTimeout(URL.revokeObjectURL, 1000)` guard) and `src/api/account-export.native.ts` (`expo-file-system` cache write + `expo-sharing.shareAsync`) deliver the file per-platform, mirroring the proven `.ics` mechanic from Phase 4. The Settings screen (`app/(app)/settings.tsx`) gains an "Export my data" secondary button above "Sign out" with loading, disabled, and error-banner states. The Phase 9 L4 follow-up was resolved in parallel: `useDebouncedCallback` now exposes `.flush()` and `.cancel()` as properties on the returned callable (non-breaking), and both `DayNotesEditor` and `PlaceNotesEditor` call `.flush()` on `onBlur` so the last keystrokes within the debounce window are not dropped on blur; unmount cleanup continues to call `.cancel()`, not `.flush()`. Reviewer sign-off: no critical, high, or medium findings; 5 low parks (see `docs/reviews/phase-10.md`). Design decision recorded in ADR-0009 (`docs/adr/0009-account-data-export.md`). Feature doc: `docs/features/account-export.md`.

## Phase 11 — close-out

Shipped 2026-04-25. Phase 11 added search and sort to the trips list screen and closed the Phase 10 L2 byte-counting correctness finding. On the trips list (`app/(app)/trips.tsx`): a debounced `TextInput` (200ms, case-insensitive substring match on `title`) with a clear button, a tap-to-cycle `Pressable` cycling through Recent / A-Z / Start date sort modes (`Intl.Collator` for locale-aware A-Z; trips with `null start_date` sort to bottom on Start date mode), and an empty-results state ("No trips match your search") when the filtered list is empty. Tab switching (Active / Archived) resets both search text and sort to their defaults. Phase 10 L2 fix: `src/api/account-export.shared.ts` replaced the Blob-fallback byte counter with `new TextEncoder().encode(json).length` for exact UTF-8 byte counting on web and RN/Hermes without feature detection. No reviewer pass — scope was minimal (one screen + one-line backend polish). Planner agent was over usage limit; main assistant scoped the phase directly. Feature doc: `docs/features/trips-list-polish.md`. Explicitly deferred: Cost sort (N+1 risk without server-side aggregation) and date filter (Upcoming/Past) — both are Phase 12+ candidates. Both closed by Phase 12.

## Phase 8 — Cost / itinerary visibility polish (per-trip cost rollup, per-day summary card, printable A4 view)

**Goal**: Ship visible itinerary-utility polish that turns the existing optimizer output into something a user actually carries on a road trip: (a) a per-trip cost rollup driven by already-cached `trip_legs.distance_meters` × a user-set `cost_per_km` (no Google call), (b) a per-day summary card showing place count, total visit hours, estimated drive time and estimated cost, and (c) a printable A4 view of the itinerary (HTML + `@media print` stylesheet, no PDF library) reachable from a "Print itinerary" button on the trip detail screen.
**Status**: ✅ Done — shipped 2026-04-25; reviewer sign-off (`docs/reviews/phase-8.md`); M1 fixed inline; M2 + lows parked.
**Last updated**: 2026-04-25

**Direction chosen**: Direction 5 (cost / itinerary visibility polish). All three sub-features ride on data the schema already caches from Phase 2 (`trip_legs.distance_meters`, `trip_legs.duration_seconds`, `trip_places.visit_duration_minutes`), so the phase makes zero Google API calls and needs no keys. Independent of all three carried-forward blockers (Google keys, leaked PAT, EAS / Apple / Google Play) — only a tiny `0005_trip_cost_meta.sql` migration adds `currency` + `cost_per_km` to `trips`. Complements Phase 7: a duplicated trip + a printable A4 view = the actual usable artifact for a road trip. Rejected the alternatives quickly — trip notes/journal is less visible per step, trips-list search/filter is low-impact until users have many trips, place-reordering polish lands on Google-key-gated optimizer territory, and PWA polish needs the kind of careful platform smoke-testing that this phase explicitly rules out. No sixth direction surfaced as a stronger fit.

**Entry criteria**:
- Phase 7 close-out is current state; `trips.archived_at`, `duplicate_trip`, `delete_account_cascade`, and the `delete-account` Edge Function are live on local Supabase
- `src/api/trips.ts` exposes `useTrip(id)` and reads `trip_places` + `trip_legs` for the trip detail screen (Phase 2 surface; not rewritten here)
- Local Supabase stack is reachable so the `0005_trip_cost_meta.sql` migration can be applied (`npx supabase db reset`)
- User has NOT requested Google-keys provisioning, EAS provisioning, or PAT rotation in this phase — Phase 8 must not depend on any of those

**Phase exit criteria**:
- A new `0005_trip_cost_meta.sql` migration adds `currency text` (default `'USD'`) and `cost_per_km numeric(8,4)` (default `0.20`) to `public.trips`; existing rows backfill with the defaults; RLS unchanged
- The `Trip` TypeScript type in `src/api/types.ts` includes `currency: string` and `cost_per_km: number`; `useUpdateTrip` (or an equivalent existing mutation) accepts both fields
- The trip edit / settings surface (in-place on the trip detail screen, not a separate route) lets the user pick `currency` (small fixed list: USD / EUR / GBP / TRY / JPY) and edit `cost_per_km` as a numeric input; the value persists and is read back on reload
- The trip detail screen shows a **per-trip cost rollup** (one card at the top of the trip page or in the trip header) computed client-side as `sum(trip_legs.distance_meters) / 1000 * trip.cost_per_km`, formatted with the trip's currency; displays a "—" placeholder when the trip has zero legs (not yet optimized) and a small "estimate" caveat
- Each day section on the trip detail screen renders a **per-day summary card** at the top of that day showing: place count (from `trip_places` filtered by `day_index`), total visit hours (sum of `visit_duration_minutes / 60`), estimated drive time (sum of `trip_legs.duration_seconds / 60` for that `day_index`), estimated drive distance (sum of `distance_meters / 1000`), and estimated cost (distance × `cost_per_km`); placeholders when legs are missing
- A **"Print itinerary"** button on the trip detail screen opens a print-friendly route (`/trip/[id]/print` on web; same screen on native rendering as a read-only summary view) that lays out the full itinerary day-by-day (day header, summary numbers, ordered places, notes, per-day map placeholder NOT implemented — text-only) and applies an `@media print` stylesheet that hides app chrome and fits a single trip on A4 portrait, with the cost rollup at the top and a "Powered by Google" attribution footer (because the place data on the printed page came from Google Places)
- Web "Print itinerary" triggers `window.print()` from a button on the print page; the resulting browser print preview is legible (visual confirmation by the implementing specialist on whatever browser they have running — no recorded smoke)
- Native "Print itinerary" renders the same content as a scrollable read-only view (no `window.print` on native; native PDF / share is out of scope and parked as a follow-up); a small inline note on native says "Open this trip on the web to print"
- All three platforms render the new cost rollup, per-day summary card, and the print route without layout breaks (visual confirmation; native verification deferred to user as standard for this project)
- `docs/features/overview.md` has a row for "Cost & itinerary visibility (rollup, daily summary, print)" with status reflecting Phase 8 completion
- A short ADR exists at `docs/adr/0002-cost-rollup-client-side.md` recording the decision to compute cost client-side from cached `trip_legs` (vs. a server view / generated column), since this is the only non-obvious design call in the phase

**Critical path**: Step 8.1 → Step 8.2 → Step 8.3 → Step 8.4 → Step 8.6 → Step 8.7 → Step 8.8

(Step 8.5 — print route — parallels Step 8.4 on the same critical-path tier, since they touch disjoint files. Step 8.3 — cost-edit UI — gates 8.4 on the `trip.cost_per_km` field being editable, but the rollup math itself can be developed against the migration default and wired to the edit surface last.)

### Step 8.1 — ADR for client-side cost rollup
- **Status**: ✅ Done
- **Agent**: planner
- **Size**: XS
- **Task**: Author `docs/adr/0002-cost-rollup-client-side.md` recording: (1) cost is computed in the React UI from `trip_legs.distance_meters` and `trip.cost_per_km`, not from a Postgres view or generated column; (2) rationale — the trip detail screen already reads both pieces via existing queries, the math is trivial (`meters / 1000 * rate`), keeping it client-side avoids a migration/view per currency-aware feature and lets the user re-tune `cost_per_km` without recomputing server-side state; (3) consequences — cost is always derived, never persisted, so duplicate-trip flows automatically get correct costs once optimizer runs; (4) alternatives considered — server view (rejected: extra surface for one read), generated column on `trip_legs` (rejected: forces currency to live on `trip_legs` rows or duplicates rate everywhere), nightly batch (rejected: pointless for a derived value). Use the standard ADR template (Context / Decision / Alternatives / Consequences). One screen max.
- **Inputs**: This phase plan; `0001_init.sql` schema for `trip_legs`
- **Expected output**: `docs/adr/0002-cost-rollup-client-side.md` exists; Step 8.4 references it when authoring the rollup component
- **Depends on**: None
- **Parallel with**: (none — gates the design intent for 8.4 / 8.6, but takes <30 min)
- **Platform check**: N/A (doc only)
- **Risks**:
  - [Low] If Step 8.2's migration adds `currency` per-row but the ADR assumes a single trip-level currency (it does — that's the choice), reviewer or user may push for multi-currency per-leg later — Mitigation: ADR explicitly states "trip-level currency only; multi-currency parked"
- **Touched files**: `docs/adr/0002-cost-rollup-client-side.md`

### Step 8.2 — Migration: `trips.currency` + `trips.cost_per_km`
- **Status**: ✅ Done
- **Agent**: backend-specialist
- **Size**: S
- **Task**: Add `supabase/migrations/0005_trip_cost_meta.sql` that: (1) adds `currency text not null default 'USD'` to `public.trips` with a check constraint `check (currency in ('USD','EUR','GBP','TRY','JPY'))` — picks a small fixed list to keep the UI a segmented control / picker (no free-form ISO list); (2) adds `cost_per_km numeric(8,4) not null default 0.20` to `public.trips`; (3) backfills existing rows with the defaults (the `not null default` does this on `alter table` automatically — no separate `update`); (4) does not touch RLS — the existing `trips_owner_all` policy already gates by `user_id` and the new columns inherit that policy. No new index needed (cost columns are read on a single-row trip query, not filtered on). Migration must apply cleanly via `npx supabase db reset` against the local stack. **No tests.**
- **Inputs**: ADR from Step 8.1
- **Expected output**: `0005_trip_cost_meta.sql` applies without error; `\d public.trips` shows the two new columns; existing trips return `'USD'` and `0.20` on `select currency, cost_per_km from trips`; `update trips set cost_per_km = 0.35 where id = '<id>'` succeeds
- **Depends on**: Step 8.1
- **Parallel with**: (none — gates 8.3, 8.4, 8.6)
- **Platform check**: N/A (DB migration)
- **Risks**:
  - [Medium] The fixed currency list may need to grow (CHF, CAD, AUD common road-trip currencies) — Mitigation: keep the check constraint loose-but-bounded; if reviewer or user pushes for more, add them to the constraint list in the same migration before merge
  - [Low] `cost_per_km` precision `(8,4)` allows up to `9999.9999` per km, which is overkill but harmless — Mitigation: leave as-is; cheaper than a future widening migration
- **Touched files**: `supabase/migrations/0005_trip_cost_meta.sql`

### Step 8.3 — Type + API extensions: `currency`, `cost_per_km`, `useUpdateTrip`
- **Status**: ✅ Done
- **Agent**: backend-specialist
- **Size**: S
- **Task**: (a) Extend `Trip` in `src/api/types.ts` with `currency: 'USD' | 'EUR' | 'GBP' | 'TRY' | 'JPY'` (literal union matching the migration's check constraint) and `cost_per_km: number`. (b) In `src/api/trips.ts`, confirm `useUpdateTrip` (or whichever mutation handles in-place trip metadata edits) accepts a `Partial<Pick<Trip, 'currency' | 'cost_per_km' | 'title' | ...>>` patch shape; if no such mutation exists yet, add `useUpdateTrip(tripId)` that runs `update trips set ... where id = $1` and invalidates `['trips']` + `['trip', id]`. (c) Re-export from `src/api/index.ts`. Run `tsc --noEmit` locally and fix any breakages caused by the type widening (likely zero, since these fields are new and additive). **No tests.**
- **Inputs**: Step 8.2 (columns exist in DB)
- **Expected output**: `Trip` type includes the two new fields; `useUpdateTrip(tripId).mutate({ cost_per_km: 0.35 })` writes to the DB and the `useTrip(tripId)` cache reflects the change after invalidation; `tsc --noEmit` is clean
- **Depends on**: Step 8.2
- **Parallel with**: Step 8.5 (print route shell — disjoint files)
- **Platform check**: All three (pure JS / TanStack Query)
- **Risks**:
  - [Low] If `useUpdateTrip` already exists with a stricter patch shape, widening it may force callers to update — Mitigation: keep the patch shape `Partial<...>` so existing callers compile unchanged
  - [Low] The literal union for `currency` may diverge from the migration constraint if the constraint list grows in 8.2 review — Mitigation: cross-reference the migration's check list before declaring the type
- **Touched files**: `src/api/trips.ts`, `src/api/types.ts`, `src/api/index.ts`

### Step 8.4 — Per-trip cost rollup card + per-day summary card
- **Status**: ✅ Done
- **Agent**: ui-specialist
- **Size**: M
- **Task**: (a) Create `src/components/TripCostRollup.tsx` that takes `{ trip: Trip, legs: TripLeg[] }` and renders a single card showing: total estimated cost (`legs.reduce((s, l) => s + l.distance_meters, 0) / 1000 * trip.cost_per_km`, formatted via `Intl.NumberFormat(undefined, { style: 'currency', currency: trip.currency })`), total distance (km), total drive time (humanised — `Xh Ym`); show a "—" placeholder card with "Optimize the trip to see cost estimate" if `legs.length === 0`. Add a small "estimate · powered by Google" footer (Google attribution because the underlying place coordinates are Google-derived). (b) Create `src/components/DaySummaryCard.tsx` that takes `{ dayIndex: number, places: TripPlace[], legs: TripLeg[], trip: Trip }` and renders place count, total visit hours (sum `visit_duration_minutes / 60`), drive time, drive distance, and estimated cost for that day only — same currency formatting. Placeholders when legs for that `day_index` are empty. (c) Wire both into `app/(app)/trip/[id]/index.tsx`: rollup goes at the top of the trip page (above or below the existing trip header), summary cards go at the top of each day section. Memoise the reductions with `useMemo` keyed on `legs` + `cost_per_km` to avoid recomputation on unrelated re-renders. **No tests.**
- **Inputs**: Step 8.3 (types updated); existing `useTrip` + `useTripLegs` (or equivalent) hooks in `src/api/`; existing `Card` / `Heading` / `StatusPill` primitives
- **Expected output**: Trip detail page renders the rollup card on web; switching `cost_per_km` via the Step 8.6 edit surface updates the rollup live (no manual reload); each day section shows its own summary; trips with zero legs show the placeholder copy
- **Depends on**: Step 8.3
- **Parallel with**: Step 8.5
- **Platform check**: All three. `Intl.NumberFormat` is universal in modern RN + web. No platform-split needed; pure JSX + RN primitives.
- **Risks**:
  - [Medium] `Intl.NumberFormat` with `{ style: 'currency', currency: 'TRY' }` may render ₺ awkwardly in some RN locales — Mitigation: ui-specialist visually confirms each currency renders sensibly on web; if a currency renders as ISO code rather than symbol, accept it (still legible)
  - [Medium] Trip detail screen layout may already be cramped; adding two new cards risks overflow on narrow viewports — Mitigation: ui-specialist collapses summary cards into a single dense row of pills if the full card looks crowded on a 360px-wide phone simulator
  - [Low] `useMemo` dependency arrays must include `trip.cost_per_km` and `trip.currency`, not just `legs` — Mitigation: explicit dep list; ui-specialist double-checks
- **Touched files**: `src/components/TripCostRollup.tsx` (new), `src/components/DaySummaryCard.tsx` (new), `app/(app)/trip/[id]/index.tsx`

### Step 8.5 — Print route shell + `@media print` stylesheet
- **Status**: ✅ Done
- **Agent**: ui-specialist
- **Size**: M
- **Task**: Create a new Expo Router route `app/(app)/trip/[id]/print.tsx` that (a) reads the same trip + places + legs as the detail screen via existing hooks; (b) renders a single read-only itinerary view: trip title, date range, currency + cost rate, the cost rollup, then for each day a DaySummaryCard followed by an ordered list of places (title, category, visit duration, notes), separated by `<hr>` or equivalent visual rule; (c) on web, applies an `@media print` block via a platform-specific style entry — concretely, add a `<style>{`@media print { body { background: #fff; } [data-no-print] { display: none; } @page { size: A4 portrait; margin: 1.5cm; } }`}</style>` block (or equivalent in the Expo web entry — ui-specialist picks the cleanest hook; one option is `expo-router`'s `Head` component for web-only style injection); (d) tags app chrome (header, tab bar) with `data-no-print` so it disappears in print preview; (e) renders a "Powered by Google" attribution footer because place data is Google-derived; (f) on native, renders the same content as a scrollable read-only view with a small inline note "Open this trip on the web to print" — no native PDF / share. **No tests.** **No `window.print()` invocation in this step — that's the button wiring in 8.6.**
- **Inputs**: Existing `useTrip`, `useTripPlaces`, `useTripLegs` hooks; existing `Card` / `Heading` / `EmptyState` primitives; Step 8.4 components (`TripCostRollup`, `DaySummaryCard`) — re-used
- **Expected output**: Navigating to `/trip/<id>/print` on web renders the full itinerary in a single scrollable view; opening browser print preview (Ctrl+P) shows the itinerary on A4 portrait with app chrome hidden; on native the same route renders content but does not attempt to print
- **Depends on**: Step 8.4 (re-uses the rollup + day summary components)
- **Parallel with**: Step 8.4 (different files — `src/components/*` vs. `app/(app)/trip/[id]/print.tsx`); ui-specialist may interleave
- **Platform check**: Web (full print support), iOS + Android (read-only view, no print). The `@media print` CSS is web-only; native ignores it. The route exists on all three platforms but the print button on native is hidden or replaced with the inline note. Document the platform split in the file with a comment.
- **Risks**:
  - [Medium] Expo Router web's HTML structure may make `body` selectors fragile — Mitigation: target the route's root view via a stable className (`tripvisor-print-root`) and apply print CSS to `.tripvisor-print-root`, not `body`
  - [Medium] React Native primitives (`<View>`, `<Text>`) compile to `<div>` / `<span>` on web with inline styles, which `@media print` can override but can't easily restyle — Mitigation: keep the print page as visually plain as possible; rely on hiding chrome rather than restyling cards
  - [Low] Long itineraries (>50 places) may overflow A4 portrait — Mitigation: out of scope; A4 is single-page best-effort, multi-page splitting handled by browser print engine naturally
- **Touched files**: `app/(app)/trip/[id]/print.tsx` (new), possibly `src/components/PrintItinerary.tsx` (new — only if 8.5's body grows past ~200 lines)

### Step 8.6 — In-place cost editor (currency + rate) + "Print itinerary" button
- **Status**: ✅ Done
- **Agent**: ui-specialist
- **Size**: M
- **Task**: (a) On the trip detail screen `app/(app)/trip/[id]/index.tsx`, add an inline editor for `currency` + `cost_per_km` — concretely, a small "Cost settings" section near the rollup card with: a `SegmentedControl` (or `Picker`) for currency (USD / EUR / GBP / TRY / JPY) and a numeric `TextInput` for cost-per-km. Wire both to `useUpdateTrip(tripId)` from Step 8.3; debounce the rate input by 500ms so we don't flood the DB on every keystroke. Validate the rate as a positive number; show an inline `EmptyState`-style hint if invalid (no toast lib). (b) Add a "Print itinerary" `Button` to the trip detail screen header (or the cost-settings section, whichever fits the layout). On web, the button uses `router.push('/trip/' + id + '/print')` and the print page itself contains a second "Print this page" button that calls `window.print()`. On native, the button uses the same `router.push` but the destination renders the read-only summary view from 8.5 and hides the `window.print()` button. (c) Confirm the rollup updates live as the user changes the rate (it should via TanStack Query cache invalidation from `useUpdateTrip`). **No tests.**
- **Inputs**: Steps 8.3, 8.4, 8.5
- **Expected output**: Cost settings inline section persists changes; rollup card recomputes within ~500ms of the rate input settling; "Print itinerary" navigates to the print route on all three platforms; on web the print page's `window.print()` button opens the browser print dialog
- **Depends on**: Steps 8.3, 8.4, 8.5
- **Parallel with**: (none — integration step that ties 8.3 / 8.4 / 8.5 together)
- **Platform check**: All three. The `window.print()` call is web-only and gated by `Platform.OS === 'web'`; the navigation works everywhere; native renders the print route as a scrollable view.
- **Risks**:
  - [Medium] Debouncing with React Native `TextInput` requires `useDebouncedValue` or a small `useEffect`-based debounce; ui-specialist must avoid spawning a new `setTimeout` on every render — Mitigation: use a stable debounce hook; if none exists in the repo, write a 10-line `useDebounce` in the same file
  - [Medium] `Platform.OS` checks for `window.print()` should fall through to a no-op on native, not crash — Mitigation: ui-specialist confirms native builds still compile (Metro will fail loudly if `window` is referenced unguarded)
  - [Low] The numeric input may accept `NaN` if user types letters — Mitigation: parse with `Number(...)` and bail on `Number.isFinite(...) === false`
- **Touched files**: `app/(app)/trip/[id]/index.tsx`, `app/(app)/trip/[id]/print.tsx` (final wiring of `window.print()` button)

### Step 8.7 — Reviewer pass on Phase 8 changes
- **Status**: ✅ Done
- **Agent**: reviewer
- **Size**: S
- **Task**: Read every diff introduced in Phase 8. Confirm: (1) the new `currency` + `cost_per_km` columns inherit the existing `trips_owner_all` RLS policy (they do — the policy gates the row, not the column, but the SQL should be sanity-checked); (2) the cost rollup math is correct — `meters / 1000 * cost_per_km` per leg, summed; rounding behaviour is reasonable (no premature `Math.round` that loses sub-unit precision); (3) `Intl.NumberFormat` is invoked with valid currency codes from the literal union — no runtime mismatch between TS type and migration check constraint; (4) the print route does not log PII or trip data to Sentry / console; (5) the print page's "Powered by Google" attribution is present (Tripvisor rule — every Place-data screen); (6) `window.print()` is gated by `Platform.OS === 'web'` and does not appear in native bundles; (7) no Google ToS regressions — the print page must NOT include Google reviews / photos / ratings / hours (those aren't persisted anyway, but reviewer confirms the print template only reads from `trip_places` columns); (8) `useUpdateTrip` debouncing does not race with optimistic updates from Phase 7's archive / unarchive (different cache keys, but reviewer confirms). Write findings to `docs/reviews/phase-8.md` with critical / high / medium / low. **Tests are out of scope; reviewer reads code only, does not run tests or smokes.**
- **Inputs**: All Phase 8 diffs
- **Expected output**: `docs/reviews/phase-8.md` with findings; no critical or high blocks Step 8.8
- **Depends on**: Step 8.6
- **Parallel with**: (none)
- **Platform check**: N/A (review)
- **Risks**:
  - [Medium] If reviewer surfaces a critical (e.g. `window.print` leaks into native bundle, attribution missing), Phase 8 must loop back to ui-specialist — Mitigation: budget one fix loop; if more than one critical surfaces, planner re-enters with a revised plan
  - [Low] Reviewer may push back on the fixed currency list — Mitigation: parked as a follow-up unless it's a blocker for the user
- **Touched files**: `docs/reviews/phase-8.md`

### Step 8.8 — Docs flip
- **Status**: ✅ Done
- **Agent**: docs-specialist
- **Size**: S
- **Task**: (a) Add one row to `docs/features/overview.md`: "Cost & itinerary visibility (rollup, daily summary, print)" → ✅ Done (web; native deferred to user smoke), Phase 8, doc `cost-and-print.md`. (b) Create `docs/features/cost-and-print.md` per the existing feature-doc template (intent / scope / API surface / data model / platforms verified table — leave iOS / Android boxes unticked, tick Web only). Include a short "Print on native" section noting the deliberate native limitation and the inline "Open this trip on the web to print" copy. (c) Flip the Phase 8 row in `plan.md`'s top table to ✅ Done. (d) Append a one-paragraph "Phase 8 — close-out" entry under the Phase 7 close-out paragraph, summarising shipped surface (cost rollup, per-day summary, in-place cost editor, web print route + A4 stylesheet, native read-only print view). Do NOT edit `CLAUDE.md` (planner project rule).
- **Inputs**: Step 8.7 review (no critical / high)
- **Expected output**: Feature doc reflects the new state; `plan.md` Phase 8 row reads ✅ Done; the new feature doc exists
- **Depends on**: Step 8.7
- **Parallel with**: (none)
- **Platform check**: N/A (docs)
- **Risks**:
  - [Low] Existing feature-doc template may have evolved between Phase 7 and now — Mitigation: docs-specialist reads `docs/features/trip-lifecycle.md` (Phase 7) as the most recent template and matches its shape
- **Touched files**: `plan.md`, `docs/features/overview.md`, `docs/features/cost-and-print.md` (new)

## ⚠ Blockers (Phase 8 — must be cleared before Step 8.2)

1. **Local Supabase stack must be reachable** for the migration to apply (`npx supabase db reset`). Same precondition as Phase 7 Step 7.2; if the user has not run `supabase start` since Phase 7, they need to before Step 8.2 lands.
2. **Pre-existing blockers carried forward — NOT in scope for Phase 8**:
   - Google Maps API keys — Phase 8 deliberately avoids any Google-keyed surface; cost is computed from already-cached `trip_legs.distance_meters` written during Phase 2 optimization. No new Google calls.
   - Leaked Supabase PAT rotation — Phase 8 uses local Supabase only; cloud PAT is irrelevant.
   - EAS account / Apple Developer / Google Play Developer — Phase 8 is web-first for print; native renders a read-only view by design. No native build / signing work.

## Phase 8 — non-goals (explicit)

- **Tests** — no Jest, no Deno tests, no fast-check, no RLS integration tests, no `*.test.ts` / `*.spec.ts` files authored or modified. The `test-specialist` sub-agent is removed for the duration of the project.
- **Smokes** — no Playwright execution, no manual UI smoke checklists, no `docs/smoke/phase-8.md`.
- **Coverage / CI changes** — Phase 5 deferred work stays deferred; the existing `.github/workflows/` is not modified.
- **Google Maps work** — no Places API, no Routes API, no optimizer changes, no map polyline updates. Cost is derived purely from already-cached `trip_legs.distance_meters` and `duration_seconds`.
- **EAS / native builds** — no `eas.json` changes, no Apple / Google Play config, no native verification beyond visual confirmation by the implementing specialist.
- **Native verification** — iOS / Android remain deferred to user smoke as standard for this project.
- **Native PDF / share** — printing on native is explicitly out of scope; the native `print` route renders a read-only view with an inline note pointing the user to the web. No `expo-print`, no `expo-sharing`, no platform PDF generation.
- **Multi-currency per leg** — trip-level currency only; per-place or per-leg currencies are parked.
- **Free-form ISO 4217 currency list** — fixed list of 5 currencies (USD / EUR / GBP / TRY / JPY) chosen so the editor can be a segmented control. Expanding the list is a one-line follow-up.
- **Per-day map screenshots in print** — text-only print template; embedding a static map image would require a Google call and a key. Parked.
- **Phases 2 / 3 / 5 / 6 status flips** — Phase 8 does not touch their rows; they stay 🚧 / partial as recorded.
- **Phase 7 follow-ups** — M2 (parallel-mutation rollback) and the parked Phase 7 lows from `docs/reviews/phase-7.md` stay parked; not reopened in Phase 8 unless reviewer flags interaction with the new mutations.

---

## Phase 9 — Notes / journal expansion (inline place notes, per-day notes, Markdown in print) + M2 mutation cleanup

**Goal**: Turn the unused `trip_places.notes` column into a real journal surface — inline edit on the trip detail screen with a "show more / show less" toggle, plus a new per-day notes field stored on `trip_days`, and a tiny Markdown renderer so both note types render with bold / italic / lists / links on the print page. Bundle the M2 follow-up from Phase 8 review (`commitBudget` / `commitMode` migrate to `useUpdateTrip`) so the trip detail screen stops bypassing TanStack Query for two stray fields.

**Status**: ✅ Done — shipped 2026-04-25; reviewer sign-off (`docs/reviews/phase-9.md`); no critical/high/medium findings; 5 low parks.
**Last updated**: 2026-04-25

**Direction chosen**: Direction A (notes / journal expansion) + bundled M2 cleanup. (1) Notes are already persisted on `trip_places` and copied by `duplicate_trip` (ADR-0006), but have no editor UI today — the print page renders them, autocomplete creates a row with `notes: null`, and that's the entire current footprint. Adding an inline editor + per-day notes turns the Phase 8 print template into something a user actually fills in. (2) Builds directly on Phase 8: every printed itinerary already has a "notes" line per place; adding Markdown rendering + a per-day notes block lifts the print artifact from "list of places" to "actual journal". (3) Pure UI + one tiny additive migration (`trip_days.notes text` — RLS unchanged, inherits from existing `trip_days_via_trip` policy). No Google API calls. (4) The M2 cleanup is one step that extends `UpdateTripPatch` with `daily_hours_budget` + `transport_mode` and migrates the two raw `supabase.from('trips').update(...)` callers — natural to bundle since both touch the same trip detail screen as the notes affordances.

**Entry criteria**:
- Phase 8 close-out is current state; `useUpdateTrip(tripId)` exists with the `UpdateTripPatch` shape (`Partial<Pick<Trip, 'title' | 'currency' | 'cost_per_km'>>`)
- `trip_places.notes text` and `useUpdateTripPlace({ ..., notes })` already exist (Phases 1 + 3); the print page already reads `place.notes` (Phase 8)
- Local Supabase stack is reachable so the `0006_trip_day_notes.sql` migration can be applied (`npx supabase db reset`)
- `app/(app)/trip/[id]/index.tsx` still contains the `commitBudget` / `commitMode` raw-Supabase pattern flagged as M2 in `docs/reviews/phase-8.md`
- User has NOT requested Google-keys provisioning, EAS provisioning, or PAT rotation in this phase — Phase 9 must not depend on any of those

**Phase exit criteria**:
- A new `0006_trip_day_notes.sql` migration adds `notes text` (nullable) to `public.trip_days`; existing rows backfill `null` automatically; RLS unchanged (inherits `trip_days_via_trip`)
- `TripDay` in `src/api/types.ts` has `notes: string | null`; a `useUpdateTripDay({ id, trip_id, notes })` hook (or equivalent extension to whatever currently writes `trip_days`) lives in `src/api/trip-days.ts` and invalidates the trip-detail cache
- `UpdateTripPatch` in `src/api/trips.ts` widens to include `daily_hours_budget` + `transport_mode`; `commitBudget` and `commitMode` in `app/(app)/trip/[id]/index.tsx` switch from raw `supabase.from('trips').update(...)` to `updateTrip.mutate({ ... })` so the cache invalidates correctly (M2 closed)
- The trip detail screen renders an inline notes editor on each `PlaceRow` (or via the existing `PlaceActionsSheet`, ui-specialist picks the cleaner surface): a multi-line `TextInput` capped at 2000 chars with a "Show more / Show less" toggle that collapses notes >120 chars to the first line; debounced write (500ms) via `useUpdateTripPlace`; saves the empty string as `null`
- Each day section on the trip detail screen renders a per-day notes editor (collapsible, default-collapsed, 2000-char cap, debounced 500ms), backed by `useUpdateTripDay`; the editor shows a placeholder ("Add notes for this day") when empty
- The print route renders place notes and per-day notes through a tiny in-repo Markdown renderer (`src/lib/markdown/render.ts` — supports bold `**x**`, italic `*x*`, unordered lists `- ...`, ordered lists `1. ...`, and links `[text](url)`; everything else passes through as plain text); zero new dependencies
- Place notes / per-day notes survive `duplicate_trip` — confirmed by code-reading the existing RPC (Phase 7 already clones `trip_places.notes`); add `notes` to the `trip_days` clone if the existing `duplicate_trip` RPC clones day rows (backend-specialist verifies; if not, no change required because the per-day notes are tied to the source-trip days only)
- All three platforms render the new notes editors and the print page's Markdown output without layout breaks (visual confirmation; native verification deferred to user as standard for this project)
- `docs/features/overview.md` has a row for "Trip notes / journal (per-place + per-day, Markdown in print)" with status reflecting Phase 9 completion
- A short ADR exists at `docs/adr/0008-notes-markdown-renderer.md` recording the decision to ship a tiny in-repo Markdown subset rather than pull `marked` / `react-native-markdown-display`

**Critical path**: Step 9.1 → Step 9.2 → Step 9.3 → Step 9.4 → Step 9.6 → Step 9.7 → Step 9.8

(Step 9.5 — Markdown renderer + print integration — parallels Step 9.4 on the same critical-path tier since they touch disjoint files. Step 9.6 — M2 cleanup — slots in as a small parallel branch off Step 9.3 because it depends only on the widened `UpdateTripPatch` and is independent of the notes UI work.)

### Step 9.1 — ADR for in-repo Markdown subset
- **Status**: ✅ Done
- **Agent**: planner
- **Size**: XS
- **Task**: Author `docs/adr/0008-notes-markdown-renderer.md` recording: (1) notes are rendered through a ~80-line in-repo renderer at `src/lib/markdown/render.ts` rather than a library; (2) supported subset — bold `**x**`, italic `*x*`, unordered lists `- ...`, ordered lists `1. ...`, links `[text](url)` (rel="noopener" on web); everything else falls through as plain text; (3) rationale — `marked` is HTML-only (web), `react-native-markdown-display` is RN-only (native), and either choice forces a platform split or a CommonMark-compliant universal lib (>50KB) for what is fundamentally a free-form text field; the subset above covers the realistic note grammar (highlight, list, link to a maps URL); (4) consequences — no XSS surface from arbitrary HTML, ~80 LOC to maintain, manual extension whenever a user asks for a new construct; (5) alternatives considered — `marked` (rejected: web-only + DOM injection), `react-native-markdown-display` (rejected: native-only + 30KB), full `react-markdown` (rejected: web-only + heavy), no formatting at all (rejected: print page wants minimal styling). Standard ADR template (Context / Decision / Alternatives / Consequences). One screen max.
- **Inputs**: This phase plan; the existing `docs/adr/README.md` template; cross-reference `docs/adr/0007-cost-rollup-client-side.md` for shape
- **Expected output**: `docs/adr/0008-notes-markdown-renderer.md` exists; Step 9.5 references it when authoring `render.ts`
- **Depends on**: None
- **Parallel with**: (none — gates the design intent for 9.5, but takes <30 min)
- **Platform check**: N/A (doc only)
- **Risks**:
  - [Low] If the renderer grows past ~150 LOC during 9.5 (table support, fenced code), the ADR's "tiny in-repo" framing weakens — Mitigation: ADR explicitly enumerates the closed grammar; anything outside is a follow-up
- **Touched files**: `docs/adr/0008-notes-markdown-renderer.md`

### Step 9.2 — Migration: `trip_days.notes`
- **Status**: ✅ Done
- **Agent**: backend-specialist
- **Size**: XS
- **Task**: Add `supabase/migrations/0006_trip_day_notes.sql` that: (1) adds `notes text` (nullable, no default) to `public.trip_days`; (2) does not touch RLS — the existing `trip_days_via_trip` policy gates the row; the new column inherits coverage; (3) does not add an index — notes are read on a single-row trip-detail query, never filtered on. Migration must apply cleanly via `npx supabase db reset`. Confirm by reading `supabase/migrations/0001_init.sql` that `trip_days` is the right table (per-day anchors, distinct from `trip_places`). **No tests.**
- **Inputs**: ADR from Step 9.1 (only for context — the migration itself is independent); `0001_init.sql` for table shape
- **Expected output**: `0006_trip_day_notes.sql` applies without error; `\d public.trip_days` shows the new `notes` column; `select notes from trip_days limit 1` returns `null` for existing rows
- **Depends on**: None
- **Parallel with**: Step 9.1 (different files; planner ADR + backend migration are disjoint)
- **Platform check**: N/A (DB migration)
- **Risks**:
  - [Low] If the existing `duplicate_trip` RPC clones `trip_days` rows and explicitly enumerates columns, adding `notes` may need a one-line addition there too — Mitigation: backend-specialist greps for `trip_days` in `0002_rpcs.sql` + `0004_trip_lifecycle.sql`; if `duplicate_trip` does not clone `trip_days` (per ADR-0006 which only mentions `trip_places`), no change needed
- **Touched files**: `supabase/migrations/0006_trip_day_notes.sql`, possibly `supabase/migrations/0007_duplicate_trip_day_notes.sql` (only if the existing RPC enumerates day columns and needs `notes` added)

### Step 9.3 — Type + API extensions: `TripDay.notes`, `useUpdateTripDay`, widened `UpdateTripPatch`
- **Status**: ✅ Done
- **Agent**: backend-specialist
- **Size**: S
- **Task**: (a) Extend `TripDay` in `src/api/types.ts` with `notes: string | null`. (b) Create `src/api/trip-days.ts` exporting `useTripDays(tripId)` (read query) and `useUpdateTripDay()` mutation accepting `{ id, trip_id, notes }`, Zod-validated (`notes: z.string().max(2000).nullish()`). On success, invalidate `tripDaysKeys.forTrip(trip_id)` and the trip-detail cache. If `useTripDays` already exists somewhere in the codebase, extend the existing hook rather than creating a duplicate (backend-specialist greps first). Re-export from `src/api/index.ts`. (c) Widen `UpdateTripPatch` in `src/api/trips.ts` to `Partial<Pick<Trip, 'title' | 'currency' | 'cost_per_km' | 'daily_hours_budget' | 'transport_mode'>>` so the M2 cleanup in Step 9.6 has a typed home. Update the `useUpdateTrip` doc-comment to list the new fields. Run `tsc --noEmit` locally and fix any breakages caused by the type widening (likely zero — additive). **No tests.**
- **Inputs**: Step 9.2 (column exists in DB); existing `tripsKeys` + `tripPlacesKeys` patterns in `src/api/trips.ts` and `src/api/trip-places.ts` for the new `tripDaysKeys` shape
- **Expected output**: `useUpdateTripDay({ id, trip_id, notes: 'foo' })` writes to the DB and the trip-detail cache reflects the change after invalidation; `useUpdateTrip(id).mutate({ daily_hours_budget: 6 })` compiles and writes; `tsc --noEmit` is clean
- **Depends on**: Step 9.2
- **Parallel with**: Step 9.1 (Step 9.1's ADR is doc-only, can land first or last)
- **Platform check**: All three (pure JS / TanStack Query)
- **Risks**:
  - [Low] If `trip_days` rows are not auto-created when the optimizer runs, an "update" against a non-existent row will silently no-op — Mitigation: backend-specialist confirms `trip_days` is upserted by the optimizer (Phase 2); if not, `useUpdateTripDay` upserts on `(trip_id, day_index)` instead
  - [Low] Widening `UpdateTripPatch` may force callers to update if any caller depends on the narrow shape via `keyof` — Mitigation: keep the patch shape `Partial<...>` so existing callers compile unchanged
- **Touched files**: `src/api/types.ts`, `src/api/trip-days.ts` (new or extended), `src/api/trips.ts`, `src/api/index.ts`

### Step 9.4 — Inline place-notes editor with show-more / show-less toggle
- **Status**: ✅ Done
- **Agent**: ui-specialist
- **Size**: M
- **Task**: (a) Pick the cleanest surface for the per-place notes editor — either an expand row inside `app/(app)/trip/[id]/index.tsx` (preferred if the place row already has a stable expand affordance) OR a new "Notes" section inside `src/components/PlaceActionsSheet.tsx`. ui-specialist decides; document choice in a short header comment. (b) Render: multi-line `TextInput` (`multiline`, `numberOfLines={4}`, `maxLength={2000}`); when not focused and the persisted notes string is >120 chars, truncate to the first 120 chars + ellipsis with a "Show more" / "Show less" `Pressable` toggle. Debounce writes by 500ms via the same `useDebounce` pattern used for `cost_per_km` in Phase 8 (extract to `src/lib/hooks/useDebouncedCallback.ts` if not already shared — small util, 15 LOC). On unmount, flush pending timer (mirror Phase 8 M1 fix). (c) Save empty string as `null` (call `useUpdateTripPlace({ id, trip_id, notes: trimmed.length ? trimmed : null })`). (d) Accessibility — `accessibilityLabel="Notes for <place title>"`, `accessibilityRole="text"` on the truncated view, `accessibilityRole="button"` on the toggle. **No tests.**
- **Inputs**: Step 9.3 (types updated, though notes shape didn't change here — `useUpdateTripPlace` already accepts `notes`); existing `useUpdateTripPlace` in `src/api/trip-places.ts`; existing `TextInput` styling tokens in `src/theme/`
- **Expected output**: Each place row on the trip detail screen exposes an editable notes field; typing settles after 500ms with a single DB write; long notes collapse to one line by default; toggle expands them; native + web both compile and render
- **Depends on**: Step 9.3
- **Parallel with**: Step 9.5
- **Platform check**: All three. `TextInput multiline` is universal in RN. No platform-split needed.
- **Risks**:
  - [Medium] Putting a per-place `TextInput` on every row of a long trip (50+ places) may cause keyboard / scroll issues on mobile (focused TextInput inside a `FlatList` requires `keyboardShouldPersistTaps="handled"` and care with `keyboardAvoidingView`) — Mitigation: ui-specialist verifies on web first (where keyboard is non-issue); for native, falls back to opening the editor inside `PlaceActionsSheet` if inline causes layout flicker
  - [Medium] `maxLength={2000}` is a hard char limit but multi-byte chars (emoji, CJK) count as multiple code units in some RN versions — Mitigation: 2000 chars is generous; document the limit in the placeholder ("Up to 2000 characters")
  - [Low] Show-more / show-less state is per-row local state; switching tabs and back resets it — Mitigation: acceptable; the persisted notes are the source of truth
- **Touched files**: `app/(app)/trip/[id]/index.tsx`, possibly `src/components/PlaceActionsSheet.tsx`, possibly `src/lib/hooks/useDebouncedCallback.ts` (new — only if the Phase 8 debounce wasn't already extracted)

### Step 9.5 — Per-day notes editor + tiny Markdown renderer + print integration
- **Status**: ✅ Done
- **Agent**: ui-specialist
- **Size**: M
- **Task**: (a) Add a per-day notes editor at the top of each day section in `app/(app)/trip/[id]/index.tsx` (under the Phase 8 `DaySummaryCard`): collapsed-by-default `Pressable` ("Add notes for this day" if empty, else first-line preview); when expanded, multi-line `TextInput` (same `useDebouncedCallback` pattern + unmount cleanup as 9.4) writing via `useUpdateTripDay` from Step 9.3. Editor accepts up to 2000 chars; saves empty as `null`. (b) Author `src/lib/markdown/render.ts` per ADR Step 9.1: a single function `renderMarkdown(input: string): MarkdownNode[]` returning a flat array of typed nodes (`{ kind: 'text' | 'bold' | 'italic' | 'link' | 'list-item-ul' | 'list-item-ol', text: string, href?: string, depth?: number }`). Plus a paired `<MarkdownText>` component in `src/components/MarkdownText.tsx` that walks the node array and renders RN `<Text>` / `<View>` primitives with appropriate `fontWeight` / `fontStyle` / link `onPress` (using `Linking.openURL` on native, `<a href>` on web — platform-split if needed, otherwise `Linking` works on both since RN Web maps it). Subset is fixed: `**bold**`, `*italic*`, `- ul item`, `1. ol item`, `[text](url)` — anything else falls through as literal text. ~80–120 LOC total. (c) Update `app/(app)/trip/[id]/print.tsx` to render `place.notes` and `day.notes` through `<MarkdownText>` instead of plain `<Text>`. Existing print layout otherwise unchanged. **No tests, no library deps.**
- **Inputs**: Step 9.1 ADR (renderer grammar); Step 9.3 (`useUpdateTripDay`); Phase 8 `print.tsx` for the integration site
- **Expected output**: Each day on the trip detail screen has a per-day notes editor that persists to `trip_days.notes`; the print page renders both place and day notes through `<MarkdownText>` with bold / italic / lists / links visible in browser print preview; native print route renders the same content (without `window.print`)
- **Depends on**: Step 9.3
- **Parallel with**: Step 9.4 (different primary files — day-level UI + new `src/lib/markdown/` + print page integration vs. place-level UI)
- **Platform check**: All three. `Linking.openURL` is universal; `react-native-web` maps `<Text>` to `<span>` so `fontWeight` / `fontStyle` work on web. No platform-split needed for the renderer itself; the print page already has the `Platform.OS === 'web'` gate.
- **Risks**:
  - [Medium] Markdown renderer regex over user input is a classic source of catastrophic backtracking on adversarial inputs — Mitigation: linear-pass tokenizer (no nested unbounded quantifiers); ui-specialist writes the parser as a simple character-by-character walker, not a single mega-regex
  - [Medium] Link `onPress` on web should use a real `<a href>` for accessibility (Ctrl-click open in new tab) — Mitigation: platform-split `<MarkdownText.web.tsx>` / `<MarkdownText.native.tsx>` only for the link node (keep tokenizer shared)
  - [Low] Per-day notes editor duplicates the debounce pattern from 9.4 — Mitigation: ensure 9.4 extracts `useDebouncedCallback` first; if 9.5 lands first, ui-specialist extracts the shared util in the same diff
- **Touched files**: `app/(app)/trip/[id]/index.tsx`, `app/(app)/trip/[id]/print.tsx`, `src/lib/markdown/render.ts` (new), `src/components/MarkdownText.tsx` (new — possibly platform-split as `.native.tsx` / `.web.tsx`), `src/components/index.ts` (re-export)

### Step 9.6 — M2 cleanup: migrate `commitBudget` / `commitMode` to `useUpdateTrip`
- **Status**: ✅ Done
- **Agent**: backend-specialist
- **Size**: XS
- **Task**: In `app/(app)/trip/[id]/index.tsx`, replace the two raw-Supabase writes flagged as M2 in `docs/reviews/phase-8.md`. Concretely: (a) hold an `updateTrip = useUpdateTrip(tripId)` reference at the top of the screen (it already exists for cost edits in Phase 8 — re-use that handle, do not double-instantiate); (b) `commitBudget(v)` becomes `setBudget(v); updateTrip.mutate({ daily_hours_budget: v });`; (c) `commitMode(v)` becomes `setMode(v); updateTrip.mutate({ transport_mode: v });`; (d) remove the now-unused `supabase.from('trips').update(...)` lines; (e) confirm via `tsc --noEmit` + a manual code-read that no other caller in the screen needs the removed pattern. Reference `docs/reviews/phase-8.md` lines 34–39 for the M2 description. **No tests.** **Note**: this step is backend-specialist (not ui-specialist) because the change is purely a server-state plumbing migration, not a UI surface change — the user-visible behaviour is unchanged.
- **Inputs**: Step 9.3 (widened `UpdateTripPatch` includes `daily_hours_budget` + `transport_mode`); `docs/reviews/phase-8.md` M2 entry
- **Expected output**: The two raw `supabase.from('trips').update(...)` lines are gone from `app/(app)/trip/[id]/index.tsx`; the screen uses `updateTrip.mutate({ ... })` for budget + transport-mode edits; `tsc --noEmit` is clean; the cost rollup + trip header recompute on budget/mode change because `useUpdateTrip` invalidates `tripsKeys.detail(tripId)`
- **Depends on**: Step 9.3
- **Parallel with**: Steps 9.4 + 9.5 (different code paths within the same file — coordinate merge order to avoid conflicts; if both 9.4 and 9.6 want to edit the same screen, ui-specialist takes 9.4 first, then backend-specialist rebases 9.6 on top)
- **Platform check**: All three (pure server-state plumbing)
- **Risks**:
  - [Low] Merge conflict with Step 9.4 / 9.5 in `app/(app)/trip/[id]/index.tsx` — Mitigation: serialise the three steps' touches to that file by having backend-specialist do 9.6 last in the chain; the diff is small (~10 lines)
  - [Low] If the budget slider currently fires `commitBudget` on every drag tick (not on release), the new mutation will issue a request per tick — Mitigation: backend-specialist checks the slider's onChange semantics; if it fires per tick, debounce 9.6 the same 500ms way as Phase 8's cost editor; otherwise leave as-is
- **Touched files**: `app/(app)/trip/[id]/index.tsx`

### Step 9.7 — Reviewer pass on Phase 9 changes
- **Status**: ✅ Done
- **Agent**: reviewer
- **Size**: S
- **Task**: Read every diff introduced in Phase 9. Confirm: (1) the new `trip_days.notes` column inherits the existing `trip_days_via_trip` RLS policy; (2) `useUpdateTripDay` calls `.eq('user_id', userId)` defense-in-depth via the trip join, OR equivalently filters via `trip_id` against an authenticated cache (reviewer flags if missing); (3) the Markdown renderer in `src/lib/markdown/render.ts` does not introduce an XSS surface — concretely, link `href` values are not interpolated as `dangerouslySetInnerHTML`, and on web the renderer either uses `<a href>` directly (which React escapes) or `Linking.openURL` (which is safe); reviewer confirms no `dangerouslySetInnerHTML` appears anywhere in the diff; (4) the renderer does not enable `javascript:` URLs in links — `[text](url)` should reject any URL whose protocol is not `http(s):` or `mailto:`; reviewer confirms a protocol allow-list is present; (5) M2 cleanup correctly invalidates the trip detail cache on budget / mode change (just by virtue of `useUpdateTrip`'s `onSuccess` invalidation — confirm no regression); (6) no Google ToS regressions — notes are user-managed text, not Google place data, so no attribution change; the print page's "Powered by Google" attribution is still present from Phase 8; (7) no PII logged from the new code paths (notes, day notes); (8) the debounce timer cleanup pattern from Phase 8 M1 is replicated for the new TextInput debouncers in 9.4 / 9.5 (no `setTimeout` left dangling on unmount); (9) `useUpdateTripPlace` already exists with `notes` support — reviewer confirms 9.4 reuses it rather than spawning a parallel mutation. Write findings to `docs/reviews/phase-9.md` with critical / high / medium / low. **Tests are out of scope; reviewer reads code only, does not run tests or smokes.**
- **Inputs**: All Phase 9 diffs; `docs/reviews/phase-8.md` for the M1 debounce pattern + M2 description
- **Expected output**: `docs/reviews/phase-9.md` with findings; no critical or high blocks Step 9.8
- **Depends on**: Steps 9.4, 9.5, 9.6
- **Parallel with**: (none)
- **Platform check**: N/A (review)
- **Risks**:
  - [Medium] If reviewer surfaces a critical XSS / `javascript:` URL bypass in the Markdown renderer, Phase 9 must loop back to ui-specialist — Mitigation: budget one fix loop; if the renderer needs a substantive rewrite, planner re-enters with a revised plan
  - [Low] Reviewer may push back on inline place-notes editor causing a long-trip layout problem — Mitigation: parked unless confirmed by visual inspection
- **Touched files**: `docs/reviews/phase-9.md`

### Step 9.8 — Docs flip
- **Status**: ✅ Done
- **Agent**: docs-specialist
- **Size**: S
- **Task**: (a) Add one row to `docs/features/overview.md`: "Trip notes / journal (per-place + per-day, Markdown in print)" → ✅ Done (web; native deferred to user smoke), Phase 9, doc `notes-journal.md`. (b) Create `docs/features/notes-journal.md` per the existing feature-doc template (intent / scope / API surface / data model / platforms verified table — leave iOS / Android boxes unticked, tick Web only). Include a short "Markdown subset" section listing the supported constructs (bold, italic, ul, ol, links) and a one-line note on the protocol allow-list (`http(s):`, `mailto:`). (c) Flip the Phase 9 row in `plan.md`'s top table to ✅ Done. (d) Append a one-paragraph "Phase 9 — close-out" entry under the Phase 8 close-out paragraph, summarising shipped surface (per-place notes editor, per-day notes editor + migration, in-repo Markdown renderer, print integration, M2 mutation cleanup). Cross-reference ADR-0008. Do NOT edit `CLAUDE.md` (planner project rule). Do NOT edit `docs/architecture.md` (planner project rule).
- **Inputs**: Step 9.7 review (no critical / high)
- **Expected output**: Feature doc reflects the new state; `plan.md` Phase 9 row reads ✅ Done; the new feature doc exists; close-out paragraph appended
- **Depends on**: Step 9.7
- **Parallel with**: (none)
- **Platform check**: N/A (docs)
- **Risks**:
  - [Low] Existing feature-doc template may have evolved between Phase 8 and now — Mitigation: docs-specialist reads `docs/features/cost-and-print.md` (Phase 8) as the most recent template and matches its shape
- **Touched files**: `plan.md`, `docs/features/overview.md`, `docs/features/notes-journal.md` (new)

## ⚠ Blockers (Phase 9 — must be cleared before Step 9.2)

1. **Local Supabase stack must be reachable** for the migration to apply (`npx supabase db reset`). Same precondition as Phase 8 Step 8.2; if the user has not run `supabase start` since the last phase, they need to before Step 9.2 lands.
2. **Pre-existing blockers carried forward — NOT in scope for Phase 9**:
   - Google Maps API keys — Phase 9 deliberately avoids any Google-keyed surface; notes are user-managed text content, no Google calls.
   - Leaked Supabase PAT rotation — Phase 9 uses local Supabase only; cloud PAT is irrelevant.
   - EAS account / Apple Developer / Google Play Developer — Phase 9 is web-first; native renders the same UI by design (notes editors are universal RN). No native build / signing work.

## Phase 9 — non-goals (explicit)

- **Tests** — no Jest, no Deno tests, no fast-check, no RLS integration tests, no `*.test.ts` / `*.spec.ts` files authored or modified. The `test-specialist` sub-agent remains removed for the duration of the project.
- **Smokes** — no Playwright execution, no manual UI smoke checklists, no `docs/smoke/phase-9.md`.
- **Coverage / CI changes** — Phase 5 deferred work stays deferred; the existing `.github/workflows/` is not modified.
- **Google Maps work** — no Places API, no Routes API, no optimizer changes, no map polyline updates. Notes are user-managed text only.
- **EAS / native builds** — no `eas.json` changes, no Apple / Google Play config, no native verification beyond visual confirmation by the implementing specialist.
- **Native verification** — iOS / Android remain deferred to user smoke as standard for this project.
- **Full CommonMark Markdown** — the renderer ships a closed grammar (bold, italic, ul, ol, link with `http(s):` / `mailto:` allow-list). Tables, fenced code, blockquotes, headings, images, raw HTML are all out of scope. Adding any construct is a one-step follow-up phase.
- **Markdown library dependency** — no `marked`, no `react-native-markdown-display`, no `react-markdown`. ADR-0008 records the trade-off.
- **Rich-text editor** — the editors are plain `TextInput` with a 2000-char cap; no toolbar, no preview pane, no slash-commands. The renderer only runs at print time.
- **Notes search / filter** — notes are not indexed, not searchable from the trips list. Out of scope.
- **Notes attachments / images** — text only; image upload is a separate (post-MVP) feature per `docs/features/overview.md`'s post-MVP brainstorm section.
- **Multi-currency or per-leg cost rebalancing** — Phase 8 follow-ups (free-form ISO list, per-leg currencies, per-day map screenshots in print) stay parked.
- **Phases 2 / 3 / 5 / 6 status flips** — Phase 9 does not touch their rows; they stay 🚧 / partial as recorded.
- **Phase 7 follow-ups** — the parallel-mutation rollback finding from `docs/reviews/phase-7.md` and the Phase 7 lows stay parked; not reopened in Phase 9 unless reviewer flags interaction.
- **Phase 8 low findings** — L1 (JPY rate label minor-unit), L2 (`_TripLegRef` workaround), L3 (`Intl.NumberFormat` constructor allocation), L4 (`inputMode` cast), L5 (empty-patch no-op comment) all stay parked from `docs/reviews/phase-8.md`. Phase 9 does not reopen them unless touched incidentally.

## Phase 10 — Account data export (JSON download) + L4 debounce flush-on-blur bundle

**Goal**: Give the signed-in user a one-click "Export my data" button in Settings that downloads a single `tripvisor-export-<YYYY-MM-DD>.json` file containing every row they own across `trips`, `trip_places`, `trip_legs`, and `trip_days` (their entire data footprint, modulo Google Place fields the project never persists). Pairs with Phase 7's delete-account so users can pull their data before deleting. Bundle the Phase 9 L4 follow-up — extend `useDebouncedCallback` with an imperative `flush()` and wire it to `onBlur` on the place- and day-notes editors so the last keystrokes aren't dropped on blur.

**Status**: ✅ Done — shipped 2026-04-25; reviewer sign-off (`docs/reviews/phase-10.md`); no critical/high/medium findings; 5 low parks.
**Last updated**: 2026-04-25

**Direction chosen**: Direction A (account data export) + bundled Phase 9 L4 (debounce flush-on-blur). (1) Reuses the JWT-verified Edge Function shape from `supabase/functions/delete-account/index.ts` (anon-client `auth.getUser(token)` to verify the bearer, then service-role client to read the user's rows by `user_id`) — same security model, same logger, same CORS shape. (2) Reuses the platform-split download mechanic from `src/api/ics.web.ts` (Blob + anchor + `URL.revokeObjectURL`) and `src/api/ics.native.ts` (`expo-file-system` write to cache dir + `expo-sharing.shareAsync`) — both already proven for the `.ics` flow. (3) Zero new dependencies, no Google calls, no Storage bucket, no migration, no new tables; clears all three carried-forward blockers (Google keys, leaked PAT, EAS) by design. (4) The L4 bundle is a small, naturally-aligned polish — extending `useDebouncedCallback` to expose `flush()` and adding `onBlur` handlers on `PlaceNotesEditor` + `DayNotesEditor` is ~25 LOC across three files, fits inside one step, and closes the only Phase 9 low that has a UX-visible correctness angle.

**Entry criteria**:
- Phase 9 close-out is current state; ADR-0008 + `notes-journal.md` shipped 2026-04-25
- `src/api/trips.ts`, `src/api/trip-places.ts`, `src/api/trip-days.ts`, and `src/api/types.ts` already export the canonical row shapes for `Trip`, `TripPlace`, `TripLeg`, and `TripDay` — Phase 10's exporter consumes those types
- `supabase/functions/delete-account/index.ts` is live and the `_shared` Edge Function helpers (`cors.ts`, `errors.ts`, `logger.ts`, `supabase-admin.ts`) work end-to-end
- `src/api/ics.web.ts` + `src/api/ics.native.ts` are wired through `src/api/index.ts` and the Phase 4 `expo-file-system` + `expo-sharing` deps are in `package.json`
- `src/lib/hooks/useDebouncedCallback.ts` exists with the cancel-on-unmount semantics shipped in Phase 9
- `app/(app)/settings.tsx` is the canonical Settings surface (Phase 7) with a clear extension point above the "Sign out" button
- User has NOT requested Google-keys provisioning, EAS provisioning, or PAT rotation in this phase — Phase 10 must not depend on any of those

**Phase exit criteria**:
- A new `supabase/functions/export-account/index.ts` Edge Function exists, modeled on `delete-account/index.ts`: `POST` (auth required) returns `{ ok: true, export: { user_id, exported_at, trips: [...], trip_places: [...], trip_legs: [...], trip_days: [...] } }` for the JWT-verified caller; `GET ?ping` returns `{ ok: true, fn: 'export-account' }`; non-POST returns 405; missing/invalid bearer returns 401; no service-role key leaks to the client; CORS uses the shared `handlePreflight` + `ALLOWED_ORIGINS`
- The Edge Function reads only the caller's rows via `admin.from('<table>').select('*').eq('user_id'|'trip_id', ...)` filters; child-table reads (`trip_places`, `trip_legs`, `trip_days`) are scoped through the user's `trip.id` set so a malformed query cannot leak across users; ordering is deterministic (`order('id', { ascending: true })`) so two consecutive exports for the same user are byte-identical
- A new `src/api/account-export.web.ts` exports a `useExportAccount()` TanStack Query mutation that invokes the Edge Function via `supabase.functions.invoke('export-account', { method: 'POST' })`, builds a JSON blob, and triggers a Blob+anchor download with filename `tripvisor-export-<YYYY-MM-DD>.json` (UTC date); pattern mirrors `src/api/ics.web.ts` including the `setTimeout(URL.revokeObjectURL, 1000)` Safari guard and the SSR `typeof window === 'undefined'` throw
- A new `src/api/account-export.native.ts` exports the same `useExportAccount()` hook signature, writes the JSON to `FileSystem.cacheDirectory` and opens the system share sheet via `Sharing.shareAsync` with `mimeType: 'application/json'`; pattern mirrors `src/api/ics.native.ts`
- `src/api/index.ts` re-exports `useExportAccount` from `./account-export` so consumers get the platform-split file resolution automatically
- `app/(app)/settings.tsx` gains an "Export my data" `Button` (variant `secondary`) above the "Sign out" button that calls `useExportAccount().mutate()`; the button shows a loading state while the mutation runs, surfaces inline errors using the same pattern as the existing delete-account error banner, and is disabled while `signOut` or `isDeleting` are pending
- Place- and day-notes editors flush their pending debounced write on `onBlur` so a user typing and immediately tabbing/clicking away no longer loses the last <500ms of keystrokes; `useDebouncedCallback` is extended to return a tuple `[debouncedFn, flush]` (or equivalent `flush` attached to the callback object — ui-specialist picks the API shape) without breaking existing call sites; existing call sites that don't need flush remain unchanged
- The Edge Function never returns Google place data fields the project does not persist (reviews, photos, ratings, hours) — by virtue of reading `trip_places.*` directly and `trip_places` only stores `google_place_id` + coordinates + user-managed fields, this is automatic; reviewer confirms no field added to the response that wasn't already in the schema
- All three platforms render the new "Export my data" button without layout breaks, and the mutation completes end-to-end on web (visual confirmation by the implementing specialist; native verification deferred to user as standard for this project)
- `docs/features/overview.md` has a row for "Account data export (JSON)" with status reflecting Phase 10 completion
- A short ADR exists at `docs/adr/0009-account-data-export.md` recording the decision to ship a single Edge Function returning a flat JSON object (vs. per-table CSVs, vs. a Postgres `setof json` function, vs. a streaming response)

**Critical path**: Step 10.1 → Step 10.2 → Step 10.3 → Step 10.4 → Step 10.5 → Step 10.7 → Step 10.8

(Step 10.6 — `useDebouncedCallback` flush + notes editor blur wiring — runs as a small parallel branch off Step 10.1 because it touches disjoint files from the export work and can land independently. Step 10.4 / 10.5 are platform-split siblings that share the same TanStack Query contract from 10.3.)

### Step 10.1 — ADR for account data export shape
- **Status**: ✅ Done
- **Agent**: planner
- **Size**: XS
- **Task**: Author `docs/adr/0009-account-data-export.md` recording: (1) the export is delivered as a single Edge Function returning one flat JSON object `{ user_id, exported_at, trips, trip_places, trip_legs, trip_days }`, downloaded via Blob+anchor on web and `expo-sharing` on native; (2) rationale — single-request shape avoids partial-failure cleanup the user can't reason about, mirrors the `delete-account` JWT-verification pattern the project already trusts, and reuses the proven `ics.web.ts` / `ics.native.ts` download mechanic; (3) consequences — entire export is materialized in memory on the Edge Function and the client at once (acceptable: a heavy user has <100 trips × <1KB each, well under the Edge Function 256MB ceiling); future media exports (notes attachments, photos) would need a different streaming pattern but are explicitly out of scope; (4) alternatives considered — per-table CSV files in a zip (rejected: requires a zip lib in the Edge Function; users want machine-readable round-trippable shape, not spreadsheet rows), Postgres `setof json` RPC called from the client (rejected: forces RLS-via-anon-JWT which is fine, but doesn't centralize the export shape behind one auditable surface; harder to evolve without a migration), streaming `text/event-stream` response (rejected: overkill for the data volume; complicates client download), generated download link with signed URL (rejected: introduces Storage bucket dependency Phase 10 deliberately avoids). Standard ADR template (Context / Decision / Alternatives / Consequences). One screen max.
- **Inputs**: This phase plan; `supabase/functions/delete-account/index.ts` for the JWT-verified Edge Function pattern; `src/api/ics.web.ts` + `src/api/ics.native.ts` for the download mechanic; cross-reference ADR-0008 (`docs/adr/0008-notes-markdown-renderer.md`) for ADR shape
- **Expected output**: `docs/adr/0009-account-data-export.md` exists; Step 10.2 references it when authoring the Edge Function
- **Depends on**: None
- **Parallel with**: Step 10.6 (different files — ADR doc + UI hook + notes-editor wiring are disjoint)
- **Platform check**: N/A (doc only)
- **Risks**:
  - [Low] If the JSON shape grows past the ~256MB Edge Function memory ceiling for a hypothetical heavy user, the response would 500 — Mitigation: ADR enumerates the realistic upper bound (single-digit MB per user) and lists streaming as the follow-up if anyone hits it
- **Touched files**: `docs/adr/0009-account-data-export.md`

### Step 10.2 — Edge Function: `export-account`
- **Status**: ✅ Done
- **Agent**: backend-specialist
- **Size**: M
- **Task**: Create `supabase/functions/export-account/index.ts` modeled on `delete-account/index.ts`. Concretely: (a) handle `OPTIONS` via `handlePreflight` from `_shared/cors.ts`; (b) handle `GET ?ping` returning `{ ok: true, fn: 'export-account' }`; (c) reject non-POST with 405 via `errorResponse('method_not_allowed', ...)`; (d) extract bearer token via the same `extractBearer` helper shape; (e) verify with anon client's `auth.getUser(token)` and reject 401 on invalid; (f) use `makeAdminClient` from `_shared/supabase-admin.ts` to read in this order — `trips` (filter `user_id = user.id`, order `id asc`), then `trip_places` / `trip_legs` / `trip_days` filtered by `trip_id in (<trip ids from step 1>)` and ordered by `id asc`; (g) build `{ user_id: user.id, exported_at: new Date().toISOString(), trips, trip_places, trip_legs, trip_days }` and return via `jsonResponse({ ok: true, export: ... }, { origin })`; (h) on any DB error, return 500 via `errorResponse('db_error', ...)`; (i) structured logs at `stage: 'auth' | 'read_trips' | 'read_children' | 'done'` with `requestId` (no PII — log row counts, not row contents). The function is a strict read-only — no writes, no `delete`, no `auth.admin.*`. **No tests.** **No `?ping` smoke artifact.**
- **Inputs**: Step 10.1 ADR (response shape); `supabase/functions/delete-account/index.ts` (function pattern); `supabase/functions/_shared/{cors,errors,logger,supabase-admin}.ts` (helpers); `src/api/types.ts` (canonical row shapes — Edge Function returns whatever the DB returns; type narrowing happens client-side in Step 10.3)
- **Expected output**: New file `supabase/functions/export-account/index.ts` exists; the function compiles under Deno; `Deno.serve(handler)` is wired the same way as `delete-account`; calling it via `supabase.functions.invoke('export-account', { method: 'POST' })` from a logged-in client returns `{ ok: true, export: { ... } }` with the caller's rows; calling without auth returns 401; calling with `GET ?ping` returns 200
- **Depends on**: Step 10.1
- **Parallel with**: Step 10.6 (different files)
- **Platform check**: N/A (Deno Edge Function, server-side)
- **Risks**:
  - [Medium] If a user's trip count grows to thousands, a single round-trip JSON response could exceed reasonable wire size — Mitigation: ADR-0009 explicitly bounds the design at single-digit MB; if reviewer or user pushes for streaming, that's a follow-up phase
  - [Low] Reading `trip_places` / `trip_legs` / `trip_days` by `trip_id in (<list>)` requires the trip-id list to be small enough for a single `in (...)` clause — Mitigation: a heavy user has <100 trips; well under Postgres's `in (...)` parameter limits; if it ever matters, switch to a server-side join in a follow-up
  - [Low] CORS — the `ALLOWED_ORIGINS` list must include the deployed web origin so the browser doesn't block the response — Mitigation: backend-specialist confirms the existing `_shared/cors.ts` ALLOWED_ORIGINS already covers Settings access (it does for `delete-account`, same surface)
- **Touched files**: `supabase/functions/export-account/index.ts` (new)

### Step 10.3 — Type + API surface: `AccountExport` shape, `useExportAccount` contract
- **Status**: ✅ Done
- **Agent**: backend-specialist
- **Size**: S
- **Task**: (a) Add an `AccountExport` interface to `src/api/types.ts` describing the Edge Function response: `{ user_id: Uuid; exported_at: string; trips: Trip[]; trip_places: TripPlace[]; trip_legs: TripLeg[]; trip_days: TripDay[] }`. (b) Add a Zod schema (or simple runtime guard) at the wrapper boundary that validates the top-level shape — narrow typing only, do not validate every row's every field (the rows came from the same Postgres types we already trust); reject and throw if `export.trips` is not an array. (c) Author a single shared internal helper `src/api/account-export.shared.ts` (or inline in both files — backend-specialist picks the cleaner shape; if shared, it exports `fetchAccountExportJson()` returning `{ json: string; filename: string; bytes: number }` from the Edge Function response, since both `.web.ts` and `.native.ts` need the same pre-download work). Filename is `tripvisor-export-<YYYY-MM-DD>.json` with UTC date (`new Date().toISOString().slice(0, 10)`). (d) Re-export from `src/api/index.ts` after the platform-split files land in 10.4 / 10.5. **No tests.**
- **Inputs**: Step 10.2 (Edge Function deployed locally); `src/api/types.ts` for canonical row types; `src/api/ics.web.ts` for the shared-helper pattern (the ICS files duplicate `fetchTripBundle` rather than sharing — Phase 10 does better and shares the JSON-build helper)
- **Expected output**: `AccountExport` type compiles under `tsc --noEmit`; `fetchAccountExportJson()` (or equivalent shared helper) returns a JSON string + filename for both platforms to consume; types are exported from `src/api/types.ts`; nothing else in the API barrel breaks
- **Depends on**: Step 10.2
- **Parallel with**: Step 10.6
- **Platform check**: All three (pure TypeScript; platform split happens in 10.4 / 10.5)
- **Risks**:
  - [Low] If the shared helper lives in `account-export.shared.ts`, Metro / RN-Web resolution must not accidentally treat it as a platform file — Mitigation: name it without a `.native.` / `.web.` suffix; the project already has shared helpers (`src/lib/ics/generate.ts`) that resolve correctly
  - [Low] `Date.prototype.toISOString().slice(0, 10)` is UTC-based; users in late-evening timezones could see a "tomorrow" filename — Mitigation: acceptable; UTC is the correct deterministic choice for filenames; document in the helper's JSDoc
- **Touched files**: `src/api/types.ts`, `src/api/account-export.shared.ts` (new, or inline if backend-specialist prefers), possibly `src/api/index.ts` (re-exports added in 10.4 / 10.5)

### Step 10.4 — `useExportAccount` (web): Blob + anchor download
- **Status**: ✅ Done
- **Agent**: ui-specialist
- **Size**: S
- **Task**: Create `src/api/account-export.web.ts` exporting `useExportAccount()` — a `useMutation` that: (a) invokes the Edge Function via `supabase.functions.invoke('export-account', { method: 'POST' })`; (b) on `error`, throws so React Query surfaces it via `onError`; (c) validates the response shape via the Step 10.3 helper (or inline guard); (d) builds the JSON string + filename via the shared helper from 10.3; (e) when `typeof window === 'undefined' || typeof document === 'undefined'`, throws "Browser not available for account export download" (mirrors the SSR guard in `ics.web.ts`); (f) creates `new Blob([json], { type: 'application/json;charset=utf-8' })`, calls `URL.createObjectURL`, programmatically clicks an anchor with `download={filename}` and `rel="noopener"`, then `setTimeout(() => URL.revokeObjectURL(url), 1000)` for Safari. Returns `{ filename, bytes, shared: true }` (matches the `DownloadIcsResult` shape so callers feel familiar). Re-export from `src/api/index.ts` (the export resolves to `.web.ts` / `.native.ts` automatically at the consumer site). **No tests.**
- **Inputs**: Step 10.3 (`AccountExport` type + shared helper); `src/api/ics.web.ts` (download mechanic to mirror); `src/api/supabase.ts` (`supabase.functions.invoke`)
- **Expected output**: `src/api/account-export.web.ts` exists; importing `useExportAccount` from `@/api` and calling `.mutate()` on a logged-in web client kicks off a download of `tripvisor-export-<YYYY-MM-DD>.json` containing the JWT-verified caller's rows; mutation `isPending` flips correctly during the request; an unauthenticated call throws and the mutation enters `error` state
- **Depends on**: Step 10.3
- **Parallel with**: Step 10.5 (different file, different platform)
- **Platform check**: Web. Sibling file `account-export.native.ts` covers iOS + Android in Step 10.5.
- **Risks**:
  - [Medium] Some browsers (Safari) need the anchor in the DOM before clicking — Mitigation: mirror the `ics.web.ts` flow exactly (`document.body.appendChild(a)`, `a.click()`, `a.remove()`)
  - [Low] If `supabase.functions.invoke` returns the JSON already-parsed (it does), constructing the Blob from `JSON.stringify(data.export)` is the right shape — Mitigation: backend-specialist confirms the response wrapper shape in Step 10.2 (`{ ok, export }`); the Blob contains `JSON.stringify(data.export, null, 2)` for human-readable output (2-space indent)
- **Touched files**: `src/api/account-export.web.ts` (new), `src/api/index.ts` (add `export * from './account-export'`)

### Step 10.5 — `useExportAccount` (native): file write + share sheet
- **Status**: ✅ Done
- **Agent**: ui-specialist
- **Size**: S
- **Task**: Create `src/api/account-export.native.ts` exporting the same `useExportAccount()` hook signature. Implementation mirrors `src/api/ics.native.ts`: (a) invoke the Edge Function the same way as the web hook; (b) build JSON string + filename via the shared helper from 10.3 (same `JSON.stringify(data.export, null, 2)`); (c) write to `${FileSystem.cacheDirectory}${filename}` with `FileSystem.EncodingType.UTF8`; (d) if `Sharing.isAvailableAsync()`, call `Sharing.shareAsync(uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Export my Tripvisor data' })`; (e) return `{ filename, uri, bytes, shared }` — matches `DownloadIcsResult`'s native shape. **No tests.**
- **Inputs**: Step 10.3 (`AccountExport` type + shared helper); `src/api/ics.native.ts` (file-write + share-sheet mechanic to mirror); `expo-file-system` + `expo-sharing` (already in `package.json` from Phase 4)
- **Expected output**: `src/api/account-export.native.ts` exists; on a logged-in native client (iOS or Android), `useExportAccount().mutate()` writes the JSON to the cache dir and opens the system share sheet; the file shows the correct extension and the share sheet offers Files / Mail / iCloud / etc. as targets
- **Depends on**: Step 10.3
- **Parallel with**: Step 10.4 (different file, different platform)
- **Platform check**: iOS + Android. Web sibling lives in 10.4.
- **Risks**:
  - [Low] `UTI: 'public.json'` is the iOS Uniform Type Identifier for JSON; some older iOS versions used `public.data` — Mitigation: `public.json` works on iOS 11+ which is far below Expo SDK 52's floor; if Sharing fails to find a target on a specific device, fall back to `public.data` in a follow-up
  - [Low] Native verification is deferred to user smoke (project standard); the implementing specialist verifies on web only — Mitigation: that's the documented policy; the native implementation is a near-copy of the proven `ics.native.ts` flow so the risk surface is small
- **Touched files**: `src/api/account-export.native.ts` (new)

### Step 10.6 — Phase 9 L4 bundle: `useDebouncedCallback` flush + notes-editor onBlur
- **Status**: ✅ Done
- **Agent**: ui-specialist
- **Size**: XS
- **Task**: (a) Extend `src/lib/hooks/useDebouncedCallback.ts` to expose a `flush()` method alongside the debounced function. ui-specialist picks the API shape — either return a tuple `[debouncedFn, flush]` (cleaner, but breaking for existing call sites) OR attach `.flush` as a property on the returned function (non-breaking, slightly less idiomatic). Prefer the non-breaking shape: `(...args) => void` with `.flush()` and `.cancel()` attached; document the choice in the JSDoc. `flush()` synchronously invokes `fnRef.current(...lastArgs)` if a timer is pending, then clears the timer; if no timer is pending, it's a no-op. `cancel()` clears the timer without invoking. Keep the existing cancel-on-unmount behavior — cleanup calls `cancel()`, not `flush()`, so a stale mutation never fires after the component is gone (this is the safer default per Phase 9 review L4). (b) Wire `onBlur` on the place-notes `TextInput` in `app/(app)/trip/[id]/index.tsx` (or wherever `PlaceNotesEditor` lives — ui-specialist greps first) to call the debounced callback's `.flush()` so the last <500ms of keystrokes persist when the user tabs/clicks away. (c) Wire the same `onBlur` flush on the per-day `DayNotesEditor`. (d) Confirm via `tsc --noEmit` that no existing `useDebouncedCallback` caller breaks (the cost-per-km editor in Phase 8, the place-notes editor in Phase 9, the day-notes editor in Phase 9). **No tests.**
- **Inputs**: `docs/reviews/phase-9.md` (L4 entry, lines 53–58); `src/lib/hooks/useDebouncedCallback.ts` (current implementation); the two notes editors from Phase 9
- **Expected output**: `useDebouncedCallback` returns a callable with `.flush()` + `.cancel()` properties; `tsc --noEmit` is clean; the place- and day-notes editors flush on blur so a typed-then-blurred edit persists; existing call sites (cost-per-km debounce, etc.) continue to work unchanged
- **Depends on**: None (independent of the export work)
- **Parallel with**: Steps 10.1, 10.2, 10.3, 10.4, 10.5 (touches different files entirely)
- **Platform check**: All three. `onBlur` is universal in RN.
- **Risks**:
  - [Low] If a future contributor calls `.flush()` from a `useEffect` cleanup function, it would fire a mutation against a torn-down query client — Mitigation: JSDoc explicitly warns against calling `flush()` from cleanup; the unmount cleanup inside the hook continues to call `cancel()`, not `flush()`
  - [Low] Storing `lastArgs` in a ref means a `flush()` after a no-op call still has stale args — Mitigation: only set `lastArgs` when scheduling a new timer; if no timer is pending, `flush()` is a no-op; document in JSDoc
- **Touched files**: `src/lib/hooks/useDebouncedCallback.ts`, `app/(app)/trip/[id]/index.tsx` (or the notes-editor sub-components), possibly `src/components/PlaceActionsSheet.tsx` (only if the place-notes editor lives there)

### Step 10.7 — Settings UI: "Export my data" button
- **Status**: ✅ Done
- **Agent**: ui-specialist
- **Size**: S
- **Task**: In `app/(app)/settings.tsx`, add an "Export my data" `Button` (variant `secondary`) directly above the existing "Sign out" button. Wire it to `useExportAccount()` from `@/api`: (a) `onPress` calls `exportMutation.mutate()`; (b) `loading` reflects `exportMutation.isPending`; (c) `disabled` reflects `screenDisabled || exportMutation.isPending` (same pattern as the existing Sign out / Delete account buttons); (d) on error, show an inline `Text` with `accessibilityRole="alert"` + `accessibilityLiveRegion="polite"` directly under the button (mirror the existing `deleteError` banner shape, but render only when `exportMutation.error` is set); reset error display on the next successful click via `exportMutation.reset()` in `onPress` before `mutate()`; (e) accessibility — `accessibilityLabel="Export my data as JSON"`, `accessibilityHint="Downloads a JSON file with all your trips and places."` (f) Order of buttons (top to bottom): theme picker, spacer (`flex: 1`), Export my data, Sign out, Delete account, error banners. **No tests.**
- **Inputs**: Step 10.4 + 10.5 (`useExportAccount` available on all three platforms via platform-split resolution); existing `app/(app)/settings.tsx` for layout + button-pattern reference; `src/components/Button.tsx` for the secondary variant
- **Expected output**: Settings screen renders an "Export my data" button above "Sign out"; clicking it on web triggers the JSON download; loading + error states are wired; accessibility labels + hints are present; the existing Sign out + Delete account buttons keep their current behavior
- **Depends on**: Steps 10.4, 10.5
- **Parallel with**: (none — gates 10.8)
- **Platform check**: All three. The button itself is platform-agnostic; the underlying `useExportAccount` is platform-split.
- **Risks**:
  - [Low] Adding a third button between the spacer and Sign out compresses the visual hierarchy — Mitigation: ui-specialist verifies on web; if cramped, move "Export my data" above the spacer (just below the theme picker) so it reads as a "data action" rather than a "session action"
  - [Low] If the Edge Function call returns a "Not authenticated" error because the JWT has expired between page load and click, the user sees a confusing inline message — Mitigation: surface the raw error message; the existing auth gate redirects to /login on next render anyway
- **Touched files**: `app/(app)/settings.tsx`

### Step 10.8 — Reviewer pass on Phase 10 changes
- **Status**: ✅ Done
- **Agent**: reviewer
- **Size**: S
- **Task**: Read every diff introduced in Phase 10. Confirm: (1) the `export-account` Edge Function verifies the JWT via the anon client before reading any data — reject if a missing `Authorization` header path returns rows; (2) child-table reads (`trip_places` / `trip_legs` / `trip_days`) are scoped through the user's `trip.id` set so a malformed query cannot leak across users — reviewer constructs a mental two-user scenario and confirms the SQL filters prevent cross-tenant reads; (3) the function never returns Google place fields the project does not persist (reviews / photos / ratings / hours) — confirm by code-reading the response builder against `src/api/types.ts`; (4) no service-role key, no Google key, and no PAT appears anywhere in client bundles — grep `src/`; (5) no PII (notes content, place titles, emails) is logged from the Edge Function — only row counts + `requestId`; (6) the platform-split `account-export.web.ts` / `account-export.native.ts` resolve correctly under Metro / RN-Web; (7) the SSR guard in `account-export.web.ts` mirrors the `ics.web.ts` shape; (8) `useDebouncedCallback`'s new `.flush()` does not break existing call sites — reviewer reads each call site (cost-per-km editor, place-notes editor, day-notes editor) and confirms behavior is unchanged when `.flush()` is not called; (9) the unmount cleanup still calls `.cancel()`, not `.flush()`, so a stale mutation cannot fire after a component is gone (Phase 8 M1 / Phase 9 review parity); (10) the Settings button is keyboard-reachable on web (visible focus ring, correct tab order) and has correct `accessibilityLabel` + `accessibilityHint`; (11) no Google ToS regression — exported data is user-managed only; "Powered by Google" attribution is unaffected (no Place data on the Settings screen); (12) ADR-0009 reflects the implemented design and does not lie about what shipped (e.g. if the implementation diverged from the ADR's "single Edge Function" plan, reviewer flags it). Write findings to `docs/reviews/phase-10.md` with critical / high / medium / low. **Tests are out of scope; reviewer reads code only, does not run tests or smokes.**
- **Inputs**: All Phase 10 diffs; ADR-0009; `docs/reviews/phase-9.md` for the L4 disposition wording
- **Expected output**: `docs/reviews/phase-10.md` with findings; no critical or high blocks Step 10.9
- **Depends on**: Steps 10.2, 10.4, 10.5, 10.6, 10.7
- **Parallel with**: (none)
- **Platform check**: N/A (review)
- **Risks**:
  - [Medium] If reviewer surfaces a critical cross-tenant leak in the Edge Function's `in (...)` filter (e.g. the trip-id list ever comes from the request body instead of being computed server-side), Phase 10 must loop back to backend-specialist — Mitigation: budget one fix loop; if the function needs a substantive rewrite, planner re-enters with a revised plan
  - [Low] Reviewer may push back on the JSON shape (e.g. wanting `account_export.version: 1` for forward-compat) — Mitigation: cheap to add in a follow-up; ADR-0009 acknowledges shape evolution as a follow-up concern
- **Touched files**: `docs/reviews/phase-10.md`

### Step 10.9 — Docs flip
- **Status**: ✅ Done
- **Agent**: docs-specialist
- **Size**: S
- **Task**: (a) Add one row to `docs/features/overview.md`: "Account data export (JSON)" → ✅ Done (web; native deferred to user smoke), Phase 10, doc `account-export.md`. (b) Create `docs/features/account-export.md` per the existing feature-doc template (intent / scope / API surface / data shape / platforms verified table — leave iOS / Android boxes unticked, tick Web only). Include a short "Exported fields" section listing the four tables (`trips`, `trip_places`, `trip_legs`, `trip_days`) and a one-line note that Google place fields (reviews / photos / ratings / hours) are explicitly NOT included because the project never persists them. Include a "Filename format" subsection documenting `tripvisor-export-<YYYY-MM-DD>.json` with UTC date. (c) Flip the Phase 10 row in `plan.md`'s top table to ✅ Done. (d) Append a one-paragraph "Phase 10 — close-out" entry under the Phase 9 close-out paragraph, summarising shipped surface (`export-account` Edge Function, platform-split `useExportAccount` mutation, Settings button, `useDebouncedCallback` flush + onBlur wiring on the notes editors). Cross-reference ADR-0009. Do NOT edit `CLAUDE.md` (planner project rule). Do NOT edit `docs/architecture.md` (planner project rule).
- **Inputs**: Step 10.8 review (no critical / high)
- **Expected output**: Feature doc reflects the new state; `plan.md` Phase 10 row reads ✅ Done; the new feature doc exists; close-out paragraph appended
- **Depends on**: Step 10.8
- **Parallel with**: (none)
- **Platform check**: N/A (docs)
- **Risks**:
  - [Low] Existing feature-doc template may have evolved between Phase 9 and now — Mitigation: docs-specialist reads `docs/features/notes-journal.md` (Phase 9) as the most recent template and matches its shape
- **Touched files**: `plan.md`, `docs/features/overview.md`, `docs/features/account-export.md` (new)

## ⚠ Blockers (Phase 10 — must be cleared before Step 10.2)

1. **Local Supabase stack must be reachable** for the `export-account` Edge Function to be served via `npx supabase functions serve` and tested manually by the implementing specialist. Same precondition as Phase 7 / Phase 8 / Phase 9; if the user has not run `supabase start` since the last phase, they need to before Step 10.2 lands.
2. **Pre-existing blockers carried forward — NOT in scope for Phase 10**:
   - Google Maps API keys — Phase 10 deliberately avoids any Google-keyed surface; the export reads user-managed data only.
   - Leaked Supabase PAT rotation — Phase 10 uses local Supabase only; cloud PAT is irrelevant.
   - EAS account / Apple Developer / Google Play Developer — Phase 10 is web-first; native renders the same UI by design (Settings button is universal, `expo-file-system` + `expo-sharing` are already in `package.json` from Phase 4). No native build / signing work.

## Phase 10 — non-goals (explicit)

- **Tests** — no Jest, no Deno tests, no fast-check, no RLS integration tests, no `*.test.ts` / `*.spec.ts` files authored or modified. The `test-specialist` sub-agent remains removed for the duration of the project.
- **Smokes** — no Playwright execution, no manual UI smoke checklists, no `docs/smoke/phase-10.md`.
- **Coverage / CI changes** — Phase 5 deferred work stays deferred; the existing `.github/workflows/` is not modified.
- **Google Maps work** — no Places API, no Routes API, no optimizer changes, no map polyline updates. Export is user-managed data only.
- **EAS / native builds** — no `eas.json` changes, no Apple / Google Play config, no native verification beyond visual confirmation by the implementing specialist.
- **Native verification** — iOS / Android remain deferred to user smoke as standard for this project.
- **Import / re-import flow** — Phase 10 ships export only. A round-trip "Import my data" flow (re-creating trips from a JSON file) is a separate (post-MVP) feature; not planned here.
- **Multi-format export** — JSON only. No CSV, no XLSX, no PDF, no zip-of-files.
- **Streaming / chunked download** — single in-memory JSON response per ADR-0009. Streaming is parked for the day a user hits the response-size ceiling.
- **Storage bucket / signed URL** — no `tripvisor-exports` bucket, no signed download links, no expiring URLs. The Edge Function returns the bytes directly to the client.
- **Photos / attachments** — text-only; the export does not include the (out-of-scope) future notes-attachment feature.
- **Schema versioning of the export shape** — the JSON does not include a `schema_version` field in Phase 10. Adding one is a one-line follow-up if the shape evolves; ADR-0009 records this as a deliberate deferral.
- **Background / scheduled exports** — no cron, no email-me-my-data flow. The user clicks the Settings button; that's the entire UX.
- **Phase 9 L2 / L3 / L5 bundling** — only L4 (debounce flush-on-blur) bundles into Phase 10. L2 (italic tokenizer edge case), L3 (`MarkdownText` style cast), and L5 (`dayNotesIndex` Map perf) stay parked from `docs/reviews/phase-9.md`.
- **Phases 2 / 3 / 5 / 6 status flips** — Phase 10 does not touch their rows; they stay 🚧 / partial as recorded.
- **Phase 7 / 8 follow-ups** — the parallel-mutation rollback finding from `docs/reviews/phase-7.md` and the Phase 8 lows stay parked; not reopened in Phase 10 unless reviewer flags interaction.

---

## Phase 11 — Trips list polish (search + sort) + Phase 10 L2 fix

**Status**: Done — shipped 2026-04-25; Direction B (trips list search + sort); planner agent skipped due to usage limit, main assistant scoped directly. No reviewer pass — scope was minimal (one screen + one-line backend polish).
**Last updated**: 2026-04-25

**Scope shipped**:
- Search input on the trips list screen (`app/(app)/trips.tsx`): debounced 200ms, case-insensitive substring match on trip `title`, clear button when non-empty.
- Sort tap-to-cycle: Recent (creation order) → A-Z (`Intl.Collator` locale-aware) → Start date (trips with `null start_date` go to bottom) → loops back to Recent.
- Tab switch (Active / Archived) resets both search text and sort to defaults.
- Empty-results state: "No trips match your search" rendered when filters yield zero from a non-empty list.
- Phase 10 L2 fix: `src/api/account-export.shared.ts` — replaced Blob+fallback byte counting with `new TextEncoder().encode(json).length` (exact UTF-8, universal on web + RN/Hermes).

**Explicitly deferred**:
- Cost sort — would require per-trip `useTripLegs` aggregation across an unbounded list (N+1 risk); requires server-side aggregation or a cached cost field before it is safe to expose. Phase 12+ candidate. **Closed by Phase 12** (batched `useAllTripLegs` query, projected to `trip_id, distance_meters`).
- Date filter (Upcoming/Past) — layout is cramped on 360px viewports; deferred until a filter drawer or expanded header can accommodate it cleanly. Phase 12+ candidate. **Closed by Phase 12** (`FilterSheet` component + All / Upcoming / Past filter on trips list).

**Process note**: The planner sub-agent hit usage limits before this phase was formally scoped. The main assistant chose Direction B (trips list search + sort) and defined the scope directly, following the established project convention of tight, unblocked increments. No separate planner ADR was produced; the decisions above capture the design rationale.

**Feature doc**: `docs/features/trips-list-polish.md`

## Phase 11 — non-goals (explicit)

- **Tests** — no Jest, no Deno tests, no Playwright, no `*.test.ts` / `*.spec.ts` files authored or modified.
- **Smokes** — no Playwright execution, no manual smoke checklist, no `docs/smoke/phase-11.md`.
- **Reviewer pass** — scope was too small to warrant a full reviewer session; the main assistant verified correctness inline.
- **Cost sort** — explicitly deferred in Phase 11; closed by Phase 12.
- **Date filter (Upcoming/Past)** — explicitly deferred in Phase 11; closed by Phase 12.
- **Backend changes** — pure UI change; no migrations, no Edge Functions, no API hooks added.
- **Native verification** — iOS / Android deferred to user smoke as standard for this project.
- **Phases 2 / 3 / 5 / 6 status flips** — Phase 11 does not touch their rows; they stay as recorded.

---

## Phase 12 — Advisory lock fix + Cost sort + Date filter

**Status**: Done — shipped 2026-04-25; web verified; native deferred to user smoke.
**Last updated**: 2026-04-25

Closed three carried-forward deferred items in one bundle. (1) Phase 5 M1 — the silent no-op advisory lock in `optimize-trip` is replaced by a real session-scoped lock pair: new migration `0007_advisory_lock_wrappers.sql` adds `try_lock_trip(uuid)` / `unlock_trip(uuid)` SECURITY DEFINER RPCs wrapping `pg_try_advisory_lock` / `pg_advisory_unlock` keyed by `hashtextextended(trip_id::text, 0)`, granted to `service_role` only (not `authenticated`). `optimize-trip` now returns HTTP 409 `already_optimizing` when another optimize is in flight for the same trip; the `finally` block calls `unlock_trip` and emits `unlock_error` / `unlock_session_mismatch` warn logs for observability. Known limitation (C1 — **Closed by Phase 13**): PgBouncer transaction pooling can swap the backend connection between the lock and unlock RPCs, weakening the session-scope guarantee; the `unlock_session_mismatch` log provides telemetry to measure swap frequency — see `docs/features/optimization.md` for detail. (2) Phase 11 M1 — Cost sort added as the 4th sort mode on the trips list; backed by new `useAllTripLegs(tripIds)` hook in `src/api/routes.ts` that issues a single batched `select trip_id, distance_meters from trip_legs where trip_id in (...)` with a sorted, stable query key; trips with no legs sort to the bottom. (3) Phase 11 L4 — Date filter added via new generic `FilterSheet` component (`src/components/FilterSheet.tsx`) wrapping the existing platform-split `BottomSheet`; options: All / Upcoming / Past, applied after search and before sort; tab-switch resets search + sort + filter together. `FilterSheet` uses `accessibilityRole="radiogroup"` with per-row `radio` + `accessibilityState={{ checked }}`. Reviewer finding H2/H3 (auth-grant griefing) closed in-phase by revoking RPCs from `public`. M2 (silent unlock failure) closed in-phase by warn logs. Feature docs updated: `docs/features/trips-list-polish.md`, `docs/features/optimization.md`. Review: `docs/reviews/phase-12.md`.

---

## Phase 13 — DB-row mutex (closes Phase 12 C1)

**Status**: Done — shipped 2026-04-25; web verified; native deferred to user smoke.
**Last updated**: 2026-04-25

Closed Phase 12 C1: the session-scoped `pg_try_advisory_lock` / `pg_advisory_unlock` pair was vulnerable to PgBouncer transaction-pooling connection swaps — the two RPC calls could land on different backend connections, causing the acquired lock to be invisible to the unlock call and leaking until the session closed.

**Mechanism**: replaced the advisory-lock pair with a row-mutex on `trips.optimizing_at` (new `timestamptz null` column, migration `0008_trip_optimize_mutex.sql`). Claiming and releasing the mutex are each a single atomic `UPDATE` statement wrapped in a data-modifying CTE. Atomic single-statement UPDATEs execute within one transaction at the Postgres layer; PgBouncer cannot route different parts of the same statement to different backends, so the connection-swap failure mode is structurally eliminated.

**Migration `0008` details**:
- Adds `trips.optimizing_at timestamptz null`.
- Adds `public.claim_trip_optimize(p_trip_id uuid, p_ttl_seconds int default 300) returns boolean` — data-modifying CTE: `UPDATE trips SET optimizing_at = now() WHERE id = p_trip_id AND (optimizing_at IS NULL OR optimizing_at < now() - make_interval(secs => p_ttl_seconds)) RETURNING true`; returns `false` if the row was not updated (concurrent claim holds it).
- Adds `public.release_trip_optimize(p_trip_id uuid) returns void` — unconditional `UPDATE trips SET optimizing_at = NULL WHERE id = p_trip_id`.
- Drops `public.try_lock_trip(uuid)` and `public.unlock_trip(uuid)` (no other callers existed).
- Both new RPCs are `SECURITY DEFINER`, `set search_path = public`, granted to `service_role` only.

**Edge Function changes** (`supabase/functions/optimize-trip/index.ts`):
- `try_lock_trip` RPC call replaced by `claim_trip_optimize` (passing `p_ttl_seconds: 300`).
- `unlock_trip` in `finally` replaced by `release_trip_optimize`.
- `unlock_session_mismatch` log stage dropped (no session-mismatch failure mode with the row-mutex).
- `unlock_error` log stage renamed to `release_error`.

**TTL rationale (5 minutes)**: observed worst-case optimize completion (25 places, 2-opt + matrix calls) is well under 30 s. A 5-minute TTL gives 10x headroom for cold-start and retry while enabling automatic stale-claim recovery if the Edge Function crashes mid-optimize. No operator action is needed for hung-function recovery.

**Process**: no formal reviewer pass — scope was one backend file plus one migration. Backend-specialist self-verified via `npx supabase db reset` (clean), `\d trips` (new column present), `\df` (new RPCs present, old ones dropped), behavioral claim/release/stale-recovery test, and `?ping` check.

**Feature doc**: `docs/features/optimization.md` (APIs + Known limitations sections updated).

---

## Phase 14 — Share link OG/Twitter meta tags

**Status**: Done — shipped 2026-04-25; web verified; native unaffected (Head is web-only no-op).
**Last updated**: 2026-04-25

Rich unfurl support for public share links. Previously, pasting a `/share/<token>` URL into Slack, Discord, iMessage (iOS 16+), Twitter/X, WhatsApp, or Telegram produced a bare URL with no preview. Phase 14 injects the necessary `og:*` and `twitter:*` meta tags on the share route and a baseline fallback on the root layout.

**Files changed**:
- `app/share/[token].tsx` — added `buildSummary(places, trip)` helper and `SharedTripHead` component. Renders 9 meta tags (`<title>`, `og:title`, `og:description`, `og:type`, `og:site_name`, `twitter:card`, `twitter:title`, `twitter:description`, `name="description"`) only after `shared` data is loaded. Loading and error states render no Head — the root-layout fallback applies. No `og:image` (per-trip card image generation is out of scope for this phase).
- `app/_layout.tsx` — added `RootHead` component that injects baseline meta tags (`name="description"`, `og:site_name`, `og:type`, `twitter:card`) on every web route. Per-route Heads (currently only the share page's) override these for the keys they specify.

**Summary string format** (used in `og:description` / `twitter:description`):
- 0 places: `"Empty trip · {h}h/day"`
- Has start+end dates: `"{N}-day trip · {placeCount} place(s) · {h}h/day"` (N = inclusive day count)
- Otherwise: `"{placeCount} place(s) · {h}h/day"`
- Daily hours: integer renders `"8h"`, fractional renders `"7.5h"`. Hard-capped at 200 chars.

**Implementation pattern**: same `Platform.OS !== 'web'` early-return + runtime `require('expo-router/head')` approach used by `app/(app)/trip/[id]/print.tsx:PrintHead`. Keeps the import out of the native bundle entirely.

**Unfurl caveat**: tags are injected client-side via `react-helmet-async` (under `expo-router/head`). They are not present in the initial static HTML of `expo export --platform web` output. In practice this is fine: Slack, Discord, Twitter/X, iMessage (iOS 16+), WhatsApp, and Telegram all execute JavaScript before scraping meta tags. The narrow class of non-JS bots (legacy Facebook crawler, plain `curl`) will see only the static document title. True pre-rendered tags would require SSR or per-trip static export — explicitly out of scope for this phase.

**Process**: no formal reviewer pass. UI-only change, two files, both edits follow an existing proven pattern. ui-specialist self-verified by grepping curl'd HTML, confirming the react-helmet-async injection path, and validating sample summary outputs against the spec.

**Feature doc**: `docs/features/share.md` (Phase 14 unfurl mechanism section added).

---

## Phase 15 — Per-day map filter on trip detail

**Status**: Done — shipped 2026-04-25; web verified; native unaffected (shared component code, no platform-specific surface).
**Last updated**: 2026-04-25

Focus mode for the trip detail Map tab. Users with 25 places across 3–5 days were reading a noisy combined map with all markers and polylines overlaid at once. Phase 15 adds a horizontal chip row ("All" + one chip per day) above the existing `<Map>` inside `MapTab`. Selecting a chip filters both `markers` and `polylines` to that day's data only.

**Mechanism**:
- `selectedDay: 'all' | number` state in `MapTab`; resets to `'all'` on tab unmount (intentionally not URL-persisted — per-session focus tool).
- `availableDays` memo: deduped, sorted list of distinct `day_index` values from places where `day_index` is non-null and `>= 0`.
- Two filter `useMemo`s: one for markers, one for polylines. Both are derived from the same TanStack Query cache — no new API calls.
- Chip row is rendered only when `availableDays.length > 0`; skipped entirely if no places have been assigned to a day (e.g. before optimize runs).

**Day-label convention**: matches the Itinerary tab. DB `day_index` is 0-based; UI label is 1-based (`day_index === 0` → chip label `"Day 1"`).

**Files changed**:
- `app/(app)/trip/[id]/index.tsx` — only file modified. Extended `MapTab` with state, memos, and chip row UI. 162 insertions / 24 deletions. Chips use `dayColor(dayIndex)` for a small decorative color dot matching the per-day color scheme used elsewhere. A11y: outer wrapper `accessibilityRole="radiogroup"`, each chip `accessibilityRole="radio"` with `accessibilityState={{ checked }}` — same pattern as Phase 12 `FilterSheet`.

**Edge cases handled**:
- Zero days available (no places assigned yet): chip row hidden; map shows everything.
- Selected day becomes invalid (all its places deleted): `useEffect` keyed on `[availableDays, selectedDay]` resets to `'all'` once.
- Unassigned places (`day_index === null`): visible only in `'all'` view; excluded from all day-specific filters.
- React keys: stringified `selectedDay` values — no duplicates, no key warnings.

**Non-goals** (explicitly out of scope):
- Filtering the Itinerary tab — already groups visually by day.
- URL/route param persistence of chip selection.
- Map viewport auto-fit / zoom-to-day — potential follow-up; existing fit-to-bounds may already cover it.
- Backend changes, tests, and smoke runs.

**Process**: no formal reviewer pass. UI-only single-file change; all logic isolated to `MapTab`. ui-specialist self-verified (matched Itinerary tab label convention, confirmed memo deps, confirmed key uniqueness). Same scoped-phase convention as Phases 11–14.

**Feature doc**: `docs/features/map.md` (Phase 15 chip filter section added).

---

## Phase 16 — Optimize error codes surfaced to UI

**Status**: Done — shipped 2026-04-25; web verified; native unaffected (shared client code, no platform-specific surface).
**Last updated**: 2026-04-25

The `optimize-trip` Edge Function has returned structured error envelopes (`{ error: { code, message } }`) since Phase 2, but the client was discarding the `code` and always rendering a generic red "Optimize failed" pill. The most common real-world failure — the 409 `already_optimizing` race on double-click — showed as a scary error when it is actually a transient non-failure.

Phase 16 is a pure client-side change. No backend modifications.

**Typed error class** (`src/api/routes.ts`):
- New `OptimizeError extends Error` with fields `{ code: string, message: string, status: number }`.
- Full JSDoc lists all 8 known codes matching `supabase/functions/optimize-trip/index.ts` exactly: `already_optimizing`, `too_many_places`, `matrix_failed`, `not_found`, `rpc_failed`, `db_error`, `invalid_input`, `method_not_allowed`.
- Re-exported via the existing `src/api/index.ts` wildcard — no import path changes needed for consumers.

**Envelope parsing** (`src/api/routes.ts`):
- `useOptimizeTrip().mutationFn` catches `FunctionsHttpError`, reads `.context` as a `Response`, and parses the `{ error: { code, message } }` envelope shape.
- On match: throws `OptimizeError`. On parse failure: falls through to the original error so network / non-envelope failures are unaffected.
- Mutation generic widened to `useMutation<OptimizeResult, OptimizeError | Error, { tripId: Uuid }>`.

**Status pill branching** (`app/(app)/trip/[id]/index.tsx`):
- New `pillForOptimizeError(err)` helper maps known codes to `(tone, label)` pairs:
  - `already_optimizing` → info / "Optimizing in progress…"
  - `too_many_places` → danger / "Trip is too large"
  - `matrix_failed` → danger / "Routing service unavailable"
  - `not_found` → danger / "Trip not found"
  - `rpc_failed` / `db_error` / `invalid_input` / `method_not_allowed` → danger / "Optimize failed"
  - Unknown code or non-`OptimizeError` → danger / "Optimize failed" (preserves previous behaviour)
- The existing `<StatusPill>` render branch is replaced with the helper output via an IIFE. No new UI surface introduced.

**Non-goals** (explicitly out of scope):
- Tests of any kind (Jest, Playwright, Deno).
- Smoke runs.
- Auto-retry on 409 — the auto-optimize `useEffect` re-runs on state-key changes; explicit retry would over-engineer.
- Toast / Snackbar / modal.
- Edge Function changes.

**Maintenance note**: if a new error code is added to `supabase/functions/optimize-trip/index.ts`, update both (1) the `OptimizeError` JSDoc in `src/api/routes.ts` and (2) the `pillForOptimizeError` mapping in `app/(app)/trip/[id]/index.tsx`.

**Process**: no formal reviewer pass. 2-file change, all logic local. backend-specialist self-verified (typecheck filtered to changed files: 0 new errors; envelope shape verified against `supabase/functions/_shared/errors.ts`). Same scoped-phase convention as Phases 11–15.

**Feature doc**: `docs/features/optimization.md` (typed error and pill branching section added).

---

## Phase 17 — Recent place searches in the add flow

**Status**: Done — shipped 2026-04-25; web verified; native shares the same code path (AsyncStorage is cross-platform; behavior is identical on iOS/Android — native device verification deferred to user smoke).
**Last updated**: 2026-04-25

The add-place screen (`app/(app)/trip/[id]/add.tsx`) was stateless: every visit started with an empty query and no history. Phase 17 adds a "Recent" section showing the last 10 added places so users can re-pick airports/hotels/landmarks in one tap.

**New module** (`src/lib/recentPlaces.ts`, ~80 LOC):
- `RecentPlace` interface: `{ placeId, mainText, secondaryText, lastUsedAt }`.
- `MAX_RECENT_PLACES = 10`, LRU semantics, deduped by `placeId` on write.
- `STORAGE_KEY = '@tripvisor/recent-places/v1'` — `/v1` suffix allows schema bumps without migration.
- Backed by `@react-native-async-storage/async-storage`, which ships a built-in `localStorage` backend on web; no new dependency.
- All errors swallowed silently (`console.warn` with `[recentPlaces]` prefix). Recents are advisory and must never crash the add flow.

**ToS-safety**: only `placeId` + display strings + timestamp are persisted. `placeId` is permanently storable under the Places API ToS. Display strings (`mainText` / `secondaryText`) are tied to the immutable handle — they do not constitute cacheable live data. Photos, reviews, opening hours, and rating continue to be fetched live via `usePlaceDetails` on every pick; the existing project-wide constraint ("never persist Google Place data beyond `google_place_id` + coordinates") is preserved and extended to the client cache without violation.

**Add-screen changes** (`app/(app)/trip/[id]/add.tsx`, ~132 ins / 33 del):
- `useEffect` on mount loads recents into local `useState` (not TanStack Query — this is local AsyncStorage state, not server state).
- Recents rendered in a sibling `<View>` above the autocomplete `FlatList`. Section header: `RECENT` (uppercase via styles, `t.typography.caption`, `t.colors.textMuted`). Each row reuses the autocomplete suggestion visual treatment; tap calls `setPickedId(item.placeId)`, entering the existing `usePlaceDetails` live-fetch path.
- "Clear recent searches" `<Pressable>` at the bottom of the recents section.
- `showRecents = debounced.length < 2 && recents.length > 0`. Recents and the autocomplete list are mutually exclusive. The `searchPrompt` empty state is suppressed when `showRecents` is true to avoid competing UI.
- After `createTripPlace.mutateAsync(...)` resolves and before `router.back()`, `addRecentPlace(...)` is called fire-and-forget.

**Design note — sibling View, not `ListHeaderComponent`**: if the recents were placed in `ListHeaderComponent`, they would scroll out of view whenever the user typed a query that produced results, scrolled down, then deleted the query — the recents would be off-screen but the user would land in the empty autocomplete region. The sibling-View layout pins recents above the scroll area at all times, independent of scroll position.

**Non-goals** (explicitly out of scope):
- Tests of any kind (Jest, Playwright).
- Smoke runs.
- Server-side / cross-device recents sync — would require a new `user_recent_places` table + RLS; deliberately deferred.
- Search bias from recent locations, category clustering, or pinned recents.
- Sharing recents between users.

**Process**: no formal reviewer pass. 2-file change, both type-clean. ui-specialist self-verified (typecheck filtered to changed files: 0 new errors). Same scoped-phase convention as Phases 11–16.

**Feature doc**: `docs/features/place-search.md` (Phase 17 recents section added).

---

## Phase 18 — Duplicate place warning in add flow

**Status**: Done — shipped 2026-04-25; web verified; native shares the same code path (single `add.tsx` file, no platform-split surface).
**Last updated**: 2026-04-25

Phase 17's recents made re-picking the same place a single tap, which surfaced the gap: the add flow had no feedback when a place was already in the current trip. Phase 18 closes that gap with an inline warning banner.

**Mechanism** (`app/(app)/trip/[id]/add.tsx`, 40 ins / 1 del — only file changed):
- `useTripPlaces(tripId)` subscribed in the add screen to read existing places.
- `isDuplicate = !!picked && existingPlaces.some(p => p.google_place_id === picked.placeId)` derived once place details have loaded.
- When `isDuplicate` is true, a banner View renders above the confirm button: **"Already in this trip — confirm to add as a separate visit."** Background is `t.colors.bgElevated`; accent is a `borderLeftWidth: 3` stripe in `t.colors.warning`; text is `t.colors.text` (high contrast — color is carried by the border accent, not the text). `accessibilityRole="alert"` + `accessibilityLiveRegion="polite"` — same screen-reader pattern as `settings.tsx` error banners (Phase 7).
- Button label swaps from "Add to trip" → "Add anyway"; `accessibilityLabel` updates accordingly. Tap behavior is unchanged — the warning is purely informational.

**Why a banner and not a block or a confirm dialog**: repeat visits are legitimate (same hotel as start/end on multiple days, same restaurant on different nights). Blocking prevents a real use case. A confirm dialog is friction-heavy for a low-stakes nudge. Banner-only is the right calibration.

**Non-goals** (explicitly out of scope):
- Tests of any kind (Jest, Playwright).
- Smoke runs.
- Server-side `(trip_id, google_place_id)` unique constraint — not desired; repeat visits are valid data.
- Auto-redirect to the existing place, "Merge with existing" affordance, or highlighting which day the duplicate is already on (potential follow-ups).

**Process**: no formal reviewer pass. Single-file UI change, all logic local. ui-specialist self-verified (typecheck: 0 new errors; banner aesthetic matches established `settings.tsx` pattern).

**Feature doc**: `docs/features/place-search.md` (Phase 18 duplicate-warning section added).

---

## Phase 19 — Test restoration + share-revoke production bug fix

**Status**: Done — shipped 2026-04-25.
**Last updated**: 2026-04-25

The test-specialist sub-agent returned after eight phases off-duty, during which feature work shipped without any automated test coverage. The starting state was 19 suites (4 failed to load entirely, 15 passed with 139 tests) and 0 integration-suite runs in the presence of a live Supabase env. The immediate failure mode was non-lazy `createClient(URL!, SERVICE!, ...)` calls executing at describe-body scope, before `describe.skip` could suppress the body — this caused the four RLS/RPC integration suites (`tests/rls.test.ts`, `tests/rls.share.test.ts`, `tests/rls.trip-places-legs.test.ts`, `tests/rpc.test.ts`) to throw at load time. Fixing all four to lazy-init `createClient` inside `beforeAll` unblocked the integration suite. `jest.config.js` also received `@react-navigation/.*` in `transformIgnorePatterns` and an AsyncStorage mock in `moduleNameMapper`. Seven new test files were then added covering Phase 17 AsyncStorage CRUD (`src/lib/__tests__/recentPlaces.test.ts`), Phase 9 Markdown tokenizer (`src/lib/__tests__/markdown.test.ts`), Phase 11–12 trips list helpers (`src/lib/__tests__/tripsFilters.test.ts`), Phase 14 share unfurl summary (`src/lib/__tests__/buildSummary.test.ts`), Phase 16 OptimizeError class (`src/api/__tests__/optimizeError.test.ts`), Phase 8 duration formatting (`src/components/__tests__/humanizeDuration.test.ts`), and Phase 13 row-mutex RPCs (new `maybeDescribe` block in `tests/rpc.test.ts`). Final counts: 25 suites (4 skipped when env absent, 21 always passing), 241 tests without env, 278 tests with local Supabase — all green.

The seven new test files exposed that pure helper functions (`applySearch`, `applyDateFilter`, `applySort` in `app/(app)/trips.tsx`; `buildSummary` in `app/share/[token].tsx`) could not be imported in Jest because their parent screen modules pull in `expo-router` and native deps that crash the jsdom test environment. Prior workarounds had silently copied the logic into test files, where it could drift from the source. The fix was a ui-specialist extraction refactor: `src/lib/tripsFilters.ts` (exports `applySearch`, `applyDateFilter`, `applySort`, `SortKey`, `DateFilter` — pure, no React deps, module-level `Intl.Collator`) and `src/lib/buildSummary.ts` (exports `buildSummary`, `SharedTripMeta`, `SharedPlace` — pure). Both screen files were updated to import from `@/lib/...`; behavior is identical. Test files were moved from the old `app/(app)/__tests__/` and `app/share/__tests__/` locations to `src/lib/__tests__/` and updated to import from the canonical lib paths. The two now-empty old test directories were cleaned up.

A real production bug was surfaced and fixed. The RLS share test had been asserting a `42501` error on `.insert(...).select()` as a test failure; deeper diagnosis revealed the true design: `trip_shares` deliberately carries no SELECT policy (share tokens must never be readable post-creation), which means `INSERT ... RETURNING` succeeds at write time but the post-insert RETURNING visibility check fails with `42501` because Postgres cannot SELECT back the newly inserted row under the caller's JWT. More critically, the same SELECT-visibility constraint caused `UPDATE ... RETURNING` under a user JWT to silently return row count 0 — no error, no exception, no visible failure — meaning the `handleRevoke` path in `supabase/functions/share-trip/index.ts` had been a no-op in production since Phase 4. Any user who pressed "Revoke" was left with a live share token. The fix: new migration `supabase/migrations/0009_share_insert_policy_note.sql` adds `COMMENT ON POLICY` entries for all three `trip_shares` policies documenting the no-SELECT-policy design, why `.insert(...).select()` fails, and why user-JWT UPDATE silently no-ops. `handleRevoke` was corrected to prove ownership via a user-JWT SELECT on `trips` first, then perform the UPDATE via the admin client (the only path that is RLS-immune and can count its own writes). `tests/rls.share.test.ts` was rewritten accordingly: the `42501` case is now asserted as design-correct; a positive bare `.insert(...)` (without `.select()`) test was added; the owner-UPDATE test asserts the silent no-op under user JWT; a new test asserts admin-client UPDATE succeeds.

---

## Phase 20 — UX / navigation / maps recovery + expense model cleanup

**Goal**: Turn the current app from a functional prototype into a usable travel product by fixing broken map flows, strengthening navigation, improving visual appeal, and correcting the planning / expense model.
**Status**: ✅ Done — shipped 2026-04-25; smoke green 24 passed / 0 failed / 13 skipped; see `docs/smoke/phase-20.md`.
**Entry criteria**:
- Phase 19 is shipped
- Local Supabase stack and web app can run for smoke
**Phase exit criteria**:
- Auth, trips list, trip detail, and add-place screens have a stronger travel-oriented visual hierarchy and no longer feel sparse
- Every deep screen exposes a clear back affordance on web and native
- Google Maps renders on supported platforms and add-place no longer fails due to an unhandled key misconfiguration path
- Time / duration terminology leads planning flows; expense capture no longer relies on `cost per km`
- Desktop web layout is explicitly adapted and does not look like a stretched mobile screen
- The known itinerary `markers` / `useMemo` runtime bug is either fixed or reproduced with an owning-agent report and regression test coverage

**Critical path**: Step 1 → Step 2 → Step 3 → Step 5 → Step 6 → Step 7 → Step 8

### Step 1 — Travel-first auth / empty-state / landing visual overhaul ✅ Done 2026-04-25
- **Agent**: ui-specialist
- **Size**: L
- **Shipped**: Hero redesign on login/signup with Unsplash CDN imagery and lifted form card; `noTrips` copy changed to "Where to next?"; new `heroOverlay`/`heroChipBg`/`heroChipText` tokens; TS literal-type widening bug in `tokens.ts` fixed.
- **Task**: Redesign the auth screen, empty states, and first-impression surfaces to feel like a travel product using imagery, stronger hierarchy, richer calls-to-action, and clearer onboarding cues.
- **Expected output**: updated auth and empty-state UI across web + native-shared surfaces
- **Depends on**: None
- **Risks**:
  - [Medium] Over-design can fight existing form ergonomics — Mitigation: keep forms readable and task-first; visual richness must not reduce clarity
- **Verification**: live smoke shows a visually richer first-run experience on web, with no regression to auth flow completion

### Step 2 — Navigation clarity + back affordances ✅ Done 2026-04-25
- **Agent**: ui-specialist
- **Size**: M
- **Shipped**: New `BackButton` component (`src/components/BackButton.tsx`) — chevron-left, 44 px touch target, `accessibilityRole="button"`, optional `noPrint` attr; wired into `print.tsx`, `add.tsx`, and `new.tsx`.
- **Task**: Add consistent back affordances and navigation cues on deep screens, especially add-place, place details, trip detail subflows, and web page transitions.
- **Expected output**: visible back navigation pattern used consistently across app flows
- **Depends on**: Step 1
- **Risks**:
  - [Low] Duplication with platform navigation chrome — Mitigation: use a shared pattern that complements Expo Router rather than fighting it
- **Verification**: every deep-linkable screen has an obvious path back during smoke

### Step 3 — Maps + add-place recovery path ✅ Done 2026-04-25
- **Agent**: backend-specialist
- **Size**: M
- **Shipped**: Defensive `?? []` coercions in `Map.web.tsx` + `MapUnavailable.tsx`; `server_misconfigured` envelope returned by all four Edge Functions when `GOOGLE_MAPS_SERVER_KEY` absent; `PlacesError` typed error in `src/api/places.ts`; setup banner in `add.tsx`; new `docs/google-maps-setup.md`; `supabase/functions/.env.example` template.
- **Task**: Fix the broken Google Maps / add-place path end-to-end, including clearer handling for missing `GOOGLE_MAPS_SERVER_KEY`, local/dev secret expectations, and any edge-function misconfiguration surface.
- **Expected output**: add-place and maps have actionable error handling and a working configured path
- **Depends on**: None
- **Risks**:
  - [High] Local success may still differ from hosted key restrictions — Mitigation: document env-specific key requirements and smoke both local and hosted assumptions
- **Verification**: add-place no longer throws `server_misconfigured` when the server key is present; when absent, the app shows a clear actionable message

### Step 4 — Desktop web layout pass ✅ Done 2026-04-25
- **Agent**: ui-specialist
- **Size**: L
- **Shipped**: New `useBreakpoint` hook (mobile <768, tablet 768–1023, desktop ≥1024, desktopWide ≥1440); auth two-column layout at ≥1024 px; trips list 2/3-col grid; trip detail side-by-side 60/40 split on desktop; add-place 720 px max-width; `TripCard` outer `accessibilityRole="link"` (fixes `<button>` nesting); `BottomSheet.web.tsx` `shadow*` → `boxShadow` migration; nine E2E specs updated for new tab structure.
- **Task**: Introduce desktop-aware layout treatments for web on primary screens instead of relying on mobile-stretched layouts.
- **Expected output**: responsive desktop layouts for auth, trips list, trip detail, and add-place on web
- **Depends on**: Step 1
- **Risks**:
  - [Medium] Web-only divergence may fragment design system — Mitigation: keep shared tokens but split layout structure where needed
- **Verification**: 1280px web smoke reads as an intentional desktop app, not a narrow mobile column

### Step 5 — Planning terminology cleanup (`duration` / `time` first) ✅ Done 2026-04-25
- **Agent**: ui-specialist
- **Size**: M
- **Shipped**: New-trip form labels updated to "Destination or trip name" and "Daily plan time (hours)"; empty-state copy refreshed in Step 1; time-first framing confirmed in the trip detail settings section.
- **Task**: Audit user-facing wording and screens so trip planning emphasizes duration / time budgets where that is the real concept, reducing misleading generic `cost` language.
- **Expected output**: clearer time-first planning copy and UI labels
- **Depends on**: Step 1
- **Risks**:
  - [Low] Mixed terminology may remain in older screens — Mitigation: create a copy audit checklist during implementation
- **Verification**: planner-related screens consistently distinguish time budgets from financial budgets

### Step 6 — Expense model redesign (remove `cost per km`, add categories) ✅ Done 2026-04-25
- **Agent**: backend-specialist
- **Size**: L
- **Shipped**: Migration `0010_trip_budget_categories.sql` adds `trips.total_budget` and new `trip_expenses` table (categories: accommodation/food/transport/shopping/activities/other; kind: estimated/actual; optional `day_index`; RLS via trip ownership); `cost_per_km` deprecated via SQL COMMENT; full TanStack Query API in `src/api/trip-expenses.ts`; shared `EdgeFunctionError` base class in `src/api/_errors.ts`; circular import resolved via `src/api/_keys.ts`.
- **Task**: Re-scope expense tracking around total-trip budget plus categorized entries (`accommodation`, `food`, `transport`, `shopping`, etc.), explicitly removing `cost per km` as the primary model.
- **Expected output**: updated data model / API contract plan for categorized expenses and total-budget entry
- **Depends on**: Step 5
- **Risks**:
  - [Medium] Existing cost UI and data may need migration — Mitigation: keep schema additive and deprecate old fields behind compatibility shims first
- **Verification**: expense entry flow supports categories and total-trip budget without relying on per-km cost

### Step 7 — Itinerary runtime bug investigation (`markers` / `useMemo`) ✅ Done 2026-04-25
- **Agent**: reviewer + ui-specialist
- **Size**: M
- **Shipped**: Root cause identified as JS `Map` constructor shadowed by the `Map` component import in `index.tsx`; fix: import renamed to `Map as TripMap`; `selectedDay` reset logic replaced with render-time `effectiveSelectedDay` derivation eliminating React 18 hook-tape corruption.
- **Task**: Reproduce and isolate the itinerary `markers` / `useMemo` runtime failure, identify the owning layer, and file a structured fix report before implementation.
- **Expected output**: concrete bug report with file/line ownership and fix direction
- **Depends on**: Steps 2, 4
- **Risks**:
  - [Medium] Reproduction may depend on map state / platform timing — Mitigation: capture reproduction steps and runtime logs during smoke
- **Verification**: a deterministic repro or a documented reason why it could not yet be reproduced

### Step 8 — Smoke-first testing / reporting pass for the broken golden path ✅ Done 2026-04-25
- **Agent**: test-specialist
- **Size**: M
- **Shipped**: First smoke run found BLOCKER (Map import shadowing JS Map constructor — see Step 8b); second run after fix: 24 passed / 0 failed / 13 skipped. Five implicit-any callbacks typed; `DateField.ts` barrel created. Full results in `docs/smoke/phase-20.md`.
- **Task**: Run live smoke against the updated UX and core flow, explicitly checking maps, add-place, navigation, desktop-web layout, and runtime errors; file findings instead of relying only on automated tests.
- **Expected output**: smoke log plus structured findings for any remaining user-visible blockers
- **Depends on**: Steps 3, 4, 6, 7
- **Risks**:
  - [Low] Some hosted-only issues may remain — Mitigation: log local vs hosted behavior separately
- **Verification**: `docs/smoke/phase-20.md` records the golden path and any residual blockers

### Step 9 — Docs / roadmap sync for the UX recovery pass ✅ Done 2026-04-25
- **Agent**: docs-specialist
- **Size**: S
- **Shipped**: `plan.md` and `docs/features/overview.md` updated; `docs/architecture.md` updated (data model, Edge Function error hierarchy, web breakpoints, maps setup link); `docs/features/auth.md`, `place-search.md`, `trip-crud.md`, and `optimization.md` updated; new `docs/features/expenses.md` created.
- **Task**: Update roadmap/docs to reflect shipped UX, navigation, map, and expense-model decisions after the phase lands.
- **Expected output**: `plan.md` status updated and relevant feature docs queued or refreshed
- **Depends on**: Step 8
- **Risks**:
  - [Low] Feature docs may lag behind final naming — Mitigation: docs pass happens after smoke/fixes settle
- **Verification**: a cold reader can see the new UX priorities and what changed

## ⚠ Blockers (needs user input before phase can fully close)

- Google Maps keys and Supabase secrets must be configured for the target environment — otherwise maps/add-place can only be partially verified

---

## Phase 21 — Budget tracking + collaboration + accommodation tracking

**Goal**: Promote the deferred travel-product capabilities into shipping features: budget UI on the existing `trip_expenses` data layer, multi-user trip collaboration extending the existing `trip_shares` link infrastructure, and accommodation tracking with a first-class data model.
**Status**: ✅ Code complete 2026-04-25 — automated tests (21.14), live smoke (21.15), reviewer pass (21.16), and fix loop (21.17) skipped per user direction; ADRs (21.2) deferred per user direction. Platforms NOT verified. See `docs/smoke/phase-21.md` for deferred-state record.
**Entry criteria**:
- Phase 20 complete (category-based expense data layer + desktop layout primitives shipped)
- Open questions below answered by user before backend/ui work begins

**Phase exit criteria**:
- Users can enter estimated/actual expenses per category from the trip detail screen, see a rollup vs `total_budget`, edit an existing expense, and delete one — verified on web, iOS, Android
- A trip owner can invite a collaborator by email and grant either viewer or editor (per Open Question 1) role; collaborator can sign in and access the trip per granted role; owner can revoke access; two-user RLS deny tests pass — verified on web, iOS, Android
- Users can attach an accommodation to a night-range (check-in / check-out dates), optionally anchor to a Google place via existing autocomplete, and see it surfaced on the trip detail / day views — verified on web, iOS, Android
- Desktop layouts use `useBreakpoint` from day one for every new screen / drawer / sheet
- `docs/features/expenses.md`, new `docs/features/collaboration.md`, new `docs/features/accommodation.md`, and `docs/features/overview.md` are updated to "shipped" with all three platform boxes ticked
- Live smoke recorded at `docs/smoke/phase-21.md` walking the budget + collaboration + accommodation golden paths

### Open questions / decisions — RESOLVED 2026-04-25 by user

1. **Collaboration permission model**: ✅ Decided — **both `viewer` and `editor` roles, viewer as default**. Schema uses `role` enum.
2. **Collaboration invite delivery**: ✅ Decided — **email invite + in-app accept**. Owner enters invitee's email; backend creates a `trip_collaborators` row in `pending` status and emails a tokenized link. Invitee follows link → lands in app → must be signed in → presses **Accept** (or **Decline**) to bind the row to their `auth.user.id` and flip status to `accepted`. Auto-bind on link click is rejected — explicit accept gates write access.
3. **Budget UI scope for v1**: ✅ Decided — **total budget + per-category rollups, no caps**. Total is editable; per-category is computed-only.
4. **Accommodation as new table vs expense category extension**: ✅ Decided — **new `trip_accommodations` table**. Accommodation cost still flows through `trip_expenses` in the `accommodation` category; optional `accommodation_id` FK back-links them.
5. **Accommodation place anchor**: ✅ Decided — **optional `google_place_id` + free-text address fallback**. Reuses existing autocomplete; ToS-safe (we already persist `google_place_id` + coordinates only).
6. **Trip-listing visibility for collaborators**: ✅ Decided — **yes, in `/trips` with "Shared with me" badge**. UNION owned + accepted-collaborator trips in `useTrips`.

**Schema implications locked from above:**
- `trip_collaborators` columns: `id, trip_id, invitee_email, user_id (nullable until accepted), role enum('viewer','editor'), status enum('pending','accepted','declined','revoked'), invite_token, created_at, accepted_at, revoked_at`
- Invite-accept Edge Function or RPC required (token → bind to current `auth.uid()`)
- `trip_accommodations` columns: `id, trip_id, name, google_place_id (nullable), address (nullable), check_in_date, check_out_date, notes, created_at, updated_at`

**Critical path**: 21.1 → 21.2 → (21.3 ‖ 21.5 ‖ 21.8) → (21.4 ‖ 21.6 ‖ 21.9) → 21.7 → 21.10 → 21.11 → 21.12 → 21.13 → 21.14

The riskiest spine is **collaboration**: 21.5 (multi-user RLS migration) gates 21.6 (collaborator-aware API rewrite) gates 21.7 (UI plumbing across every trip-scoped screen). Budget and accommodation slices can run in parallel against this critical path.

---

### Group A — Foundations (must complete before any Group B work)

#### Step 21.1 — Resolve open questions ✅ Done 2026-04-25
- **Agent**: planner (this step is a hand-off, not a code task)
- **Size**: XS
- **Task**: User answers the 6 open questions above. Planner updates this section with the resolved decisions and converts blockers into "decided" notes.
- **Inputs**: Open questions list above
- **Outputs**: Updated `plan.md` with answers inlined; ADRs queued for any non-obvious choices
- **Depends on**: None
- **Risks**: [Blocker] Phase cannot start without these — Mitigation: this step exists exactly to surface that
- **Verification**: All 6 questions have a "Decided: <answer>" line written into plan.md

#### Step 21.2 — ADRs for load-bearing decisions — DEFERRED (user direction)
- **Reason**: User directed the team to skip formal ADR authoring for this phase; the locked decisions recorded in the "Open questions / decisions" block above serve as the de-facto record.
- **Agent**: planner
- **Size**: S
- **Task**: Author ADRs in `docs/adr/` for the two load-bearing choices: (a) collaboration model (multi-user RLS via `trip_collaborators` join table vs. denormalized owner_ids), (b) accommodation as separate table vs. expense extension. Skip ADRs for trivially-resolved questions.
- **Inputs**: Step 21.1 decisions
- **Outputs**: `docs/adr/0001-trip-collaboration-model.md`, `docs/adr/0002-accommodation-as-separate-table.md` (numbering: planner picks next free numbers; verify no existing ADRs collide)
- **Depends on**: 21.1
- **Risks**: [Low] Decisions may shift during implementation — Mitigation: ADRs are short and amendable
- **Verification**: Two ADRs written; each ≤ 1 screen; status: accepted

---

### Group B — Backend (per slice, parallelizable across slices)

#### Step 21.3 — [Slice: Budget] Budget rollup helper + API extensions ✅ Done 2026-04-25
- **Agent**: backend-specialist
- **Size**: S
- **Task**: Add a derived rollup helper to `src/api/trip-expenses.ts` (e.g. `useTripExpenseRollup(tripId)` returning `{ byCategory, totalEstimated, totalActual, budget, remaining }`). No new migration — `trip_expenses` and `trips.total_budget` already exist. Add `useUpdateTripBudget(tripId)` mutation to set `trips.total_budget`. Re-export from `src/api/index.ts`.
- **Inputs**: existing `trip_expenses` schema, existing `useTripExpenses` hook
- **Outputs**: extended `src/api/trip-expenses.ts`, new hook(s), updated `src/api/index.ts` re-exports
- **Depends on**: 21.2
- **Parallel with**: 21.5, 21.8
- **Risks**: [Low] Rollup math edge cases (zero expenses, null budget) — Mitigation: test-specialist covers in 21.10
- **Verification**: Hook returns correct rollup for a fixture trip with 5 mixed-kind expenses; mutation updates `trips.total_budget` round-trip

#### Step 21.4 — [Slice: Budget] Wire test fixtures + types ✅ Done 2026-04-25
- **Agent**: backend-specialist
- **Size**: XS
- **Task**: Ensure `src/api/types.ts` exposes `TripExpense`, `TripExpenseRollup` types cleanly for UI consumption. Add Zod parsing for the rollup return shape if any server-side aggregation is introduced (none expected for v1 — JS-side aggregation is fine for <50 rows).
- **Inputs**: 21.3 hook signatures
- **Outputs**: type exports in `src/api/types.ts`
- **Depends on**: 21.3
- **Parallel with**: 21.6, 21.9
- **Risks**: none material
- **Verification**: `tsc --noEmit` passes; types importable from UI

#### Step 21.5 — [Slice: Collaboration] Migration `0011_trip_collaborators.sql` ✅ Done 2026-04-25
- **Agent**: backend-specialist
- **Size**: L
- **Task**: New migration creating `public.trip_collaborators (id uuid pk, trip_id uuid fk trips, user_id uuid fk auth.users, role text check in ('viewer','editor'), invited_at timestamptz, accepted_at timestamptz null, invited_by uuid fk auth.users)`. Update RLS policies on **all** trip-child tables (`trip_days`, `trip_places`, `trip_legs`, `trip_expenses`, plus the new `trip_accommodations` from 21.8) so SELECT is allowed when caller is owner OR has accepted collaborator row; UPDATE/INSERT/DELETE allowed only for owner OR editor-role collaborators. Update `trips` SELECT policy similarly. Owner-only operations (delete trip, manage collaborators) stay restricted to `trips.user_id = auth.uid()`. Define a SQL helper function `public.user_can_access_trip(trip_id uuid)` returning bool to keep policies DRY.
- **Inputs**: 21.2 ADR-1 decision (single `role` enum confirmed)
- **Outputs**: `supabase/migrations/0011_trip_collaborators.sql`; documents the helper function and policy structure inline
- **Depends on**: 21.2
- **Parallel with**: 21.3, 21.8
- **Risks**:
  - [High] RLS holes — a sharee could read another sharee's email or see all collaborators on a trip. Mitigation: `trip_collaborators` SELECT policy must be limited to owner + the collaborator themselves seeing only their own row; explicit two-user negative test required in 21.10
  - [High] Recursive policy evaluation cost — `user_can_access_trip` called from every child-table policy could explode. Mitigation: keep the function `stable language sql security definer` and `set search_path = public`; benchmark with EXPLAIN on a 10-place trip
  - [Medium] `trip_expenses` policies were authored in 0010 with strict owner-only semantics — must be replaced, not added to. Mitigation: migration drops + recreates, documented in migration header
- **Verification**: `supabase db reset` applies cleanly; `psql` direct test confirms a viewer-role collaborator can SELECT trip + places + legs but cannot UPDATE; editor-role collaborator can UPDATE places; non-collaborator non-owner cannot SELECT

#### Step 21.6 — [Slice: Collaboration] `manage-collaborators` Edge Function + client API ✅ Done 2026-04-25
- **Agent**: backend-specialist
- **Size**: L
- **Task**: New Edge Function `supabase/functions/manage-collaborators/index.ts` with ops `invite` (owner adds by email — uses Supabase Auth admin to look up or invite user, then inserts `trip_collaborators` row), `list` (owner lists collaborators on their trip; returns email + role + accepted_at, never user_id leakage to other collaborators), `update_role` (owner only), `remove` (owner only), `accept` (invitee marks `accepted_at`). Anonymous `?ping` returns 200. Client API `src/api/trip-collaborators.ts` exposes `useTripCollaborators(tripId)`, `useInviteCollaborator(tripId)`, `useUpdateCollaboratorRole(tripId)`, `useRemoveCollaborator(tripId)`, `useAcceptCollaboratorInvite()`. Re-export from `src/api/index.ts`.
- **Inputs**: 21.5 schema + decision on email-invite flow (Open Q2)
- **Outputs**: Edge Function + tests scaffolding (test bodies authored by test-specialist in 21.10), `src/api/trip-collaborators.ts`
- **Depends on**: 21.5
- **Parallel with**: 21.4, 21.9
- **Risks**:
  - [High] Email-enumeration: if invite fails when email doesn't exist, attackers can probe registered emails. Mitigation: always return success-shape, send actual invite if user exists, no-op silently if not (test-specialist verifies)
  - [Medium] Race on accept (two devices same invite) — Mitigation: `accepted_at` is upsert-idempotent
  - [Medium] Existing `useTrips()` query needs to merge owned + accepted-collaborator trips. Mitigation: 21.7 covers
- **Verification**: Edge Function `?ping` returns 200; `invite` then `accept` round-trip works in local Supabase; `list` excludes other collaborators' user_ids

#### Step 21.7 — [Slice: Collaboration] Update `useTrips` and trip-scoped hooks for shared trips — DEFERRED (user direction)
- **Reason**: UNION of owned + accepted-collaborator trips in `useTrips` was not implemented in Phase 21. The trips list instead consumes `useTrips()` (owned) and `useCollaboratedTrips()` (shared) as two separate sections. Completing the UNION is a Phase 22 candidate.
- **Agent**: backend-specialist
- **Size**: M
- **Task**: Update `useTrips()` in `src/api/trips.ts` to UNION owned trips and accepted-collaborator trips, returning a `role: 'owner' | 'editor' | 'viewer'` field per trip. Audit every existing `src/api/*.ts` hook that mutates trip data and ensure it gracefully handles the case where caller is a viewer (the RLS-driven 403 must surface as a typed `forbidden` error, not a silent failure).
- **Inputs**: 21.5 RLS, 21.6 collaborator API
- **Outputs**: updated `src/api/trips.ts`, audit notes inline; possibly small touch-ups to `trip-places.ts`, `trip-expenses.ts`, etc. for error mapping
- **Depends on**: 21.5, 21.6
- **Parallel with**: 21.9 (different files)
- **Risks**: [Medium] UNION query performance — Mitigation: index on `trip_collaborators(user_id, accepted_at)` already in 21.5
- **Verification**: A test user with one owned trip and one accepted-collaborator invite sees both in `useTrips()` with correct `role` values

#### Step 21.8 — [Slice: Accommodation] Migration `0012_trip_accommodations.sql` ✅ Done 2026-04-25
- **Agent**: backend-specialist
- **Size**: M
- **Task**: New migration creating `public.trip_accommodations (id uuid pk, trip_id uuid fk trips, name text not null, google_place_id text null, address text null, lat numeric null, lng numeric null, check_in_date date not null, check_out_date date not null, notes text null, created_at, updated_at)` with CHECK `check_out_date > check_in_date`. RLS policies use the `user_can_access_trip(trip_id)` helper from 21.5 (depends on 21.5 landing first). Index on `trip_id`. `updated_at` trigger reuses `set_updated_at()`.
- **Inputs**: 21.2 ADR-2 (separate table confirmed), 21.5 helper function
- **Outputs**: `supabase/migrations/0012_trip_accommodations.sql`
- **Depends on**: 21.5 (for RLS helper)
- **Parallel with**: 21.3, 21.6
- **Risks**:
  - [Medium] Overlap detection (two stays same night) — out of scope for v1; UI will warn but DB does not enforce. Mitigation: documented in migration header
  - [Low] Coordinates persistence is ToS-safe (we already store `lat`/`lng` for `trip_places`)
- **Verification**: Migration applies cleanly; viewer-collaborator can SELECT, editor can INSERT, non-collaborator gets 0 rows

#### Step 21.9 — [Slice: Accommodation] Client API `src/api/trip-accommodations.ts` ✅ Done 2026-04-25
- **Agent**: backend-specialist
- **Size**: S
- **Task**: TanStack Query hooks `useTripAccommodations(tripId)`, `useCreateAccommodation()`, `useUpdateAccommodation()`, `useDeleteAccommodation()`. Zod schema. Query keys in `src/api/_keys.ts`. Re-export from `src/api/index.ts`. Optional: a derived selector that maps each `trip_days[].day_index` to the accommodation covering that night, for UI consumption in 21.13.
- **Inputs**: 21.8 schema
- **Outputs**: `src/api/trip-accommodations.ts`, types in `src/api/types.ts`
- **Depends on**: 21.8
- **Parallel with**: 21.4, 21.7
- **Risks**: [Low] none material
- **Verification**: `tsc --noEmit` passes; CRUD round-trip works against local Supabase

---

### Group C — UI (per slice, parallelizable across slices; depends on Group B)

#### Step 21.10 — [Slice: Budget] Budget UI on trip detail ✅ Done 2026-04-25
- **Agent**: ui-specialist
- **Size**: L
- **Task**: Build (a) a `BudgetCard` on trip detail showing total budget, total estimated, total actual, remaining, with a small per-category bar breakdown (mobile-first card; desktop variant uses `useBreakpoint` to expand into a 2-col layout placing the card alongside the trip summary), (b) a `BudgetSheet` (modal on mobile, side drawer on desktop) for setting `total_budget`, (c) an `ExpenseSheet` for create/edit with category picker, kind toggle (estimated/actual), amount field, optional day picker, optional label, (d) a list view of all expenses with edit/delete swipe (mobile) or row-actions (desktop). Strong empty state with travel imagery (per 2026-04-25 user priorities). Currency rendering via `Intl.NumberFormat` keyed off `trips.currency`.
- **Inputs**: 21.3, 21.4 hooks; existing `useBreakpoint`; existing trip detail screen
- **Outputs**: `src/components/budget/BudgetCard.tsx`, `src/components/budget/BudgetSheet.tsx`, `src/components/budget/ExpenseSheet.tsx`, `src/components/budget/ExpenseList.tsx`; integrated into `app/(app)/trip/[id]/index.tsx` (or wherever trip detail lives)
- **Depends on**: 21.3, 21.4
- **Parallel with**: 21.11, 21.13
- **Risks**:
  - [Medium] Sheet behavior diverges between iOS / Android / web — Mitigation: use existing sheet primitive if Phase 20 introduced one; otherwise platform-split
  - [Medium] Viewer collaborators must see budget read-only (no edit affordances) — Mitigation: gate edit UI on `trip.role !== 'viewer'`
- **Verification**: Manual: enter 5 expenses across categories, see correct rollup, edit one, delete one. Viewer-role user sees read-only. iOS / Android / web all render correctly.

#### Step 21.11 — [Slice: Collaboration] Collaborator management UI ✅ Done 2026-04-25
- **Agent**: ui-specialist
- **Size**: L
- **Task**: Build (a) a `CollaboratorsScreen` accessible from trip detail (route `app/(app)/trip/[id]/collaborators.tsx`) with mobile-first list + email invite form + role selector, desktop variant uses two-column layout (`useBreakpoint`), (b) a "Shared with me" section header and badge in `app/(app)/trips.tsx` (the trips list) for trips where `role !== 'owner'`, (c) an invite-acceptance flow — when an invitee signs in and lands on `/trips`, pending invites show a banner with accept/decline. Visible back affordance per 2026-04-25 priority. Show role-appropriate edit/view affordances throughout (already gated in 21.10 for budget; add the same gating to existing place/leg edit UIs in this step's audit).
- **Inputs**: 21.6, 21.7 APIs; existing trip detail + trips-list screens
- **Outputs**: `app/(app)/trip/[id]/collaborators.tsx`, updates to `app/(app)/trips.tsx`, new `src/components/collaboration/InviteForm.tsx`, `src/components/collaboration/CollaboratorRow.tsx`, `src/components/collaboration/PendingInvitesBanner.tsx`; gated affordance audit across existing trip-edit UIs
- **Depends on**: 21.6, 21.7
- **Parallel with**: 21.10, 21.13
- **Risks**:
  - [High] Existing place/leg/optimize UIs may unconditionally allow edits — Mitigation: ui-specialist must audit every trip-scoped mutation surface; add a `useTripRole(tripId)` hook in 21.7 if not already there
  - [Medium] Invite-by-email UX when invitee doesn't exist yet — Mitigation: success copy says "If they have an account they'll see this trip; otherwise they'll need to sign up first" (matches the email-enumeration mitigation in 21.6)
- **Verification**: Two-account manual smoke: owner invites editor by email; editor signs in, accepts, edits a place; owner sees the edit. Owner downgrades to viewer; editor's edit affordances disappear. Owner revokes; trip vanishes from former-collaborator's list.

#### Step 21.12 — [Slice: Collaboration] Update share-link and existing public-share screen ✅ Done 2026-04-25
- **Agent**: ui-specialist
- **Size**: S
- **Task**: Update `app/share/[token].tsx` to clarify that link-share is **read-only public view** distinct from collaboration. Add a small "Want to invite someone to edit? Use Collaborators →" link from the trip detail's existing share UI to the new collaborators screen. Link-share itself is unchanged.
- **Inputs**: 21.11 collaborators screen
- **Outputs**: copy / link updates to share UI; no logic changes
- **Depends on**: 21.11
- **Parallel with**: 21.13
- **Risks**: [Low] none material
- **Verification**: Existing share flow still works; new link discoverable from trip detail

#### Step 21.13 — [Slice: Accommodation] Accommodation UI on trip detail + day views ✅ Done 2026-04-25
- **Agent**: ui-specialist
- **Size**: L
- **Task**: Build (a) `AccommodationsSection` on trip detail showing each booking as a card with name, dates (night N–M of trip), address line, and tap-to-edit, (b) `AccommodationSheet` for create/edit — name field, optional Google place autocomplete (reuses existing `PlacesAutocomplete`), free-text address fallback, check-in / check-out date pickers with validation (`check_out > check_in`), notes, (c) per-day surfacing on existing day views — small "Staying at: <name>" pill near the day header when an accommodation covers that night. Mobile-first; desktop uses two-column (`useBreakpoint`). Visible back affordance from sheet.
- **Inputs**: 21.9 hooks; existing `PlacesAutocomplete`, day views; `useBreakpoint`
- **Outputs**: `src/components/accommodation/AccommodationsSection.tsx`, `src/components/accommodation/AccommodationSheet.tsx`, `src/components/accommodation/StayingAtPill.tsx`; integrations into trip detail + day views
- **Depends on**: 21.9
- **Parallel with**: 21.10, 21.11
- **Risks**:
  - [Medium] Date range overlap UX (two accommodations same night) — Mitigation: warning banner in sheet, no DB enforcement; documented in `docs/features/accommodation.md`
  - [Medium] Native date picker divergence — Mitigation: use the same date-picker primitive Phase 20 standardized on (or platform-split if necessary)
  - [Medium] Viewer role gating — Mitigation: `role !== 'viewer'` gates create/edit affordances
- **Verification**: Add a 3-night stay with Google place anchor; appears on trip detail and on each of the 3 day headers; date validation rejects invalid ranges; viewer cannot create/edit.

---

### Group D — Test, smoke, review, docs (sequential close-out)

#### Step 21.14 — Test authoring (automated) — DEFERRED (user direction)
- **Reason**: User explicitly skipped automated tests for Phase 21. Phase 22 should include RLS two-user deny tests, rollup unit tests, and Playwright E2E for all three golden paths.
- **Agent**: test-specialist
- **Size**: L
- **Task**: Author (a) **unit / integration tests** for: `trip_expenses` rollup math, `trip_collaborators` two-user RLS deny / allow matrix (owner-only, viewer-can-read-cannot-write, editor-can-write, non-member-cannot-read, collaborator-cannot-see-other-collaborators-emails), `trip_accommodations` RLS, `manage-collaborators` Edge Function ops including email-enumeration safety (consistent response when email exists vs. doesn't). (b) **Playwright web E2E** for the three golden paths: budget entry + rollup, collaborator invite + acceptance + edit, accommodation creation + day surfacing. (c) **Component tests** for budget rollup display, collaborator role gating, accommodation date validation.
- **Inputs**: All Group B and Group C output
- **Outputs**: tests under `tests/`, `e2e/web/phase-21-budget.spec.ts`, `e2e/web/phase-21-collaboration.spec.ts`, `e2e/web/phase-21-accommodation.spec.ts`, RLS tests under `tests/rls.*.test.ts`
- **Depends on**: 21.10, 21.11, 21.12, 21.13
- **Parallel with**: (none — gates 21.15)
- **Risks**:
  - [High] Two-user collaboration tests need second seeded auth.user; mitigation: extend existing test seeding pattern from `tests/rls.share.test.ts`
  - [Medium] E2E flake on the email-invite flow (depends on Supabase Auth admin in local) — Mitigation: stub Auth admin in local; integration test covers the real path
- **Verification**: `npm test` and `npm run test:e2e` both green; RLS deny tests show correct 403 / empty-result for cross-user access

#### Step 21.15 — Live smoke on web (penultimate, mandatory) — DEFERRED (user direction)
- **Reason**: User explicitly skipped live smoke for Phase 21. `docs/smoke/phase-21.md` records the deferred state. No platform-verified box was ticked for budget, collaboration, or accommodation features.
- **Agent**: test-specialist
- **Size**: S
- **Task**: Walk all three golden paths in a real browser (Chromium) on a fresh Supabase local + dev server. Record at `docs/smoke/phase-21.md` with: (a) budget — set total budget, add 5 expenses across categories + kinds, verify rollup, edit + delete; (b) collaboration — owner invites editor, editor signs in (use second test account), accepts, edits a place; owner downgrades to viewer; editor loses affordances; owner revokes; (c) accommodation — add 3-night stay with Google anchor, verify per-day pill. Note any console errors, navigation dead-ends, or desktop-layout regressions per 2026-04-25 priorities. If anything fails, **do not proceed to 21.16** — main assistant loops back to owning ui/backend specialist.
- **Inputs**: 21.14 (automated tests must be green first)
- **Outputs**: `docs/smoke/phase-21.md` with PASS / FAIL per golden path, screenshots optional
- **Depends on**: 21.14
- **Parallel with**: (none)
- **Risks**: [High] Smoke surfaces unknown unknowns — Mitigation: this is exactly what smoke is for; budget time for at least one fix loop
- **Verification**: Smoke log at `docs/smoke/phase-21.md` shows PASS for all three paths; no console errors

#### Step 21.16 — Reviewer pass — DEFERRED (user direction)
- **Reason**: User skipped smoke (21.15), so reviewer pass was also skipped. Phase 22 should include an RLS correctness review and email-enumeration audit.
- **Agent**: reviewer
- **Size**: M
- **Task**: Pre-merge review covering: RLS correctness on `trip_collaborators` and the helper function (manual SQL probe), email-enumeration safety on `manage-collaborators`, ToS compliance (no Google reviews/photos/hours persisted on accommodations — only `google_place_id` + coords), desktop layouts on web, visible back affordances on every new screen, viewer-role gating across all mutation surfaces, console-error scan during smoke replay. Report findings; if anything is architecture-level, planner re-enters.
- **Inputs**: 21.15 smoke log (must show PASS)
- **Outputs**: review notes; possibly a list of fix items
- **Depends on**: 21.15
- **Parallel with**: (none)
- **Risks**: [Medium] Reviewer finds rearchitecture-level RLS issue — Mitigation: planner re-enters with revised steps appended (don't renumber existing)
- **Verification**: Reviewer signs off, OR fix-loop steps are added and re-reviewed

#### Step 21.17 — Fix loop — DEFERRED (user direction)
- **Reason**: No reviewer pass (21.16) was run, so there are no fix items. Any issues surfaced during Phase 22 smoke or review will be addressed then.
- **Agent**: ui-specialist and/or backend-specialist (as scoped per reviewer findings)
- **Size**: variable (typically S–M)
- **Task**: Apply reviewer's fix items. Each fix is one logical commit. If a fix is rearchitecture-level, planner re-enters before this step.
- **Inputs**: 21.16 review output
- **Outputs**: targeted fixes
- **Depends on**: 21.16
- **Parallel with**: (none)
- **Risks**: [Low] Scope creep during fixes — Mitigation: every fix maps to a reviewer-named item
- **Verification**: Reviewer re-checks the named items only

#### Step 21.18 — Docs sync (final) ✅ Done 2026-04-25
- **Agent**: docs-specialist
- **Size**: M
- **Task**: Update `docs/features/expenses.md` to "shipped" with all three platform boxes ticked; create `docs/features/collaboration.md` and `docs/features/accommodation.md` following the standard template; update `docs/features/overview.md` to mark all three as shipped and remove from the brainstorm-deferred list; update `docs/architecture.md` to reference the two new tables and the `user_can_access_trip` helper; sync `plan.md` Phase 21 status to ✅ Done.
- **Inputs**: All shipped surfaces post-fix-loop
- **Outputs**: `docs/features/collaboration.md` (new), `docs/features/accommodation.md` (new), updates to `docs/features/expenses.md`, `docs/features/overview.md`, `docs/architecture.md`, `plan.md`
- **Depends on**: 21.17 (or 21.16 if no fixes required)
- **Parallel with**: (none — final step)
- **Risks**: [Low] Doc drift if naming shifted — Mitigation: this step is precisely the alignment pass
- **Verification**: All four docs reflect shipped reality; `plan.md` Phase 21 marked ✅ Done

---

### Phase 22 candidates (known limitations from Phase 21)

The following items were identified during Phase 21 implementation and intentionally left for Phase 22:

1. **`useUpdateCollaborator` not implemented** — collaborators screen role chips are read-only; to change a collaborator's role the owner must revoke + re-invite.
2. **`useTrips` does not UNION owned + accepted-collaborator trips** — trips list consumes `useTrips()` and `useCollaboratedTrips()` as two separate sections (Step 21.7 deferred).
3. **Accommodation edit sheet missing Google Places autocomplete** — only manual address entry in v1; the "remove existing link" button works but autocomplete wiring is absent.
4. **Budget UI uses static `$` symbol** — `trip.currency` is not threaded through the budget components.
5. **Editor collaborators cannot edit `trips.total_budget`** — `trips` UPDATE is owner-only per current RLS; a per-column relaxation may be needed if product wants editors to manage budgets.

### Out-of-scope (deferred to Phase 22+, do not plan now)
- Per-category budget caps with overspend warnings
- Per-day budget caps
- Trip ownership transfer to a collaborator
- Real-time multi-user collaboration cursor / presence
- Accommodation overlap enforcement at DB level
- Budget export (CSV / PDF)
- Currency conversion for multi-currency expenses
- Push notifications on collaborator invites
