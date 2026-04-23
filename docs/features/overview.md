# Feature Overview

Legend: 📋 Planned · 🚧 In progress · ✅ Done · ⚠ Blocked

| Feature | Status | Phase | Doc |
|---|---|---|---|
| Auth (magic link) | 🚧 In progress | 1 | [auth.md](auth.md) |
| Trip CRUD | 🚧 In progress | 1 | [trip-crud.md](trip-crud.md) |
| Place search (autocomplete) | 🚧 In progress | 1 | [place-search.md](place-search.md) |
| Place details + Google reviews | 🚧 In progress | 1 | [place-details.md](place-details.md) |
| Route optimization (k-means + 2-opt) | 🚧 In progress | 2 | [optimization.md](optimization.md) |
| Day split by time budget | 🚧 In progress | 2 | [day-split.md](day-split.md) |
| Map + polyline visualization | 🚧 In progress | 2 | [map.md](map.md) |
| Manual drag / move-to-day | 📋 Planned | 3 | [manual-edit.md](manual-edit.md) |
| Visit duration override | 📋 Planned | 3 | [visit-duration.md](visit-duration.md) |
| Offline itinerary view | 📋 Planned | 4 | [offline.md](offline.md) |
| Shareable read-only link | 📋 Planned | 4 | [share.md](share.md) |
| .ics calendar export | 📋 Planned | 4 | [ics-export.md](ics-export.md) |
| Sentry error tracking | 📋 Planned | 4 | [sentry.md](sentry.md) |

Per-feature docs are created by `docs-specialist` when a feature moves to 🚧 In progress.

## Post-MVP brainstorm (from `database-schema.jsx`)

`/database-schema.jsx` at project root is a pre-existing React visualization of an earlier, broader brainstorm. Features listed there that are **out of scope for MVP** but worth revisiting:

- Budget tracking per trip / day / stop (estimated vs. actual)
- Trip collaborators (owner / editor / viewer roles, real-time sync)
- Accommodations (hotel bookings linked to specific nights)
- Weather forecast integration + rainy-day indoor alternatives
- Meal planning (breakfast/lunch/dinner tagging, restaurant suggestions near stops)
- Trip journal (photos, notes, auto-generated summary)
- Packing lists (auto-suggested from destination + weather + activities)
- Document storage (tickets, reservations, passport copies)

These should be re-evaluated after Phase 4 ships.
