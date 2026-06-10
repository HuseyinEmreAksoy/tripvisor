# ai-itinerary

"Plan my trip" AI core (v2 Phase N3). The LLM proposes place **names**, Google Places **grounds** them into real `google_place_id` + lat/lng, and the result lands as a **DRAFT** — this function **never writes `trip_places`**. The client's draft-review screen commits accepted places through the normal hooks (and the pure optimizer day-splits/orders on commit).

## Contract

| method      | auth     | body                                                                                  | response                                  |
| ----------- | -------- | ------------------------------------------------------------------------------------- | ----------------------------------------- |
| `POST`      | required | `{ prompt (10..2000), tripId?, days? (1..14), destination?, idempotencyKey (8..64) }` | `{ runId, status, draft, usage }`          |
| `GET ?ping` | none     | none                                                                                   | `{ ok: true, fn: "ai-itinerary" }`        |

Success response (`200`):

```jsonc
{
  "runId": "uuid",                  // trip_ai_runs.id
  "status": "ok" | "partial",       // partial = unresolved.length > 0
  "draft": {
    "places": [
      {
        "name": "Louvre Museum",    // canonical Google displayName (falls back to the LLM name)
        "googlePlaceId": "ChIJ…",
        "lat": 48.8606,
        "lng": 2.3376,
        "visitMinutes": 150,        // LLM estimate, validated 15..480
        "category": "museum",       // or null
        "dayHint": 1                // 1-based suggested day, clamped to 1..dayCount
      }
    ],
    "unresolved": ["Café de l'Imaginaire"],  // names Google couldn't find — user fix-up, NEVER silently dropped
    "notes": "…or null",                      // optional LLM trip-level note
    "dayCount": 3
  },
  "usage": { "runsToday": 4, "dailyLimit": 10 }
}
```

## Error codes

| code                 | status | meaning                                                                              |
| -------------------- | ------ | ------------------------------------------------------------------------------------ |
| `invalid_input`      | 400    | Body failed Zod validation, or `tripId` is unknown / not visible to the caller       |
| `not_authenticated`  | 401    | Missing or invalid bearer JWT                                                        |
| `method_not_allowed` | 405    | Non-POST to non-ping path                                                            |
| `quota_exceeded`     | 429    | `ai_usage.ai_runs >= 10` for today (UTC day buckets)                                 |
| `ai_misconfigured`   | 500    | No LLM key (`GEMINI_API_KEY`/`GROQ_API_KEY`) or no `GOOGLE_MAPS_SERVER_KEY`          |
| `db_error`           | 500    | Postgres read/write failure                                                          |
| `llm_failed`         | 502    | Both LLM providers failed (HTTP error / timeout / unparseable or empty JSON)         |
| `upstream_timeout`   | 504    | Grounding transport failure: zero names resolved AND ≥1 Google call errored/timed out (transient — retry; nothing was persisted) |

## Pipeline

1. **Idempotency replay** — `SELECT trip_ai_runs` by `(user_id, idempotency_key)`; a hit with status `ok`/`partial` returns the stored draft with **zero** LLM/grounding spend. Concurrent duplicates converge via the UNIQUE constraint (the loser's insert hits 23505 and returns the winner's draft).
2. **Quota** — today's `ai_usage.ai_runs >= 10` → 429. Read-then-spend (soft guard; the ledger always records true spend).
3. **LLM** — primary **Gemini 2.5 Flash** (`generationConfig.responseSchema`, JSON mime) with 20s timeout; on 4xx/5xx/timeout/garbage falls back to **Groq `openai/gpt-oss-20b`** (`response_format: json_schema, strict`). Output schema deliberately has **no lat/lng — LLM coordinates are never trusted or used**.
4. **Grounding** — each unique name: Places (New) `:autocomplete` (input = `"<name>, <destination>"` for text location bias) → `:get` with field mask **`id,location,displayName` only**, one session token per name (the pair bills as one Details session). Batched 5 names per batch, max 2 batches in flight. Unresolved names go to `unresolved[]` (partial-grounding UX). Duplicate names / duplicate resolved place-ids collapse to one draft entry.
5. **Persist** — `increment_ai_usage(userId, 1, <details calls>, 0)` via the service-role RPC, then INSERT `trip_ai_runs` **under the caller's JWT** (RLS-enforced, append-only). Failed runs (llm_failed / 504) increment the ledger but write **no** row — the idempotency key stays free for the retry (see migration `0020` §b).

## Data-minimization & Google ToS (D4 — ACCEPTED)

- The LLM payload contains **only**: the user's prompt, the destination string, and the day count. **No Google-derived content ever reaches an LLM.**
- The persisted draft contains only ToS-durable fields: names, `google_place_id`, lat/lng, visitMinutes, category, dayHint. **Never** ratings/reviews/photos/hours/phone/website/attributions (the grounding field mask can't even fetch them).
- `trip_ai_runs.prompt_hash` is a sha256 hex digest — the raw prompt is never persisted, and structured logs log the hash, not the prompt.

## Quota & ledger

`ai_usage` (migration `0020` §c) is the C4 quota table **and** the usage ledger from day one: `ai_runs` increments whenever an LLM call was actually dispatched (success or failure), `grounding_calls` counts Google-metered `:get` details calls. `DAILY_PLAN_LIMIT = 10` lives in this function, not the DB. UTC day buckets.

## Secrets (Edge Function secrets — never bundled)

| name                     | required | purpose                                  |
| ------------------------ | -------- | ---------------------------------------- |
| `GEMINI_API_KEY`         | ≥1 of 2  | Primary LLM (Gemini 2.5 Flash free tier) |
| `GROQ_API_KEY`           | ≥1 of 2  | Fallback LLM (gpt-oss-20b free tier)     |
| `GOOGLE_MAPS_SERVER_KEY` | yes      | Grounding (Places API New)               |

```sh
npx supabase secrets set GEMINI_API_KEY=... GROQ_API_KEY=...
```

## Local dev

```sh
npx supabase functions serve ai-itinerary --env-file supabase/functions/.env
```

```sh
# Happy path
curl -s -X POST 'http://127.0.0.1:54321/functions/v1/ai-itinerary' \
  -H "Authorization: Bearer $USER_JWT" -H 'Content-Type: application/json' \
  -d '{"prompt":"3 relaxed days in Lisbon, food and history","days":3,"destination":"Lisbon","idempotencyKey":"demo-key-0001"}'

# Replay (same key) — returns the stored draft, no LLM/grounding spend
curl -s -X POST 'http://127.0.0.1:54321/functions/v1/ai-itinerary' \
  -H "Authorization: Bearer $USER_JWT" -H 'Content-Type: application/json' \
  -d '{"prompt":"3 relaxed days in Lisbon, food and history","days":3,"destination":"Lisbon","idempotencyKey":"demo-key-0001"}'

# 400 invalid_input (prompt too short)
curl -s -X POST 'http://127.0.0.1:54321/functions/v1/ai-itinerary' \
  -H "Authorization: Bearer $USER_JWT" -H 'Content-Type: application/json' \
  -d '{"prompt":"Lisbon","idempotencyKey":"demo-key-0002"}'

# 401 not_authenticated
curl -s -X POST 'http://127.0.0.1:54321/functions/v1/ai-itinerary' \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"3 relaxed days in Lisbon, food and history","idempotencyKey":"demo-key-0003"}'

# 429 quota_exceeded — 11th call of the (UTC) day for the same user
```

## Client

`src/api/ai.ts` — `useGenerateItinerary()` mutation + `AiError` (extends the shared `EdgeFunctionError`). The hook auto-generates `idempotencyKey` per `mutate()` call; **callers that implement "try again" UX should hold one key per planning intent and pass it explicitly** so a client-side timeout retry replays the stored draft instead of double-billing.

## Migrations

Depends on `0020_v2_ai_and_day_start.sql` (`trip_ai_runs`, `ai_usage`, `increment_ai_usage()`), `0011_trip_collaborators.sql` (`user_can_access_trip` used by the `trip_ai_runs` insert policy).
