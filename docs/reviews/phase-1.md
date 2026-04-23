# Phase 1 — Pre-exit review

**Date**: 2026-04-23
**Reviewer role**: main assistant acting as `reviewer` (read-only)
**Scope**: everything authored in Phase 1 across `supabase/functions/`, `src/api/`, `src/components/`, `src/theme/`, `app/`, and `tests/`.

## Review summary

- Files reviewed: ~35 (see git status after `git init`)
- Tools run: static read-through (no `npm test` yet — user install pending)
- Top issues:
  1. CORS default falls back to `*` when `ALLOWED_ORIGINS` is unset — acceptable for local dev, MUST be tightened before any production deploy
  2. Several inline lambda props — low impact for non-memoized list items but worth watching
  3. Web magic-link redirect URL not yet configured — auth flow will silently fail on web without `emailRedirectTo`

### No CRITICAL findings. Phase 1 is ready for user smoke-testing once they install + provision.

---

### Problem 1: CORS defaults to wildcard
- **Severity**: medium
- **Category**: security
- **Location**: `supabase/functions/_shared/cors.ts:1-4`
- **Observation**: `ALLOWED_ORIGINS` defaults to `*` when the env var is unset
- **Root cause**: Safe for local dev but a production deploy with `ALLOWED_ORIGINS` unset would expose an unrestricted Edge Function
- **Why it matters**: Google key isn't leaked (it's server-side only), but an open proxy still invites abuse and quota burn
- **Suggested fix**: Flip the default to `''` (no origins allowed) so misconfiguration fails closed, not open. Document env var as required in `docs/architecture.md`.
- **Which agent should fix**: `backend-specialist`

### Problem 2: Magic-link `emailRedirectTo` missing
- **Severity**: medium
- **Category**: correctness (auth)
- **Location**: `src/api/auth.ts:28-36` (`useSignInWithMagicLink`)
- **Observation**: `signInWithOtp` is called without `options.emailRedirectTo`
- **Root cause**: On web, Supabase needs an absolute URL to redirect the user back after clicking the magic link; on native it needs the `tripvisor://` scheme. Neither is configured.
- **Why it matters**: User will receive the email but clicking the link will land on Supabase's hosted page instead of returning to the app
- **Suggested fix**: Pass `emailRedirectTo` computed from `expo-linking`'s `Linking.createURL('/')`. Works on all three platforms.
- **Which agent should fix**: `backend-specialist` (for the hook) or `ui-specialist` (if wrapped in a UI-owned helper)

### Problem 3: Photo URL builder exposes client key in URL
- **Severity**: low (by design)
- **Category**: ToS / security
- **Location**: `app/(app)/place/[placeId].tsx:172-180`
- **Observation**: Photo URL includes `&key=<EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY>`
- **Root cause**: Places API photo endpoint requires either a server key (through a proxy) or a client key (referer-restricted for Maps JS). We use the client key directly.
- **Why it matters**: The client key must be referer-restricted in Google Cloud Console; otherwise it can be abused. This is a deployment-time configuration, not a code bug.
- **Suggested fix**: Add a note in `docs/architecture.md` that `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` must have HTTP referer restrictions set. Alternatively, route photos through an Edge Function too (trade-off: more cost, more latency).
- **Which agent should fix**: `docs-specialist` (documentation) + operator (console config)

### Problem 4: Inline lambdas in FlatList renderItem
- **Severity**: low
- **Category**: perf
- **Location**: `app/(app)/trips.tsx:47`, `app/(app)/trip/[id]/add.tsx:117`
- **Observation**: `renderItem={({ item }) => ...}` creates a new function per render
- **Root cause**: Default RN pattern; fine for small lists and non-memoized items
- **Why it matters**: Not measurable until list size grows past ~100 items, which is beyond MVP scope (trips capped at 25 places per trip)
- **Suggested fix**: Defer until a measurable perf issue surfaces. Keep in mind for Phase 3 drag-reorder work.
- **Which agent should fix**: defer; revisit in Phase 3 perf pass

### Problem 5: Trip detail places list lacks pull-to-refresh
- **Severity**: low
- **Category**: UX
- **Location**: `app/(app)/trip/[id]/index.tsx`
- **Observation**: trips list has `RefreshControl`, trip-detail places list does not
- **Root cause**: Omitted for brevity
- **Suggested fix**: Add `RefreshControl` wired to `useTripPlaces().refetch`
- **Which agent should fix**: `ui-specialist`

### Problem 6: No loading state for suggestion fetch while keystrokes continue
- **Severity**: low
- **Category**: UX
- **Location**: `app/(app)/trip/[id]/add.tsx`
- **Observation**: While `isFetching` is true but `data` exists, we show the stale data. Feels fine, but there's no spinner in the search header.
- **Suggested fix**: Add a subtle `ActivityIndicator` in the header while `isFetching`
- **Which agent should fix**: `ui-specialist`

### Problem 7: `suggestions` empty state says "No results" vs "Type more"
- **Severity**: low
- **Category**: UX copy
- **Location**: `app/(app)/trip/[id]/add.tsx:124-131`
- **Observation**: Correct branching already present; no action needed
- **Suggested fix**: none

### Problem 8: `useTrip` fallback queryKey collision
- **Severity**: low
- **Category**: correctness
- **Location**: `src/api/trips.ts:38`
- **Observation**: When `id` is undefined, key falls back to `['trips', 'detail', 'none']` which could collide with future placeholder usage
- **Root cause**: Defensive fallback; `enabled: false` guards the fetch
- **Why it matters**: Minor; the query never runs, so no actual collision can occur
- **Suggested fix**: none needed, but consider stable `['trips', 'detail', null]` if other hooks do the same pattern
- **Which agent should fix**: none (informational)

---

## Checklist coverage

| Category | Status |
|---|---|
| Google ToS compliance (persistence, attribution, field masks, session tokens) | ✅ Pass |
| Security — RLS / keys / Zod / CORS | ⚠ CORS default needs fix before prod (Problem 1) |
| Cross-platform correctness (web / iOS / Android) | ✅ Pass (platform splits in place) |
| Supabase / Edge Function patterns (timeouts, logs, ping, input validation) | ✅ Pass |
| Performance | ✅ Pass for MVP scale |
| Accessibility (labels, roles, live regions, contrast) | ✅ Pass baseline |
| State / data discipline (TanStack Query, react-hook-form, no prop drilling) | ✅ Pass |
| Testing coverage (Edge Function integration, RLS, component) | ✅ Pass for Phase 1 scope |

---

## Recommended before calling Phase 1 "Done"

Blocking:
1. Fix Problem 1 (CORS default fails-closed) — `backend-specialist`
2. Fix Problem 2 (magic-link redirect URL) — `backend-specialist`

Non-blocking, good hygiene:
3. Fix Problem 5 (pull-to-refresh on trip detail) — `ui-specialist`
4. Document Problem 3 in `docs/architecture.md` — `docs-specialist`
