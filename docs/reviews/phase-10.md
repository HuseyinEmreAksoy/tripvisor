# Phase 10 — Pre-exit review

**Date**: 2026-04-25
**Reviewer**: `reviewer` sub-agent (read-only)
**Scope**: `export-account` Edge Function, platform-split `useExportAccount`, `useDebouncedCallback` flush/cancel extension, Settings export button, Phase 9 L4 onBlur wiring.

## Summary

- **Cross-tenant safety / JWT chain**: clean. `userId` derived exclusively from `anon.auth.getUser(token)` after guarded bearer extraction. Trip rows filtered with `.eq('user_id', userId)`; child tables filtered by `.in('trip_id', tripIds)` where `tripIds` comes from the JWT-scoped trip list. Function never reads `req.body` for any identifier.
- **No service-role / Google / PAT in client bundle**: clean. `grep -r "SUPABASE_SERVICE_ROLE_KEY|sbp_"` returns zero hits in `src/` or `app/`. Service role lives only in `supabase/functions/_shared/supabase-admin.ts` (Deno).
- **Google ToS**: untouched. Export reads only the four user-managed tables; no Place data fields in schema or response builder.
- **Logging**: clean. All `log()` emits only `requestId`, `fn`, `level`, `stage`, `userId` (UUID), and row counts. No notes, titles, emails, coordinates.
- **Platform-split resolution**: matches the proven `ics.ts` stub pattern. Metro resolves `.native.ts` on iOS/Android and `.web.ts` on Web; `account-export.ts` is the TS-resolution stub re-exporting from `.web` (never bundled at runtime).
- **SSR guard parity**: `account-export.web.ts` matches `ics.web.ts` (`typeof window === 'undefined' || typeof document === 'undefined'`).
- **Debounce hook non-breaking**: confirmed. All three call sites consume the result as a callable; none destructure. `.flush` and `.cancel` are additive properties. Unmount cleanup still calls `cancel()`, NOT `flush()`.
- **ADR-0009 fidelity**: implementation matches every clause — single Edge Function, flat JSON, `trips → children` order, `order('id', { ascending: true })` deterministic ordering, UTC `YYYY-MM-DD` filename, Blob+anchor on web, file-write + share sheet on native.
- **Accessibility**: Settings button has `accessibilityLabel="Export my data as JSON"` + `accessibilityHint`; error banner has `accessibilityRole="alert"` + `accessibilityLiveRegion="polite"`.

## Critical findings

**None.**

## High findings

**None.**

## Medium findings

**None.**

## Low findings

### L1 — Empty `tripIds` short-circuit logs `read_children` with all-zero counts
- **Severity**: low (observability nit)
- **Location**: `supabase/functions/export-account/index.ts`
- **Observation**: When a user owns zero trips, `if (tripIds.length > 0)` is skipped, but `read_children` log still fires with `count: 0`. Cosmetic; could mislead an operator scanning logs.
- **Disposition**: Park; non-blocking.

### L2 — `bytes` count fallback undercounts UTF-8 in non-ASCII content
- **Severity**: low
- **Location**: `src/api/account-export.shared.ts`
- **Observation**: Fallback `json.length` undercounts UTF-8 bytes for accents/emoji. `bytes` is consumed only in mutation return value, not displayed.
- **Suggested fix**: Use `new TextEncoder().encode(json).length` (matches `ics.web.ts` pattern).
- **Disposition**: Park.

### L3 — Web vs native `AccountExportResult` divergence
- **Severity**: low
- **Location**: `account-export.web.ts` vs `account-export.native.ts`
- **Observation**: Web result is `{ filename, bytes, shared: true }`; native is `{ filename, uri, bytes, shared: boolean }`. Stub re-exports the web type; future consumer reading `result.uri` would not type-check on web. Same divergence exists in `ics.ts` family.
- **Disposition**: Park; pre-existing pattern.

### L4 — `useDebouncedCallback` JSDoc warns against effect-cleanup flush but doesn't enforce
- **Severity**: low (informational)
- **Location**: `src/lib/hooks/useDebouncedCallback.ts`
- **Observation**: The "WARNING: Do NOT call `.flush()` from a `useEffect` cleanup" comment is correct. Phase 10 is clean (only `onBlur` callers).
- **Disposition**: No action.

### L5 — Settings spacer may collapse on narrow viewports
- **Severity**: low (pre-existing)
- **Location**: `app/(app)/settings.tsx`
- **Observation**: `<View style={{ flex: 1 }} />` spacer pushes buttons to bottom; on narrow viewports with overflow, buttons may stack below the email row. Pre-existing Phase 7 layout.
- **Disposition**: Park.

## Adversarial mental model — verified

1. **Forged `userId` in body**: function never reads `req.body` for identifiers. PASS.
2. **Malformed JWT**: `auth.getUser(token)` returns error; 401 before any admin client created. PASS.
3. **User A's JWT trying to read User B's trips**: `userId` derived server-side from JWT `sub`; attacker can't influence; child-table filter list comes from JWT-scoped trips query, not request. PASS.
4. **Expired JWT**: same as malformed; 401. PASS.
5. **Replay with old session token**: bounded by Supabase Auth TTL. PASS.
6. **CORS bypass**: response without `Access-Control-Allow-Origin` is unreachable to attacker page; function doesn't branch logic on origin. PASS.

## Sign-off

**SHIP.**

No critical, high, or medium findings. Cross-tenant filter chain is sound. Service-role usage contained to Edge Function. Logging row-counts-only. Platform splits proven. `useDebouncedCallback` extension is additive and unmount-cleanup safety preserved. ADR-0009 reflects what shipped. Five low parks; none gate Step 10.9.

## Files referenced

- `supabase/functions/export-account/index.ts`
- `supabase/functions/delete-account/index.ts` (parity reference)
- `supabase/functions/_shared/{cors,errors,logger,supabase-admin}.ts`
- `src/api/account-export.{shared,web,native,ts}`
- `src/api/index.ts`
- `src/api/types.ts`
- `src/api/ics.{web,ts}` (parity references)
- `src/lib/hooks/useDebouncedCallback.ts`
- `app/(app)/trip/[id]/index.tsx`
- `app/(app)/settings.tsx`
- `docs/adr/0009-account-data-export.md`
- `docs/reviews/phase-9.md` (format reference)
