# account-export

**Status**: Done (Web). Native deferred to user smoke.
**Owner agents**: ui-specialist, backend-specialist
**Depends on**: settings (Phase 7 Settings screen), ics-export (proven platform-split download mechanic, Phase 4)
**Shipped on**: 2026-04-25 — Phase 10

## Platforms verified
- ☐ iOS — deferred to user smoke
- ☐ Android — deferred to user smoke
- ☑ Web — visual smoke confirmed 2026-04-25 (Settings button renders; Blob+anchor download triggers `tripvisor-export-<YYYY-MM-DD>.json`)

## Intent
Privacy mirror to Phase 7's account-deletion surface. Let users pull their complete data footprint as a single human-readable JSON file before — or instead of — deleting their account. The export contains every row the user owns across the four managed tables; no Google Place fields are included because the project never persists them (ToS constraint, `CLAUDE.md`).

## Scope
- Settings screen: "Export my data" secondary button above "Sign out". Loading state while mutation runs. Inline error banner on failure. Disabled while sign-out or delete-account are pending.
- Edge Function `export-account`: JWT-verified POST returns a flat JSON object containing all user-owned rows. Read-only; no writes, no `auth.admin.*`.
- Web download: Blob+anchor click with `setTimeout(URL.revokeObjectURL, 1000)` Safari guard.
- Native download: `expo-file-system` write to cache dir + `expo-sharing.shareAsync` (`mimeType: 'application/json'`, `UTI: 'public.json'`).
- L4 bundle (Phase 9 follow-up): `useDebouncedCallback` extended with `.flush()` and `.cancel()` properties; `DayNotesEditor` and `PlaceNotesEditor` call `.flush()` on `onBlur`. Unmount cleanup continues to call `.cancel()`.

## API surface

### Edge Function
`supabase/functions/export-account/index.ts`

- `POST /export-account` (authenticated) — returns `{ ok: true, export: { user_id, exported_at, trips, trip_places, trip_legs, trip_days } }`.
- `GET /export-account?ping` — returns `{ ok: true, fn: 'export-account' }`.
- Non-POST: 405. Missing/invalid bearer: 401.
- Structured logs emit `requestId`, `fn`, `level`, `stage`, `userId` (UUID), and row counts only — no notes content, place titles, or emails.

### Client hooks (platform-split)

| File | Platform | Resolution |
|---|---|---|
| `src/api/account-export.web.ts` | Web | Metro/RN-Web resolves `.web.ts` |
| `src/api/account-export.native.ts` | iOS + Android | Metro resolves `.native.ts` |
| `src/api/account-export.ts` | TS stub | Consumed only by TypeScript compiler; never bundled at runtime |
| `src/api/account-export.shared.ts` | All | `fetchAccountExportJson()` — builds JSON string + filename; shared by both platform files |

Exported from `src/api/index.ts` as `export * from './account-export'`. Consumers import `useExportAccount` from `@/api` and receive the correct platform implementation automatically.

`AccountExport` interface lives in `src/api/types.ts`.

## Exported fields

| Table | Notes |
|---|---|
| `trips` | All user-owned trip rows (`user_id = userId`), ordered by `id asc` |
| `trip_places` | Child rows filtered by `trip_id IN (<user's trip IDs>)`, ordered by `id asc` |
| `trip_legs` | Same filter chain as `trip_places` |
| `trip_days` | Same filter chain as `trip_places` |

Google place fields (reviews, photos, ratings, opening hours, etc.) are explicitly NOT included. The project never persists them (30-day ToS ceiling); `trip_places` stores only `google_place_id`, coordinates, and user-managed fields.

## Filename format

`tripvisor-export-<YYYY-MM-DD>.json` where the date is UTC (`new Date().toISOString().slice(0, 10)`). Two consecutive exports by the same user produce byte-identical files (deterministic row ordering). Users in a late-evening timezone may see "tomorrow's" date — acceptable trade-off; UTC is the correct deterministic choice for filenames.

## Security

- `userId` is derived exclusively from `anon.auth.getUser(token)` after bearer extraction. The function never reads `req.body` for any identifier.
- Child-table reads are filtered by `trip_id IN (<tripIds>)` where `tripIds` comes from the JWT-scoped trips query, not the request body. A forged or replayed token cannot reach another user's rows.
- Service-role client lives only inside the Deno Edge Function; it never appears in `src/` or `app/` (grep confirmed by reviewer).
- Logging is row-counts-only. No PII fields are emitted.

See `docs/reviews/phase-10.md` for the adversarial mental model checklist (6 scenarios, all PASS) and `docs/adr/0009-account-data-export.md` for the architectural decision (single Edge Function vs. per-table CSVs, Postgres RPC, streaming, signed URL).

## Platform differences

- **Web**: Blob+anchor download. SSR guard (`typeof window === 'undefined' || typeof document === 'undefined'`) throws before any DOM access.
- **iOS / Android**: `FileSystem.writeAsStringAsync` to `cacheDirectory` then `Sharing.shareAsync`. Share sheet offers Files, Mail, iCloud, etc. `UTI: 'public.json'` (iOS 11+, well below Expo SDK 52 floor).

## Open follow-ups

See `docs/reviews/phase-10.md` for full reviewer findings. All five are low severity and parked:

- **L1** — Empty `tripIds` path logs `read_children` stage with all-zero counts (cosmetic observability nit).
- **L2** — `bytes` fallback `json.length` undercounts UTF-8 for non-ASCII content; use `new TextEncoder().encode(json).length` on next touch.
- **L3** — Web vs. native `AccountExportResult` type divergence (pre-existing pattern from `ics.ts` family).
- **L4** — `useDebouncedCallback` JSDoc warns against `flush()` in effect cleanup but does not enforce (informational; Phase 10 call sites are clean).
- **L5** — Settings `flex: 1` spacer may collapse buttons below fold on narrow viewports (pre-existing Phase 7 layout).
