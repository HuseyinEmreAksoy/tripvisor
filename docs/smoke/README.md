# Smoke logs

Per-phase live smoke results, one file per phase.

## Running

```
# Headless — prints pass/fail inline
npm run smoke

# Headed — see the browser drive the flow
npm run test:e2e:headed

# Single phase
npx playwright test e2e/web/phase-1-auth.spec.ts
```

Playwright boots Expo via the `webServer` entry in `playwright.config.ts`. If you already have `npm run web` running, it reuses that server.

## Status legend

- 🟢 **Green** — all exit criteria verified
- 🟡 **Partial** — some checks pass, others blocked
- ⏸ **Blocked** — prerequisites unmet (usually env + live backend)
- 🔴 **Red** — a blocker was found and filed

Each file records the build SHA and the exact specs that ran, so you can reproduce the result later.
