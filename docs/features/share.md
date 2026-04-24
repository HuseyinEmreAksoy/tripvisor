# share

**Status**: 🚧 Code complete · awaiting native smoke
**Owner agents**: backend-specialist, ui-specialist
**Depends on**: trip-crud, optimization, map

## Platforms verified
- ☐ iOS
- ☐ Android
- ☐ Web
(Check a box only after smoke-testing on that platform.)

## User story
As a trip planner, I want to send a read-only link to a friend so they can view my itinerary without needing an account.

## UI
- **Settings tab** (`app/(app)/trip/[id]/index.tsx`): "Share" section with "Create share link" button. On success, shows the share URL + "Copy" button + "Revoke" button via `ShareLinkCard.tsx`.
- **Copy button**: platform-split — `expo-clipboard` on native, `navigator.clipboard` on web. Both return `Promise<boolean>`.
- **Fallback URL (native)**: when `EXPO_PUBLIC_APP_URL` is unset, `buildShareUrl()` returns the `tripvisor://share/<token>` deep-link scheme (not a placeholder HTTPS domain) and shows an inline warning so the developer knows to set the env var before an EAS build.
- **Anonymous share route** (`app/share/[token].tsx`): no auth required. Renders the trip header, read-only itinerary list, and `Map` (or `MapUnavailable` fallback when web key is absent). No edit affordances. "Powered by Google" footer when any place data is displayed. "Read-only view" badge with `accessibilityRole="text"` + descriptive `accessibilityLabel`.
- Platform difference: deep-link `tripvisor://share/<token>` (native) and `https://<domain>/share/<token>` (web) both route to the same `app/share/[token].tsx` via Expo Router universal linking.

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
- `EXPO_PUBLIC_APP_URL` unset on native: falls back to `tripvisor://share/<token>` with an inline developer warning — no silent UX failure.
- Map unavailable: if `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` is empty on web, the share route shows `MapUnavailable` ("Map unavailable — list view below") rather than crashing.
- Legs older than 30 days: excluded from the share read payload; share view renders place list without travel times.
- No edit affordances on the share route: verified by component test asserting no "Edit", "Delete", or drag controls are rendered.

## Test plan
- Unit: `src/components/__tests__/ShareLinkCard.test.tsx` — 10 cases covering create, copy, revoke, no-URL warning ✅
- Deno integration: `supabase/functions/share-trip/test.ts` — 14 cases: create, read, revoke, read-after-revoke (404), anon bypass attempts ✅
- RLS: `tests/rls.share.test.ts` — anonymous cannot SELECT `trip_shares` or bypass via a revoked token ✅
- Component: `app/share/[token].tsx` renders no edit controls; read-only badge present ✅
- E2E (Playwright): `e2e/web/phase-4-polish.spec.ts` Check 1 (create + open share link in anonymous context) + Check 2 (revoke returns 404) — using `page.getByLabel(/share url:/i)` ✅
- Manual native smoke (iOS + Android): create link on device, open in browser, open via deep link — deferred to user

## ADR
- [ADR-0002 — Share-link route shape](../adr/0002-share-link-shape.md)

## Review
- [Phase 4 review — Problems 1, 2, 8](../reviews/phase-4.md)
