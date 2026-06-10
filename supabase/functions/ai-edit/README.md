# ai-edit

AI editing, gap-fill suggestions, and import grounding (v2 Phase N4). Every action is **preview-only** — this function **never writes `trip_places` / `trip_days` / `trips`**. The client renders the diff / suggestions / resolved list and commits accepted changes through the normal hooks. Same pipeline DNA as `ai-itinerary`: **the LLM proposes, Google Places grounds, the user decides** (shared plumbing in `supabase/functions/_shared/ai.ts`).

## Contract (action-discriminated body — the manage-collaborators pattern)

| method      | auth     | body                                                                                       | response                                            |
| ----------- | -------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `POST`      | required | `{ action: "edit", tripId, instruction (5..1000), idempotencyKey (8..64) }`                | `{ runId, status, diff, unresolved, usage }`         |
| `POST`      | required | `{ action: "suggest", tripId, dayIndex (0-based), slackMinutes (30..480), idempotencyKey }` | `{ runId, status, suggestions, unresolved, usage }`  |
| `POST`      | required | `{ action: "ground", names (1..30, each 2..120), destination?, idempotencyKey }`            | `{ runId, resolved, unresolved, usage }`             |
| `GET ?ping` | none     | none                                                                                        | `{ ok: true, fn: "ai-edit" }`                        |

### action `edit` — NL edit as a previewable DIFF

```jsonc
// -> 200
{
  "runId": "uuid",                       // trip_ai_runs.id (kind 'edit')
  "status": "ok" | "partial",            // partial = unresolved.length > 0
  "diff": {
    "adds": [                            // grounded AiDraftPlace, same shape as ai-itinerary drafts
      { "name": "Louvre Museum", "googlePlaceId": "ChIJ…", "lat": 48.86, "lng": 2.33,
        "visitMinutes": 150, "category": "museum", "dayHint": 2 }   // dayHint 1-BASED
    ],
    "removes":         [{ "tripPlaceId": "uuid", "name": "Musée d'Orsay" }],
    "moves":           [{ "tripPlaceId": "uuid", "name": "Eiffel Tower", "toDay": 3 }],  // toDay 1-BASED
    "durationChanges": [{ "tripPlaceId": "uuid", "name": "Sainte-Chapelle", "visitMinutes": 60 }],
    "notes": "Swapped the museum as asked."  // or null
  },
  "unresolved": ["Café de l'Imaginaire"],    // add-names Google couldn't ground — user fix-up, never dropped
  "usage": { "runsToday": 4, "dailyLimit": 10 }
}
```

- Names in `removes` / `moves` / `durationChanges` are echoed from the trip's own `user_title`s, so the UI renders the diff without extra joins.
- An **all-empty diff is a valid result** ("nothing to change" is an honest answer); the UI shows "no changes proposed" + `notes`.
- Server-side validation: unknown place ids are dropped (logged), no-op moves/duration changes are pruned, ops on removed places are pruned, adds capped at 10, grounded adds that duplicate an existing trip place are skipped, `dayHint`/`toDay` clamped to `1..maxDay+1` (+1 headroom = "move it to a new day").

### action `suggest` — gap-fill for one day

Input `dayIndex` is the **0-based** `trip_places.day_index` (what the itinerary screen has in hand). Output `suggestions` are `AiDraftPlace[]` with `dayHint = dayIndex + 1` (**1-based**, the AI-surface convention — the commit layer converts back, same as the N3 draft review). Suggestions whose `visitMinutes` exceed `slackMinutes` are dropped server-side; an empty `suggestions` array is a valid honest result ("nothing fits"). Counts as a run (same 10/day quota).

### action `ground` — LLM-free import grounding

**No LLM call on this path** — a pure `autocomplete → details` loop (field mask `id,location,displayName` only) for the import-places feature (pasted names / Takeout-extracted lists → Ideas bucket). `resolved[].name` is the **canonical Google displayName** (exposes wrong groundings in the import review); `unresolved[]` echoes the input names that didn't match. Duplicate inputs resolving to one place collapse to a single entry.

Does **not** consume an AI run. Budgeted instead against `ai_usage.grounding_calls`: **100 grounded names/user/day** (`DAILY_GROUNDING_LIMIT`); the whole batch must fit today's remaining budget or the request is rejected 429 (predictable reject beats a partial mystery). Note `grounding_calls` is the shared Google-metered counter — plan/edit/suggest grounding increments it too, so the budget is deliberately conservative.

## Day-number conventions

| field                          | base    | why                                                            |
| ------------------------------ | ------- | -------------------------------------------------------------- |
| `suggest.dayIndex` (input)     | 0-based | callers read it straight off `trip_places.day_index`            |
| `dayHint` / `toDay` (output)   | 1-based | matches the N3 draft-review convention; client converts on commit |

## Error codes

| code                 | status | meaning                                                                                   |
| -------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `invalid_input`      | 400    | Body failed Zod validation; tripId unknown/not visible; cross-kind idempotency-key reuse  |
| `not_authenticated`  | 401    | Missing or invalid bearer JWT                                                              |
| `method_not_allowed` | 405    | Non-POST to non-ping path                                                                  |
| `quota_exceeded`     | 429    | edit/suggest: `ai_usage.ai_runs >= 10` today · ground: batch exceeds the 100/day budget    |
| `ai_misconfigured`   | 500    | edit/suggest: no LLM key or no Google key · ground: no Google key (LLM keys NOT required)  |
| `db_error`           | 500    | Postgres read/write failure                                                                |
| `llm_failed`         | 502    | Both LLM providers failed (edit/suggest only; transient — retry with the same key)         |
| `upstream_timeout`   | 504    | Grounding transport failure with nothing useful to return (transient; nothing persisted)   |

## Pipeline (per action)

1. **Idempotency replay** — `trip_ai_runs` by `(user_id, idempotency_key)` **+ kind filter** (a key can never replay across action types); a hit replays the stored result with zero LLM/grounding spend. Concurrent duplicates converge via the UNIQUE constraint (23505 → return the winner's row).
2. **Quota** — edit/suggest: shared `ai_runs >= 10` → 429. ground: `grounding_calls + batch > 100` → 429.
3. **Config** — edit/suggest need ≥1 LLM key + the Google key; ground needs only the Google key.
4. **Context (edit/suggest)** — trip + places loaded **under the caller's JWT** (RLS is the access proof; viewer visibility suffices — committing goes through editor-gated client mutations).
5. **LLM (edit/suggest)** — Gemini 2.5 Flash `responseSchema` → Groq `gpt-oss-20b` strict `json_schema` fallback (shared adapter). Output schemas have **no lat/lng** — LLM coordinates are never trusted.
6. **Grounding** — shared batched loop (5 per batch, 2 in flight), one session token per name, field mask `id,location,displayName` only. Biased by a 50km circle at the trip's (or day's) first place **plus** the destination text; ground uses text bias only.
7. **Persist** — `increment_ai_usage` (service-role RPC; edit/suggest: runs=1 + grounding=N; ground: runs=0 + grounding=N) **before** the `trip_ai_runs` insert (user JWT, append-only RLS). Failed runs (502/504) increment the ledger but write **no row** — the idempotency key stays free for the retry.

## Data-minimization & Google ToS (D4/R2 posture)

- LLM payloads carry **only user-authored context**: trip title (destination), place `user_title`s, 1-based day numbers, visit minutes, the instruction / slack. **Never** Google-derived data — no leg durations, ratings, reviews, hours, or coordinates.
- Places are presented to the LLM as opaque aliases `p1..pN`, mapped back server-side — internal UUIDs never reach a third-party LLM, and short ids survive structured output far better than UUIDs.
- Persisted drafts hold only ToS-durable fields (names + `google_place_id` + lat/lng + minutes + category + day hints). The grounding field mask can't even fetch restricted content.
- `prompt_hash` is sha256 hex of the instruction (edit), canonical params (suggest), or the names list (ground) — raw text is never persisted.

## Secrets (Edge Function secrets — never bundled)

| name                     | edit/suggest | ground | purpose                                  |
| ------------------------ | ------------ | ------ | ---------------------------------------- |
| `GEMINI_API_KEY`         | ≥1 of 2      | unused | Primary LLM (Gemini 2.5 Flash free tier) |
| `GROQ_API_KEY`           | ≥1 of 2      | unused | Fallback LLM (gpt-oss-20b free tier)     |
| `GOOGLE_MAPS_SERVER_KEY` | required     | required | Grounding (Places API New)             |

## Local dev

```sh
npx supabase functions serve ai-edit --env-file supabase/functions/.env
```

```sh
# edit — happy path
curl -s -X POST 'http://127.0.0.1:54321/functions/v1/ai-edit' \
  -H "Authorization: Bearer $USER_JWT" -H 'Content-Type: application/json' \
  -d '{"action":"edit","tripId":"<trip-uuid>","instruction":"swap the museum for something outdoors and shorten the tower to an hour","idempotencyKey":"edit-demo-0001"}'

# suggest — fill 90 spare minutes on day 1 (day_index 0)
curl -s -X POST 'http://127.0.0.1:54321/functions/v1/ai-edit' \
  -H "Authorization: Bearer $USER_JWT" -H 'Content-Type: application/json' \
  -d '{"action":"suggest","tripId":"<trip-uuid>","dayIndex":0,"slackMinutes":90,"idempotencyKey":"suggest-demo-0001"}'

# ground — import a pasted list (no LLM, no run consumed)
curl -s -X POST 'http://127.0.0.1:54321/functions/v1/ai-edit' \
  -H "Authorization: Bearer $USER_JWT" -H 'Content-Type: application/json' \
  -d '{"action":"ground","names":["Louvre","Sainte-Chapelle","Le Comptoir du Relais"],"destination":"Paris","idempotencyKey":"ground-demo-0001"}'

# 400 invalid_input (instruction too short)
curl -s -X POST 'http://127.0.0.1:54321/functions/v1/ai-edit' \
  -H "Authorization: Bearer $USER_JWT" -H 'Content-Type: application/json' \
  -d '{"action":"edit","tripId":"<trip-uuid>","instruction":"hi","idempotencyKey":"edit-demo-0002"}'

# 401 not_authenticated (no JWT)
curl -s -X POST 'http://127.0.0.1:54321/functions/v1/ai-edit' \
  -H 'Content-Type: application/json' \
  -d '{"action":"ground","names":["Louvre"],"idempotencyKey":"ground-demo-0002"}'

# 429 quota_exceeded — 11th edit/suggest of the UTC day, or a ground batch
# that doesn't fit the remaining 100/day budget
```

## Client

`src/api/ai.ts` — `useAiEditTrip()`, `useAiSuggest()`, `useGroundPlaces()` mutations, all throwing the shared `AiError`. Hooks auto-generate `idempotencyKey` per `mutate()`; **"try again" UX should hold one key per intent and pass it explicitly** so a client-side timeout retry replays the stored result instead of double-billing. No query invalidation — previews don't change trip state.

## Migrations

Depends on `0021_v2_ai_run_kinds.sql` (widened kind CHECK) on top of `0020_v2_ai_and_day_start.sql` (`trip_ai_runs`, `ai_usage`, `increment_ai_usage()`), `0011_trip_collaborators.sql` (`user_can_access_trip` used by the `trip_ai_runs` insert policy).
