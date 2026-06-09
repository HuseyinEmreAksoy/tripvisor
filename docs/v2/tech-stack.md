# Tripvisor v2 — Tech Stack (free-only evaluation)

> **Status:** v2 (2026-06-09), reconciled with the multi-agent design pass + critic.
> Constraint: **everything free** ($0 ceiling at hobby scale). "Open to bigger swaps" per user direction.

## Summary table

| Layer | v1 today | v2 choice (free) | Verdict |
|---|---|---|---|
| Framework | Expo SDK 52, React 18 | **Expo SDK 54 + React 19.1 + New Arch**, via a **two-step 52→53→54** upgrade | Upgrade (staged) |
| Routing/nav | Expo Router v4 | **Expo Router (latest)** | Keep |
| State (durable) | TanStack Query + AsyncStorage persister | **Legend-State v3** + **expo-sqlite** + `syncedSupabase` plugin | Swap |
| State (ephemeral) | TanStack Query | **Keep TanStack Query** for Google/optimizer reads (ToS firewall) | Keep |
| Backend | Supabase free | **Supabase free** + adopt **Realtime · Storage · pg_cron/pg_net** | Keep + adopt more |
| Maps — web | @vis.gl/react-google-maps | **MapLibre GL** via `react-map-gl/maplibre` + **OpenFreeMap** tiles (no key) | Swap |
| Maps — native | react-native-maps (Google) | **Keep react-native-maps + `PROVIDER_GOOGLE`** ($0 native render); MapLibre deferred to New-Arch phase | Keep (defer swap) |
| Routing/matrix | Google Routes API | **Self-host OSRM** (`/table` + `/route`) behind the existing Edge Functions; Google env-flag fallback | Swap (conditional) |
| Charts | hand-rolled SVG | **react-native-gifted-charts** + `react-gifted-charts` (web) | Swap |
| AI / LLM | none | **Gemini 2.5-flash / -flash-lite** (primary) + **Groq `gpt-oss-20b`** (fallback), structured output | New |
| Weather | none | **Open-Meteo** (no key, CC-BY 4.0) | New |
| Geocoding fallback | Google only | **Photon** (primary) + **Nominatim** (secondary), server-side | New |
| Error tracking | Sentry | **Sentry free** (tracesSampleRate 0.1, replay off) | Keep |
| Analytics | none | **PostHog Cloud free** (replay off, ~15 events) — or zero-telemetry Supabase events table | New (opt-in) |
| Push | none | **Expo Push** (native-only) | New |
| Storage | none | **Supabase Storage** (1GB) default; **Cloudflare R2** escape hatch | New |
| Email | Supabase built-in (dev-only ~2–4/hr) | **Resend free** (3,000/mo) as Supabase Auth SMTP | New |
| CI / deploy | — | GitHub Actions + EAS free + Cloudflare Pages + Expo OTA | Keep/new |

---

## Per-layer detail

### Framework — Expo SDK 54 + React 19.1 + New Architecture (two-step upgrade)
- **Why SDK 54:** it's the current stable line (RN 0.81 + React 19.1) and the **last** SDK where New Arch can still be toggled off; SDK 55+ removes legacy arch entirely. `app.json` already sets `newArchEnabled:true` on an un-upgraded React 18 runtime — finishing the migration removes that lie.
- **Two steps, not one:** 52→53 (RN 0.79 + React 19, Reanimated stays v3), validate, then 53→54 (RN 0.81, Reanimated **v3→v4 + react-native-worklets**). A single jump spans two RN majors + the Reanimated break — the documented failure mode.
- **Key risk:** `react-native-maps` custom markers are broken under New Arch on Android (a **pre-existing** bug on the current SDK 52/RN 0.76.9, not an upgrade regression) — the route map is golden-path, so it **must** get a real-device Android smoke. Pin react-native-maps to the New-Arch-first 1.21+ line; evaluate `expo-maps` as a fallback.
- **Migration effort: medium.**

### Charts — react-native-gifted-charts (NOT victory/Skia)
- **Why:** MIT; needs only `react-native-svg` (already a dep) + `expo-linear-gradient`; ships **`react-gifted-charts`** with a shared `gifted-charts-core` so the *same* chart code renders web + native (upholds one-codebase-three-platforms). Covers bar/line/area/pie/donut/stacked — everything analytics + budget need.
- **Rejected victory-native@41:** free, but forces Skia + Reanimated + Gesture Handler peers, inflates bundle, worse universal-web story. Overkill here.

### State / persistence — Legend-State v3 (two-tier split)
- **Tier 1 (durable, offline read+write+sync):** **Legend-State v3** reactive store → **expo-sqlite** (local source of truth) → **`syncedSupabase`** plugin. Owns all editable roots (places, days, legs, expenses, accommodations, reactions, notes) with a durable write-queue + optimistic UI + diff sync.
- **Tier 2 (ephemeral, ToS-restricted):** **keep TanStack Query as-is** for Google place-details/autocomplete/distance/directions + optimize-trip. The existing `shouldDehydrateQuery` allowlist stays the **ToS firewall** (these never hit disk).
- **Conflict policy:** **per-field last-write-wins** keyed on server-stamped `updated_at`, soft-delete via a `deleted` boolean + a `handle_times()` trigger. **NOT CRDT** — records are structured and route order is a pure optimizer recompute.
- **Rejected PowerSync:** free instances are **deprovisioned after 7 days idle** — fatal for a holiday planner idle for months. RxDB's Supabase replication is behind a paywall. WatermelonDB's web support is second-class.
- **Effort: medium** (biggest rebuild; sequence after the god-screen split).

### Backend — keep Supabase (free), adopt the dormant features
- Keep the gold: `user_can_access_trip()` RLS helper, the **10** Edge Functions, the 18-migration schema core.
- **Newly adopt (already free, unused today):** **Realtime** (co-edit + sync), **Storage** (docs/photos), **pg_cron + pg_net** (30-day Google-ToS leg purge, analytics materialized view to fix the 10-trip cap, a heartbeat to defeat the 7-day pause).
- **Free-tier (verified):** 500MB DB, 1GB Storage, 5GB egress/mo, 200 Realtime peak conns + 2M msgs/mo, 500k Edge invocations/mo, **2 projects/org**, **auto-pause after 7 days idle**. Comfortable at hobby scale; the pause + 2-project cap are the watch-items. **Effort: low.**

### Maps + routing — split web/native, self-host OSRM (conditional)
- **Web:** **MapLibre GL** via `react-map-gl/maplibre` + **OpenFreeMap** vector tiles (no key, no quota). MapTiler free tier as optional styled fallback.
- **Native:** **keep react-native-maps + `PROVIDER_GOOGLE`** — native SDK rendering is **$0** (only the web Maps JS + Routes/Places HTTP bill the credit). Defer the native MapLibre swap (`@maplibre/maplibre-react-native` v11 needs New Arch + RN ≥0.80) to the SDK-upgrade phase; track as native-only debt.
- **Routing (the optimizer's real dependency):** **self-host OSRM** (`osrm-backend`) for one region's OSM extract; point the existing `distance-matrix` Edge Fn at OSRM `/table` and `directions-polyline` at `/route`. **Edge Function contracts stay identical → nothing client-side changes.** Google Routes stays behind an env flag as fallback.
- **⚠ See risks-and-decisions:** OSRM-on-free-compute is the **biggest mislabeled cost/availability risk** (Oracle Always-Free ARM is hard to get + reclaims idle VMs; the fallback re-introduces Google billing). Honest alternative: **openrouteservice free API** (2,000 directions/day, 50×50 matrix, needs a key) as primary. Decide ownership before committing.

### AI / LLM — Gemini 2.5-flash (primary) + Groq gpt-oss-20b (fallback), with grounding
- **Primary:** Gemini `gemini-2.5-flash` (generation) + `gemini-2.5-flash-lite` (edits/suggestions) via `@google/genai`, in a new `ai-itinerary` Edge Function. Use **`responseSchema` structured output** locked to a zod shape. *(Note: Gemini 2.0 Flash shut down ~June 2026 — pin to 2.5-series.)*
- **Fallback:** Groq **`openai/gpt-oss-20b`** with strict `json_schema`. **Not Llama 3.3 70B** — it only has loose JSON mode on Groq.
- **Grounding loop (critical):** the LLM proposes place **names**; the server round-trips each through the existing **places-autocomplete → place-details** chain to get a real `google_place_id` + lat/lng. **LLM coordinates are never trusted or persisted.** Then `OptimizerPlace[]` → existing optimizer.
- **Free-tier:** Gemini ~250 RPD (flash) / 1,000 RPD (flash-lite), no card; Groq 1,000 RPD independent. Plenty for hobby use.
- **⚠ Two cost/ToS catches** (see risks-and-decisions): (1) free-tier Gemini **may train on prompts** → send only user text + place names; (2) the **grounding calls are Google-metered** against the $200 credit — "AI is free" only while grounding stays under the credit.

### Supporting (all free)
- **Weather:** **Open-Meteo** — free, **no key**, commercial-friendly (CC-BY 4.0 attribution). Drives rainy-day indoor swaps via `precipitation_probability_max` / `weathercode`.
- **Geocoding fallback:** **Photon** (Apache-2.0, autocomplete-friendly) primary + **Nominatim** (1 req/s, no autocomplete) secondary — server-side only, low traffic.
- **Analytics:** **PostHog Cloud free** (1M events/mo, replay **off**, ~15 explicit events). Self-host is *not* free (ClickHouse/Kafka). Zero-telemetry alternative: a Supabase events table.
- **Error tracking:** **Sentry free** (5k errors/mo, tracesSampleRate 0.1, replay off). GlitchTip self-host only if you exceed it.
- **Push:** **Expo Push** — free, **native-only** (web push out of scope; scope it explicitly).
- **Storage:** **Supabase Storage** (1GB) default; **Cloudflare R2** (10GB, $0 egress) escape hatch. Downscale images client-side before upload.
- **Email:** **Resend free** (3,000/mo, 100/day) wired as Supabase Auth SMTP — Supabase's built-in sender is **dev-only** (~2–4/hr). Config-only, no code.
- **CI/deploy:** GitHub Actions (free), **EAS Build (30 builds/mo TOTAL)** ⚠, Cloudflare Pages, Expo OTA.

---

## Cost watch-items (things that could break $0)

1. **EAS native build minutes — the #1 risk.** 30 builds/mo total across iOS+Android; native config changes (expo-sqlite, expo-notifications, SDK bumps, Reanimated v4) **cannot** ship via free OTA. The two-step SDK upgrade + native parity phases are build-heavy. Mitigate: native builds only on tagged releases; OTA for JS-only; run TS/lint/jest/Playwright in GitHub Actions.
2. **OSRM availability** (see above) — self-host on free compute is fragile; the fallback re-introduces Google billing.
3. **AI grounding is Google-metered** — itinerary generation bills places-autocomplete + place-details against the $200 credit.
4. **Supabase 7-day pause + 2-project cap** — pg_cron heartbeat; one prod + one staging only.
5. **Supabase egress / Storage** — polyline-heavy `trip_legs` syncing to multiple devices + per-trip PMTiles slices can move real bytes; keep tiles in `expo-file-system`, not Storage.
6. **LLM free-tier quotas** can shrink (Gemini cut 50–80% Dec 2025) — keep the provider-abstraction layer (swap Gemini↔Groq).

See also: [`architecture.md`](architecture.md) · [`features.md`](features.md) · [`migration.md`](migration.md) · [`risks-and-decisions.md`](risks-and-decisions.md) · [`../../plan-v2.md`](../../plan-v2.md)
