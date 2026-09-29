// share-trip — create / read / revoke read-only share links for a trip.
//
// Contract:
//   POST { op: "create", tripId: string }           (auth required, OWNER only)
//     -> { token: string }
//   POST { op: "read",   token: string }            (anonymous)
//     -> { trip, places, legs, meta: { contractVersion: 2 } } — allow-listed
//        fields only (see ./public-fields.ts for the list + version history)
//   POST { op: "revoke", tripId: string, token?: string }   (auth required, OWNER only)
//     -> { revoked: number }
//   GET  ?ping
//     -> { ok: true, fn: "share-trip" }
//
// Security model:
//   - The `trip_shares` table has NO SELECT policy. All reads go through this
//     function using the service-role client.
//   - `create` / `revoke` are OWNER-ONLY (security audit #5, 2026-09-29). The
//     caller is identified with `auth.getUser(jwt)`, the trip is looked up
//     under the caller's JWT (RLS: not visible → 404), and anything but
//     `trip.user_id === caller.id` → 403 `not_owner`. Before the fix the
//     function only checked RLS *visibility*, so an accepted viewer/editor
//     could mint or kill the owner's public links. Publishing a trip to the
//     internet is the owner's decision alone.
//   - `read` is anonymous and returns ONLY the allow-listed fields in
//     ./public-fields.ts: never `user_id`, never `trip.id`, never notes
//     (private by default), and never Google-ToS-restricted content (reviews,
//     photos, rating, website, phone, opening_hours are not persisted anywhere
//     in our DB in the first place).
//   - Tokens are 128 bits of `crypto.getRandomValues` entropy, base64url-encoded.
//     Only a token prefix (8 chars) is ever logged.
//
// Error codes: invalid_input 400 · not_authenticated 401 · not_owner 403 ·
//   not_found 404 · method_not_allowed 405 · db_error / internal_error 500.

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { log, newRequestId } from '../_shared/logger.ts';
import { makeAdminClient, makeUserClient } from '../_shared/supabase-admin.ts';
import {
  buildPublicSharePayload,
  LEG_FIELDS,
  PLACE_FIELDS,
  TRIP_FIELDS,
} from './public-fields.ts';

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

type Body =
  | { op: 'create'; tripId: string }
  | { op: 'read'; token: string }
  | { op: 'revoke'; tripId: string; token?: string };

// 30-day TTL on trip_legs. Legs derive from the Google Routes API (polyline,
// duration, distance) and fall under the 30-day ToS ceiling. Any leg whose
// `computed_at` is older than this window must be re-fetched — and must NOT be
// returned over the public share endpoint.
const LEG_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

// ---- caller identity (create / revoke) -------------------------------------

function extractBearer(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? '';
  const m = /^Bearer\s+(.+)$/.exec(header);
  return m?.[1] ? m[1].trim() : null;
}

type UserClient = ReturnType<typeof makeUserClient>;

/**
 * Verify the bearer JWT and return the caller's user id, or null when the
 * header is missing, is the anon key (anonymous share viewers send it), or is
 * otherwise invalid. `userClient` is the anon-key client carrying the caller's
 * JWT (makeUserClient) — no RLS bypass. `auth.getUser(jwt)` round-trips to
 * GoTrue, so a forged / expired / signed-out token is rejected.
 */
async function authenticate(userClient: UserClient, req: Request): Promise<{ id: string } | null> {
  const jwt = extractBearer(req);
  if (!jwt) return null;
  const { data, error } = await userClient.auth.getUser(jwt);
  if (error || !data?.user?.id) return null;
  return { id: data.user.id };
}

/**
 * Owner gate shared by create + revoke. Returns an error Response to send, or
 * null when the caller owns the trip.
 *   - trip not visible under the caller's JWT (RLS)   → 404 not_found
 *   - visible but `user_id !== caller` (collaborator)  → 403 not_owner
 */
async function requireOwner(
  user: UserClient,
  tripId: string,
  callerId: string,
  op: 'create' | 'revoke',
  requestId: string,
  origin: string | null,
): Promise<Response | null> {
  const { data: trip, error: tripErr } = await user
    .from('trips')
    .select('id, user_id')
    .eq('id', tripId)
    .maybeSingle();
  if (tripErr) {
    log({ requestId, fn: 'share-trip', op, level: 'error', tripId, err: tripErr.message });
    return errorResponse('db_error', 'Failed to load trip', 500, origin);
  }
  if (!trip) {
    return errorResponse('not_found', 'Trip not found or forbidden', 404, origin);
  }
  if ((trip as { user_id?: string }).user_id !== callerId) {
    log({
      requestId,
      fn: 'share-trip',
      op,
      level: 'warn',
      result: 'not_owner',
      tripId,
      userId: callerId,
    });
    return errorResponse(
      'not_owner',
      'Only the trip owner can manage public share links',
      403,
      origin,
    );
  }
  return null;
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

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse('invalid_input', 'Invalid JSON', 400, origin);
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(
      'invalid_input',
      parsed.error.issues.map((i: { message: string }) => i.message).join('; '),
      400,
      origin,
    );
  }
  const body = parsed.data as Body;

  try {
    switch (body.op) {
      case 'create':
      case 'revoke': {
        const userClient = makeUserClient(req);
        const caller = await authenticate(userClient, req);
        if (!caller) {
          return errorResponse('not_authenticated', 'Missing or invalid bearer token', 401, origin);
        }
        const denied = await requireOwner(userClient, body.tripId, caller.id, body.op, requestId, origin);
        if (denied) return denied;
        return body.op === 'create'
          ? await handleCreate(body, caller.id, requestId, origin)
          : await handleRevoke(body, caller.id, requestId, origin);
      }
      case 'read':
        return await handleRead(body, requestId, origin);
      default:
        return errorResponse('invalid_input', 'Unknown op', 400, origin);
    }
  } catch (err) {
    log({
      requestId,
      fn: 'share-trip',
      level: 'error',
      op: body.op,
      err: String(err),
    });
    return errorResponse('internal_error', 'share-trip failed', 500, origin);
  }
}

// ---- create ---------------------------------------------------------------

async function handleCreate(
  body: { tripId: string },
  callerId: string,
  requestId: string,
  origin: string | null,
): Promise<Response> {
  // Ownership was proven by requireOwner (auth.getUser + RLS-scoped trip
  // read + user_id match). Insert via the admin client so the token is always
  // generated server-side; `trip_shares` has no client-facing write path.
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
    userId: callerId,
    tokenPrefix: prefix(token),
  });

  return jsonResponse({ token }, { origin });
}

// ---- read (anonymous) -----------------------------------------------------

async function handleRead(
  body: { token: string },
  requestId: string,
  origin: string | null,
): Promise<Response> {
  const admin = makeAdminClient();

  const { data: share, error: shareErr } = await admin
    .from('trip_shares')
    .select('trip_id, revoked_at')
    .eq('token', body.token)
    .maybeSingle();

  if (shareErr) {
    log({ requestId, fn: 'share-trip', op: 'read', level: 'error', err: shareErr.message });
    return errorResponse('db_error', 'Failed to read share link', 500, origin);
  }
  const shareRow = share as { trip_id: string; revoked_at: string | null } | null;
  if (!shareRow || shareRow.revoked_at) {
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

  // Fetch the trip, its places, and its legs — allow-listed columns only
  // (./public-fields.ts), then re-shaped through the same allow-list below.
  //
  // `trip_legs` is additionally filtered by a 30-day TTL on `computed_at` — any
  // leg older than `LEG_TTL_MS` has aged past the Google Routes ToS ceiling
  // and must not be returned. Stale legs are quietly omitted; the client will
  // render those segments as degraded/missing until the owner re-optimizes.
  const legTtlCutoff = new Date(Date.now() - LEG_TTL_MS).toISOString();
  const [tripRes, placesRes, legsRes] = await Promise.all([
    admin.from('trips').select(TRIP_FIELDS).eq('id', shareRow.trip_id).maybeSingle(),
    admin
      .from('trip_places')
      .select(PLACE_FIELDS)
      .eq('trip_id', shareRow.trip_id)
      // v2 S2.8.1: soft-delete tombstones (migration 0027, NOT NULL DEFAULT
      // false) must never surface on a share link — this read runs under the
      // admin client, so the filter is the only thing standing between a
      // user-deleted place and an anonymous viewer.
      .eq('deleted', false)
      .order('day_index', { ascending: true, nullsFirst: true })
      .order('order_in_day', { ascending: true, nullsFirst: true }),
    admin
      .from('trip_legs')
      .select(LEG_FIELDS)
      .eq('trip_id', shareRow.trip_id)
      .gte('computed_at', legTtlCutoff),
  ]);

  // DB error text is logged, never echoed to anonymous callers.
  const dbErr = tripRes.error ?? placesRes.error ?? legsRes.error;
  if (dbErr) {
    log({ requestId, fn: 'share-trip', op: 'read', level: 'error', err: dbErr.message });
    return errorResponse('db_error', 'Failed to load shared trip', 500, origin);
  }
  if (!tripRes.data) {
    // Trip was deleted but the share row survived (shouldn't happen with FK cascade,
    // but defensive).
    return errorResponse('not_found', 'Trip no longer exists', 404, origin);
  }

  const payload = buildPublicSharePayload({
    trip: tripRes.data as Record<string, unknown>,
    places: (placesRes.data ?? []) as Record<string, unknown>[],
    legs: (legsRes.data ?? []) as Record<string, unknown>[],
  });

  log({
    requestId,
    fn: 'share-trip',
    op: 'read',
    level: 'info',
    tokenPrefix: prefix(body.token),
    tripId: shareRow.trip_id,
    placeCount: payload.places.length,
    legCount: payload.legs.length,
  });

  return jsonResponse(payload, { origin });
}

// ---- revoke ---------------------------------------------------------------

async function handleRevoke(
  body: { tripId: string; token?: string },
  callerId: string,
  requestId: string,
  origin: string | null,
): Promise<Response> {
  // Update via the admin client. We CANNOT use the user-JWT client here:
  // `trip_shares` has no SELECT policy by design (tokens must never be
  // readable post-creation), and Postgres requires a row to be visible via
  // the SELECT policy in order for UPDATE / DELETE to find it. Without that,
  // an UPDATE under the user JWT silently affects 0 rows even though the
  // UPDATE policy's USING clause would otherwise permit it. Ownership has
  // already been proven by requireOwner (caller === trips.user_id), so the
  // admin client write is safe.
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
    return errorResponse('db_error', 'Failed to revoke share', 500, origin);
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
    userId: callerId,
    tokenPrefix: body.token ? prefix(body.token) : null,
    revoked: count ?? 0,
  });

  return jsonResponse({ revoked: count ?? 0 }, { origin });
}

Deno.serve(handler);
