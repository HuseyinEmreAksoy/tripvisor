# Tripvisor v2 — UX Principles (user-first)

> **Status:** v2 (2026-06-09). **Load-bearing.** Tripvisor is a real product real users will use — not a tech demo. Every phase and feature is judged against these. A technically-correct feature that is rigid or confusing is **not done**.

## The core loop (must be flexible + user-friendly)

```
 choose places  →  see reviews / comments  →  find OR adjust the optimal route on the map
        ▲                                                             │
        └─────────────────────  edit freely, re-route, undo  ◄────────┘
```

Everything else (AI, offline, weather, packing, docs) wraps this loop. If a change makes any leg of it slower, stiffer, or more confusing, it's a regression.

## Per-flow requirements

### 1. Choose places — fast & forgiving
- Instant autocomplete (session-token cheap), recent places, AI/nearby suggestions.
- Flexible add: pick the day with chips, stay on screen after adding, inline "added to Day N" feedback, one-tap "add another / switch day".
- Forgiving: easy remove, **undo**, duplicate-place warning, no dead ends.

### 2. See reviews / comments — readable & trustworthy
- Google reviews easy to scan: expandable long reviews, author + time + photo, "Powered by Google" + per-review attribution (ToS).
- Collaborator voice: per-place **reactions** (👍/👎) and **notes/comments** visible inline, so a group can weigh in. Keep it lightweight.
- Reviews/photos stay **Tier-2 (memory-only)** — never persisted (ToS firewall).

### 3. Find OR adjust the optimal route on the map — auto, but fully editable
- **Find:** one tap to auto-optimize (k-means + 2-opt) within the daily time budget; clear per-day colored path on the map.
- **Adjust (this is the "flexible" heart):** drag-to-reorder within a day, move places between days, lock per-day start/end anchors, toggle **"Best route" vs "My order"**, and **re-route automatically** after any edit.
- Map is **load-bearing**: pins + polylines must render correctly (web + native); per-day filter; broken maps/keys are blockers, not warnings.
- Honor server-authoritative order (C1): optimistic on the map immediately, confirmed by the server.

## Cross-cutting (every screen)
- **Explicit navigation** — visible back affordances; never stuck.
- **Desktop-aware web** — not a stretched mobile screen.
- **Fast & responsive** — optimistic UI, skeletons, no jank.
- **Forgiving** — undo, confirmations on destructive actions, clear empty/loading/error states.
- **Accessible** — WCAG 2.2 AA; labels, focus, contrast, reduced motion.
- **Travel-product feel** — destination imagery, strong hierarchy.

## How this binds the plan
- **Phase 6** (nav backbone + god-screen split) and **Phase 9** (maps) are where flow 3 gets its flexibility; **Phase 7–8** (AI) must feed *editable* drafts, never locked itineraries.
- New features in any phase get a "flexible & user-friendly?" check in their feature doc before they're marked Done.

See also: [`features.md`](features.md) · [`conventions.md`](conventions.md) · [`../../plan-v2.md`](../../plan-v2.md)
