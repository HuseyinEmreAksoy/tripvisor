# Feature Overview

Legend: 📋 Planned · 🚧 In progress · ✅ Done · ⚠ Blocked

| Feature | Status | Phase | Doc |
|---|---|---|---|
| Auth (magic link) | 🚧 In progress (Phase 20: hero redesign + two-column desktop layout shipped; web verified; iOS/Android deferred to user smoke) | 1, 20 | [auth.md](auth.md) |
| Trip CRUD | 🚧 In progress (Phase 20: time-first copy + `total_budget` column + desktop trips-list grid shipped; web verified; iOS/Android deferred to user smoke) | 1, 20 | [trip-crud.md](trip-crud.md) |
| Place search (autocomplete) + recent places + duplicate warning | 🚧 In progress (Phase 20: `PlacesError` typed error + `server_misconfigured` setup banner shipped; web verified; iOS/Android deferred to user smoke) | 1, 17, 18, 20 | [place-search.md](place-search.md) |
| Place details + Google reviews | 🚧 In progress | 1 | [place-details.md](place-details.md) |
| Route optimization (k-means + 2-opt) | 🚧 In progress (Phase 20: `EdgeFunctionError` base class extracted; `OptimizeError` refactored to extend it; web verified) | 2, 20 | [optimization.md](optimization.md) |
| Day split by time budget | 🚧 In progress | 2 | [day-split.md](day-split.md) |
| Map + polyline visualization (+ per-day chip filter) | 🚧 In progress (Phase 20: Map import shadowing JS Map fixed; desktop split-view; web verified; native deferred to user smoke) | 2, 15, 20 | [map.md](map.md) |
| Manual drag / move-to-day | 🚧 In progress | 3 | [manual-edit.md](manual-edit.md) |
| Visit duration override | 🚧 In progress | 3 | [visit-duration.md](visit-duration.md) |
| Expense tracking (budget + categories) | 🚧 In progress — data layer shipped Phase 20 (migration, RLS, TanStack Query API); UI deferred to Phase 21 | 20 | [expenses.md](expenses.md) |
| Offline itinerary view | 🚧 Code complete · awaiting native smoke | 4 | [offline.md](offline.md) |
| Shareable read-only link | ✅ Done (web verified; iOS/Android deferred to user smoke — Head is web-only no-op, no native re-verification needed for Phase 14 unfurl; Phase 19 fixed share-revoke production bug — tokens that appeared revoked were live until this fix) | 4, 14, 19 | [share.md](share.md) |
| .ics calendar export | 🚧 Code complete · awaiting native smoke | 4 | [ics-export.md](ics-export.md) |
| Sentry error tracking | 🚧 Code complete · awaiting native smoke | 4 | [sentry.md](sentry.md) |
| Empty states (UX polish) | 🚧 Code complete · awaiting native smoke | 4 | See Phase 4 changelog in [plan.md](../../plan.md) |
| Test hardening (coverage, E2E, property, CI) | 🚧 Partial — source fixes + CI workflow shipped 2026-04-25; test expansion deferred | 5 | [test-hardening.md](test-hardening.md) |
| Test restoration (suite back to green; 7 new unit suites; lazy-init pattern) | ✅ Done — 25 suites, 278 tests green (with env), 241 without env; see [testing.md](../testing.md) | 19 | [testing.md](../testing.md) |
| Trip lifecycle (archive / duplicate) | ✅ Done (web; native deferred to user smoke) | 7 | [trip-lifecycle.md](trip-lifecycle.md) |
| Account settings (theme + delete account) | ✅ Done (web; native deferred to user smoke) | 7 | [settings.md](settings.md) |
| Cost & itinerary visibility (rollup, daily summary, print) | ✅ Done (web; native deferred to user smoke) | 8 | [cost-and-print.md](cost-and-print.md) |
| Trip notes / journal (per-place + per-day, Markdown in print) | ✅ Done (web; native deferred to user smoke) | 9 | [notes-journal.md](notes-journal.md) |
| Account data export (JSON) | ✅ Done (web; native deferred to user smoke) | 10 | [account-export.md](account-export.md) |
| Trips list polish (search + sort + Cost sort + date filter All/Upcoming/Past) | ✅ Done (web; native deferred to user smoke) | 11–12 | [trips-list-polish.md](trips-list-polish.md) |
| Per-day map filter (MapTab chip row) | ✅ Done (web verified; native unaffected — shared component code) | 15 | [map.md](map.md) |

Per-feature docs are created by `docs-specialist` when a feature moves to 🚧 In progress.

## Post-MVP brainstorm (from `database-schema.jsx`)

`/database-schema.jsx` at project root is a pre-existing React visualization of an earlier, broader brainstorm. As of 2026-04-25, three items from that brainstorm have been promoted into the active roadmap (`plan.md` Phase 21): budget tracking, trip collaboration, and accommodation tracking. The remaining items below are still out of scope for MVP but worth revisiting:

- Weather forecast integration + rainy-day indoor alternatives
- Meal planning (breakfast/lunch/dinner tagging, restaurant suggestions near stops)
- Trip journal (photos, notes, auto-generated summary)
- Packing lists (auto-suggested from destination + weather + activities)
- Document storage (tickets, reservations, passport copies)

These should be re-evaluated after Phase 4 ships.
