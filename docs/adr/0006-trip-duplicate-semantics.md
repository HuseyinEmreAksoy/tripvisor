# ADR-0006: Trip duplicate semantics — clone places, not legs/days

**Status**: Accepted
**Date**: 2026-04-25

## Context

The user wants a "Duplicate" action on each trip card. The schema has four child relations: `trip_places` (the user's curated stops), `trip_legs` (Google-derived directions cache), `trip_days` (computed grouping with `day_index` / `order_in_day`), and `trip_shares` (anonymous read-only tokens). We need a clear rule for which children clone and which recompute, both for correctness (Google ToS forbids persisting derived data beyond 30 days, and stale legs from one trip would never apply to a copy with shifted geometry anyway) and for product simplicity (the user expects a fresh, recomputable trip).

## Decision

1. Clone `trip_places` per source row, copying `google_place_id`, `lat`, `lng`, `user_title`, `category`, `visit_duration_minutes`, `notes`. Reset `day_index` and `order_in_day` to `null` so the optimizer re-places them on next run.
2. Do NOT clone `trip_legs` — they are Google-derived (Routes API output) and rebuilt on optimize.
3. Do NOT clone `trip_days` — they are computed projections of places + budget.
4. Do NOT clone `trip_shares` — share tokens are unique per trip; copying them would create dual-source links which is a security concern.
5. Reset `archived_at = null` on the new trip even if the source is archived (the user's intent is "give me a fresh editable copy").
6. Reset `anchor_place_id = null` because the source anchor is a row in the source's `trip_places`; resolving it to the new copy's matching place is non-trivial and the user can re-pick. Documented as an explicit trade-off so a future change can revisit.
7. New trip title = `<source.title> || ' (copy)'`.

## Alternatives considered

- *Clone everything including legs.* Rejected: legs are Google-derived; persisting beyond their TTL violates Google ToS, and they'd be wrong for any future place edit anyway.
- *Resolve the new anchor by matching `google_place_id`.* Rejected for v1: requires a second lookup pass and the matching could be ambiguous if a place appears twice in the source. The cost of "user re-picks the anchor" is one tap.
- *Clone shares.* Rejected for security: token reuse across two trips means a single revoke can't sever both, and the URL-token-to-trip mapping must stay 1:1.

## Consequences

- Pros: simple SQL, ToS-safe, deterministic.
- Cons: the duplicate has zero days / zero legs until the user runs Optimize — that's expected, but the UI should communicate "duplicated trip — run Optimize to schedule" if users find it confusing. (Out of scope for this ADR; Step 7.5/7.8 may add an inline hint.)
- The `duplicate_trip` RPC is `security definer` and gates ownership via `auth.uid() = source.user_id`; this is the only authorization surface for duplication.
