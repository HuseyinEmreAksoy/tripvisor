// optimize-trip — orchestrates route rendering for a trip.
//
// Contract:
//   POST { tripId: string, mode?: 'optimized' | 'manual' }
//   -> {
//        stateHash: string,
//        days: Array<{ dayIndex, orderedPlaceIds, totalMinutes }>,
//        placesUpdated: number,
//        legsWritten: number,
//        cacheHit: boolean,
//        polylineDays: number,
//        mode: 'optimized' | 'manual',
//      }
//
// Modes (Phase 23 Step 23.2):
//   'optimized' (default, back-compat) — k-means + 2-opt.
//     1. Auth (JWT, RLS-scoped).
//     2. Row-mutex via claim_trip_optimize.
//     3. Load trip + places. Cap at 25 places.
//     4. Fetch N×N distance matrix, reusing legs < 30 days old.
//     5. Run the pure optimizer (k-means + 2-opt).
//     6. Write day_index / order_in_day via apply_optimization (atomic).
//     7. For each day, call directions-polyline and upsert into trip_legs.
//
//   'manual' — keep current (day_index, order_in_day) untouched; only
//              recompute trip_legs against the existing per-day chain.
//     1. Auth (JWT, RLS-scoped). Same row-mutex.
//     2. Load places already grouped by day_index. Skip places with
//        day_index = null (unscheduled).
//     3. NO clustering, NO 2-opt, NO trip_places writes.
//     4. For each day with >=2 places, call directions-polyline along the
//        existing chain and upsert the resulting trip_legs row.
//     5. stateHash is computed from the pre-existing assignments (so
//        consumers that branch on it continue to work).
//
// Both modes share:
//   - the row-mutex (Phase 13 fix preserved),
//   - trip_legs replacement semantics (legs for the trip are wiped or
//     overwritten before writing fresh ones — see writeTripLegs),
//   - the same response envelope shape (existing OptimizeError consumers
//     keep working unchanged).

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { log, newRequestId } from '../_shared/logger.ts';
import { makeAdminClient, makeUserClient } from '../_shared/supabase-admin.ts';
import {
  optimize,
  type OptimizerLeg,
  type OptimizerPlace,
} from '../../../src/lib/optimizer/kmeans-2opt.ts';

const MAX_PLACES = 25;
const LEG_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Phase 23 Step 23.2: explicit mode parameter. Defaults to 'optimized' for
// back-compat with every pre-Phase-23 caller (optimize-trip used to take
// only { tripId }). The client always passes mode explicitly post-Phase-23
// (see useOptimizeTrip in src/api/routes.ts) so the default is purely a
// safety net, not the hot path.
const BodySchema = z.object({
  tripId: z.string().uuid(),
  mode: z.enum(['optimized', 'manual']).optional().default('optimized'),
});

// Phase 23 Step 23.1 widens transport_mode to include 'bicycling'. The
// downstream Edge Functions (distance-matrix, directions-polyline) and the
// types in src/api/types.ts must stay in lockstep; see migration 0016 for
// the data-layer guard.
type TransportMode = 'driving' | 'walking' | 'transit' | 'bicycling';

interface TripRow {
  id: string;
  user_id: string;
  daily_hours_budget: number;
  transport_mode: TransportMode;
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
}

interface TripLegRow {
  from_place_id: string;
  to_place_id: string;
  duration_seconds: number;
  distance_meters: number;
  computed_at: string;
  transport_mode: string;
  polyline: string | null;
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

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return errorResponse(
      'invalid_input',
      err instanceof z.ZodError ? err.issues.map((i) => i.message).join('; ') : 'Invalid JSON',
      400,
      origin,
    );
  }

  const user = makeUserClient(req);
  const admin = makeAdminClient();

  // Auth check — the trip must be visible to the caller under RLS.
  const { data: trip, error: tripErr } = await user
    .from('trips')
    .select('id, user_id, daily_hours_budget, transport_mode, anchor_place_id')
    .eq('id', body.tripId)
    .maybeSingle<TripRow>();
  if (tripErr) {
    log({ requestId, fn: 'optimize-trip', level: 'error', err: tripErr.message });
    return errorResponse('db_error', tripErr.message, 500, origin);
  }
  if (!trip) return errorResponse('not_found', 'Trip not found or forbidden', 404, origin);

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
  // still recovering from a hung function within minutes.
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
  const lockRes = await admin.rpc('claim_trip_optimize', {
    p_trip_id: body.tripId,
    p_ttl_seconds: 300,
  });
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
    // relies on day_index/order_in_day already being set by the user.
    const { data: places, error: placesErr } = await user
      .from('trip_places')
      .select('id, lat, lng, visit_duration_minutes, day_index, order_in_day')
      .eq('trip_id', body.tripId)
      .returns<TripPlaceRow[]>();
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

    // Branch on mode. 'manual' bypasses clustering + 2-opt entirely and
    // returns early after recomputing legs against the existing per-day
    // chain. 'optimized' falls through to the legacy path.
    if (body.mode === 'manual') {
      return await runManualMode({
        admin,
        trip,
        places,
        tripId: body.tripId,
        requestId,
        origin,
      });
    }

    // Fetch cached legs < 30 days old.
    const { data: cachedLegsRaw } = await user
      .from('trip_legs')
      .select('from_place_id, to_place_id, duration_seconds, distance_meters, computed_at, transport_mode, polyline')
      .eq('trip_id', body.tripId)
      .eq('transport_mode', trip.transport_mode)
      .returns<TripLegRow[]>();

    const nowMs = Date.now();
    const cachedLegs: OptimizerLeg[] = (cachedLegsRaw ?? [])
      .filter((l) => nowMs - new Date(l.computed_at).getTime() < LEG_TTL_MS)
      .map((l) => ({
        fromId: l.from_place_id,
        toId: l.to_place_id,
        durationSeconds: l.duration_seconds,
      }));

    const cachedPairs = new Set(cachedLegs.map((l) => `${l.fromId}__${l.toId}`));

    // Collect missing pairs; request a matrix for exactly those origins/destinations.
    const missing: Array<{ from: TripPlaceRow; to: TripPlaceRow }> = [];
    for (const a of places) {
      for (const b of places) {
        if (a.id === b.id) continue;
        if (!cachedPairs.has(`${a.id}__${b.id}`)) {
          missing.push({ from: a, to: b });
        }
      }
    }

    const cacheHit = missing.length === 0;
    const freshLegs: OptimizerLeg[] = [];
    const legsToUpsert: Array<{
      trip_id: string;
      from_place_id: string;
      to_place_id: string;
      day_index: number;
      transport_mode: string;
      duration_seconds: number;
      distance_meters: number;
      polyline: string | null;
    }> = [];

    if (!cacheHit) {
      const origins = missing.map((m) => ({ lat: m.from.lat, lng: m.from.lng }));
      const destinations = missing.map((m) => ({ lat: m.to.lat, lng: m.to.lng }));
      const matrixRes = await callEdge('distance-matrix', {
        origins,
        destinations,
        mode: trip.transport_mode,
      });
      if (!matrixRes.ok) {
        return errorResponse('matrix_failed', 'Distance matrix failed', 502, origin);
      }
      const matrix = matrixRes.body as {
        legs: Array<{ fromIndex: number; toIndex: number; durationSeconds: number; distanceMeters: number }>;
      };
      for (const el of matrix.legs) {
        const fromPlace = missing[el.fromIndex]?.from;
        const toPlace = missing[el.toIndex]?.to;
        if (!fromPlace || !toPlace) continue;
        freshLegs.push({
          fromId: fromPlace.id,
          toId: toPlace.id,
          durationSeconds: el.durationSeconds,
        });
      }
    }

    const allLegs: OptimizerLeg[] = [...cachedLegs, ...freshLegs];

    const optimizerInput = {
      places: places.map<OptimizerPlace>((p) => ({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        visitMinutes: p.visit_duration_minutes,
      })),
      legs: allLegs,
      dailyBudgetMinutes: Math.round(trip.daily_hours_budget * 60),
      anchorPlaceId: trip.anchor_place_id ?? undefined,
    };

    const result = optimize(optimizerInput);

    // Persist day_index + order_in_day atomically via the apply_optimization RPC
    // (single UPDATE scoped to trip_id — no per-row roundtrip).
    const assignments = result.days.flatMap((day) =>
      day.orderedPlaceIds.map((id, i) => ({
        id,
        day_index: day.dayIndex,
        order_in_day: i,
      })),
    );
    if (assignments.length > 0) {
      const { error: rpcErr } = await admin.rpc('apply_optimization', {
        p_trip_id: body.tripId,
        p_assignments: assignments,
      });
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

    // Fetch polylines per day (optional — best-effort; degrade gracefully).
    let polylineDays = 0;
    const placeById = new Map(places.map((p) => [p.id, p]));
    for (const day of result.days) {
      if (day.orderedPlaceIds.length < 2) continue;
      const pts = day.orderedPlaceIds.map((id) => placeById.get(id)!);
      const [first, ...rest] = pts;
      const last = rest.pop()!;
      const polyRes = await callEdge('directions-polyline', {
        origin: { lat: first!.lat, lng: first!.lng },
        destination: { lat: last.lat, lng: last.lng },
        intermediates: rest.map((p) => ({ lat: p.lat, lng: p.lng })),
        mode: trip.transport_mode,
      });
      if (!polyRes.ok) continue;
      polylineDays++;
      const poly = polyRes.body as { polyline: string; durationSeconds: number; distanceMeters: number };

      // Persist per-leg polyline on the first leg of the day (lightweight). A richer
      // implementation would split the polyline per-leg; MVP stores one polyline per day.
      const firstLeg = {
        trip_id: body.tripId,
        from_place_id: first!.id,
        to_place_id: last.id,
        day_index: day.dayIndex,
        transport_mode: trip.transport_mode,
        duration_seconds: poly.durationSeconds,
        distance_meters: poly.distanceMeters,
        polyline: poly.polyline,
      };
      legsToUpsert.push(firstLeg);
    }

    // Also persist individual pairwise legs we learned about (caching for next call).
    for (const leg of freshLegs) {
      legsToUpsert.push({
        trip_id: body.tripId,
        from_place_id: leg.fromId,
        to_place_id: leg.toId,
        day_index: -1,
        transport_mode: trip.transport_mode,
        duration_seconds: leg.durationSeconds,
        distance_meters: 0,
        polyline: null,
      });
    }

    if (legsToUpsert.length > 0) {
      await admin.from('trip_legs').insert(legsToUpsert);
    }

    log({
      requestId,
      fn: 'optimize-trip',
      level: 'info',
      tripId: body.tripId,
      places: places.length,
      days: result.days.length,
      cacheHit,
      legsWritten: legsToUpsert.length,
      polylineDays,
    });

    return jsonResponse(
      {
        stateHash: result.stateHash,
        days: result.days,
        placesUpdated: places.length,
        legsWritten: legsToUpsert.length,
        cacheHit,
        polylineDays,
        mode: 'optimized' as const,
      },
      { origin },
    );
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
      const releaseRes = await admin
        .rpc('release_trip_optimize', { p_trip_id: body.tripId })
        .then(
          (r) => r,
          (err) => ({ data: null, error: err as { message?: string } }),
        );
      if (releaseRes.error) {
        log({
          requestId,
          fn: 'optimize-trip',
          level: 'warn',
          stage: 'release_error',
          err: (releaseRes.error as { message?: string }).message ?? 'unknown',
        });
      }
    }
  }
}

// ============================================================
// Phase 23 Step 23.2: manual-mode renderer.
// ============================================================
// Skips k-means + 2-opt entirely. The user has hand-arranged places into
// (day_index, order_in_day) groups; this function only refreshes
// trip_legs against that existing chain so the polyline traces what the
// user laid out.
//
// Invariants
// ----------
// * NEVER mutates trip_places. The caller's ordering is authoritative.
// * Skips places with day_index = null (unscheduled). This is not an
//   error — it is the documented edge case from the planner brief.
// * Replaces trip_legs for the trip atomically: delete-then-insert under
//   the admin client (RLS already authorized the caller via the parent
//   handler; admin is used only to bypass the per-row eq filter that
//   PostgREST would otherwise require for a bulk delete).
// * Honors trips.transport_mode for travel time / polyline calls — the
//   user's transport choice flows all the way through to the Routes API
//   request body via callEdge('directions-polyline', { mode }).
//
// Response shape mirrors the optimized branch so OptimizeError / OptimizeResult
// consumers don't need a discriminated union — every field is populated:
//   - days                : grouped {dayIndex, orderedPlaceIds, totalMinutes}
//                          where totalMinutes is the sum of visit_duration_minutes
//                          (no travel-time reflow happens in manual mode)
//   - placesUpdated       : 0 (we never wrote)
//   - legsWritten         : count of new trip_legs rows
//   - cacheHit            : false (we always re-call directions-polyline; the
//                          user is asking for a fresh render)
//   - polylineDays        : number of days that produced a polyline
//   - mode                : 'manual'
//   - stateHash           : sha256 of the (orderedDayIds) list, so React Query
//                          can dedupe a "manual re-run on identical layout"
async function runManualMode(args: {
  admin: ReturnType<typeof makeAdminClient>;
  trip: TripRow;
  places: TripPlaceRow[];
  tripId: string;
  requestId: string;
  origin: string | null;
}): Promise<Response> {
  const { admin, trip, places, tripId, requestId, origin } = args;

  // 1. Group scheduled places by day_index. Skip unscheduled.
  const byDay = new Map<number, TripPlaceRow[]>();
  for (const p of places) {
    if (p.day_index === null) continue;
    const bucket = byDay.get(p.day_index);
    if (bucket) bucket.push(p);
    else byDay.set(p.day_index, [p]);
  }

  // 2. Sort each day's places by order_in_day. NULLs sort last (defensive
  //    — should not happen for scheduled rows, but tolerate).
  for (const list of byDay.values()) {
    list.sort((a, b) => {
      const ao = a.order_in_day ?? Number.MAX_SAFE_INTEGER;
      const bo = b.order_in_day ?? Number.MAX_SAFE_INTEGER;
      return ao - bo;
    });
  }

  const sortedDays = Array.from(byDay.keys()).sort((a, b) => a - b);

  // 3. Build the response 'days' array up front — independent of leg fetch
  //    success so a partial polyline failure doesn't lose the layout
  //    summary the client needs.
  const responseDays = sortedDays.map((dayIndex) => {
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
  const layoutSig = responseDays
    .map((d) => `${d.dayIndex}:${d.orderedPlaceIds.join(',')}`)
    .join('|');
  const stateHash = await sha256Hex(layoutSig);

  // 5. Wipe existing trip_legs for this trip. We overwrite per-day, but
  //    the prior layout might have had MORE days than the manual layout
  //    (e.g. user merged days 2 and 3 into day 2); a delete-first ensures
  //    no stale day's leg leaks into the rendered route.
  const { error: delErr } = await admin
    .from('trip_legs')
    .delete()
    .eq('trip_id', tripId);
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

  // 6. For each day with >=2 places, fetch a polyline along the existing
  //    chain. Best-effort: if Routes API returns null (transit) or
  //    upstream errors, skip that day's leg row but keep going. The UI
  //    falls back to dashed straight-lines when polyline is missing.
  const legsToInsert: Array<{
    trip_id: string;
    from_place_id: string;
    to_place_id: string;
    day_index: number;
    transport_mode: TransportMode;
    duration_seconds: number;
    distance_meters: number;
    polyline: string | null;
  }> = [];
  let polylineDays = 0;

  for (const dayIndex of sortedDays) {
    const chain = byDay.get(dayIndex)!;
    if (chain.length < 2) continue;

    const [first, ...rest] = chain;
    const last = rest.pop()!;
    const polyRes = await callEdge('directions-polyline', {
      origin: { lat: first!.lat, lng: first!.lng },
      destination: { lat: last.lat, lng: last.lng },
      intermediates: rest.map((p) => ({ lat: p.lat, lng: p.lng })),
      mode: trip.transport_mode,
    });
    if (!polyRes.ok) continue;
    const poly = polyRes.body as {
      polyline: string | null;
      durationSeconds: number;
      distanceMeters: number;
    };
    if (poly.polyline) polylineDays++;

    legsToInsert.push({
      trip_id: tripId,
      from_place_id: first!.id,
      to_place_id: last.id,
      day_index: dayIndex,
      transport_mode: trip.transport_mode,
      duration_seconds: poly.durationSeconds,
      distance_meters: poly.distanceMeters,
      polyline: poly.polyline,
    });
  }

  if (legsToInsert.length > 0) {
    const { error: insErr } = await admin.from('trip_legs').insert(legsToInsert);
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

  log({
    requestId,
    fn: 'optimize-trip',
    level: 'info',
    mode: 'manual',
    tripId,
    places: places.length,
    days: responseDays.length,
    legsWritten: legsToInsert.length,
    polylineDays,
  });

  return jsonResponse(
    {
      stateHash,
      days: responseDays,
      placesUpdated: 0,
      legsWritten: legsToInsert.length,
      cacheHit: false,
      polylineDays,
      mode: 'manual' as const,
    },
    { origin },
  );
}

// SHA-256 -> hex. Used only for the manual-mode stateHash so React Query
// can dedupe identical re-renders. Web Crypto is available in Deno
// natively — no shim needed.
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

async function callEdge(fnName: string, body: unknown): Promise<{ ok: boolean; body: unknown }> {
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) return { ok: false, body: null };
  try {
    const res = await fetch(`${url}/functions/v1/${fnName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anon}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, body: json };
  } catch {
    return { ok: false, body: null };
  }
}

Deno.serve(handler);
