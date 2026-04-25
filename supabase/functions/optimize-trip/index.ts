// optimize-trip — orchestrates route optimization for a trip.
//
// Contract:
//   POST { tripId: string }
//   -> {
//        stateHash: string,
//        days: Array<{ dayIndex, orderedPlaceIds, totalMinutes }>,
//        placesUpdated: number,
//        legsWritten: number,
//        cacheHit: boolean,
//        polylineDays: number,
//      }
//
// Steps:
//  1. Auth: run under the caller's JWT so RLS enforces ownership.
//  2. Acquire a per-trip row-mutex via the `claim_trip_optimize(uuid, int)`
//     RPC (migration 0008) — bail with 409 `already_optimizing` if another
//     optimize is in flight for the same trip. Released in `finally` via
//     `release_trip_optimize(uuid)`. The row-mutex replaces the Phase 12
//     session-scoped advisory lock (closes review C1: PgBouncer transaction
//     pooling could route lock and unlock to different backends).
//  3. Load trip + places. Cap at 25 places.
//  4. Fetch N×N distance matrix, reusing legs < 30 days old from trip_legs.
//  5. Run the pure optimizer (k-means + 2-opt).
//  6. Write day_index / order_in_day via admin client (atomic).
//  7. For each day, call directions-polyline and upsert into trip_legs.

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

const BodySchema = z.object({
  tripId: z.string().uuid(),
});

interface TripRow {
  id: string;
  user_id: string;
  daily_hours_budget: number;
  transport_mode: 'driving' | 'walking' | 'transit';
  anchor_place_id: string | null;
}

interface TripPlaceRow {
  id: string;
  lat: number;
  lng: number;
  visit_duration_minutes: number;
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
    const { data: places, error: placesErr } = await user
      .from('trip_places')
      .select('id, lat, lng, visit_duration_minutes')
      .eq('trip_id', body.tripId)
      .returns<TripPlaceRow[]>();
    if (placesErr) {
      return errorResponse('db_error', placesErr.message, 500, origin);
    }
    if (!places || places.length === 0) {
      return jsonResponse(
        { days: [], stateHash: '', placesUpdated: 0, legsWritten: 0, cacheHit: false, polylineDays: 0 },
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
