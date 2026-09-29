// optimize-trip — orchestrates route rendering for a trip.
//
// Contract (meta.contractVersion 2; v1 responses carried no `meta`):
//   POST { tripId: string, mode?: 'optimized' | 'manual' }
//   -> {
//        stateHash: string,
//        days: Array<{ dayIndex, orderedPlaceIds, totalMinutes }>,
//        placesUpdated: number,
//        legsWritten: number,
//        cacheHit: boolean,
//        polylineDays: number,
//        mode: 'optimized' | 'manual',
//        // M5 Y2.3 (additive, contractVersion 2):
//        keptOrderDays: number[],   // days whose order was KEPT because they
//                                   // hold a flight/ferry arrival ('optimized'
//                                   // only; always [] in 'manual')
//        legSources: { ors, google, estimate, user },  // counts of the day
//                                   // legs written, by trip_legs.source
//        meta: { contractVersion: 2 },
//      }
//   Error envelope unchanged: { error: { code, message } }.
//
// Modes (Phase 23 Step 23.2):
//   'optimized' (default, back-compat) — k-means + 2-opt.
//     1. Auth (JWT, RLS-scoped).
//     2. Row-mutex via claim_trip_optimize.
//     3. Load trip + places (+ day default modes). Cap at 25 places.
//     4. Fetch N×N distance matrix, reusing legs < 30 days old.
//     5. Run the pure optimizer (k-means + 2-opt).
//     6. Write day_index / order_in_day via apply_optimization (atomic).
//     7. Compute every day's legs (per-leg modes, below) and replace the
//        trip's day legs in trip_legs.
//
//   'manual' — render the user's hand-ordered chain and recompute trip_legs
//              against it. day_index is never reassigned.
//     1. Auth (JWT, RLS-scoped). Same row-mutex.
//     2. Load live (deleted = false) places grouped by day_index. Skip
//        places with day_index = null (unscheduled).
//     3. NO clustering, NO 2-opt. Within each day the chain is ordered by
//        manual_rank (v2 S2.8.2 — base-62 fractional index, plain string
//        compare; see src/sync/rank.ts) with a per-day fallback to the
//        legacy order_in_day order when ranks are absent. The derived
//        order_in_day is persisted back via apply_optimization (C1: the
//        server stays the sole WRITER of day_index/order_in_day; the
//        client-owned manual_rank is what the server derives them FROM).
//     4. For each day with >=2 places, compute its legs (per-leg modes)
//        and replace the trip's legs.
//     5. stateHash is computed from the rank-derived assignments (so
//        consumers that branch on it continue to work). NOTE (plan S2.8.2
//        risk): for trips that already carry ranks whose order disagrees
//        with order_in_day, the first post-S2.8.2 hash differs once —
//        one spurious manual recompute per such trip is the accepted
//        one-time cost. All-NULL-rank trips (every v1 trip) hash and
//        behave byte-identically to the pre-rank implementation.
//
// Both modes share:
//   - the row-mutex (Phase 13 fix preserved),
//   - trip_legs replacement semantics (see "Leg rows" below),
//   - the same response envelope shape (existing OptimizeError consumers
//     keep working unchanged).
//
// M5 Y2.3 — per-leg transport modes (migration 0035; pure rules in legs.ts)
// ------------------------------------------------------------------------
//   Effective mode of the leg INTO a place:
//     trip_places.arrival_mode ?? trip_days.transport_mode ?? trips.transport_mode
//   Every leg records trip_legs.source ('ors' | 'google' | 'estimate' | 'user'):
//     - driving / walking / bicycling: consecutive same-mode legs share ONE
//       directions-polyline call (ORS primary + Google fallback via the
//       existing routing_provider switch) that returns a per-leg split.
//     - transit: one Google Routes call per leg while the caller's routing
//       quota lasts and app_config 'transit_routing' is not 'estimate'/'off'.
//     - flight / ferry: never routed.
//     - arrival_minutes set: the user's duration ('user'), no call.
//     - anything a routing API can't answer (quota spent, kill switch,
//       upstream error, time budget) becomes a clearly-labelled 'estimate'
//       (legs.ts LEG_ESTIMATE_MODEL), never a missing leg.
//   Days holding a flight/ferry arrival keep the user's manual_rank order in
//   'optimized' mode (their places stay on that day; the optimizer runs on
//   the rest and fills the other day indexes) — listed in `keptOrderDays`.
//   The optimizer matrix is keyed by mode: phase 1 clusters/orders with the
//   trip default mode; a day whose effective default mode
//   (trip_days.transport_mode ?? trips.transport_mode) differs is then
//   re-ordered with a matrix in THAT mode (best effort: on any failure the
//   phase-1 order stands). Per-leg overrides never feed the matrix.
//   Transit matrices: kill switch / quota / >100 elements (Google's transit
//   matrix cap) / upstream failure -> estimates for the optimizer instead of
//   an error. Non-transit matrix failures keep their pre-M5 behavior
//   (429 quota_exceeded, 502 matrix_failed).
//
// Leg rows (trip_legs):
//   - day legs: day_index >= 0, one row per consecutive pair of a day,
//     transport_mode = the leg's effective mode, polyline per leg (null for
//     transit, which carries transit_steps, and for estimate/user legs).
//   - matrix cache rows: day_index = -1, one per ordered pair, keyed by mode;
//     only routed answers are cached (never estimates).
//   'manual' replaces ALL of the trip's legs; 'optimized' replaces the day
//   legs and keeps the (TTL-bounded) matrix cache rows.
//
// Security (audit 2026-09-29):
//   #6 Viewers could run this function. RLS only proved the trip was
//      VISIBLE, and every write below runs under the service role. After
//      the trip loads, the caller must pass
//      user_can_access_trip(tripId, callerId, 'editor') (owner or accepted
//      editor). Otherwise -> 403 not_editor. The check runs through the
//      caller-scoped client with the caller's OWN id (the function guards
//      p_user_id = auth.uid()), and BEFORE the row-mutex, so a viewer can't
//      even hold the lock.
//   #2 The downstream distance-matrix / directions-polyline calls used to
//      send `Bearer <anon key>`. Those functions now require a real user
//      and meter a per-user routing quota. callEdge therefore forwards the
//      CALLER's Authorization header. A downstream 429 quota_exceeded on
//      the (non-transit, phase-1) matrix surfaces as 429 quota_exceeded
//      here; on leg calls it turns the remaining routed legs into estimates.
//   Caller auth itself goes through requireUser (GoTrue getUser). The anon
//   key gets 401 not_authenticated. New M5 reads (trip_days, app_config,
//   the leg cache) go through the caller-scoped client (RLS); the service
//   role is used only for the mutex, apply_optimization and trip_legs writes.

// @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { describeInvalidInput, requireUser } from '../_shared/auth.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { handlePreflight } from '../_shared/cors.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { fetchWithTimeout } from '../_shared/fetch-with-timeout.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { log, newRequestId } from '../_shared/logger.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { makeAdminClient, makeUserClient } from '../_shared/supabase-admin.ts';
import {
  optimize,
  type OptimizerLeg,
  type OptimizerPlace,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from '../../../src/lib/optimizer/kmeans-2opt.ts';
import {
  chainHasRank,
  countLegSources,
  dayDefaultMode,
  dayTotalMinutes,
  estimatedLegResult,
  estimateLeg,
  freeDayIndexes,
  GOOGLE_TRANSIT_MATRIX_MAX_ELEMENTS,
  isTripMode,
  keptOrderDayIndexes,
  type LegResult,
  type LegSegment,
  type LegSource,
  type LegSourceCounts,
  orderChainByRank,
  type PlannedLeg,
  planDayLegs,
  routedLegsFromDirections,
  routedSource,
  type RunMode,
  segmentDayLegs,
  type TripMode,
  userLegResult,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from './legs.ts';

const MAX_PLACES = 25;
const LEG_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Outer budgets for the sibling-function hops. Each sits above the callee's
// own upstream budget (distance-matrix / directions-polyline: 10s Google,
// plus up to 10s ORS before the fallback, plus an auth round-trip), so the
// callee times out first and returns its structured error.
const MATRIX_TIMEOUT_MS = 25_000;
const POLYLINE_TIMEOUT_MS = 25_000;

/**
 * M5 Y2.3: directions-polyline calls in flight at once. Small on purpose:
 * ORS's free tier allows 40 directions/min per key, shared by every user.
 */
const ROUTING_CONCURRENCY = 3;

/**
 * M5 Y2.3: wall-clock budget (from the start of the routed work) after which
 * no NEW routing call starts; the remaining legs become estimates and the
 * remaining phase-2 re-orders are skipped. Keeps a slow upstream from
 * holding the function (150 s platform limit) and the mutex.
 */
const ROUTING_BUDGET_MS = 60_000;

/** app_config key: 'estimate' | 'off' stops Google transit calls (M5 Y2.3). */
const TRANSIT_SWITCH_KEY = 'transit_routing';

/** meta.contractVersion of every 2xx body (v1 = pre-M5, no `meta`). */
export const OPTIMIZE_CONTRACT_VERSION = 2;

// Phase 23 Step 23.2: explicit mode parameter. Defaults to 'optimized' for
// back-compat with every pre-Phase-23 caller (optimize-trip used to take
// only { tripId }). The client always passes mode explicitly post-Phase-23
// (see useOptimizeTrip in src/api/routes.ts) so the default is purely a
// safety net, not the hot path.
const BodySchema = z.object({
  tripId: z.string().uuid(),
  mode: z.enum(['optimized', 'manual']).optional().default('optimized'),
});

type Body = { tripId: string; mode: 'optimized' | 'manual' };

// Minimal structural view of the supabase-js clients this file uses. The
// esm.sh import does not resolve under the repo tsconfig, so without it every
// query result would be implicitly `any` there.
// deno-lint-ignore no-explicit-any
type Db = any; // supabase-js SupabaseClient (typed at runtime by Deno)

interface TripRow {
  id: string;
  user_id: string;
  daily_hours_budget: number;
  transport_mode: TripMode;
  anchor_place_id: string | null;
}

interface TripPlaceRow {
  id: string;
  lat: number;
  lng: number;
  visit_duration_minutes: number;
  // Optional in 'optimized' mode (we overwrite them); load-bearing in
  // 'manual' mode (we trace the existing chain).
  day_index: number | null;
  order_in_day: number | null;
  // v2 S2.8.2: user-authored fractional-index order key (migration 0027).
  // Lexicographic base-62 text — plain string comparison yields the user's
  // hand-ordered sequence (src/sync/rank.ts). NULL = never hand-ordered.
  // CONSUMED to derive order_in_day; NEVER written here (manual_rank is
  // client-owned per C1).
  manual_rank: string | null;
  // M5 (0035): user intent for the leg ARRIVING here. READ-only here (C1).
  arrival_mode?: string | null;
  arrival_minutes?: number | null;
}

interface TripDayModeRow {
  day_index: number;
  transport_mode: string | null;
}

/** A trip_legs row read as a matrix-cache candidate. */
interface CachedLegRow {
  from_place_id: string;
  to_place_id: string;
  duration_seconds: number;
  distance_meters: number;
  computed_at: string;
  transport_mode: string;
  // Absent on pre-0035 rows / narrow mocks: treated as a routed cache row.
  source?: string | null;
  day_index?: number | null;
}

/** Row shape inserted into trip_legs. */
interface LegInsertRow {
  trip_id: string;
  from_place_id: string;
  to_place_id: string;
  day_index: number;
  transport_mode: string;
  duration_seconds: number;
  distance_meters: number;
  polyline: string | null;
  transit_steps: unknown[] | null;
  source: LegSource;
}

interface ResponseDay {
  dayIndex: number;
  orderedPlaceIds: string[];
  totalMinutes: number;
}

/** Per-request routing state shared by the matrix + leg phases. */
interface RoutingCtx {
  requestId: string;
  tripId: string;
  userId: string;
  callerAuth: string;
  tripMode: TripMode;
  dayModes: ReadonlyMap<number, TripMode>;
  /** Epoch ms after which no new routing call starts. */
  deadline: number;
  /** Set on the first downstream 429 quota_exceeded: later calls are skipped. */
  quotaExhausted: boolean;
  /** Memoized app_config 'transit_routing' read (true = Google allowed). */
  transitAllowed: () => Promise<boolean>;
  /** Routing calls made (logs). */
  routingCalls: number;
}

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const requestId = newRequestId();

  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  if (url.searchParams.has('ping')) {
    return jsonResponse({ ok: true, fn: 'optimize-trip' }, { origin });
  }

  if (req.method !== 'POST') {
    return errorResponse('method_not_allowed', 'Only POST is allowed', 405, origin);
  }

  const auth = await requireUser(req, { fn: 'optimize-trip', requestId, origin });
  if (!auth.ok) return auth.response;
  const callerId: string = auth.user.id;
  const callerAuth: string = auth.user.authHeader;

  let body: Body;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return errorResponse('invalid_input', describeInvalidInput(err), 400, origin);
  }

  const user: Db = makeUserClient(req);
  const admin: Db = makeAdminClient();

  // Visibility check — the trip must be visible to the caller under RLS.
  const { data: trip, error: tripErr } = (await user
    .from('trips')
    .select('id, user_id, daily_hours_budget, transport_mode, anchor_place_id')
    .eq('id', body.tripId)
    .maybeSingle()) as { data: TripRow | null; error: { message: string } | null };
  if (tripErr) {
    log({ requestId, fn: 'optimize-trip', level: 'error', err: tripErr.message });
    return errorResponse('db_error', tripErr.message, 500, origin);
  }
  if (!trip) return errorResponse('not_found', 'Trip not found or forbidden', 404, origin);

  // Role check (audit #6): visibility is not enough. Everything below writes
  // via the service role, so only the owner or an accepted EDITOR may run
  // the optimizer. Runs through the caller-scoped client with the caller's
  // own id, the only combination user_can_access_trip accepts from an
  // authenticated JWT. Fail CLOSED: an RPC error is a 500, never an allow.
  const { data: canEdit, error: roleErr } = (await user.rpc('user_can_access_trip', {
    p_trip_id: body.tripId,
    p_user_id: callerId,
    p_min_role: 'editor',
  })) as { data: unknown; error: { message: string } | null };
  if (roleErr) {
    log({
      requestId,
      fn: 'optimize-trip',
      level: 'error',
      stage: 'role_check',
      userId: callerId,
      tripId: body.tripId,
      err: roleErr.message,
    });
    return errorResponse('db_error', 'Could not verify trip role', 500, origin);
  }
  if (canEdit !== true) {
    log({
      requestId,
      fn: 'optimize-trip',
      level: 'info',
      stage: 'role_check',
      userId: callerId,
      tripId: body.tripId,
      outcome: 'not_editor',
    });
    return errorResponse(
      'not_editor',
      'Only the trip owner or an editor can optimize this route.',
      403,
      origin,
    );
  }

  // Per-trip row-mutex via claim_trip_optimize (migration 0008). The mutex
  // is a single-statement UPDATE on trips.optimizing_at, atomic at the row
  // level regardless of which backend the connection is routed to — immune
  // to PgBouncer transaction-pooling connection swaps (the failure mode
  // that weakened the Phase 12 session-scoped advisory lock, review C1).
  //
  // We use a 5-minute TTL: if the Edge Function crashes mid-optimize, the
  // claim auto-expires so a subsequent call can re-claim without operator
  // intervention. Optimize completion is bounded — MAX_PLACES = 25 plus
  // 2-opt and matrix calls runs comfortably under 30s in observed worst
  // case, so a 5-minute TTL gives 10x headroom for cold start + retry while
  // still recovering from a hung function within minutes. (M5: the leg
  // phase is additionally capped by ROUTING_BUDGET_MS.)
  //
  // Behavior: if another optimize holds an unexpired claim, bail with 409
  // rather than serialize and double-charge the user's compute against the
  // Google free tier. Concurrent optimize requests for the same trip are
  // almost always a double-click bug, not intentional parallelism.
  //
  // `lockHeld` tracks whether *this* invocation won the claim. If the RPC
  // errors (e.g. migration not yet deployed in some env), we log and
  // proceed without the mutex — stateHash idempotence still prevents truly
  // wasted work on the rare race.
  let lockHeld = false;
  const lockRes = (await admin.rpc('claim_trip_optimize', {
    p_trip_id: body.tripId,
    p_ttl_seconds: 300,
  })) as { data: unknown; error: { message: string } | null };
  if (lockRes.error) {
    log({
      requestId,
      fn: 'optimize-trip',
      level: 'warn',
      stage: 'lock',
      err: lockRes.error.message,
    });
  } else if (lockRes.data === false) {
    return errorResponse(
      'already_optimizing',
      'Another optimization is already in progress for this trip.',
      409,
      origin,
    );
  } else {
    lockHeld = true;
  }

  try {
    // Load places. Both modes need them; the 'manual' mode additionally
    // relies on day_index being set by the user and orders within each day
    // by manual_rank (falling back to order_in_day — see orderChainByRank).
    // v2 S2.8.1: `deleted = false` — tombstoned rows (soft-delete, migration
    // 0027; the column is NOT NULL DEFAULT false) must never be clustered,
    // routed, or counted against MAX_PLACES. A tombstone that slipped in
    // here would resurrect a user-deleted place in the optimized layout.
    // M5 Y2.3: + arrival_mode / arrival_minutes (0035) for per-leg modes.
    const { data: places, error: placesErr } = (await user
      .from('trip_places')
      .select(
        'id, lat, lng, visit_duration_minutes, day_index, order_in_day, manual_rank, arrival_mode, arrival_minutes',
      )
      .eq('trip_id', body.tripId)
      .eq('deleted', false)) as { data: TripPlaceRow[] | null; error: { message: string } | null };
    if (placesErr) {
      return errorResponse('db_error', placesErr.message, 500, origin);
    }
    if (!places || places.length === 0) {
      return jsonResponse(
        {
          days: [],
          stateHash: '',
          placesUpdated: 0,
          legsWritten: 0,
          cacheHit: false,
          polylineDays: 0,
          mode: body.mode,
          keptOrderDays: [],
          legSources: countLegSources([]),
          meta: { contractVersion: OPTIMIZE_CONTRACT_VERSION },
        },
        { origin },
      );
    }
    if (places.length > MAX_PLACES) {
      return errorResponse(
        'too_many_places',
        `Trip has ${places.length} places; MVP limit is ${MAX_PLACES}`,
        400,
        origin,
      );
    }

    // M5 Y2.3: per-day default modes (0035). Fail CLOSED like the place
    // read: silently routing a "walking day" by car would be a wrong answer
    // with no error to retry on.
    const { data: dayRows, error: daysErr } = (await user
      .from('trip_days')
      .select('day_index, transport_mode')
      .eq('trip_id', body.tripId)
      .eq('deleted', false)) as { data: TripDayModeRow[] | null; error: { message: string } | null };
    if (daysErr) {
      log({
        requestId,
        fn: 'optimize-trip',
        level: 'error',
        stage: 'day_modes',
        userId: callerId,
        tripId: body.tripId,
        err: daysErr.message,
      });
      return errorResponse('db_error', daysErr.message, 500, origin);
    }
    const dayModes = new Map<number, TripMode>();
    for (const row of dayRows ?? []) {
      if (typeof row.day_index === 'number' && isTripMode(row.transport_mode)) {
        dayModes.set(row.day_index, row.transport_mode);
      }
    }

    const ctx: RoutingCtx = {
      requestId,
      tripId: body.tripId,
      userId: callerId,
      callerAuth,
      // trips_transport_mode_check guarantees one of the 4; fail-safe anyway.
      tripMode: isTripMode(trip.transport_mode) ? trip.transport_mode : 'driving',
      dayModes,
      deadline: Date.now() + ROUTING_BUDGET_MS,
      quotaExhausted: false,
      transitAllowed: makeTransitSwitch(user, requestId, body.tripId),
      routingCalls: 0,
    };

    // Branch on mode. 'manual' bypasses clustering + 2-opt entirely and
    // returns early after recomputing legs against the existing per-day
    // chain. 'optimized' runs the optimizer (except on kept-order days).
    if (body.mode === 'manual') {
      return await runManualMode({ admin, places, ctx, origin });
    }
    return await runOptimizedMode({ user, admin, trip, places, ctx, origin });
  } finally {
    // Release the row-mutex if we acquired it. The release is unconditional
    // at the SQL level (UPDATE ... SET optimizing_at = NULL WHERE id = ?)
    // and has no session-mismatch failure mode — unlike the Phase 12
    // pg_advisory_unlock, the row-mutex doesn't care which backend
    // connection issues the release. If the release fails (transient DB
    // blip), the TTL on the claim ensures the row self-recovers within 5
    // minutes, so a missed release is at worst a brief, self-healing window
    // — log it for observability and move on.
    if (lockHeld) {
      const releaseRes = (await admin
        .rpc('release_trip_optimize', { p_trip_id: body.tripId })
        .then(
          (r: { data: unknown; error: { message?: string } | null }) => r,
          (err: unknown) => ({ data: null, error: err as { message?: string } }),
        )) as { data: unknown; error: { message?: string } | null };
      if (releaseRes.error) {
        log({
          requestId,
          fn: 'optimize-trip',
          level: 'warn',
          stage: 'release_error',
          err: releaseRes.error.message ?? 'unknown',
        });
      }
    }
  }
}

// ============================================================
// 'optimized' mode
// ============================================================
async function runOptimizedMode(args: {
  user: Db;
  admin: Db;
  trip: TripRow;
  places: TripPlaceRow[];
  ctx: RoutingCtx;
  origin: string | null;
}): Promise<Response> {
  const { user, admin, trip, places, ctx, origin } = args;
  const { requestId, tripId } = ctx;
  const placeById = new Map<string, TripPlaceRow>(places.map((p) => [p.id, p]));

  // M5 Y2.3: days holding a flight/ferry arrival keep their places AND the
  // user's order; the optimizer only sees the other places.
  const keptOrderDays = keptOrderDayIndexes(places);
  const keptSet = new Set<number>(keptOrderDays);
  const freePlaces = places.filter((p) => p.day_index === null || !keptSet.has(p.day_index));

  let optimizerHash = '';
  let cacheHit = true;
  let reordered = false;
  const cacheRows: LegInsertRow[] = [];
  const optimizedDays: ResponseDay[] = [];

  if (freePlaces.length > 0) {
    // Matrix cache: routed (never estimated) pairwise rows < 30 days old,
    // keyed by mode. Only the modes a matrix may be built in are read.
    const matrixModes = [...new Set<TripMode>([ctx.tripMode, ...ctx.dayModes.values()])];
    const { data: cachedRaw } = (await user
      .from('trip_legs')
      .select('from_place_id, to_place_id, duration_seconds, distance_meters, computed_at, transport_mode, source, day_index')
      .eq('trip_id', tripId)
      .lt('day_index', 0)
      .in('transport_mode', matrixModes)) as { data: CachedLegRow[] | null };
    const cachedRows: CachedLegRow[] = cachedRaw ?? [];

    const phase1 = await buildMatrix({ places: freePlaces, mode: ctx.tripMode, cachedRows, ctx, stage: 'matrix' });
    if (phase1.kind === 'quota') {
      // Audit #2: the caller's daily routing quota is spent. Surface the
      // same quota_exceeded envelope instead of a generic matrix failure,
      // so the client can say "try again tomorrow" instead of "retry".
      return errorResponse(
        'quota_exceeded',
        phase1.message ?? 'Daily route calculation limit reached. Try again tomorrow.',
        429,
        origin,
      );
    }
    if (phase1.kind === 'failed') {
      return errorResponse('matrix_failed', 'Distance matrix failed', 502, origin);
    }
    cacheHit = phase1.cacheHit;
    cacheRows.push(...phase1.cacheRows);

    const result = optimize({
      places: freePlaces.map(toOptimizerPlace),
      legs: phase1.legs,
      dailyBudgetMinutes: Math.round(trip.daily_hours_budget * 60),
      anchorPlaceId: trip.anchor_place_id ?? undefined,
    });
    optimizerHash = result.stateHash;

    // Optimizer days are 0..k-1; kept days hold their own indexes, so the
    // optimized days fill the remaining ones in order (identity when no
    // day is kept).
    const dayIndexes = freeDayIndexes(result.days.length, keptSet);
    result.days.forEach((day: { orderedPlaceIds: string[]; totalMinutes: number }, i: number) => {
      optimizedDays.push({
        dayIndex: dayIndexes[i]!,
        orderedPlaceIds: [...day.orderedPlaceIds],
        totalMinutes: day.totalMinutes,
      });
    });

    // Phase 2 (M5 Y2.3): a day whose effective default mode differs from the
    // trip mode is re-ordered with a matrix in its own mode. Best effort:
    // any failure keeps the phase-1 order.
    for (const day of optimizedDays) {
      const dayMode = dayDefaultMode(ctx.dayModes.get(day.dayIndex), ctx.tripMode);
      if (dayMode === ctx.tripMode || day.orderedPlaceIds.length < 3) continue;
      if (Date.now() > ctx.deadline) {
        log({ requestId, fn: 'optimize-trip', level: 'warn', stage: 'day_matrix', tripId, dayIndex: day.dayIndex, skipped: 'time_budget' });
        continue;
      }
      const dayPlaces = day.orderedPlaceIds.map((id) => placeById.get(id)!);
      const m = await buildMatrix({ places: dayPlaces, mode: dayMode, cachedRows, ctx, stage: 'day_matrix' });
      if (m.kind !== 'ok') continue;
      cacheRows.push(...m.cacheRows);
      const re = optimize({
        places: dayPlaces.map(toOptimizerPlace),
        legs: m.legs,
        // One cluster: this call only re-orders the day's places.
        dailyBudgetMinutes: Number.MAX_SAFE_INTEGER,
        anchorPlaceId: trip.anchor_place_id ?? undefined,
      });
      const only = re.days[0];
      if (!only || re.days.length !== 1 || only.orderedPlaceIds.length !== day.orderedPlaceIds.length) continue;
      if (only.orderedPlaceIds.join(',') !== day.orderedPlaceIds.join(',')) reordered = true;
      day.orderedPlaceIds = [...only.orderedPlaceIds];
      day.totalMinutes = only.totalMinutes;
    }
  }

  // Kept days: the user's order (manual_rank, legacy order_in_day fallback).
  const keptChains = keptOrderDays.map((dayIndex) => {
    const chain = places.filter((p) => p.day_index === dayIndex);
    orderChainByRank(chain);
    return { dayIndex, chain };
  });

  // Persist day_index + order_in_day atomically via the apply_optimization RPC
  // (single UPDATE scoped to trip_id — no per-row roundtrip). Kept days only
  // write the rank-derived order_in_day of rows that changed (same rule as
  // the manual branch; day_index passes through unchanged).
  const assignments: Array<{ id: string; day_index: number; order_in_day: number }> = [];
  for (const day of optimizedDays) {
    day.orderedPlaceIds.forEach((id, i) => assignments.push({ id, day_index: day.dayIndex, order_in_day: i }));
  }
  for (const { dayIndex, chain } of keptChains) {
    if (!chainHasRank(chain)) continue;
    chain.forEach((p, i) => {
      if (p.order_in_day !== i) assignments.push({ id: p.id, day_index: dayIndex, order_in_day: i });
    });
  }
  if (assignments.length > 0) {
    const { error: rpcErr } = (await admin.rpc('apply_optimization', {
      p_trip_id: tripId,
      p_assignments: assignments,
    })) as { error: { message: string } | null };
    if (rpcErr) {
      log({
        requestId,
        fn: 'optimize-trip',
        level: 'error',
        err: rpcErr.message,
        stage: 'apply_optimization',
      });
      return errorResponse('rpc_failed', 'apply_optimization failed', 500, origin);
    }
  }

  // Legs for every day (optimized + kept), per-leg modes.
  const dayChains = [
    ...optimizedDays.map((d) => ({ dayIndex: d.dayIndex, chain: d.orderedPlaceIds.map((id) => placeById.get(id)!) })),
    ...keptChains,
  ].sort((a, b) => a.dayIndex - b.dayIndex);
  const legsByDay = await computeDayLegs(dayChains, ctx);
  const dayLegRows = legRows(tripId, dayChains, legsByDay);

  // Replace the day legs (day_index >= 0) — the previous layout's legs would
  // otherwise be summed with the new ones. Matrix cache rows (-1) stay.
  const { error: delErr } = (await admin
    .from('trip_legs')
    .delete()
    .eq('trip_id', tripId)
    .gte('day_index', 0)) as { error: { message: string } | null };
  if (delErr) {
    log({ requestId, fn: 'optimize-trip', level: 'error', stage: 'delete_legs', err: delErr.message });
    return errorResponse('db_error', delErr.message, 500, origin);
  }
  // Cache rows first, day legs last: pre-Y2.3 clients key legs by
  // from->to with last-wins, so the day leg must come after a same-pair
  // cache row in the (insertion-ordered) read.
  const rowsToInsert = [...cacheRows, ...dayLegRows];
  if (rowsToInsert.length > 0) {
    const { error: insErr } = (await admin.from('trip_legs').insert(rowsToInsert)) as {
      error: { message: string } | null;
    };
    if (insErr) {
      log({ requestId, fn: 'optimize-trip', level: 'error', stage: 'insert_legs', err: insErr.message });
      return errorResponse('db_error', insErr.message, 500, origin);
    }
  }

  const keptResponseDays: ResponseDay[] = keptChains.map(({ dayIndex, chain }) => ({
    dayIndex,
    orderedPlaceIds: chain.map((p) => p.id),
    totalMinutes: dayTotalMinutes(chain, legsByDay.get(dayIndex) ?? []),
  }));
  const days = [...optimizedDays, ...keptResponseDays].sort((a, b) => a.dayIndex - b.dayIndex);

  // Unchanged (optimizer hash) unless M5 logic changed the layout the
  // optimizer alone would have produced.
  const stateHash =
    keptOrderDays.length === 0 && !reordered
      ? optimizerHash
      : await sha256Hex(`${optimizerHash}|${layoutSignature(days)}`);

  const allLegs = [...legsByDay.values()].flat();
  const legSources = countLegSources(allLegs);
  const polylineDays = countRoutedDays(legsByDay);

  log({
    requestId,
    fn: 'optimize-trip',
    level: 'info',
    tripId,
    places: places.length,
    days: days.length,
    keptOrderDays,
    cacheHit,
    legsWritten: rowsToInsert.length,
    polylineDays,
    legSources,
    routingCalls: ctx.routingCalls,
  });

  return jsonResponse(
    {
      stateHash,
      days,
      placesUpdated: places.length,
      legsWritten: rowsToInsert.length,
      cacheHit,
      polylineDays,
      mode: 'optimized' as const,
      keptOrderDays,
      legSources,
      meta: { contractVersion: OPTIMIZE_CONTRACT_VERSION },
    },
    { origin },
  );
}

// ============================================================
// Phase 23 Step 23.2: manual-mode renderer.
// ============================================================
// Skips k-means + 2-opt entirely. The user has hand-arranged places into
// days; this function orders each day's chain by the user-owned
// manual_rank (v2 S2.8.2 — C1 loop closure), persists the derived
// order_in_day, and refreshes trip_legs so the route traces what the
// user laid out.
//
// Invariants
// ----------
// * day_index is NEVER written here (manual mode never reassigns days),
//   and manual_rank is NEVER written anywhere server-side (client-owned,
//   LWW-synced — see migration 0027 + docs/v2/risks-and-decisions.md C1).
//   order_in_day IS written (v2 S2.8.2): it is server-DERIVED from
//   manual_rank via apply_optimization, keeping the server the sole owner
//   of optimizer-domain columns while user intent stays in manual_rank.
// * Skips places with day_index = null (unscheduled). This is not an
//   error — it is the documented edge case from the planner brief.
// * Tombstoned places (deleted = true) never reach this function — the
//   parent handler's select filters them (v2 S2.8.1).
// * Replaces trip_legs for the trip atomically: delete-then-insert under
//   the admin client (RLS already authorized the caller via the parent
//   handler; admin is used only to bypass the per-row eq filter that
//   PostgREST would otherwise require for a bulk delete).
// * M5 Y2.3: every leg uses its effective mode (arrival_mode ?? day default
//   ?? trip default); see the file header for the routing policy.
//
// Response shape mirrors the optimized branch so OptimizeError / OptimizeResult
// consumers don't need a discriminated union — every field is populated:
//   - days                : grouped {dayIndex, orderedPlaceIds, totalMinutes}
//                          where totalMinutes is the sum of visit_duration_minutes
//                          (no travel-time reflow happens in manual mode)
//   - placesUpdated       : rows whose order_in_day was rewritten from
//                          manual_rank (0 for all-NULL-rank trips — i.e.
//                          every v1 trip — and for re-runs on an
//                          unchanged layout)
//   - legsWritten         : count of new trip_legs rows
//   - cacheHit            : false (we always recompute legs; the user is
//                          asking for a fresh render)
//   - polylineDays        : number of days with at least one routed leg
//   - mode                : 'manual'
//   - stateHash           : sha256 of the (orderedDayIds) list, so React Query
//                          can dedupe a "manual re-run on identical layout"
//   - keptOrderDays       : [] (every manual day keeps its order by definition)
async function runManualMode(args: {
  admin: Db;
  places: TripPlaceRow[];
  ctx: RoutingCtx;
  origin: string | null;
}): Promise<Response> {
  const { admin, places, ctx, origin } = args;
  const { requestId, tripId } = ctx;

  // 1. Group scheduled places by day_index. Skip unscheduled.
  const byDay = new Map<number, TripPlaceRow[]>();
  for (const p of places) {
    if (p.day_index === null) continue;
    const bucket = byDay.get(p.day_index);
    if (bucket) bucket.push(p);
    else byDay.set(p.day_index, [p]);
  }

  // 2. Order each day's chain (v2 S2.8.2 — C1 loop closure). Rule in
  //    legs.ts orderChainByRank: all-NULL-rank days keep the legacy
  //    order_in_day order; otherwise ranked rows first, then unranked.
  for (const list of byDay.values()) orderChainByRank(list);

  const sortedDays = Array.from(byDay.keys()).sort((a, b) => a - b);

  // 3. Build the response 'days' array up front — independent of leg fetch
  //    success so a partial polyline failure doesn't lose the layout
  //    summary the client needs.
  const responseDays: ResponseDay[] = sortedDays.map((dayIndex) => {
    const list = byDay.get(dayIndex)!;
    const totalMinutes = list.reduce((sum, p) => sum + p.visit_duration_minutes, 0);
    return {
      dayIndex,
      orderedPlaceIds: list.map((p) => p.id),
      totalMinutes,
    };
  });

  // 4. stateHash from the layout. Lets the client dedupe
  //    "manual re-run on identical layout" if the mutation fires twice.
  const stateHash = await sha256Hex(layoutSignature(responseDays));

  // 5. Persist the derived order_in_day back (v2 S2.8.2). C1: day_index /
  //    order_in_day are SERVER-owned; the manual branch derives them from
  //    the user-owned manual_rank rather than letting the client write
  //    them. Scope of the write:
  //      - Only days where at least one row carries a rank (all-NULL days
  //        are legacy-authoritative — zero writes, byte-identical v1
  //        behavior).
  //      - Only rows whose stored order_in_day differs from the derived
  //        position (idempotent: a re-run on an unchanged layout writes 0
  //        rows and causes no updated_at churn for the sync pull).
  //    day_index is passed through UNCHANGED — manual mode never
  //    reassigns days; apply_optimization just needs it in the payload.
  //
  //    Sequenced BEFORE the trip_legs wipe so a persistence failure exits
  //    with the previous legs intact instead of leaving the trip leg-less.
  const assignments: Array<{ id: string; day_index: number; order_in_day: number }> = [];
  for (const dayIndex of sortedDays) {
    const chain = byDay.get(dayIndex)!;
    if (!chainHasRank(chain)) continue;
    chain.forEach((p, i) => {
      if (p.order_in_day !== i) {
        assignments.push({ id: p.id, day_index: dayIndex, order_in_day: i });
      }
    });
  }
  let placesUpdated = 0;
  if (assignments.length > 0) {
    const { error: rankRpcErr } = (await admin.rpc('apply_optimization', {
      p_trip_id: tripId,
      p_assignments: assignments,
    })) as { error: { message: string } | null };
    if (rankRpcErr) {
      log({
        requestId,
        fn: 'optimize-trip',
        level: 'error',
        mode: 'manual',
        stage: 'apply_rank_order',
        err: rankRpcErr.message,
      });
      return errorResponse('rpc_failed', 'apply_optimization failed', 500, origin);
    }
    placesUpdated = assignments.length;
  }

  // 6. Compute every day's legs (per-leg modes). Done BEFORE the wipe so the
  //    trip is never leg-less while routing calls are in flight. Never
  //    fails: an unroutable leg becomes an estimate.
  const dayChains = sortedDays.map((dayIndex) => ({ dayIndex, chain: byDay.get(dayIndex)! }));
  const legsByDay = await computeDayLegs(dayChains, ctx);
  const legsToInsert = legRows(tripId, dayChains, legsByDay);

  // 7. Wipe existing trip_legs for this trip. We overwrite per-day, but
  //    the prior layout might have had MORE days than the manual layout
  //    (e.g. user merged days 2 and 3 into day 2); a delete-first ensures
  //    no stale day's leg leaks into the rendered route.
  const { error: delErr } = (await admin
    .from('trip_legs')
    .delete()
    .eq('trip_id', tripId)) as { error: { message: string } | null };
  if (delErr) {
    log({
      requestId,
      fn: 'optimize-trip',
      level: 'error',
      mode: 'manual',
      stage: 'delete_legs',
      err: delErr.message,
    });
    return errorResponse('db_error', delErr.message, 500, origin);
  }

  if (legsToInsert.length > 0) {
    const { error: insErr } = (await admin.from('trip_legs').insert(legsToInsert)) as {
      error: { message: string } | null;
    };
    if (insErr) {
      log({
        requestId,
        fn: 'optimize-trip',
        level: 'error',
        mode: 'manual',
        stage: 'insert_legs',
        err: insErr.message,
      });
      return errorResponse('db_error', insErr.message, 500, origin);
    }
  }

  const legSources = countLegSources([...legsByDay.values()].flat());
  const polylineDays = countRoutedDays(legsByDay);

  log({
    requestId,
    fn: 'optimize-trip',
    level: 'info',
    mode: 'manual',
    tripId,
    places: places.length,
    days: responseDays.length,
    placesUpdated,
    legsWritten: legsToInsert.length,
    polylineDays,
    legSources,
    routingCalls: ctx.routingCalls,
  });

  return jsonResponse(
    {
      stateHash,
      days: responseDays,
      placesUpdated,
      legsWritten: legsToInsert.length,
      cacheHit: false,
      polylineDays,
      mode: 'manual' as const,
      keptOrderDays: [] as number[],
      legSources,
      meta: { contractVersion: OPTIMIZE_CONTRACT_VERSION },
    },
    { origin },
  );
}

// ============================================================
// Matrix (optimizer input), keyed by mode — M5 Y2.3
// ============================================================

type MatrixOutcome =
  | { kind: 'ok'; legs: OptimizerLeg[]; cacheRows: LegInsertRow[]; cacheHit: boolean }
  | { kind: 'quota'; message: string | null }
  | { kind: 'failed' };

/**
 * Travel times between every ordered pair of `places` in `mode`:
 * fresh routed cache rows first, one distance-matrix call for the rest.
 *   - non-transit: failures surface ('quota' / 'failed'); the phase-1 caller
 *     maps them to the pre-M5 429 / 502, phase 2 just keeps its order.
 *   - transit: never fails. Kill switch, spent quota, time budget, a matrix
 *     over Google's 100-element transit cap, or any upstream error ->
 *     estimated pairs (NOT cached, so a later run can still route them).
 * Returned cacheRows are the freshly routed pairs (day_index -1).
 */
async function buildMatrix(args: {
  places: TripPlaceRow[];
  mode: TripMode;
  cachedRows: CachedLegRow[];
  ctx: RoutingCtx;
  stage: 'matrix' | 'day_matrix';
}): Promise<MatrixOutcome> {
  const { places, mode, cachedRows, ctx, stage } = args;
  const ids = new Set(places.map((p) => p.id));

  // Freshest routed row per ordered pair.
  const nowMs = Date.now();
  const cachedByPair = new Map<string, CachedLegRow>();
  for (const row of cachedRows) {
    if (row.transport_mode !== mode) continue;
    if (!ids.has(row.from_place_id) || !ids.has(row.to_place_id)) continue;
    if (typeof row.day_index === 'number' && row.day_index >= 0) continue; // day legs are not a matrix
    if (row.source === 'estimate' || row.source === 'user') continue; // never cache a guess
    const at = Date.parse(row.computed_at);
    if (!(nowMs - at < LEG_TTL_MS)) continue; // stale (or unparseable)
    const key = `${row.from_place_id}__${row.to_place_id}`;
    const prev = cachedByPair.get(key);
    if (!prev || Date.parse(prev.computed_at) < at) cachedByPair.set(key, row);
  }
  const cached: OptimizerLeg[] = [...cachedByPair.values()].map((l) => ({
    fromId: l.from_place_id,
    toId: l.to_place_id,
    durationSeconds: l.duration_seconds,
  }));

  const missing: Array<{ from: TripPlaceRow; to: TripPlaceRow }> = [];
  for (const a of places) {
    for (const b of places) {
      if (a.id === b.id) continue;
      if (!cachedByPair.has(`${a.id}__${b.id}`)) missing.push({ from: a, to: b });
    }
  }
  if (missing.length === 0) return { kind: 'ok', legs: cached, cacheRows: [], cacheHit: true };

  const estimatedMissing = (reason: string): MatrixOutcome => {
    log({
      requestId: ctx.requestId,
      fn: 'optimize-trip',
      level: 'info',
      stage,
      userId: ctx.userId,
      tripId: ctx.tripId,
      mode,
      pairs: missing.length,
      outcome: 'estimated',
      reason,
    });
    return {
      kind: 'ok',
      legs: [...cached, ...missing.map((m) => estimatedPair(mode, m.from, m.to))],
      cacheRows: [],
      cacheHit: false,
    };
  };

  if (mode === 'transit') {
    if (!(await ctx.transitAllowed())) return estimatedMissing('transit_disabled');
    if (places.length * places.length > GOOGLE_TRANSIT_MATRIX_MAX_ELEMENTS) {
      return estimatedMissing('transit_matrix_limit');
    }
    if (ctx.quotaExhausted) return estimatedMissing('quota_exhausted');
    if (Date.now() > ctx.deadline) return estimatedMissing('time_budget');
  } else if (stage === 'day_matrix' && (ctx.quotaExhausted || Date.now() > ctx.deadline)) {
    return { kind: 'failed' };
  }

  // Fix (2026-06-11, caught by the first real 14-place trip): send each
  // UNIQUE place once as both origin and destination. distance-matrix
  // computes the full N×M cross product, so pair-expanded arrays would both
  // blow the endpoint's 25-coordinate cap and request a quadratically
  // redundant matrix. `places` is capped at MAX 25 by the too_many_places
  // guard, which is exactly the matrix endpoint's per-side limit.
  const coords = places.map((p) => ({ lat: p.lat, lng: p.lng }));
  ctx.routingCalls += 1;
  const matrixRes = await callEdge(
    'distance-matrix',
    { origins: coords, destinations: coords, mode },
    ctx.callerAuth,
    MATRIX_TIMEOUT_MS,
  );
  if (!matrixRes.ok) {
    const quota = matrixRes.status === 429 && matrixRes.errorCode === 'quota_exceeded';
    if (quota) ctx.quotaExhausted = true;
    if (mode === 'transit') {
      return estimatedMissing(quota ? 'quota_exceeded' : `http_${matrixRes.status}:${matrixRes.errorCode ?? 'unknown'}`);
    }
    log({
      requestId: ctx.requestId,
      fn: 'optimize-trip',
      level: quota ? 'info' : 'error',
      stage,
      userId: ctx.userId,
      tripId: ctx.tripId,
      mode,
      status: matrixRes.status,
      ...(quota ? { outcome: 'quota_exceeded' } : { err: matrixRes.errorCode ?? 'unknown' }),
    });
    return quota ? { kind: 'quota', message: matrixRes.errorMessage } : { kind: 'failed' };
  }

  const matrixBody = matrixRes.body as { legs?: unknown; provider?: unknown } | null;
  const matrixLegs = Array.isArray(matrixBody?.legs) ? matrixBody.legs : null;
  if (!matrixLegs) {
    if (mode === 'transit') return estimatedMissing('bad_response');
    log({ requestId: ctx.requestId, fn: 'optimize-trip', level: 'error', stage, mode, err: 'bad_matrix_response' });
    return { kind: 'failed' };
  }

  const source = routedSource(matrixBody?.provider);
  const missingKeys = new Set(missing.map((m) => `${m.from.id}__${m.to.id}`));
  const fresh: OptimizerLeg[] = [];
  const cacheRows: LegInsertRow[] = [];
  const answered = new Set<string>();
  for (const raw of matrixLegs) {
    const el = raw as { fromIndex?: unknown; toIndex?: unknown; durationSeconds?: unknown; distanceMeters?: unknown };
    if (typeof el.fromIndex !== 'number' || typeof el.toIndex !== 'number') continue;
    const fromPlace = places[el.fromIndex];
    const toPlace = places[el.toIndex];
    if (!fromPlace || !toPlace) continue;
    if (fromPlace.id === toPlace.id) continue; // diagonal — zero-length hop
    const key = `${fromPlace.id}__${toPlace.id}`;
    // Cached pairs stay cached; only the ones we actually needed are fresh.
    if (!missingKeys.has(key) || answered.has(key)) continue;
    if (typeof el.durationSeconds !== 'number' || !Number.isFinite(el.durationSeconds) || el.durationSeconds < 0) continue;
    const durationSeconds = Math.round(el.durationSeconds);
    const distanceMeters =
      typeof el.distanceMeters === 'number' && Number.isFinite(el.distanceMeters) && el.distanceMeters >= 0
        ? Math.round(el.distanceMeters)
        : 0;
    answered.add(key);
    fresh.push({ fromId: fromPlace.id, toId: toPlace.id, durationSeconds });
    cacheRows.push({
      trip_id: ctx.tripId,
      from_place_id: fromPlace.id,
      to_place_id: toPlace.id,
      day_index: -1,
      transport_mode: mode,
      duration_seconds: durationSeconds,
      distance_meters: distanceMeters,
      polyline: null,
      // Pairwise cache rows come from distance-matrix, which carries no
      // step geometry — transit_steps is a render artifact, not a cache key.
      transit_steps: null,
      source,
    });
  }

  // Transit pairs Google could not route become estimates (the optimizer's
  // own fallback assumes ~30 km/h by car). Other modes keep the pre-M5
  // behavior: unanswered pairs fall back inside the optimizer.
  const extra: OptimizerLeg[] =
    mode === 'transit'
      ? missing
          .filter((m) => !answered.has(`${m.from.id}__${m.to.id}`))
          .map((m) => estimatedPair(mode, m.from, m.to))
      : [];

  return { kind: 'ok', legs: [...cached, ...fresh, ...extra], cacheRows, cacheHit: false };
}

function estimatedPair(mode: TripMode, from: TripPlaceRow, to: TripPlaceRow): OptimizerLeg {
  return { fromId: from.id, toId: to.id, durationSeconds: estimateLeg(mode, from, to).durationSeconds };
}

function toOptimizerPlace(p: TripPlaceRow): OptimizerPlace {
  return { id: p.id, lat: p.lat, lng: p.lng, visitMinutes: p.visit_duration_minutes };
}

// ============================================================
// Day legs — M5 Y2.3
// ============================================================

/**
 * Compute every day's legs. Segments (legs.ts segmentDayLegs) run with
 * bounded concurrency; results come back in day/leg order. Never throws and
 * never drops a leg: whatever can't be routed is estimated.
 */
async function computeDayLegs(
  days: ReadonlyArray<{ dayIndex: number; chain: TripPlaceRow[] }>,
  ctx: RoutingCtx,
): Promise<Map<number, LegResult[]>> {
  const tasks: Array<{ dayIndex: number; segment: LegSegment<TripPlaceRow> }> = [];
  for (const { dayIndex, chain } of days) {
    const planned = planDayLegs(chain, ctx.dayModes.get(dayIndex) ?? null, ctx.tripMode);
    for (const segment of segmentDayLegs(planned)) tasks.push({ dayIndex, segment });
  }
  const resolved = await mapWithConcurrency(tasks, ROUTING_CONCURRENCY, async (task) => {
    try {
      return await resolveSegment(task.segment, ctx);
    } catch (err) {
      // Defensive: resolveSegment handles every expected failure itself.
      log({ requestId: ctx.requestId, fn: 'optimize-trip', level: 'error', stage: 'leg', err: String(err).slice(0, 300) });
      return segmentLegs(task.segment).map(estimatedLegResult);
    }
  });
  const byDay = new Map<number, LegResult[]>();
  for (const { dayIndex } of days) byDay.set(dayIndex, []);
  tasks.forEach((task, i) => byDay.get(task.dayIndex)!.push(...resolved[i]!));
  return byDay;
}

function segmentLegs(segment: LegSegment<TripPlaceRow>): PlannedLeg[] {
  return segment.kind === 'run' ? segment.legs : [segment.leg];
}

async function resolveSegment(segment: LegSegment<TripPlaceRow>, ctx: RoutingCtx): Promise<LegResult[]> {
  switch (segment.kind) {
    case 'user':
      return [userLegResult(segment.leg)];
    case 'estimate':
      return [estimatedLegResult(segment.leg)];
    case 'transit':
      return [await resolveTransitLeg(segment.leg, ctx)];
    case 'run':
      return await resolveRun(segment.mode, segment.legs, ctx);
  }
}

/** One Google Routes transit call (quota + kill switch permitting), else an estimate. */
async function resolveTransitLeg(leg: PlannedLeg, ctx: RoutingCtx): Promise<LegResult> {
  const skip = !(await ctx.transitAllowed())
    ? 'transit_disabled'
    : ctx.quotaExhausted
      ? 'quota_exhausted'
      : Date.now() > ctx.deadline
        ? 'time_budget'
        : null;
  if (skip) {
    logLegEstimate(ctx, 'transit', 1, skip);
    return estimatedLegResult(leg);
  }
  const res = await callDirections(
    { origin: latLng(leg.from), destination: latLng(leg.to), mode: 'transit' },
    ctx,
  );
  if (!res.ok) {
    logLegEstimate(ctx, 'transit', 1, failureReason(res, ctx));
    return estimatedLegResult(leg);
  }
  const parsed = routedLegsFromDirections(res.body, [leg]);
  if (parsed.kind !== 'ok') {
    logLegEstimate(ctx, 'transit', 1, parsed.kind === 'invalid' ? parsed.reason : 'bad_response');
    return estimatedLegResult(leg);
  }
  return parsed.results[0]!;
}

/**
 * One directions-polyline call for consecutive same-mode ground legs, split
 * per leg. A multi-leg answer without a usable split is re-asked one leg
 * per call; a failed call estimates the whole run.
 */
async function resolveRun(mode: RunMode, legs: PlannedLeg[], ctx: RoutingCtx): Promise<LegResult[]> {
  const skip = ctx.quotaExhausted ? 'quota_exhausted' : Date.now() > ctx.deadline ? 'time_budget' : null;
  if (skip) {
    logLegEstimate(ctx, mode, legs.length, skip);
    return legs.map(estimatedLegResult);
  }
  const waypoints = [legs[0]!.from, ...legs.map((l) => l.to)];
  const res = await callDirections(
    {
      origin: latLng(waypoints[0]!),
      destination: latLng(waypoints[waypoints.length - 1]!),
      intermediates: waypoints.slice(1, -1).map(latLng),
      mode,
      ...(legs.length > 1 ? { perLeg: true } : {}),
    },
    ctx,
  );
  if (!res.ok) {
    logLegEstimate(ctx, mode, legs.length, failureReason(res, ctx));
    return legs.map(estimatedLegResult);
  }
  const parsed = routedLegsFromDirections(res.body, legs);
  if (parsed.kind === 'ok') return parsed.results;
  if (parsed.kind === 'no_breakdown') {
    log({
      requestId: ctx.requestId,
      fn: 'optimize-trip',
      level: 'warn',
      stage: 'leg',
      mode,
      legs: legs.length,
      fallback: 'one_call_per_leg',
    });
    const out: LegResult[] = [];
    for (const leg of legs) out.push(...(await resolveRun(mode, [leg], ctx)));
    return out;
  }
  logLegEstimate(ctx, mode, legs.length, parsed.reason);
  return legs.map(estimatedLegResult);
}

async function callDirections(body: Record<string, unknown>, ctx: RoutingCtx): Promise<EdgeCallResult> {
  ctx.routingCalls += 1;
  return await callEdge('directions-polyline', body, ctx.callerAuth, POLYLINE_TIMEOUT_MS);
}

/** Records a spent quota on the context and names the failure for logs. */
function failureReason(res: EdgeCallResult, ctx: RoutingCtx): string {
  if (res.status === 429 && res.errorCode === 'quota_exceeded') {
    ctx.quotaExhausted = true;
    return 'quota_exceeded';
  }
  return `http_${res.status}:${res.errorCode ?? 'unknown'}`;
}

function logLegEstimate(ctx: RoutingCtx, mode: string, legs: number, reason: string): void {
  log({
    requestId: ctx.requestId,
    fn: 'optimize-trip',
    level: 'info',
    stage: 'leg_estimate',
    userId: ctx.userId,
    tripId: ctx.tripId,
    mode,
    legs,
    reason,
  });
}

function latLng(p: { lat: number; lng: number }): { lat: number; lng: number } {
  return { lat: p.lat, lng: p.lng };
}

/** LegResults -> trip_legs rows, in day/leg order. */
function legRows(
  tripId: string,
  days: ReadonlyArray<{ dayIndex: number }>,
  legsByDay: ReadonlyMap<number, LegResult[]>,
): LegInsertRow[] {
  const rows: LegInsertRow[] = [];
  for (const { dayIndex } of days) {
    for (const leg of legsByDay.get(dayIndex) ?? []) {
      rows.push({
        trip_id: tripId,
        from_place_id: leg.fromId,
        to_place_id: leg.toId,
        day_index: dayIndex,
        transport_mode: leg.mode,
        duration_seconds: leg.durationSeconds,
        distance_meters: leg.distanceMeters,
        polyline: leg.polyline,
        // v2 P1.2: transit legs carry per-step geometry here (top-level
        // polyline stays null for transit); null for every other leg.
        transit_steps: leg.transitSteps,
        source: leg.source,
      });
    }
  }
  return rows;
}

/** Days with at least one leg a routing API answered (response `polylineDays`). */
function countRoutedDays(legsByDay: ReadonlyMap<number, LegResult[]>): number {
  let n = 0;
  for (const legs of legsByDay.values()) {
    if (legs.some((l) => l.source === 'ors' || l.source === 'google')) n += 1;
  }
  return n;
}

function layoutSignature(days: ReadonlyArray<ResponseDay>): string {
  return days.map((d) => `${d.dayIndex}:${d.orderedPlaceIds.join(',')}`).join('|');
}

/**
 * Memoized read of app_config 'transit_routing' through the caller-scoped
 * client (app_config is SELECT-able by authenticated, 0022). 'estimate' or
 * 'off' stops Google transit calls; anything else — including an absent row
 * or a failed read — keeps the pre-M5 default (Google), exactly like the
 * routing_provider switch fails safe to Google. Spend stays bounded by the
 * per-user routing quota either way.
 */
function makeTransitSwitch(user: Db, requestId: string, tripId: string): () => Promise<boolean> {
  let pending: Promise<boolean> | null = null;
  return () => {
    pending ??= (async () => {
      try {
        const { data, error } = (await user
          .from('app_config')
          .select('value')
          .eq('key', TRANSIT_SWITCH_KEY)
          .maybeSingle()) as { data: { value?: unknown } | null; error: { message: string } | null };
        if (error) {
          log({ requestId, fn: 'optimize-trip', level: 'warn', stage: 'transit_switch', err: error.message });
          return true;
        }
        const value = data?.value;
        const allowed = !(value === 'estimate' || value === 'off');
        if (!allowed) {
          log({ requestId, fn: 'optimize-trip', level: 'info', stage: 'transit_switch', tripId, transit_routing: value });
        }
        return allowed;
      } catch (err) {
        log({ requestId, fn: 'optimize-trip', level: 'warn', stage: 'transit_switch', err: String(err).slice(0, 200) });
        return true;
      }
    })();
    return pending;
  };
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep input order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// SHA-256 -> hex. Used for the manual-mode stateHash (and the optimized
// hash when M5 logic changed the layout) so React Query can dedupe
// identical re-renders. Web Crypto is available in Deno natively.
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

interface EdgeCallResult {
  ok: boolean;
  /** HTTP status; 0 when the request never completed (timeout / network / env). */
  status: number;
  body: unknown;
  /** `error.code` from the shared envelope on non-2xx, when present. */
  errorCode: string | null;
  errorMessage: string | null;
}

/**
 * POST to a sibling Edge Function AS THE CALLER (audit #2). The caller's
 * Authorization header is forwarded verbatim, so the downstream
 * requireUser() authenticates, and consumeQuota() meters, the same user.
 * Never the anon key: those functions reject it now. `apikey` carries the
 * public anon key only for gateway routing parity with supabase-js
 * `functions.invoke`; it grants nothing.
 */
async function callEdge(
  fnName: string,
  body: unknown,
  callerAuth: string,
  timeoutMs: number,
): Promise<EdgeCallResult> {
  // @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
  const env: { get(key: string): string | undefined } = Deno.env;
  const url = env.get('SUPABASE_URL');
  const anon = env.get('SUPABASE_ANON_KEY');
  if (!url) {
    return { ok: false, status: 0, body: null, errorCode: 'env_missing', errorMessage: null };
  }
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: callerAuth,
    };
    if (anon) headers.apikey = anon;
    const res: Response = await fetchWithTimeout(
      `${url}/functions/v1/${fnName}`,
      { method: 'POST', headers, body: JSON.stringify(body) },
      timeoutMs,
    );
    const json: unknown = await res.json().catch(() => null);
    const envelope = res.ok
      ? null
      : (json as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    return {
      ok: res.ok,
      status: res.status,
      body: json,
      errorCode: typeof envelope?.code === 'string' ? envelope.code : null,
      errorMessage: typeof envelope?.message === 'string' ? envelope.message : null,
    };
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      body: null,
      errorCode: isAbort ? 'timeout' : 'network_error',
      errorMessage: null,
    };
  }
}

// @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
Deno.serve(handler);
