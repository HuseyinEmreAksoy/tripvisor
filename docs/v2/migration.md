# Tripvisor v2 — Migration Path (v1 → v2)

> **Status:** Draft v2 (2026-06-09). v2 is a **greenfield redesign that reuses the proven core** — not a throwaway rewrite. This doc maps how today's 26-phase codebase becomes v2 incrementally, keeping the app shippable throughout.

## Principle

Migrate **in place, layer by layer**, behind flags where risky. Never break the golden path. The
optimizer, RLS, Edge Functions, and schema core travel forward untouched; the state layer, screens,
maps, and cost model are the things that actually change.

## What travels forward unchanged (reuse the gold)

- `src/lib/optimizer/**` — pure k-means + 2-opt (extended, not replaced).
- RLS policies + `user_can_access_trip()` + `enforce_trips_column_restrictions`.
- Edge Function proxies: `places-autocomplete`, `place-details`, `place-photo`, `distance-matrix`, `directions-polyline`, `optimize-trip`, `manage-collaborators`, `share-trip`, `delete-account`, `export-account`.
- Supabase schema core: `trips` + child tables.
- `src/theme/**` design tokens; magic-link auth.

## What changes (and how)

### 0. Existing v1 on-device data (don't strand current users)
- v1 users carry an **AsyncStorage-persisted TanStack cache** (3 roots) + Supabase rows. v2 retires those persister keys and adds `created_at/updated_at/deleted` + a `handle_times()` trigger (replacing `set_updated_at`), plus `created_at/updated_at` on `trip_days` (none today).
- On first v2 launch: **ignore the legacy persister cache** (server is the truth), hydrate Legend-State from Supabase, then enable offline. Any unsynced legacy local state is best-effort — document the one-time reconciliation. No silent data loss for server-stored trips.

### 1. State layer: TanStack Query → Legend-State (local-first) — biggest lift
- Introduce a Legend-State store persisted to expo-sqlite/MMKV as the UI's source of truth.
- Wrap each existing `src/api/` entity behind the store + Supabase sync plugin **one entity at a time** (trips → places → days → legs → expenses → accommodations → notes → reactions).
- Keep TanStack Query permanently for ToS-restricted Google/optimizer reads (the two-tier split); remove it only for the durable user tables now owned by Legend-State.
- Conflict policy: **per-field LWW** on server-stamped `updated_at` + soft-delete `deleted`. **Order (C1, refined):** user-intent order = `manual_rank` (client-writable, LWW, offline-safe); optimizer-computed `day_index`/`order_in_day`/`trip_legs` are server-only — reconnect runs optimize-trip's manual branch over `manual_rank`; offline drag is never reverted.

### 2. Cost model: remove `cost_per_km`
- Replace every live use first (so the column becomes dead before it's dropped):
  - `src/components/DaySummaryCard.tsx` (cost chip → time metrics)
  - `src/components/TripCostRollup.tsx` (→ category `trip_expenses` rollup)
  - `app/(app)/trip/[id]/print.tsx` (`/km` line)
  - `src/lib/tripsFilters.ts` (trips "Cost" sort → category total or remove)
  - `app/(app)/trip/[id]/index.tsx` (editable settings input)
- Then a migration drops `trips.cost_per_km` and the type field in `src/api/types.ts`.

### 3. Navigation/IA: split the god-screen
- `app/(app)/trip/[id]/index.tsx` (**2442 lines**) → route segments/components (map / itinerary / settings / budget / collaborators) — sequenced **before** the Legend-State migration (N1 before S2).
- Add a Home/Discover surface hosting "Plan my trip".
- Desktop-aware layouts per key screen.

### 4. Maps + routing: split web/native; route via free engine behind existing Edge Fns
- **Web:** add a MapLibre `Map.web.tsx` (`react-map-gl/maplibre` + OpenFreeMap) behind the existing `MapViewProps` abstraction; switch via env flag. (More than cosmetic — dayColor palette, dashed-transit lines, marker press, region fitting all differ from Google's API.)
- **Native:** keep `Map.native.tsx` on react-native-maps + `PROVIDER_GOOGLE` ($0 render); defer the native MapLibre vector swap to the New-Arch phase (track as native-only debt).
- **Routing:** re-point `distance-matrix` (→ OSRM `/table` or ORS matrix) and `directions-polyline` (→ `/route`) — **contracts unchanged, nothing client-side moves**. Add a health-check + auto-failover; Google stays env-flag fallback (decision C2).
- Add offline web tiles to `expo-file-system` for the trip region.

### 5. Framework: Expo SDK 52 → 54 + React 19 + New Architecture
- Audit native deps for New-Arch compatibility (maps, reanimated, gesture-handler) **before** flipping.
- Once on R19, replace hand-rolled SVG charts with **react-native-gifted-charts** (+ `react-gifted-charts` for web).

### 6. New surfaces (additive)
- `ai-plan` / `ai-edit` / `weather` Edge Functions.
- `trip_documents`, `trip_packing_items`, `trip_meals`, `trip_ai_runs` tables (+ RLS).
- Realtime presence/co-edit (reuses the sync layer).

## Data migrations (ordered)

1. Add new child tables (`trip_documents`, `trip_packing_items`, `trip_meals`, `trip_ai_runs`) + RLS.
2. Add optimizer time-window fields to `trip_places`.
3. Backfill any defaults.
4. **After** UI no longer reads `cost_per_km`: drop the column + type field.
5. Add Storage buckets (documents, tiles) with RLS policies.

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Legend-State migration destabilises data flow | High | Migrate one entity at a time behind a flag; keep TanStack until parity proven; RLS unchanged. |
| New-Arch breaks a native lib | High | Pre-upgrade compatibility audit; pin known-good versions; stage on a branch. |
| Free routing (ORS) rate limits during optimize | Medium | Cache legs in `trip_legs` (already 30-day TTL); OSRM self-host fallback; Google fallback flag. |
| EAS free build minutes exhausted | Medium | Batch native builds; OTA for JS-only changes. |
| Dropping `cost_per_km` before all reads removed | Medium | Column drop is the **last** step, gated on a grep proving zero reads. |
| Supabase project pause | Low | `pg_cron` keep-alive; periodic use. |

## Sequencing

The migration aligns 1:1 with the phased plan in [`../../plan-v2.md`](../../plan-v2.md): foundation/state-layer
and cost-model removal land first (so the base is clean), then AI, offline, maps, depth, optimizer,
realtime, native parity, and polish stack on top.

See also: [`architecture.md`](architecture.md) · [`features.md`](features.md) · [`tech-stack.md`](tech-stack.md)
