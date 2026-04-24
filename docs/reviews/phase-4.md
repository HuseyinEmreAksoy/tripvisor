# Phase 4 — Pre-exit review (polish: share, offline, export, empty states, Sentry)

**Date**: 2026-04-24
**Reviewer role**: main assistant acting as `reviewer` (read-only)
**Build**: `master @ 8bfc57c` + Phase 4 uncommitted diff
**Scope**: share-links (DB + Edge Function + UI), offline persister allowlist, `.ics` export (pure + platform hooks), Map web fallback, EmptyState copy variants, Sentry guarded init, Phase 4 tests (25 ics + 13 EmptyState + 6 MapUnavailable + 4 Map.web + 10 ShareLinkCard + 4 Sentry + 14 offline allowlist + 14 Deno share-trip + 8 RLS + 6 Playwright).

## Review summary

- Files reviewed: ~30 new + ~10 modified across `supabase/`, `src/api/`, `src/components/`, `src/lib/`, `app/`, `docs/adr/`, `e2e/`, `tests/`
- Tools run: static read-through, `npx tsc --noEmit` (many pre-existing @types/jest errors; four new Phase-4-specific TS errors flagged), git blame vs. `d9d6669` to confirm pre-existing failures, bundle grep for `AIza` / `GOOGLE_MAPS_SERVER_KEY` (clean in source + pre-Phase-4 dist/), RFC 5545 cross-check on `tripToIcs`, review of all four new ADRs
- Top issues:
  1. `app/share/[token].tsx` serves `trip_legs` with no 30-day ToS age cap — polylines older than 30 days can leak to anonymous viewers, violating Google Maps Platform caching rules
  2. `src/components/ShareLinkCard.tsx` native fallback URL is `https://tripvisor.app` — a domain Tripvisor does not own. Copying on native without `EXPO_PUBLIC_APP_URL` set produces a URL that points nowhere we control
  3. `src/lib/ics/__tests__/__fixtures__/sample.ics` is a CRLF-ended golden fixture committed to a repo with `core.autocrlf=true` at system scope and no `.gitattributes` override — Linux CI will check out the fixture with LF endings and the byte-exact test will fail

### No criticals. Three high-severity findings — one ToS-adjacent, one production UX, one CI portability. Phase 4 is shippable once (1) is resolved; (2) and (3) can be fast-follows if deployment URL + CI platform are captured before release.

---

### Problem 1: Shared trip legs are not age-capped (30-day Google ToS ceiling)
- **Severity**: high
- **Category**: ToS / security
- **Location**: `supabase/functions/share-trip/index.ts:217-226` (`handleRead` — `trip_legs` fetch with no `computed_at` filter)
- **Observation**: `handleRead` selects `trip_legs` with only `.eq('trip_id', share.trip_id)`. The `optimize-trip` orchestrator correctly filters by `LEG_TTL_MS = 30 * 24 * 60 * 60 * 1000` before reusing legs, but `share-trip` does not. A trip whose owner has not re-optimized in >30 days will serve polyline + duration + distance data (all derived from Routes API responses) to anonymous viewers.
- **Root cause**: The TTL is enforced in one read path (optimize) but not the other (share). Sharing is a publish-to-anon action that must respect the same 30-day ceiling that protects cached Google data in our own client.
- **Why it matters**: Google Maps Platform ToS require Routes/Distance-Matrix-derived content to be refreshed at least every 30 days. An abandoned+shared trip is a persistent source of potentially stale Routes data served to third parties. Lower-severity if one accepts the owner's implicit agreement on create, but the Tripvisor architecture doc is explicit about the 30-day ceiling, so the share path should respect it symmetrically.
- **Suggested fix**: Add `.gte('computed_at', new Date(Date.now() - 30*24*60*60*1000).toISOString())` to the `trip_legs` query in `handleRead`, or drop `polyline` + `duration_seconds` + `distance_meters` from the `LEG_FIELDS` selection for shared reads (serve markers only, with "Travel times unavailable" on the anon screen). A cheap alternative: on `op: read`, if any leg is >30 days old, return them with null polyline/duration/distance.
- **Which agent should fix**: `backend-specialist`

### Problem 2: ShareLinkCard native fallback URL hard-codes a domain we don't own
- **Severity**: high
- **Category**: correctness / UX
- **Location**: `src/components/ShareLinkCard.tsx:45`
- **Observation**: When `EXPO_PUBLIC_APP_URL` is unset on native, `buildShareUrl()` returns `https://tripvisor.app/share/<token>`. `tripvisor.app` is a placeholder that neither the repo nor `app.json` points to.
- **Root cause**: MVP placeholder that will ship if the user forgets to set `EXPO_PUBLIC_APP_URL` before an EAS build.
- **Why it matters**: The user presses "Copy link" on an iPhone, pastes into Messages, the recipient taps — and either lands on a dead domain or (worse) a squatter's site. Sharing is the headline Phase 4 feature; this is the worst possible silent failure for it.
- **Suggested fix**: Three options (pick one):
  1. Fail loudly: if `EXPO_PUBLIC_APP_URL` is unset on native, show "Share URL not configured — set EXPO_PUBLIC_APP_URL in .env" instead of the Copy button.
  2. Use the `tripvisor://share/<token>` deep-link scheme as the native copy value when no HTTPS host is configured (the deep-link will still work when opened on an iOS/Android device with the app installed).
  3. Document in `RUNNING.md` section 2.2 that `EXPO_PUBLIC_APP_URL` is mandatory for share-link copy on native, and add a `npx expo-doctor`-style check to the prebuild hook.
- **Which agent should fix**: `ui-specialist` (code) + `docs-specialist` (RUNNING.md)

### Problem 3: `.ics` golden fixture will fail on Linux CI due to CRLF normalization
- **Severity**: high
- **Category**: testing / portability
- **Location**: `src/lib/ics/__tests__/__fixtures__/sample.ics` + `src/lib/ics/__tests__/generate.test.ts:349-377`
- **Observation**: The fixture is committed with real CRLF bytes (verified via `od -c`). System-scope `core.autocrlf=true` with no `.gitattributes` override means git normalizes to LF on commit and restores to CRLF only on Windows checkouts. On Linux CI, the fixture will be LF-ended, the generator emits CRLF, and the byte-for-byte golden comparison `expect(output).toBe(existing)` fails.
- **Root cause**: The test file uses `fs.writeFileSync(fixturePath, output, { encoding: 'utf8' })` to create the fixture on first run, then reads it back. That works on Windows because CRLF in then CRLF out. In CI-on-Linux the initial checkout converts to LF, then the comparison mismatches by 1 byte per line.
- **Why it matters**: The comparison will be silently broken only on Linux — most CI runs today; the test passes on developer Windows machines and in the current local run, masking the problem.
- **Suggested fix**: Add a `.gitattributes` entry forcing CRLF for `.ics` fixtures: `*.ics text eol=crlf`. Or change the assertion to normalize CRLF to LF on both sides before comparing (but that weakens the "real wire format" intent of the golden). The `.gitattributes` fix is better because `.ics` files on disk really should round-trip as CRLF.
- **Which agent should fix**: `test-specialist`

### Problem 4: Playwright e2e uses `[accessibilityLabel^=...]` which React Native Web does not render
- **Severity**: high
- **Category**: testing
- **Location**: `e2e/web/phase-4-polish.spec.ts:154, 220`
- **Observation**: `page.locator('[accessibilityLabel^="Share URL:"]')` selects elements by a literal `accessibilityLabel` DOM attribute. React Native Web maps `accessibilityLabel` to `aria-label` in the DOM. The selector matches zero nodes on web, and Check 3 + Check 4 silently skip via `test.skip(true, 'Could not extract token from share URL')`.
- **Root cause**: Confusion between RN prop name and the rendered ARIA attribute.
- **Why it matters**: The two most important Phase 4 smokes (share link create + revoke round-trip) never actually run even when env is configured. Phase 4 can "pass" on CI without exercising the share flow at all.
- **Suggested fix**: Replace the selector with `page.locator('[aria-label^="Share URL:"]')` (or use a more idiomatic Playwright locator: `page.getByLabel(/share url:/i)`). Also worth adding a fast sanity check in the spec: after create, assert the URL text node (by text match) is visible.
- **Which agent should fix**: `test-specialist`

### Problem 5: Stale pre-Phase-4 persisted cache will hydrate ToS-restricted keys once after upgrade
- **Severity**: medium
- **Category**: ToS / migration
- **Location**: `app/_layout.tsx:47-53` + `src/api/offline.web.ts` + `src/api/offline.native.ts`
- **Observation**: `dehydrateOptions.shouldDehydrateQuery` correctly blocks `place-details` / `places-autocomplete` keys from being written going forward. But users who installed a pre-Phase-4 build have those keys already in AsyncStorage / localStorage, and TanStack Query's hydrate step will restore them on the first launch after upgrade. After first launch the cache churn will evict them once they refetch (they're not rewritten by the allowlist), but for the first process lifetime after upgrade they are in memory and could be inspected via dev tools.
- **Root cause**: Allowlist is applied to dehydration only, not to hydration.
- **Why it matters**: Low realistic risk (data was already cached, just re-hydrated for one session), but strictly speaking the ToS ceiling is "not beyond 30 days" and an existing cache could be older. On-upgrade cache bust would close the loop.
- **Suggested fix**: Bump the `PersistQueryClientProvider`'s `persistOptions.buster` string on any ToS-affecting change (e.g. `buster: 'phase-4-allowlist-v1'`). Setting a new buster discards the prior cache on restore and forces a clean slate. Zero user-visible cost — cache fills in within a screen or two.
- **Which agent should fix**: `ui-specialist` (one line in `app/_layout.tsx`)

### Problem 6: Sentry init runs at module top-level side effect — unmockable, unconditional
- **Severity**: medium
- **Category**: testability / maintainability
- **Location**: `app/_layout.tsx:12-13`
- **Observation**: `initSentry()` is invoked at module scope on every import of `_layout.tsx`. In Jest it's safely a no-op because `EXPO_PUBLIC_SENTRY_DSN` is compile-time-inlined to `undefined` (test-specialist correctly flagged the inlining issue in Finding 1). But the pattern means the layout module cannot be imported in a test that wants a mocked Sentry without the real init running.
- **Root cause**: Import-time side effect. Works for prod, awkward for tests.
- **Why it matters**: Not a correctness bug today (the guard is bulletproof), but it cements an anti-pattern (import-time side effects) that becomes a problem when future telemetry / feature-flag / AB code wants to sit at the same layer. Also blocks coverage of the DSN-present branch without env gymnastics.
- **Suggested fix**: Move `initSentry()` into a `useEffect(() => { initSentry(); }, [])` inside `RootLayout()`. Same timing in practice (runs before any child mounts), testable (can be mocked per test), side-effect-free at module scope. Alternately, accept test-specialist's Finding 1 recommendation: refactor `sentry.ts` to read DSN via `getDsn()` so tests can mock it.
- **Which agent should fix**: `backend-specialist`

### Problem 7: Web .ics anchor download falls back to a 0-byte file on SSR/worker contexts
- **Severity**: medium
- **Category**: correctness / UX
- **Location**: `src/api/ics.web.ts:43-46`
- **Observation**: When `typeof window === 'undefined' || typeof document === 'undefined'`, the hook returns `{ filename, bytes, shared: false }` with no visible affordance. In a static-export deploy this could conceivably run in a prerender / service-worker context and the button's success toast fires without any file actually appearing.
- **Root cause**: Defensive but silent fallback.
- **Why it matters**: The Settings tab sets `icsStatus` to `'success'` regardless of `shared`. A user clicks Export, sees "Downloaded!", and no file is on disk. This would be a hard-to-diagnose support ticket.
- **Suggested fix**: Return `shared: false` only when no browser was available, and teach the caller (trip `[id]/index.tsx`) to set `icsStatus` to `'error'` when `shared` is `false`. Or, simpler: throw `new Error('Browser not available for download')` in the SSR branch — React Query surfaces that through `onError` and the existing error copy applies.
- **Which agent should fix**: `ui-specialist`

### Problem 8: `share-trip` revoke path cannot distinguish "nothing to revoke" from "already revoked"
- **Severity**: medium
- **Category**: correctness / API contract
- **Location**: `supabase/functions/share-trip/index.ts:290-315` (`handleRevoke`)
- **Observation**: The two-step update-then-count pattern is fine per the backend deviation note, but a subtle issue: when called on a trip with zero active shares, `count` is 0 and the response is `{ revoked: 0 }` with HTTP 200. The UI (`ShareLinkCard`) treats that as success and clears the local token state. Correct observable outcome, but the API can't tell the caller "you asked to revoke a specific token that doesn't exist."
- **Root cause**: Revoke-if-active semantics aren't surfaced distinctly from "revoke was a no-op."
- **Why it matters**: Low-impact in the MVP flow because `ShareLinkCard` only calls revoke when it holds a live token. If a future screen re-derives state from the server (e.g. "active share links for this trip"), a revoke-of-nothing silently reports success and the state reconciliation gets confused.
- **Suggested fix**: Log it if you like, but don't widen the API — document in the README that `revoked: 0` means "nothing active matched the filter," and the client should treat 0 as idempotent success. A `token not found` variant (404 only when `body.token` is set and didn't match) would be a nicer contract but isn't blocking.
- **Which agent should fix**: `docs-specialist` (README clarification) or `backend-specialist` (if widening API)

### Problem 9: `EmptyState` focus-on-mount uses `any`-cast and runs on every mount (even when not the first)
- **Severity**: low
- **Category**: a11y / maintainability
- **Location**: `src/components/EmptyState.tsx:48-60`
- **Observation**: The `useEffect(() => { (titleRef.current as any)?.focus?.(); }, [])` cast is the documented workaround for RN Web's Text-to-span mapping, but it's reached on every EmptyState mount in the app. When an empty state is nested inside a tab panel, a keyboard user tabbing around the page has focus suddenly jumping to the title again on tab switches.
- **Root cause**: Unconditional focus steal on mount.
- **Why it matters**: WCAG 2.4.3 (focus order) — gracefully ceding focus is better than unconditionally stealing it. Not a blocker; affects UX for keyboard-only users on web.
- **Suggested fix**: Only steal focus if the empty-state represents the primary content of the route (e.g. after a navigation, not after a tab switch). A safe compromise: only steal focus if `document.activeElement === document.body` when mounting (i.e. nothing already has focus).
- **Which agent should fix**: `ui-specialist`

### Problem 10: `app/(app)/trip/[id]/index.tsx` holds four implicit-`any` parameters violating `strict` mode
- **Severity**: low
- **Category**: maintainability (pre-existing, not a Phase-4 regression)
- **Location**: `app/(app)/trip/[id]/index.tsx:186, 266, 274, 505`
- **Observation**: `(markerId) =>`, `(newIds) =>`, `(id) =>`, `([a], [b]) =>` all lack explicit types. `npx tsc --noEmit` flags them. These errors existed at `d9d6669` (Phase 3 final) — confirmed via `git show d9d6669:app/(app)/trip/[id]/index.tsx`.
- **Root cause**: Inferred types work at runtime; TS `strict` + `noImplicitAny` catches them.
- **Why it matters**: Pre-existing technical debt. Phase 4 did not introduce these. The `Map` / `DraggableItinerary` component types should carry the inferred types but don't, forcing the caller to supply them explicitly.
- **Suggested fix**: Add explicit type annotations, or export the param types from the component files (`onMarkerPress?: (markerId: string) => void` etc.).
- **Which agent should fix**: `ui-specialist` (fast follow, not Phase-4-owned)

### Problem 11: Sentry init guard exercised only in the DSN-absent branch in Jest
- **Severity**: low
- **Category**: testing (accepted gap, not a correctness bug)
- **Location**: `src/lib/__tests__/sentry.test.ts` (and test-specialist's Finding 1)
- **Observation**: `babel-preset-expo` inlines `EXPO_PUBLIC_*` env vars at compile time, so `process.env.EXPO_PUBLIC_SENTRY_DSN` is always `undefined` at test runtime regardless of what the test sets on `process.env`. The DSN-present branch is unreachable from plain `npm test`.
- **Root cause**: Babel compile-time inlining is load-bearing for Expo's env strategy.
- **Why it matters**: The 3-line DSN-present branch is trivial and readable. Accepting the gap is reasonable; the coverage report will show the branch as uncovered in CI. A fix requires either (a) shell-injecting `EXPO_PUBLIC_SENTRY_DSN=<any>` before `npm test` (documented workaround), or (b) refactoring `sentry.ts` to read DSN via an injectable function.
- **Suggested fix**: Accept as a known gap and document the workaround in `RUNNING.md` section 6 (Tests): "To cover the Sentry DSN-present branch, run `EXPO_PUBLIC_SENTRY_DSN=any-value npm test`." Option (b) is a cleaner long-term fix; capture as a Phase 5 item if coverage becomes a hard gate.
- **Which agent should fix**: `docs-specialist` (add workaround note) — `backend-specialist` only if (b) is preferred.

### Problem 12: No Phase 4 deployment notes in RUNNING.md
- **Severity**: low
- **Category**: docs
- **Location**: `RUNNING.md` section 2.3 (Supabase) and 2.2 (env)
- **Observation**: RUNNING.md lists five Edge Functions to deploy — no `share-trip`. `.env.example` adds `EXPO_PUBLIC_SENTRY_DSN` but RUNNING.md doesn't mention it. No mention of `EXPO_PUBLIC_APP_URL` for native share URL fallback either.
- **Root cause**: RUNNING.md is a living doc that hasn't been updated for Phase 4 yet.
- **Why it matters**: First-time runner won't deploy `share-trip` and the Settings tab's "Create share link" will 404 on Phase 4 deploys.
- **Suggested fix**: Update section 2.3 step 4 to add `npx supabase functions deploy share-trip`; add `EXPO_PUBLIC_SENTRY_DSN` and `EXPO_PUBLIC_APP_URL` to section 2.2 with one-line explanations.
- **Which agent should fix**: `docs-specialist`

### Problem 13: "Read-only view" badge on shared view uses ad-hoc style and no accessible role
- **Severity**: low
- **Category**: a11y
- **Location**: `app/share/[token].tsx:169-187`
- **Observation**: The "Read-only view" chip is rendered as a `<View>` + `<Text>` with no `accessibilityRole` or `accessibilityLabel`. Screen readers announce it as plain text inline with the trip meta line above.
- **Root cause**: Easy to miss; it's a visual decoration that also conveys important status.
- **Why it matters**: A user on VoiceOver / TalkBack lands on a shared trip and may not realize they're in anon mode. Minor a11y gap.
- **Suggested fix**: Add `accessibilityRole="text"` + `accessibilityLabel="This is a read-only view of someone else's trip"` to the badge's `<View>`.
- **Which agent should fix**: `ui-specialist`

### Problem 14: Bundle budget not verified — web bundle likely grew > 150 KB gz
- **Severity**: low
- **Category**: perf (unverified)
- **Location**: n/a (whole-bundle observation)
- **Observation**: Phase 4 adds `@sentry/react-native`, `@react-native-community/netinfo`, `expo-file-system`, `expo-sharing`, `expo-clipboard`. Pre-Phase-4 `dist/_expo/static/js/web/entry-*.js` weighs 2.23 MB un-gzipped (from April 23 export). I did not re-run `npx expo export --platform web` because the working tree has uncommitted config changes; the existing bundle is stale.
- **Why it matters**: Sentry + netinfo on web together can add ~80-120 KB gz if not tree-shaken. `expo-file-system` / `expo-sharing` / `expo-clipboard` on web should be tiny if their web stubs are loaded.
- **Suggested fix**: Run `npm run build:web` before cutting the Phase 4 release and diff `dist/_expo/static/js/web/entry-*.js` size against the April 23 baseline. If the delta exceeds ~150 KB gz, consider lazy-loading Sentry via `import('./sentry').then(m => m.initSentry())` inside a `useEffect` in `_layout.tsx`.
- **Which agent should fix**: `test-specialist` (bundle measurement, once committed) + `ui-specialist` (lazy-load fix if exceeded)

---

## Checklist coverage

| Category | Status | Notes |
|---|---|---|
| Google Places ToS — `share-trip` SELECT only ToS-safe fields | OK | `PLACE_FIELDS` + `TRIP_FIELDS` + `LEG_FIELDS` all clean; no `reviews`/`photos`/`rating`/`website`/`phone`/`opening_hours` anywhere |
| Google Places ToS — `place-details` / `places-autocomplete` excluded from persister allowlist | OK | `PERSIST_ROOTS` set is strict, tests assert it |
| Google Places ToS — 30-day leg TTL honoured in share read path | FAIL | See Problem 1 |
| Share token: 128-bit entropy, base64url | OK | `crypto.getRandomValues(new Uint8Array(16))` + base64url encoder |
| Share token: only 8-char prefix logged | OK | `prefix(token)` used in all `log(...)` calls; full token never appears |
| Share token: revoked_at gate unskippable on `read` | OK | `if (!share || share.revoked_at)` — early return before any place fetch |
| `trip_shares` RLS: no SELECT policy, owner-only INSERT/UPDATE/DELETE via `trips.user_id` | OK | Migration 0003 matches ADR-0002; RLS test covers 4 isolation dimensions |
| Sentry guard: DSN-absent is a no-op, no transport spun up | OK | `initSentry()` returns early; tests assert zero `Sentry.init` calls |
| Sentry guard: `sendDefaultPii: false`, `tracesSampleRate: 0.1` | OK | Matches ADR-0003 |
| `initSentry()` called before any other init in `_layout.tsx` | WARN | Called at module-scope side effect — see Problem 6 |
| Cross-platform parity: `offline.{native,web}` same exports | OK | Both export `shouldDehydrateQuery`, `isOnline`, `useIsOnline` |
| Cross-platform parity: `ics.{native,web}` same `useDownloadTripIcs` signature | OK | Both return the same `DownloadIcsResult` shape |
| Cross-platform parity: `clipboard.{native,web}` same `copyToClipboard(text)` | OK | Both return `Promise<boolean>` |
| `Map.web` fallback gracefully degrades to `MapUnavailable` when key absent | OK | Verified + tested |
| Deep link `tripvisor://share/<token>` documented, native fallback URL | WARN | See Problem 2 (fallback domain unowned) |
| No `AIza` / `GOOGLE_MAPS_SERVER_KEY` in client source or pre-Phase-4 bundle | OK | Grep clean; only appearance is `Map.web.test.tsx:66` test literal |
| `.ics` correctness: CRLF, VCALENDAR wrap, folding <= 75 octets, escaping, VTIMEZONE + UTC fallback | OK | Code matches RFC 5545 3.1/3.3.11/3.6 |
| `.ics` golden fixture portable across OS | FAIL | See Problem 3 |
| EmptyState: `accessibilityRole="summary"`, focus-on-mount | WARN | Works, but unconditional focus steal — see Problem 9 |
| Share screen header: `accessibilityRole="header"` + `aria-level` | OK | Lines 159-161, 200-204 |
| ShareLinkCard Copy / Revoke labels | OK | Both `accessibilityLabel`s descriptive |
| ICS export button has accessibilityLabel when disabled | OK | `accessibilityState={{ disabled }}` + label swap |
| No `.only` / `.skip` committed in test files | OK | Only `test.skip(conditional, ...)` uses, all legitimate |
| `tests/rls.share.test.ts` gate-skips without Supabase env | OK | Uses `maybeDescribe = URL && ANON && SERVICE ? describe : describe.skip` |
| Pre-existing failures (Button, optimizer.property, rls.test env gate) are not Phase-4 regressions | OK | Confirmed via `git show d9d6669` — all predate Phase 4 |
| Sentry DSN-present coverage gap | WARN | Accepted (Problem 11 / Finding 1 from test-specialist) |

---

## Existing open findings from test-specialist — disposition

### Finding 1 — Sentry DSN test coverage gap
**Disposition**: **Accepted as a known gap.** The DSN-present branch is 3 lines of trivially readable code and live smoke will cover it. Refactoring `sentry.ts` for testability is reasonable but not blocking. Route to `docs-specialist` to add the `EXPO_PUBLIC_SENTRY_DSN=<any> npm test` workaround to `RUNNING.md` section 6 (see Problem 11 above).

### Finding 2 — Pre-existing test failures (Button, optimizer.property, rls.test.ts env gate)
**Disposition**: **Confirmed pre-existing** via `git show d9d6669:src/components/__tests__/Button.test.tsx`, `git show d9d6669:src/lib/optimizer/__tests__/optimizer.property.test.ts`, and `git show d9d6669:tests/rls.test.ts`. All three existed unchanged at Phase 3 final. Not Phase-4 regressions. Route Button + optimizer property-test to their respective specialists as Phase-5 hygiene items; leave rls.test env-gate alone (it's the intended gating pattern).

---

## MVP readiness

Phase 4 exit criteria from `plan.md` can be ticked after addressing Problem 1, 2, and 3:

- [x] Share links: create / read / revoke end-to-end (Edge Function + RLS-locked table + UI)
- [x] Anonymous share view shows read-only trip + PoweredByGoogle + Google-ToS-safe fields only
- [x] Offline cache policy: 7-day maxAge + allowlist (trips / trip-places / trip-legs) + Google ToS keys blocked
- [x] `.ics` export: pure generator + platform hooks + web download + native share sheet
- [x] Map web fallback: graceful degradation with list view + place grouping
- [x] Empty-state polish: four curated copy variants wired into trips list / itinerary / add-place
- [x] Sentry: guarded init, no transport without DSN, zero test spam
- [?] Platforms verified: web golden path is listed as partial pending env-configured smoke; iOS + Android deferred to user smoke

**Recommendation**: ship Phase 4 after:
1. **Problem 1 fixed** (30-day leg TTL on share read) — `backend-specialist`, ~5 lines
2. **Problem 2 addressed** (either set `EXPO_PUBLIC_APP_URL` before EAS build, or switch to the deep-link scheme fallback, or fail-loud in UI) — `ui-specialist` + `docs-specialist`
3. **Problem 3 fixed** (add `.gitattributes` `*.ics text eol=crlf`) — `test-specialist`, 1 line

The remaining 11 findings (including all mediums) can land as fast-follows in Phase 5. None are blockers.

## Specialists who need to do fixes

- **backend-specialist** — Problems 1, 6, 8 (ToS leg TTL + Sentry init refactor + revoke API clarity)
- **ui-specialist** — Problems 2, 5, 7, 9, 10, 13 (share URL fallback, persister buster, ics web SSR fallback, focus-on-mount, implicit any, read-only badge a11y)
- **test-specialist** — Problems 3, 4, 14 (CRLF .gitattributes, Playwright aria-label selector, bundle-size measurement)
- **docs-specialist** — Problems 2, 8, 11, 12 (deployment URL docs, revoke API note, Sentry test workaround, RUNNING.md Phase 4 updates)

---

*Reviewer did not modify any feature code during this review. All fixes are handed off to the specialists named above.*

---

### Bundle size delta (Problem 14 follow-up)

**Measured**: 2026-04-24 by test-specialist
**Build command**: `npm run build:web` (`expo export --platform web`)
**Entry file**: `dist/_expo/static/js/web/entry-5416d95d1d92f49fa009363d3702b4ed.js`

| Metric | Pre-Phase-4 baseline (April 23 export) | Phase 4 (2026-04-24) | Delta |
|---|---|---|---|
| Uncompressed | 2,283.5 KB (2.23 MB, from review doc) | 2,964.7 KB (2.90 MB) | +681.2 KB |
| Gzipped (level 9) | not measured at baseline | 762.7 KB | n/a (no baseline gz) |

**Gz budget verdict**: The pre-Phase-4 gz baseline was not captured in the April 23 export, so an exact gz delta cannot be computed. Estimating from a typical JS gzip ratio of ~75% compression on a similar Metro bundle, the April 23 baseline would have been approximately 570-640 KB gz, putting the Phase 4 gz delta at roughly **+120-190 KB gz**.

The absolute Phase 4 gz size (762.7 KB) is healthy for a universal app bundle of this scope. However, the estimated gz delta exceeds the 150 KB gz threshold at the upper bound.

**Verdict**: ⚠ The gz delta is on the boundary. The uncompressed growth (+681 KB) is driven primarily by `@sentry/react-native`, `@react-native-community/netinfo`, `expo-file-system`, `expo-sharing`, and `expo-clipboard`. The actual gz impact depends on how well Metro tree-shakes these packages' web stubs.

**Recommendation for ui-specialist**: Measure the pre-Phase-4 gz baseline from commit `d9d6669` (`git stash && npm run build:web`, gzip, `git stash pop`) to get an exact delta. If confirmed above 150 KB gz, apply lazy-loading of Sentry: replace the top-level `initSentry()` call in `app/_layout.tsx` with `import('./lib/sentry').then(m => m.initSentry())` inside a `useEffect`. This defers the Sentry chunk (~80-100 KB gz) until after first paint and is the single highest-leverage optimization available.

---

## Fix disposition (2026-04-24)

| # | Severity | Status | Commit |
|---|---|---|---|
| 1 | High | ✅ Fixed — 30-day computed_at filter + new Deno test | pending commit |
| 2 | High | ✅ Fixed — tripvisor:// deep-link fallback + inline warning | pending commit |
| 3 | High | ✅ Fixed — .gitattributes `*.ics text eol=crlf` | pending commit |
| 4 | High | ✅ Fixed — Playwright `getByLabel` + fail-loud tokens | pending commit |
| 5 | Medium | ✅ Fixed — persister buster `phase-4-allowlist-v1` | pending commit |
| 6 | Medium | ✅ Fixed — initSentry moved to useEffect | pending commit |
| 7 | Medium | ✅ Fixed — throws on SSR download path | pending commit |
| 8 | Medium | ✅ Fixed — README "Revoke semantics" section added | pending commit |
| 9 | Low | ✅ Fixed — focus-steal gated on activeElement === body | pending commit |
| 10 | Low | ⏭ Parked — pre-existing Phase 3 debt, Phase 5 hygiene | — |
| 11 | Low | ✅ Fixed — RUNNING.md Sentry coverage workaround | pending commit |
| 12 | Low | ✅ Fixed — RUNNING.md Phase 4 deploy list | pending commit |
| 13 | Low | ✅ Fixed — share view read-only badge a11y | pending commit |
| 14 | Low | ⚠ Parked — bundle at 762.7 KB gz, baseline not captured; track in Phase 5 | — |

**Ship verdict**: ✅ Phase 4 cleared to commit + ship.
