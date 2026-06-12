---
name: v2-commit-log
description: v2-era commit records starting at v2 Phase 0 checkpoint (2026-06-09) — SHAs, split rationale, push policy, leftover artifacts to gitignore
metadata:
  type: project
---

# Tripvisor v2 — git-committer commit log

v1 records (Phases 3-26) live in [[phase3-through-phase26-commits]]
(project_phase3_complete.md). This file starts the v2 era.

## Standing policies confirmed at v2 Phase 0 (2026-06-09)

- **No Co-Authored-By trailer** on any commit — explicit user policy, reaffirmed.
- Fast-forward pushes to `master` by git-committer are **pre-authorized** per
  CLAUDE.md Don'ts section; only force-push needs confirmation. Push went
  through directly with no sandbox block this session.
- test-specialist sub-agent is disabled via rename to
  `.claude/agents/test-specialist.md.disabled` (token-saving, reversible).
  Active agents all run `model: fable`.

## v2 Phase 0 checkpoint committed + pushed 2026-06-09 (3 commits)

- `714eea8` — chore(agents): swap opus/sonnet -> fable; disable test-specialist
  (7 files: 5 agent defs model swap, test-specialist.md -> .disabled rename
   detected at 99% similarity, + agent-memory Phase 25/26 record)
- `5411607` — refactor(ui,api): retire cost_per_km for time-first + category model
  (12 files, 137 ins/253 del: src/api/{types,trips,routes,_keys}.ts,
   src/lib/tripsFilters.ts + test, DaySummaryCard, TripCostRollup,
   trip/[id]/index + print, trips.tsx, TripCard.test.
   trips.cost_per_km DB column drop deferred to v2 Phase 15.1 — client-only change.)
- `a990187` — docs(v2): add v2 blueprint + build log; env v2 vars
  (9 files, 757 ins: docs/v2/ 7 files, plan-v2.md, .env.example v2 vars —
   MapLibre/OpenFreeMap, Gemini/Groq, OSRM/ORS, PostHog placeholders, no values)
- Pushed origin/master fast-forward 61ff74d..a990187.

## v2.1 Fable plan revision checkpoint committed + pushed 2026-06-10 (2 commits)

- `0eb41d6` — chore(agents): planner inherit -> fable (1 line; planner was the
  one agent 714eea8 missed)
- `e9e0715` — docs(v2): Fable panel revision — resequenced plan v2.1 + UX principles
  (9 files, 330 ins/191 del: plan-v2.md v2.1 rewrite with N/S/P tracks + WEB BETA
   milestone; NEW docs/v2/ux-principles.md (user-first core loop, load-bearing);
   BUILD-LOG tracks + debt register; features Core-loop L1-L4; architecture C1
   manual_rank + trip_place_comments/app_config; risks D6 -> GitHub Actions pinger;
   conventions CI posture; migration + tech-stack wording)
- Pushed origin/master fast-forward a990187..e9e0715. Standing push authorization
  applied directly — no confirmation needed, no sandbox block.
- Revision authored by a 5-lens Fable review panel (product/UX, architecture,
  sequencing, feature-gaps, debt) + synthesis; supersedes the 2026-06-09 16-phase
  plan. v2 plan-doc churn arrives as one bundled docs(v2) commit + a tiny
  chore(agents) sidecar when agent defs move — reuse this split.

## v2 Phase 0.5 debt sweep committed + pushed 2026-06-10 (1 commit)

- `7572d32` — chore(cleanup): v2 Phase 0.5 debt sweep — analytics cap interim
  fix, dead hook removal, hygiene
  (15 files, 103 ins/124 del, ONE bundled commit per user brief: analytics.tsx
   10-hook cap -> useQueries over all trips; useCollaboratedTrips +
   tripCollaboratorsKeys.mine deleted; .gitignore scratch logs + .claude lock;
   e2e Cost->Duration x4; v1-superseded banners on architecture + 4 feature
   docs; ci.yml posture comment; BUILD-LOG 0.5 done + debt register flips.)
- Pushed origin/master fast-forward b3530b9..7572d32, standing authorization,
  no sandbox block.
- Pattern: debt-sweep commits bundle as one `chore(cleanup)` with sub-step ids
  (0.5b/c/d/f) structuring the body + a "Gates verified" line (tsc baseline,
  Jest counts). User supplies the exact subject verbatim — use it even past
  72 chars. Jest count as of 0.5: 25 suites / 268 tests.

## v2 Wave 1 (N1.1 + N2) committed + pushed 2026-06-10 (2 commits)

- `ada5d6d` — refactor(ui): split trip-detail god-screen into 8 components (N1.1)
  (9 files, 2292 ins/2086 del: trip/[id]/index.tsx 2365 -> 312 route shell;
   NEW src/components/trip-detail/ TripHeader, MapTab, ItineraryTab, PlaceRow,
   NotesEditors, SettingsTab, CoverPhotoSection, CoverPickerModal.
   Gates in body: tsc byte-identical baseline, Jest 25 suites / 268 tests.)
- `13f17bf` — feat(backend): N2 adoption — comments schema+hooks, realtime,
  analytics MV, pg_cron, keep-alive
  (6 files, 972 ins: migration 0019, migrations/README-v2.md NEW,
   src/api/trip-place-comments.ts NEW, .github/workflows/keepalive.yml NEW,
   _keys.ts + index.ts. keepalive.yml references secrets by NAME only —
   verified clean; "any HTTP status = awake" success criterion is deliberate.)
- Pushed origin/master fast-forward 7572d32..13f17bf, standing authorization,
  no sandbox block.
- Wave pattern: v2 feature work arrives as "Wave N" briefs with N-track item
  ids (N1.1, N2) embedded in the subjects; ui refactor + backend adoption
  split into one commit each. User again supplied exact subjects verbatim
  (commit 2 past 72 chars — used as given). BUILD-LOG.md was "stage if
  modified" but had already landed in e9e0715 — fresh-status rule paid off.

## v2 Wave 2 (N1 + N3) committed + pushed 2026-06-10 (2 commits)

- `cb2e9c4` — feat(ui): N1 core-loop UX — timeline+ETAs, comments, Ideas,
  Home, OAuth, sample trip
  (14 files, 1630 ins/45 del: trips.tsx Home hero, login/signup OAuth button,
   ItineraryTab + PlaceRow timeline/comments wiring; NEW trip/plan.tsx
   placeholder, HomeHero, DayStartTimeControl, PlaceCommentsSheet,
   computeDayTimeline, GoogleSignInButton, useGoogleSignIn, useSampleTrip.)
- `6313d2a` — feat(backend): N3 AI core — ai-itinerary Edge Fn (Gemini→Groq,
  grounding, quota), migration 0020, ai client
  (7 files, 1504 ins/8 del: NEW supabase/functions/ai-itinerary/ 955-line
   index.ts + README, migration 0020 trip_days.start_time + trip_ai_runs +
   ai_usage (RLS both) + increment_ai_usage fn, src/api/ai.ts;
   trip-days/types/index modified.)
- Pushed origin/master fast-forward 13f17bf..6313d2a, standing authorization.
- Authoring agents' session was interrupted mid-wave; user had the work
  gate-verified afterward and asked for that note in both bodies — "authored
  across an interrupted two-agent session; gate-verified after recovery".
  Jest still 25 suites / 268 tests.
- BUILD-LOG.md deliberately left UNSTAGED this wave — user wants it committed
  as its own update after Wave 3. Don't sweep it into the next feature commit.
  (RESOLVED: landed as its own docs(v2) commit 828a42c in Wave 3.)
- Secret posture verified: ai-itinerary reads GEMINI_API_KEY / GROQ_API_KEY /
  GOOGLE_MAPS_SERVER_KEY via Deno.env.get by name only; Google OAuth goes
  through supabase.auth.signInWithOAuth — zero client-side OAuth IDs in repo.
- Migrations use lowercase SQL DDL — grep them case-insensitively when
  verifying schema claims.

## v2 Wave 3 (N3.4/3.5 + phase close-out) committed + pushed 2026-06-10 (2 commits)

- `a2d7552` — feat(ui): N3.4/3.5 — Plan-my-trip flow with AI draft review,
  commit-on-accept, undo
  (12 files, 1914 ins/81 del: trip/plan.tsx placeholder -> 464-line 3-stage
   flow; NEW src/components/ai-plan/ 10 files + src/hooks/useAiDraftCommit.ts.
   Body bullets: draft staging, keep/remove/restore + duration + day reassign,
   unresolved-places card, quota/misconfigured/retry idempotent-replay,
   commit via existing hooks createTrip -> places + moveToDay -> one optimize,
   2.6s undo deletes trip, Powered-by-Google. Gates line as usual.)
- `828a42c` — docs(v2): BUILD-LOG — phases 0.5/N1/N2/N3 closed; user-action
  checklist
  (1 file, 36 ins/24 del: commit refs for closed phases, 2.2 Storage re-scoped
   to P2, 2.5 dashboard-manual, user-actions checklist — migrations 0019+0020,
   GEMINI/GROQ secrets, deploy ai-itinerary, Resend/OAuth, keepalive secrets,
   web smoke list. Secret names by NAME only with `…` placeholders — clean.)
- Pushed origin/master fast-forward 6313d2a..828a42c, standing authorization,
  no sandbox block. Jest still 25 suites / 268 tests.
- N-track state after Wave 3: N1/N2/N3 + 0.5 all closed. Next candidates per
  BUILD-LOG: N4 (AI editing + import), N5 (free maps, D2), S1 (SDK epic, D1) —
  all paused pending user actions (migrations/secrets/dashboard) + web smoke.

## v2 Phase N4 (AI editing + gap-fill + import) committed + pushed 2026-06-10 (2 commits)

- `2ab6200` — feat(backend): N4 — ai-edit Edge Fn (edit/suggest/ground),
  shared AI helpers, migration 0021
  (6 files, 2577 ins/406 del: NEW supabase/functions/ai-edit/ index+README,
   NEW _shared/ai.ts extracted from ai-itinerary, migration 0021,
   ai-itinerary refactor 955 -> 625 lines, src/api/ai.ts 3 new hooks.
   Body carries deploy note: db push 0021 then deploy BOTH ai-edit and
   ai-itinerary.)
- `122e35b` — feat(ui): N4 — AI edit diff preview with undo, gap-fill from
  Ideas, places import
  (15 files, 2512 ins/22 del: NEW src/components/ai-edit/ 10 files incl.
   CsvImportButton platform-split .web.tsx, NEW useAiEditApply + importParse,
   ItineraryTab entry points + slack chips, AiErrorNotice; BUILD-LOG N4
   closed staged into this commit per brief.)
- Pushed origin/master fast-forward 828a42c..122e35b, standing authorization,
  no sandbox block.
- Both commits exceeded the 2000-insertion guardrail; proceeded without
  asking because the brief explicitly granted the push with an exact file
  manifest (same precedent as Wave 1 ada5d6d). Note: only `_shared/ai.ts`
  was new in `_shared/` — the dir was already tracked; status showed the
  file-level `??` entry, not the dir.
- Gates phrasing this wave: "tsc clean — only standard Deno-noise classes
  on new Edge Fn files" + Jest 25 suites / 268 tests (unchanged).
- N-track state after N4: 0.5/N1/N2/N3/N4 closed. Next candidates: N5
  (free maps, D2), S1 (SDK epic, D1).

## v2 Phase N5 (free maps + routing kill-switches, D2) committed + pushed 2026-06-10 (2 commits)

- `72fc146` — feat(backend): N5 — ORS routing adapter with auto-failover,
  app_config kill-switches (migration 0022)
  (9 files, 946 ins/3 del: NEW _shared/routing.ts, migration 0022 app_config,
   distance-matrix + directions-polyline READMEs, src/api/app-config.ts;
   both routing index.ts dispatch via adapter, contracts byte-unchanged.
   Provider resolution: app_config row > ROUTING_PROVIDER env > google.)
- `9bbd238` — feat(ui): N5 — web map to MapLibre + OpenFreeMap with provider
  dispatcher
  (7 files, 1039 ins/187 del: Map.web.tsx renamed -> GoogleMap.web.tsx with
   the NEW dispatcher recreated at Map.web.tsx in the SAME commit; NEW
   MapLibreMap.web.tsx zero-key OpenFreeMap; test repoint; maplibre-gl +
   react-map-gl + @vis.gl/react-maplibre deps; BUILD-LOG N5 closed +
   WEB BETA milestone staged into this commit per brief.)
- Pushed origin/master fast-forward 122e35b..9bbd238, standing authorization,
  no sandbox block.
- Rename + recreate-at-old-path in ONE commit: default diff shows Map.web.tsx
  as modified, but `git show -C --stat` renders {Map.web.tsx => GoogleMap.web.tsx}
  (15 lines) and `git log --follow` on GoogleMap.web.tsx traces pre-rename
  history fine — content similarity carries the rename, not staging
  choreography. The authoring agent had pre-staged the rename via git mv;
  had to `git restore --staged` both paths before building the backend
  commit so the rename wouldn't ride along into commit 1.
- Gates phrasing this wave: Jest 25/268 + "deno tests 15/15 (npx deno 2.1.4
  --no-lock)" + "expo export --platform web clean" — deno + export gates new
  as of N5.
- app_config posture (will recur): world-readable SELECT for anon +
  authenticated is DELIBERATE (public share page), no write policies by
  design — don't flag it as an RLS gap in future reviews.
- N-track state after N5: 0.5/N1-N5 closed. Next candidate: S1 (SDK epic, D1).

## v2 P1+P2 backend wave committed + pushed 2026-06-10 (2 commits)

- `1d8b565` — feat(backend): P1 — user time-windows + real multi-leg transit
  steps (migration 0023)
  (7 files, 375 ins/17 del: NEW migration 0023; directions-polyline
   index+README, optimize-trip, src/api/{types,trip-places,routes}.ts.
   Body invariants: arrive_after/leave_before user-confirmed ONLY — never
   auto-filled from Google hours (ToS, in column comments); transitSteps
   additive, omitted-when-empty, top-level polyline stays null; deploy
   order migration 0023 BEFORE optimize-trip.)
- `e02aa23` — feat(backend): P2 — weather Edge Fn (Open-Meteo), packing +
  documents schema/hooks, trip-docs storage (migration 0024)
  (10 files, 1646 ins/1 del: NEW migration 0024, supabase/functions/weather/
   index+README, src/api/{weather,trip-packing,trip-documents}.ts,
   src/lib/packingSeed.ts; _keys.ts, api/index.ts, migrations/README-v2.md.
   Open-Meteo is keyless upstream but CC-BY attribution is a UI obligation;
   storage path-parse helper uuid-validates before cast and fails closed;
   upload is object-first/row-second with orphan cleanup; 10MB bucket cap.)
- Pushed origin/master fast-forward 9bbd238..e02aa23, standing authorization,
  no sandbox block.
- P-track (parallel-feature backend waves) now runs alongside the N-track;
  same brief format — exact subjects supplied verbatim, both past 72 chars,
  used as given. Gates phrasing now includes per-Edge-Fn deno counts
  ("deno directions-polyline 8/8 + optimize-trip 11/11"). Jest still 25/268.
- BUILD-LOG.md deliberately unstaged again — user says it closes after the
  UI waves; expect it as its own docs(v2) commit later (same pattern as
  Wave 3's 828a42c).

## v2 P1 UI wave committed + pushed 2026-06-10 (1 commit)

- `939949b` — feat(ui): P1 — time-window editor + conflict chips, multi-leg
  transit rendering
  (10 files, 643 ins/86 del: PlaceActionsSheet TimeWindowEditor;
   trip-detail computeDayTimeline/PlaceRow/ItineraryTab/MapTab;
   Map types/native/GoogleMap.web/MapLibreMap.web; tokens warningText.
   Body invariants: windows user-set only, never auto-filled from Google
   hours (ToS); warnings non-blocking chips; per-step TRANSIT solid /
   WALK dashed-gray with byte-identical no-steps fallback; unified
   dashed-with-points rule also fixed invisible my-location leg on native;
   per-day anchors DEFERRED — optimize-trip doesn't read trip_days,
   useUpdateTripDay schema strips anchor columns.)
- Pushed origin/master fast-forward e02aa23..939949b, standing
  authorization, no sandbox block.
- P-track pattern holds: UI wave follows its backend wave (1d8b565) as a
  separate single commit; gates phrasing "jest 25/268 green, tsc
  1202->1202 zero new" — tsc error-count baseline parity is now a stated
  gate alongside Jest. P2 UI wave likely next (weather/packing/documents
  surfaces for e02aa23 backend).

## v2 P2 UI + phase close-out committed + pushed 2026-06-11 (1 commit)

- `13919d8` — feat(ui): P2 — weather chips + rainy-day gap-fill, packing
  list, documents; BUILD-LOG P1/P2 closed
  (12 files, 1445 ins/11 del, ONE commit per brief: NEW tripWeather.ts,
   WeatherChip.tsx, app/(app)/trip/[id]/packing.tsx, src/components/packing/
   x3, DocumentsSection, DocumentUploadButton + .web platform split;
   ItineraryTab one centroid weather query date-mapped + CC-BY line +
   rainy->GapFillSheet; SettingsTab packing entry + documents; BUILD-LOG
   P1 closed w/ anchors-deferred wiring-gap note, P2 closed, deploy
   checklist. Body invariants: weather hidden silently out-of-horizon/
   on-error; upload web-only BY DESIGN — native picker = forbidden new
   dep, viewing works everywhere; "Weather data by Open-Meteo.com"
   attribution obligation met.)
- Pushed origin/master fast-forward 939949b..13919d8, standing
  authorization, no sandbox block. Gates: jest 25/268,
  "tsc 1202 baseline-identical" (new phrasing for error-count parity).
- BUILD-LOG staged INTO the feature commit this time (brief said so) —
  unlike Wave 2/P-backend where it was held back. Follow the brief, not
  the prior pattern. P-track state: P1 + P2 fully closed (backend + UI).
  Stale status snapshots recur in briefs — fresh `git status` showed
  plan-v2.md/features.md/planner.md already landed; trust fresh status.

## v2 Tide & Terracotta redesign + planning docs committed + pushed 2026-06-11 (2 commits)

- `3fbd54c` — feat(ui): Tide & Terracotta visual redesign — new design
  language across core surfaces
  (23 files, 704 ins/473 del: tokens.ts full retune + overline token,
   Home/trips + trip-detail + ai-plan + primitives + auth light-touch;
   NEW src/hooks/useReducedMotion.ts — animations gate on
   prefers-reduced-motion. Body invariants: WCAG AA both modes, all
   roles/labels/visible strings preserved.)
- `3b4cec6` — docs(v2): monetization plan, live-deployment runbook, T1
  editable timeline; BUILD-LOG updates
  (5 files, 191 ins: NEW monetization.md (subs-first freemium,
   RevenueCat+Stripe, M1-M3) + deployment.md ($0 go-live runbook G1-G5);
   features L5 pinned-times, plan-v2 2026-06-11 addendum, BUILD-LOG
   runtime-verification + redesign records + T1/M/GO-LIVE tracks.)
- Pushed origin/master fast-forward 13919d8..3b4cec6, standing
  authorization, no sandbox block. Gates phrasing this wave: "tsc
  identical vs pristine-HEAD worktree" (worktree-diff method, not error
  count) + jest 25/268 + "live authed screenshots taken" — live visual
  verification is now part of the gate set for UI reskins.
- Redesign briefs split visual work (src/+app/ -> feat(ui)) from planning
  docs (docs/+plan-v2.md -> docs(v2)); `git add app src` was exact since
  the dirty set under those dirs matched the manifest. New tracks now in
  BUILD-LOG: T (timeline), M (monetization), GO-LIVE (G1-G5). S1 still
  open as next code epic.

## v2 design-system v3 committed + pushed 2026-06-11 (1 commit)

- `87fdeb1` — feat(ui): implement design-system v3 — Hanken Grotesk,
  brighter teal, Lucide icon system
  (13 files, 257 ins/35 del, ONE commit per brief: tokens.ts light primary
   #0C8578 + teal wash/glow + brandTypography builder; ThemeProvider
   non-blocking useFonts; NEW src/components/Icon.tsx Lucide registry
   (1.75 stroke, decorative-by-default a11y); icon adoption in BackButton/
   PlaceRow/SettingsTab/PlaceActionsSheet; jest.config lucide transform;
   jest-setup expo-font mock; deps @expo-google-fonts/hanken-grotesk +
   lucide-react-native.)
- app.json was NOT in the brief's manifest but its diff was integral
  (expo-font plugin registration + permissions reformat) — included it and
  reported the addition. Lesson: brief manifests can omit config sidecars;
  verify the full dirty set against the feature before staging.
- Held back per brief: migration 0025_v2_pinned_start.sql (T1, commits
  next), BUILD-LOG.md (closes after T1), agent-memory.
- Pushed origin/master fast-forward 3b4cec6..87fdeb1, standing
  authorization, no sandbox block. Gates: jest 25/268, tsc baseline-clean,
  live screenshots (fonts + teal + Lucide rendering).
- Origin story noted in body: design system came from the user's "Claude
  Design" handoff bundle, reverse-engineered from Tide & Terracotta then
  evolved. Emoji deliberately retained as expressive layer (hybrid icon
  spec). Remaining icon spots: tab glyphs, transport picker, tool chips.

## v2 T1 editable timeline committed + pushed 2026-06-11 (1 commit)

- `0eb8a71` — feat(ui,backend): T1 — user-pinned arrival times in the day
  timeline (migration 0025)
  (9 files, 247 ins/8 del, ONE commit per brief: NEW migration 0025
   trip_places.pinned_start (time, nullable, user-authored-only ToS comment);
   types.ts, trip-places.ts update schema, computeDayTimeline pin-as-anchor +
   'pinned_tight' conflict, ItineraryTab pinnedAt view-model, PlaceRow pinned
   chip + a11y, PlaceActionsSheet PinnedTimeEditor, Icon.tsx pin glyph,
   BUILD-LOG T1 + v3 records + Docker port-desync ops note. Body invariants:
   reachable pin = cursor jumps / downstream shifts through the gap;
   unreachable = non-blocking chip, time never rewound; editor in sheet,
   chip is indicator.)
- Pushed origin/master fast-forward 87fdeb1..0eb8a71, standing authorization,
  no sandbox block. Gates: jest 25/268, tsc baseline-clean, "migration 0025
  applied + column-verified on local Supabase" — migration-applied
  verification now appears in gate phrasing when a commit ships SQL.
- First mixed-scope `feat(ui,backend)` subject in v2 — used when one T-track
  item spans a migration plus its UI in a single brief-mandated commit.
- BUILD-LOG hold-back from 87fdeb1 resolved here (staged into T1 per brief).

## v2 manual-mode stale-route bug fix committed + pushed 2026-06-11 (1 commit)

- `b8dc2b5` — fix(ui): manual-mode reorders now recompute the map route
  (stale trip_legs)
  (1 file, 20 ins/2 del: app/(app)/trip/[id]/index.tsx auto-optimize effect
   only. Two defects: stateKey was order-insensitive (sorted ids) so manual
   drags never re-triggered — layout key id:day:position joins in manual
   mode only; optimizeMutate never passed mode, defaulting auto-runs to the
   'optimized' branch — now passes trip.route_render_mode. Optimized mode
   key stays order-insensitive to avoid post-run loops.)
- Pushed origin/master fast-forward 0eb8a71..b8dc2b5, standing
  authorization, no sandbox block. Gates: jest 25/268, tsc clean.
- First v2-era pure bug-fix commit (fix scope, not feat/T-track). Note:
  jest gate count is 268 tests in recent briefs (was 269 in Phase 26 era).
- PowerShell 5.1 gotcha confirmed: embedded double quotes inside a
  here-string break native-arg passing to `git commit -m` (message split
  as pathspec). Use a temp message file + `git commit -F` whenever the
  body contains double quotes.

## v2 AI golden-path bug-fix bundle committed + pushed 2026-06-11 (1 commit)

- `8180b64` — fix(backend,ui): three latent bugs surfaced by the first real
  AI golden-path run
  (4 files, 170 ins/12 del, ONE commit per brief: NEW migration 0026
   service-role bypass in the editor-restriction trigger — fixes optimize
   mutex blocked since Phase 22 (NULL auth.uid() under service-role hit the
   deny-list); optimize-trip matrix call reshaped from pair-expanded arrays
   to unique-places NxN + pair-filter — >5-place trips broken since Phase 2;
   TripCostRollup filters day_index >= 0 so the drive-time card stops
   summing pairwise cache rows; BUILD-LOG records the run + Gemini quality
   verdict + ops notes.)
- Pushed origin/master fast-forward b8dc2b5..8180b64, standing
  authorization, no sandbox block. Gates: deno optimize-trip 11/11,
  jest 25/268, live re-optimize of the real 14-place trip with routes
  rendered — live-run verification now appears alongside suite gates for
  fix bundles.
- First multi-bug `fix(backend,ui)` bundle: real-usage-discovered latent
  bugs ship as ONE commit when one live run surfaced them together.
- A leftover `.git/COMMIT_MSG_TMP.txt` from an interrupted prior attempt
  was present with the correct message — check for/reuse it before
  rewriting; clean it up after commit.
- Maintenance contract reminder (from 0026's comment): any new column on
  `trips` must be added to the trigger whitelist diff — expect future
  migrations touching trips to pair with a trigger update.

## v2 GO-LIVE docs record committed + pushed 2026-06-11 (1 commit)

- `8b151eb` — docs(v2): GO-LIVE executed — cloud project live, 13 functions
  deployed, web on Pages
  (1 file, 7 ins/7 del: BUILD-LOG.md only — G1-G5 execution record: Supabase
   project nahywqbrdlkemdtjjxkc live, 26 migrations, 13 functions, G2a auth
   URLs via Management API, Cloudflare Pages direct-upload ->
   tripvisor.pages.dev, G2b/G4 leftovers, G5 pending TLS; plus 0019->0026
   checklist fix.)
- Pushed origin/master fast-forward 8180b64..8b151eb, standing authorization.
- Brief warned of parallel SDK-upgrade churn (package.json/lockfile) — fresh
  status showed it hadn't landed yet; staged the single named file anyway.
  Pattern: when a brief says "another agent is working in parallel", stage
  by explicit path only, never directory adds.
- Tripvisor is now LIVE: Supabase cloud project nahywqbrdlkemdtjjxkc +
  https://tripvisor.pages.dev (direct-upload Pages, NOT auto-deploy-on-push —
  pushes to master do NOT redeploy the web app; deploys are manual wrangler
  runs). Project ref + pages URLs are public identifiers, fine in commits;
  real credentials live in gitignored supabase/.env.

## v2 S1 Checkpoint A (Expo SDK 52->53) committed + pushed 2026-06-11 (1 commit)

- `7cacb56` — build(deps): S1-A — Expo SDK 53, React 19, RN 0.79, expo-router
  v5 (checkpoint A of the SDK epic)
  (8 files, 1922 ins/4868 del, ONE commit per brief: package.json +
   package-lock.json regenerated — expo ^53.0.27, react 19.0.0, RN 0.79.6,
   expo-router ~5.1.11, reanimated ~3.17.4 stays v3, jest-expo 53, TS 5.8.3,
   sentry ~6.14, NEW dep expo-asset ~11.1.7 (expo-font web needs it in 53);
   app.json expo-asset plugin only; login/signup/HomeHero expo-image 2.4
   placeholder-color -> style backgroundColor; BottomSheet.web stale
   ts-expect-errors removed (RN 0.79 first-class aria); trips.ts functional
   updaters for TanStack 5.101 + TS 5.8 Updater inference.)
- Pushed origin/master fast-forward 8b151eb..7cacb56, standing authorization,
  no sandbox block. Gates: expo-doctor 18/18 (new gate type for SDK work),
  tsc baseline-stable, jest 25/268, expo web export clean.
- First `build(deps)` scope in the repo — SDK upgrades use it, not chore(deps).
- S1 is a multi-checkpoint epic: Checkpoint B owes Reanimated v4/worklets +
  New-Arch maps pin + device smoke (checklist lands in BUILD-LOG with B).
- No untracked stragglers from the upgrade (`expo-env.d.ts` is gitignored;
  no `.npmrc` appeared). Lockfile-driven >2000-line commit proceeded without
  asking — brief granted it with an exact manifest (N4 precedent holds).

## S1-B SDK 53 -> 54 checkpoint committed + pushed 2026-06-11 (1 commit)

- `4ceae19` — build(deps): S1-B — Expo SDK 54, RN 0.81, React 19.1,
  Reanimated 4 + worklets, maps ^1.21 (SDK epic complete, device smoke owed)
  (5 files, 2281 ins/1862 del: package.json, package-lock.json regenerated,
   babel.config.js, src/api/{ics,account-export}.native.ts)
- Pushed origin/master fast-forward 7cacb56..4ceae19. S1 SDK epic is now
  code-complete; device smoke owed on a NEW EAS dev-client build.
- Key institutional facts baked into the commit body (don't re-litigate):
  babel-preset-expo 54 auto-registers react-native-worklets/plugin, and
  Reanimated 4's plugin is a re-export of it — explicit plugin entry in
  babel.config.js must stay REMOVED or worklets compile twice (#1 failure
  mode). expo-file-system v19 string-URI API lives at
  `expo-file-system/legacy`. react-native-maps held at 1.27.2 via
  `expo.install.exclude` in package.json — expo-doctor respects the
  exclusion, don't "fix" it back.
- expo-router v5 -> v6 arrived WITH SDK 54 (pre-research said otherwise);
  draggable-flatlist on Reanimated 4 is compatible-by-evidence only —
  runtime nav + drag are on the device-smoke checklist.
- Subject was user-specified verbatim (>72 chars accepted — exact-manifest
  briefs override the length convention, same as content conventions).

## P3 analytics committed + pushed 2026-06-11 (2 commits)

- `e7f589d` — feat(ui): P3 — gifted-charts analytics + MV-first aggregates
  with live fallback (7 files: charts/{Bar,Pie,Line}Chart.tsx rewritten on
  react-native-gifted-charts, analytics.tsx MV-first merge, NEW
  src/api/trip-stats.ts, package.json/lock)
- `be0afe9` — docs(v2): BUILD-LOG — S1 SDK epic record (device smoke owed),
  P3 closed
- Pushed origin/master fast-forward 4ceae19..be0afe9.
- Charting facts: gifted-charts' gradient dep optional-falls-through to
  expo-linear-gradient — `react-native-linear-gradient` must NOT be added
  (verified absent from exported bundle). expo-linear-gradient ~15.0.8
  entered package.json alongside gifted-charts ^1.4.77.
- trip-stats.ts pattern: MV reader returns [] on missing RPC
  (get_my_trip_stats) so analytics silently falls back to live aggregation —
  safe to ship ahead of the MV migration.
- Gate bar for P3-era phases included LIVE visual verification (screenshot
  of charts rendering with data) on top of tsc-baseline/jest/web-export —
  expect briefs to cite it; jest baseline at this point: 25 suites/268 tests,
  tsc baseline 1195.
- S1 device smoke STILL owed after P3 (native untested since SDK 54).

## S2 Wave 1 (offline-engine foundation) committed + pushed 2026-06-12 (2 commits)

- `7071e7b` — feat(backend): S2.1 — sync-foundation migration 0027
  (4 files, 394 ins: NEW migrations/0027_v2_sync_foundation.sql —
   handle_times, tombstones, manual_rank, realtime completeness;
   src/api/{types,trip-packing,trip-place-comments}.ts type alignment)
- `10e41e5` — feat(sync): S2.2/S2.3 — Tier-1 read-only hydration engine +
  C3 ToS firewall (13 files, 1197 ins: NEW src/sync/ 9 files + 45-test C3
  allowlist suite; @legendapp/state pinned EXACTLY 3.0.0-beta.47 per R6 —
  no caret; expo-sqlite ~16; BUILD-LOG Wave 1 + abort-gate assessment)
- Pushed origin/master fast-forward be0afe9..10e41e5.
- Sync-era facts: engine = syncedSupabase; flag-gated OFF (env/app_config),
  inert no-ops when off; writes disabled until Wave 2; trip_legs excluded
  from Tier-1 (R4); reconnect force-pull works around LegendApp#362.
  expo-sqlite native module rides the pending S1 dev-client rebuild —
  S1 device smoke STILL owed.
- Jest baseline now 26 suites / 313 tests. tsc gate phrasing: "zero
  non-test sync errors" — test-file jest-globals noise is the accepted
  baseline class.

## S2 Wave 2 (Tier-1 write path + R6 GO) committed + pushed 2026-06-12 (1 commit)

- `33155c8` — feat(sync): S2.4/S2.9 — Tier-1 writes for trips+places slice;
  R6 abort gate validated GO (7/7 live round-trip). 8 files, 1070 ins:
  allowlist sanitizeForTier1Write (C1 write firewall — plugin hard-codes
  updatePartial:false), hydrate read-write + tombstones + session
  user_id stamping, telemetry write counters, +16 allowlist tests
  (sync suite 61), NEW scripts/validate-sync-roundtrip.mjs +
  `npm run sync:validate`.
- Pushed origin/master fast-forward 10e41e5..33155c8.
- R6 verdict GO: 7/7 PASS against live local stack. Queue durability
  platform-dependent (R5); engine still flag-gated OFF.
- Jest baseline now 26 suites / 329 tests; tsc non-test count 288
  (verified stable via stash-diff).
- validate-sync-roundtrip.mjs reads ANON/SERVICE_ROLE keys at runtime
  via `npx supabase status` — no literals; only hardcoded cred is the
  local smoke-user password (smoke-phase6@test.local), accepted class.

## S2 Wave 3a (mutation layer + undo + auth lifecycle) committed + pushed 2026-06-12 (1 commit)

- `5b830a1` — feat(sync): S2 Wave 3a — mutation layer + undo stack + auth
  lifecycle wiring. 8 files, 1081 ins: NEW src/sync/{mutations,rank,undo}.ts
  + rank/undo test suites; hydrate.ts isTier1SyncInitialized/teardownTier1Sync
  (gates without detaching — beta lacks unsubscribe; clearing write-enabled
  stores would diff as mass tombstones), telemetry.ts useSyncStatus
  (writeErrorCount is the pendingWrites proxy), auth.ts single-seam engine
  lifecycle in onAuthStateChange.
- Pushed origin/master fast-forward 33155c8..5b830a1.
- Sync jest suite now 78 tests / 3 suites (allowlist/rank/undo). Engine still
  flag-gated OFF. S1 device smoke STILL owed.
- Wave history note: implementing agent hit API overload at ~80%;
  orchestrator finished hydrate exports, auth wiring, telemetry reactive
  core, node() index bridge (18 sites), both test suites — recorded in
  commit body.
- tsc "zero non-test sync/auth errors" gate: src/api/supabase.ts ./storage
  TS2307 is the accepted platform-split resolution class (.native/.web files
  exist; tsc lacks moduleSuffixes for them) — same family as ./Map,
  ./BottomSheet. Not a regression signal unless the importing file was
  touched.

## S2 Wave 3b + G6 hotfix (landed between my sessions, 2026-06-12)

- `a8466a8` — feat(sync): S2 Wave 3b — offline drag + sync-status pill +
  metro wasm fix. My previously STAGED agent-memory updates (Wave 3a record)
  rode along into this commit — that's why the tree was clean at Wave A.
- `dc2ace9` — fix(env): live auth broken — static-first EXPO_PUBLIC reads
  (G6 hotfix). Key fact in BUILD-LOG: Expo babel inlines ONLY literal
  `process.env.EXPO_PUBLIC_X` member expressions — computed/optional-chained
  reads ship the REPLACE_ME fallback in prod bundles. Site redeployed;
  autoconfirm (`mailer_autoconfirm=true`) enabled until Resend SMTP (G2b).

## S2.8 Wave A committed + pushed 2026-06-12 (1 commit)

- `b97af68` — feat(sync): S2.8 Wave A — tombstone-filtered reads, manual_rank
  optimize branch, undo toast, issues sheet, COOP/COEP
  (18 files, 942 ins/69 del: eq(deleted,false) on all 9 trip_places read
   sites incl. 4 Edge Fns; optimize-trip manual_rank branch; NEW UndoToast +
   public/_headers (COOP/COEP for web OPFS persistence) + ADR-0010;
   SyncStatusPill issues sheet; plan.md S2.8 phase plan.)
- Concurrent-agent discipline applied: another agent was editing
  src/api/trips.ts + src/sync/* — staged by explicit path only; neither was
  dirty at commit time. Untracked `public/` dir contained ONLY _headers.
- Gates baseline now: jest 28 suites / 346 tests, tsc 1341 baseline-exact,
  sync:validate 7/7 GO. Residual owed: analytics MV counts tombstones
  (Wave C migration); S1 device smoke STILL owed.

## Leftover artifacts — RESOLVED 2026-06-10 in 7572d32

`*-fresh.txt`, `e2e-final.txt`, `tsc-output.txt`, `.claude/scheduled_tasks.lock`
are now gitignored; stray txt files (incl. the malformed
`C…UsershemreDesktopTripvisortsc-output.txt`) deleted from disk.
`.claude/settings.local.json` remains local-only — never commit.

## v2 commit conventions

- v2 docs live in `docs/v2/`; v2 plan is root `plan-v2.md`. Scope `docs(v2)`
  for blueprint-level docs work.
- Quote `app/(app)/...` and `[id]` paths in bash `git add` (parens/brackets).
- CRLF warnings on add are normal on this Windows checkout — not an error.
