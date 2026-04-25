# Testing

Last updated: 2026-04-25 (Phase 19 — test restoration)

## Test runners at a glance

| Runner | Command | What it covers | Env required |
|---|---|---|---|
| Jest | `npm test` | Unit, component, and integration suites in `src/` and `tests/` | Optional — integration suites skip when Supabase env vars are absent |
| Deno (Supabase) | `deno test` inside each `supabase/functions/<fn>/test.ts` | Edge Function logic (end-to-end against a real running function) | Local Supabase stack + Google Maps keys |
| Playwright | `npm run test:e2e` | Web golden-path E2E via browser automation | Local dev server running on port 8081 |

---

## Jest

### Running without env

```
npm test
```

All 21 pure suites run. The 4 integration suites (`tests/rls.test.ts`, `tests/rls.share.test.ts`, `tests/rls.trip-places-legs.test.ts`, `tests/rpc.test.ts`) skip themselves when `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are absent. Expected result: 25 suites, 4 skipped, 241 tests passing.

### Running with local Supabase env

Start the local stack first:

```
npx supabase start
```

Then set the env vars (copy from `supabase status` output):

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<service_role key from supabase status>
```

Then run:

```
npm test
```

Expected result: 25 suites, 0 skipped, 278 tests passing.

### Suite inventory (Phase 19 baseline)

| Suite | Phase covered | Location |
|---|---|---|
| `src/lib/__tests__/recentPlaces.test.ts` | 17 — AsyncStorage CRUD (getRecentPlaces, addRecentPlace LRU + dedup, clearRecentPlaces) | Pure unit |
| `src/lib/__tests__/markdown.test.ts` | 9 — linear-pass tokenizer: bold/italic/links (XSS rejection), UL/OL, multi-line, inline markup in lists | Pure unit |
| `src/lib/__tests__/tripsFilters.test.ts` | 11 + 12 — applySearch, applyDateFilter (all 3 modes), applySort (all 4 modes incl. cost) | Pure unit |
| `src/lib/__tests__/buildSummary.test.ts` | 14 — share unfurl summary string: empty/dates/no-dates/singular-plural/fractional hours/200-char cap | Pure unit |
| `src/api/__tests__/optimizeError.test.ts` | 16 — OptimizeError class + envelope shape contract (8 codes + invalid shapes) | Pure unit |
| `src/components/__tests__/humanizeDuration.test.ts` | 8 — cost rollup time-format helper | Pure unit |
| `tests/rpc.test.ts` | 13 — row-mutex RPCs: claim/release/TTL-expiry/stale-recovery | Integration (skips without env) |
| `tests/rls.test.ts` | 1 — trips RLS two-user isolation | Integration (skips without env) |
| `tests/rls.share.test.ts` | 4 + 19 — trip_shares RLS design: no-SELECT-policy behavior, revoke admin path | Integration (skips without env) |
| `tests/rls.trip-places-legs.test.ts` | 1 + 2 — trip_places and trip_legs RLS isolation | Integration (skips without env) |
| Optimizer unit + property | 2 — kmeans-2opt correctness, fast-check property tests | Pure unit |

### Config: `jest.config.js`

Key settings established in Phase 19:

- `transformIgnorePatterns`: includes `@react-navigation/.*` so navigation packages are transformed by Babel for Jest.
- `moduleNameMapper`: `@react-native-async-storage/async-storage` mapped to the in-memory mock at `src/__mocks__/async-storage.ts`.
- `testEnvironment`: `jsdom` for component suites; integration suites use the default node env (set per-file via `@jest-environment node` docblock).

---

## Lazy-init pattern for env-conditional integration suites

Integration suites that require a live Supabase connection MUST use lazy initialization. The anti-pattern is placing `createClient(URL!, SERVICE!, ...)` at describe-body scope: the call executes before Jest processes `describe.skip`, causing the suite to throw at load time even when the suite should be skipped.

### Correct pattern

```ts
// At top of file — derive skip flag
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const runIntegration = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

// Lazy client — only created inside beforeAll when env is present
let supabase: ReturnType<typeof createClient>;

const maybeDescribe = runIntegration ? describe : describe.skip;

maybeDescribe('My integration suite', () => {
  beforeAll(() => {
    supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  });

  it('does something', async () => {
    // use supabase here
  });
});
```

This pattern is now used in all four integration suites. Do not place `createClient` at module scope in any test file.

---

## Deno / Edge Function tests

Each Edge Function has its own Deno test file at `supabase/functions/<name>/test.ts`. These run against a locally served function:

```
npx supabase functions serve <name>
deno test --allow-net supabase/functions/<name>/test.ts
```

Google Maps keys are required for functions that proxy the Places or Routes APIs. Functions with a `?ping` handler can be smoke-tested without keys.

---

## Playwright (E2E, web only)

```
npm run test:e2e
```

Requires the Expo web dev server running (`npm run web`) and the full Supabase + Google Maps env. Specs live in `e2e/web/`. The golden-path smoke for each phase is recorded in `docs/smoke/phase-N.md`.

Phase 4 E2E covers: auth, trip CRUD, share link create + open + revoke. Phase 5 added CI infrastructure. Later phases have targeted specs alongside the phase smoke log.
