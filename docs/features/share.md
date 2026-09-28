# share

**Status**: ✅ Done — shipped Phase 4 (core); Phase 14 added rich unfurl (2026-04-25); M4 X3.3 (2026-09-29, `8dd2ae4`) added the native share sheet, https links on native, the mobile-first public page and the OG Pages Function (deploy pending, BUILD-LOG X3.4).
**Owner agents**: backend-specialist, ui-specialist
**Depends on**: trip-crud, optimization, map

## Platforms verified
- ☐ iOS (deferred to user smoke; Head component is a web-only no-op — no native surface changed in Phase 14)
- ☐ Android (deferred to user smoke; same reason as iOS)
- ✅ Web (Playwright E2E Phase 4; Phase 14 unfurl self-verified by ui-specialist)

## User story
As a trip planner, I want to send a read-only link to a friend so they can view my itinerary without needing an account.

## UI
- **Where** (M4 X2.2/X3.3): the Trip tab hub (`TripHubTab.tsx`, editors only; formerly the Settings tab) mounts `ShareLinkCard.tsx`; the header ⋯ menu also has a Share entry. The card shows "Create share link", then the URL + Share + Copy + Revoke (confirmed).
- **Copy button**: platform-split — `expo-clipboard` on native, `navigator.clipboard` on web. Both return `Promise<boolean>`.
- **Share URL (native)** *(updated M4 X3.3, 2026-09-29, `8dd2ae4`)*: `buildAppUrl()` in `src/components/share/shareSheet.native.ts` uses `EXPO_PUBLIC_APP_URL` when set, else the live web origin `https://tripvisor.pages.dev` (`DEFAULT_APP_URL` in `shareSheet.types.ts`). It never returns the `tripvisor://` scheme (only works for recipients who have the app) and there is no longer an inline env-var warning. On web the URL is `<page origin>/share/<token>`.
- **Share button** (M4 X3.3): the native share sheet (RN `Share.share`); on web `navigator.share` with a clipboard fallback. Invite links on `/trip/[id]/collaborators` are shared the same way.
- *Superseded (pre-M4):* when `EXPO_PUBLIC_APP_URL` was unset, `buildShareUrl()` returned `tripvisor://share/<token>` with an inline developer warning.
- **Anonymous share route** (`app/share/[token].tsx`): no auth required. Renders the trip header, read-only itinerary list, and `Map` (or `MapUnavailable` fallback when web key is absent). No edit affordances. "Powered by Google" footer when any place data is displayed. "Read-only view" badge with `accessibilityRole="text"` + descriptive `accessibilityLabel`.
- Platform difference: shared links are always `https://<domain>/share/<token>` and open `app/share/[token].tsx` in a browser. `tripvisor://share/<token>` still routes to the same screen if typed or tapped inside the app, but it is not what users share. Android App Links (opening https links in the installed app) are ⏭ deferred to P4.
- **Public share page (M4 X3.3)**: mobile-first — day tabs, map, timeline, "Plan your own" CTA. Per-trip OG tags come from the Cloudflare Pages Function `functions/share/[token].ts` (needs Pages env `SUPABASE_URL` / `SUPABASE_ANON_KEY`; not deployed yet — BUILD-LOG X3.4), with static OG tags as the fallback.

## Data
- New table: `trip_shares (id uuid pk, trip_id uuid fk trips, token text unique not null, created_at timestamptz, revoked_at timestamptz)` — migration `supabase/migrations/0003_share_links.sql`
- RLS: no SELECT policy on the table (anonymous cannot query it directly); owner-only INSERT/UPDATE/DELETE enforced via `trips.user_id` join. All anonymous reads go through the Edge Function using the service role.
- Token: 128-bit random via `crypto.getRandomValues(new Uint8Array(16))`, base64url encoded (~22 chars). Never logged in full — only an 8-char prefix appears in Edge Function logs.

## APIs
- **Edge Function `share-trip`** — three operations dispatched by `op` body field:
  - `create` (authenticated): generates token, writes to `trip_shares`, returns `{ token }`.
  - `read` (anonymous): looks up token, gates on `revoked_at` being null, returns trip + trip_places + trip_legs. Trip legs are filtered to `computed_at >= now - 30 days` (Google ToS ceiling) — legs older than 30 days are excluded and the share view shows "Route times unavailable".
  - `revoke` (authenticated, owner only): sets `revoked_at = now()` on all active shares for the trip. Returns `{ revoked: count }`. A count of 0 is idempotent success (documented in RUNNING.md "Revoke semantics").
- **No reviews / photos / ratings / opening_hours** in `PLACE_FIELDS` or `LEG_FIELDS` selection — enforced by field mask in the Edge Function.

## Edge cases
- Revoked token: `read` returns HTTP 404. UI shows "Link not found or revoked".
- `EXPO_PUBLIC_APP_URL` unset on native: falls back to `https://tripvisor.pages.dev/share/<token>` (M4; previously `tripvisor://` + inline warning). Tested in `src/components/share/__tests__/shareSheet.native.test.ts`.
- Map unavailable: if `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` is empty on web, the share route shows `MapUnavailable` ("Map unavailable — list view below") rather than crashing.
- Legs older than 30 days: excluded from the share read payload; share view renders place list without travel times.
- No edit affordances on the share route: verified by component test asserting no "Edit", "Delete", or drag controls are rendered.

## Test plan
- Unit: `src/components/__tests__/ShareLinkCard.test.tsx` — create, share sheet, clipboard fallback, revoke with confirm (M4 rewrite; the no-URL warning case is gone) ✅ · `src/components/share/__tests__/shareSheet.{native,web}.test.ts` ✅
- Deno integration: `supabase/functions/share-trip/test.ts` — 14 cases: create, read, revoke, read-after-revoke (404), anon bypass attempts ✅
- RLS: `tests/rls.share.test.ts` — anonymous cannot SELECT `trip_shares` or bypass via a revoked token ✅
- Component: `app/share/[token].tsx` renders no edit controls; read-only badge present ✅
- E2E (Playwright): `e2e/web/phase-4-polish.spec.ts` Check 1 (create + open share link in anonymous context) + Check 2 (revoke returns 404) — using `page.getByLabel(/share url:/i)` ✅
- Manual native smoke (iOS + Android): create link on device, open in browser, open via deep link — deferred to user

## Phase 14 — Rich unfurl (OG / Twitter meta tags)

**Shipped**: 2026-04-25

When a `/share/<token>` URL is pasted into Slack, Discord, iMessage (iOS 16+), Twitter/X, WhatsApp, or Telegram, it now unfurls with a title and description instead of a bare URL.

### Mechanism

Two components added, both web-only via `Platform.OS !== 'web'` early-return + runtime `require('expo-router/head')` (same pattern as `app/(app)/trip/[id]/print.tsx:PrintHead`):

- `SharedTripHead` in `app/share/[token].tsx` — renders 9 meta tags (`<title>`, `og:title`, `og:description`, `og:type`, `og:site_name`, `twitter:card`, `twitter:title`, `twitter:description`, `name="description"`) once `shared` data is loaded. Loading/error states emit nothing; the root fallback applies.
- `RootHead` in `app/_layout.tsx` — baseline tags (`name="description"`, `og:site_name`, `og:type`, `twitter:card`) on every web route. Per-route Heads override these for the keys they specify.

### Summary string format

Used as `og:description` / `twitter:description`. Hard-capped at 200 chars.

| Condition | Format |
|---|---|
| 0 places | `"Empty trip · {h}h/day"` |
| Has start + end dates | `"{N}-day trip · {placeCount} place(s) · {h}h/day"` |
| No dates | `"{placeCount} place(s) · {h}h/day"` |

Daily hours: integer prints as `"8h"`, fractional as `"7.5h"`. N = inclusive day count.

### No `og:image`

Per-trip card image generation is out of scope for this phase.

### Unfurl caveat

Tags are injected client-side by `react-helmet-async` (under `expo-router/head`) and are not in the initial static HTML. All major unfurlers (Slack, Discord, Twitter/X, iMessage iOS 16+, WhatsApp, Telegram) execute JavaScript before scraping, so this is fine in practice. Non-JS bots (legacy Facebook crawler, plain `curl`) see only the static document title. True pre-rendered tags require SSR or per-trip static export — out of scope.

## Phase 19 — Revoke flow correctness fix

**Bug fixed**: 2026-04-25

The share-revoke flow had been silently failing in production since Phase 4 shipped.

### Root cause

`trip_shares` carries no SELECT policy by design: share tokens must never be queryable by any client JWT after creation (the only read path is the admin-client Edge Function). This design is correct and intentional — but it has a non-obvious consequence for write paths:

- `INSERT ... RETURNING` under a user JWT: the INSERT itself succeeds (the INSERT WITH CHECK policy allows it), but the post-insert `RETURNING` visibility check fails with `42501` because Postgres cannot SELECT the row back under the caller's JWT. The `.insert(...).select()` pattern therefore surfaces `42501` on the client even though the row was written. Direct `.insert(...)` without `.select()` works correctly.
- `UPDATE ... RETURNING` under a user JWT: the UPDATE is silently blocked by RLS (the row is invisible to the caller's SELECT policy), Postgres returns row count 0, and no error is raised. The `handleRevoke` function in `supabase/functions/share-trip/index.ts` had been using this path, meaning every revoke call returned `{ revoked: 0 }` and the token remained live. Any token a user believed they had revoked was still valid in production from Phase 4 through Phase 18.

### Fix

Three parts:

1. **Migration `supabase/migrations/0009_share_insert_policy_note.sql`** — adds `COMMENT ON POLICY` entries for all three `trip_shares` policies (`trip_shares_insert`, `trip_shares_update`, `trip_shares_delete`) documenting the no-SELECT-policy design rationale, why `.insert(...).select()` produces `42501`, why direct user-JWT UPDATE silently no-ops, and that all production writes must flow through the Edge Function admin client.

2. **`supabase/functions/share-trip/index.ts:handleRevoke`** — reworked to:
   - Prove ownership via a user-JWT `SELECT` on `trips` (where the caller does have SELECT rights via the standard `trips.user_id = auth.uid()` policy).
   - Perform the `UPDATE revoked_at = now()` and row-count read via the admin client, which is RLS-immune and can read its own write back.
   - Return `{ revoked: count }` correctly.

3. **`tests/rls.share.test.ts`** — rewritten to match the correct design:
   - `42501` on `.insert(...).select()` is now asserted as expected behavior (not a failure).
   - Bare `.insert(...)` without `.select()` is tested and confirmed to succeed.
   - Owner-JWT `UPDATE` is tested and confirmed to silently no-op (row count 0, no error) — the test documents the design hazard.
   - Admin-client `UPDATE` is tested and confirmed to succeed.

### User-visible impact

This is a bug fix with real user impact. Any share token that a user pressed "Revoke" on between Phase 4 (2026-04-24) and Phase 19 (2026-04-25) was not actually revoked. After Phase 19, the revoke flow correctly marks the token as revoked and the share read Edge Function returns HTTP 404 for revoked tokens as documented.

## ADR
- [ADR-0002 — Share-link route shape](../adr/0002-share-link-shape.md)

## Review
- [Phase 4 review — Problems 1, 2, 8](../reviews/phase-4.md)
