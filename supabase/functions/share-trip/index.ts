// share-trip — create / read / revoke read-only share links for a trip.
//
// Contract:
//   POST { op: "create", tripId: string }           (auth required)
//     -> { token: string }
//   POST { op: "read",   token: string }            (anonymous)
//     -> { trip, places, legs } — ToS-safe fields only
//   POST { op: "revoke", tripId: string, token?: string }   (auth required)
//     -> { revoked: number }
//   GET  ?ping
//     -> { ok: true, fn: "share-trip" }
//
// Security model:
//   - The `trip_shares` table has NO SELECT policy. All reads go through this
//     function using the service-role client.
//   - `create` runs under the caller's JWT (makeUserClient) so RLS on `trips`
//     proves ownership before we insert via the admin client.
//   - `read` is anonymous and NEVER returns user_id or Google-ToS-restricted
//     content (reviews, photos, rating, website, phone, opening_hours are not
//     persisted anywhere in our DB — only the safe persistable fields are).
//   - Tokens are 128 bits of `crypto.getRandomValues` entropy, base64url-encoded.
//     Only a token prefix (8 chars) is ever logged.

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { log, newRequestId } from '../_shared/logger.ts';
import { makeAdminClient, makeUserClient } from '../_shared/supabase-admin.ts';

const CreateSchema = z.object({
  op: z.literal('create'),
  tripId: z.string().uuid(),
});

const ReadSchema = z.object({
  op: z.literal('read'),
  token: z.string().min(16).max(128),
});

const RevokeSchema = z.object({
  op: z.literal('revoke'),
  tripId: z.string().uuid(),
  token: z.string().min(16).max(128).optional(),
});

const BodySchema = z.union([CreateSchema, ReadSchema, RevokeSchema]);

// 30-day TTL on trip_legs. Legs derive from the Google Routes API (polyline,
// duration, distance) and fall under the 30-day ToS ceiling. Any leg whose
// `computed_at` is older than this window must be re-fetched — and must NOT be
// returned over the public share endpoint.
const LEG_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Fields persisted server-side. We NEVER store/return Google-ToS-restricted
// content (reviews, photos, rating, website, phone, opening_hours). That data
// only ever lives in the client's React Query cache.
const PLACE_FIELDS =
  'id, google_place_id, user_title, category, lat, lng, visit_duration_minutes, day_index, order_in_day, notes';
const LEG_FIELDS =
  'id, from_place_id, to_place_id, day_index, transport_mode, duration_seconds, distance_meters, polyline, computed_at';
const TRIP_FIELDS =
  'id, title, start_date, end_date, daily_hours_budget, transport_mode, timezone';

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function newToken(): string {
  const bytes = new Uint8Array(16); // 128 bits
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

function prefix(token: string): string {
  return token.slice(0, 8);
}

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const requestId = newRequestId();

  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  if (url.searchParams.has('ping')) {
    return jsonResponse({ ok: true, fn: 'share-trip' }, { origin });
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

  try {
    switch (body.op) {
      case 'create':
        return await handleCreate(req, body, requestId, origin);
      case 'read':
        return await handleRead(body, requestId, origin);
      case 'revoke':
        return await handleRevoke(req, body, requestId, origin);
      default: {
        // Exhaustiveness guard — Zod's union already rejects other ops, but
        // this makes the switch explicit for TS.
        const _exhaustive: never = body;
        return errorResponse('invalid_input', 'Unknown op', 400, origin);
      }
    }
  } catch (err) {
    log({
      requestId,
      fn: 'share-trip',
      level: 'error',
      op: (body as { op: string }).op,
      err: String(err),
    });
    return errorResponse('internal_error', 'share-trip failed', 500, origin);
  }
}

// ---- create ---------------------------------------------------------------

async function handleCreate(
  req: Request,
  body: z.infer<typeof CreateSchema>,
  requestId: string,
  origin: string | null,
): Promise<Response> {
  const user = makeUserClient(req);

  // RLS-scoped ownership check. Caller must be authenticated as the owner.
  const { data: trip, error: tripErr } = await user
    .from('trips')
    .select('id')
    .eq('id', body.tripId)
    .maybeSingle();
  if (tripErr) {
    log({ requestId, fn: 'share-trip', op: 'create', level: 'error', err: tripErr.message });
    return errorResponse('db_error', tripErr.message, 500, origin);
  }
  if (!trip) {
    return errorResponse('not_found', 'Trip not found or forbidden', 404, origin);
  }

  // Insert via admin client so the token is always generated server-side and
  // the RLS INSERT policy has already approved the operation via `user` check.
  const admin = makeAdminClient();
  const token = newToken();
  const { error: insertErr } = await admin
    .from('trip_shares')
    .insert({ trip_id: body.tripId, token });
  if (insertErr) {
    log({
      requestId,
      fn: 'share-trip',
      op: 'create',
      level: 'error',
      err: insertErr.message,
    });
    return errorResponse('db_error', 'Failed to create share', 500, origin);
  }

  log({
    requestId,
    fn: 'share-trip',
    op: 'create',
    level: 'info',
    tripId: body.tripId,
    tokenPrefix: prefix(token),
  });

  return jsonResponse({ token }, { origin });
}

// ---- read (anonymous) -----------------------------------------------------

async function handleRead(
  body: z.infer<typeof ReadSchema>,
  requestId: string,
  origin: string | null,
): Promise<Response> {
  const admin = makeAdminClient();

  const { data: share, error: shareErr } = await admin
    .from('trip_shares')
    .select('trip_id, revoked_at')
    .eq('token', body.token)
    .maybeSingle<{ trip_id: string; revoked_at: string | null }>();

  if (shareErr) {
    log({ requestId, fn: 'share-trip', op: 'read', level: 'error', err: shareErr.message });
    return errorResponse('db_error', shareErr.message, 500, origin);
  }
  if (!share || share.revoked_at) {
    log({
      requestId,
      fn: 'share-trip',
      op: 'read',
      level: 'info',
      result: 'not_found',
      tokenPrefix: prefix(body.token),
    });
    return errorResponse('not_found', 'Share link not found or revoked', 404, origin);
  }

  // Fetch the trip, its places, and its legs. Select only ToS-safe fields.
  // We deliberately do NOT select user_id, and the DB does NOT store
  // reviews / photos / rating / website / phone / opening_hours anywhere.
  //
  // `trip_legs` is additionally filtered by a 30-day TTL on `computed_at` — any
  // leg older than `LEG_TTL_MS` has aged past the Google Routes ToS ceiling
  // and must not be returned. Stale legs are quietly omitted; the client will
  // render those segments as degraded/missing until the owner re-optimizes.
  const legTtlCutoff = new Date(Date.now() - LEG_TTL_MS).toISOString();
  const [tripRes, placesRes, legsRes] = await Promise.all([
    admin.from('trips').select(TRIP_FIELDS).eq('id', share.trip_id).maybeSingle(),
    admin
      .from('trip_places')
      .select(PLACE_FIELDS)
      .eq('trip_id', share.trip_id)
      .order('day_index', { ascending: true, nullsFirst: true })
      .order('order_in_day', { ascending: true, nullsFirst: true }),
    admin
      .from('trip_legs')
      .select(LEG_FIELDS)
      .eq('trip_id', share.trip_id)
      .gte('computed_at', legTtlCutoff),
  ]);

  if (tripRes.error) {
    return errorResponse('db_error', tripRes.error.message, 500, origin);
  }
  if (!tripRes.data) {
    // Trip was deleted but the share row survived (shouldn't happen with FK cascade,
    // but defensive).
    return errorResponse('not_found', 'Trip no longer exists', 404, origin);
  }
  if (placesRes.error) {
    return errorResponse('db_error', placesRes.error.message, 500, origin);
  }
  if (legsRes.error) {
    return errorResponse('db_error', legsRes.error.message, 500, origin);
  }

  log({
    requestId,
    fn: 'share-trip',
    op: 'read',
    level: 'info',
    tokenPrefix: prefix(body.token),
    tripId: share.trip_id,
    placeCount: placesRes.data?.length ?? 0,
    legCount: legsRes.data?.length ?? 0,
  });

  return jsonResponse(
    {
      trip: tripRes.data,
      places: placesRes.data ?? [],
      legs: legsRes.data ?? [],
    },
    { origin },
  );
}

// ---- revoke ---------------------------------------------------------------

async function handleRevoke(
  req: Request,
  body: z.infer<typeof RevokeSchema>,
  requestId: string,
  origin: string | null,
): Promise<Response> {
  const user = makeUserClient(req);

  // Ownership check via RLS on `trips` (which DOES have a SELECT policy).
  const { data: trip, error: tripErr } = await user
    .from('trips')
    .select('id')
    .eq('id', body.tripId)
    .maybeSingle();
  if (tripErr) {
    return errorResponse('db_error', tripErr.message, 500, origin);
  }
  if (!trip) {
    return errorResponse('not_found', 'Trip not found or forbidden', 404, origin);
  }

  // Update via the admin client. We CANNOT use the user-JWT client here:
  // `trip_shares` has no SELECT policy by design (tokens must never be
  // readable post-creation), and Postgres requires a row to be visible via
  // the SELECT policy in order for UPDATE / DELETE to find it. Without that,
  // an UPDATE under the user JWT silently affects 0 rows even though the
  // UPDATE policy's USING clause would otherwise permit it. Ownership has
  // already been proven against `trips` immediately above, so the admin
  // client write is safe and equivalent to what the policy would have
  // permitted under SELECT-visibility-preserving conditions.
  const admin = makeAdminClient();
  const nowIso = new Date().toISOString();
  let q = admin.from('trip_shares').update({ revoked_at: nowIso }).eq('trip_id', body.tripId);
  if (body.token) q = q.eq('token', body.token);
  // Don't re-stamp already-revoked rows.
  q = q.is('revoked_at', null);
  const { error: updErr } = await q;
  if (updErr) {
    log({
      requestId,
      fn: 'share-trip',
      op: 'revoke',
      level: 'error',
      err: updErr.message,
    });
    return errorResponse('db_error', updErr.message, 500, origin);
  }

  // Count rows just revoked via admin client (no SELECT policy for owner).
  let countQ = admin
    .from('trip_shares')
    .select('id', { count: 'exact', head: true })
    .eq('trip_id', body.tripId)
    .eq('revoked_at', nowIso);
  if (body.token) countQ = countQ.eq('token', body.token);
  const { count, error: countErr } = await countQ;
  if (countErr) {
    log({
      requestId,
      fn: 'share-trip',
      op: 'revoke',
      level: 'warn',
      err: countErr.message,
    });
  }

  log({
    requestId,
    fn: 'share-trip',
    op: 'revoke',
    level: 'info',
    tripId: body.tripId,
    tokenPrefix: body.token ? prefix(body.token) : null,
    revoked: count ?? 0,
  });

  return jsonResponse({ revoked: count ?? 0 }, { origin });
}

Deno.serve(handler);
