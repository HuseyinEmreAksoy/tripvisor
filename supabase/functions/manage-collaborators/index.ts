// manage-collaborators — invite / accept / decline / revoke / list trip collaborators.
//
// Contract:
//   POST { action: 'invite',  tripId, inviteeEmail, role? }   (auth required, owner-gated)
//     -> { ok: true, collaboratorId, status: 'pending', emailSent: boolean }
//
//   POST { action: 'accept',  token }                          (auth required, invitee-gated)
//     -> { ok: true, tripId, role }
//
//   POST { action: 'decline', token }                          (auth required, invitee-gated)
//     -> { ok: true, tripId }
//
//   POST { action: 'revoke',  collaboratorId }                 (auth required, owner-gated)
//     -> { ok: true, collaboratorId, status: 'revoked' }
//
//   POST { action: 'list',    tripId }                         (auth required, owner-gated)
//     -> { ok: true, collaborators: TripCollaborator[] }
//
//   GET  ?ping
//     -> { ok: true, fn: 'manage-collaborators' }
//
// Security model:
//   - 'invite', 'revoke', 'list' run under the caller's JWT (makeUserClient)
//     so RLS on `trips` enforces ownership. We additionally re-check by
//     SELECTing the trip with the user JWT before any write — failure
//     returns 'not_owner' (403).
//   - 'accept', 'decline' run under the caller's JWT for invitee
//     identification. We refuse if the authenticated user's email does
//     NOT match the invitee_email (case-insensitive). This guards
//     against URL-stealing: an attacker who steals the token but is
//     signed in as a different user cannot bind themselves.
//   - The admin client (service-role) is used only to:
//       * insert the pending row (avoids the INSERT-RETURNING RLS quirk),
//       * do the bind-on-accept update (the invitee's UPDATE policy
//         allows this, but the admin path is more transparent and writes
//         user_id + status atomically),
//       * send the invite email via supabase.auth.admin.inviteUserByEmail.
//
// Email delivery:
//   - Uses Supabase Auth's `inviteUserByEmail` admin call. This sends a
//     standard Supabase invite email IF the user does not already have
//     an account — when they do, the call may return an error which we
//     surface as `emailSent: false`. Email failures DO NOT roll back the
//     invite row: the invitee may be reachable via "resend invite" or
//     direct token-link sharing.
//   - We do NOT include the invite_token in the email's redirect URL
//     today — the standard Supabase invite confirms the auth row, and
//     the user is then expected to sign in and visit the app. A
//     follow-up step is to also send a custom email containing the
//     invite_token URL via SMTP. For MVP, the invite link is returned
//     in the response so the owner can copy/paste it as a fallback.
//
// Error codes:
//   - invalid_input         400 — body failed Zod validation
//   - method_not_allowed    405 — non-POST to non-ping path
//   - not_authenticated     401 — missing / invalid JWT
//   - not_owner             403 — caller does not own the trip
//   - invite_not_found      404 — token does not match any invite
//   - invite_revoked        410 — invite was revoked / declined
//   - invite_expired        410 — invite is older than 7 days (TTL)
//   - email_mismatch        403 — caller's auth email != invitee_email
//   - email_failed          200 — invite row created but email send failed
//                                  (returned with ok:true, emailSent:false)
//   - already_accepted      409 — invite already in 'accepted' state
//   - db_error              500 — Postgres failure
//   - internal_error        500 — unexpected exception

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { log, newRequestId } from '../_shared/logger.ts';
import { makeAdminClient, makeUserClient } from '../_shared/supabase-admin.ts';

// 7-day TTL for pending invites. Older pending rows are treated as
// expired on accept; the invitee gets a clear error and the owner can
// re-invite. Accepted / declined / revoked rows are unaffected (the TTL
// is only consulted when accepting a 'pending' row).
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const InviteSchema = z.object({
  action: z.literal('invite'),
  tripId: z.string().uuid(),
  inviteeEmail: z.string().email().max(254),
  role: z.enum(['viewer', 'editor']).optional(),
});

const AcceptSchema = z.object({
  action: z.literal('accept'),
  token: z.string().min(20).max(128),
});

const DeclineSchema = z.object({
  action: z.literal('decline'),
  token: z.string().min(20).max(128),
});

const RevokeSchema = z.object({
  action: z.literal('revoke'),
  collaboratorId: z.string().uuid(),
});

const ListSchema = z.object({
  action: z.literal('list'),
  tripId: z.string().uuid(),
});

const BodySchema = z.union([
  InviteSchema,
  AcceptSchema,
  DeclineSchema,
  RevokeSchema,
  ListSchema,
]);

type CollaboratorRow = {
  id: string;
  trip_id: string;
  invitee_email: string;
  user_id: string | null;
  role: 'viewer' | 'editor';
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  invite_token: string;
  created_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

function tokenPrefix(token: string): string {
  return token.slice(0, 8);
}

/**
 * Anon client used to verify a bearer JWT via auth.getUser(). Mirrors
 * the pattern in delete-account/index.ts.
 */
function makeAnonClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) throw new Error('Supabase env vars missing');
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function extractBearer(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? '';
  const m = /^Bearer\s+(.+)$/.exec(header);
  return m ? m[1].trim() : null;
}

interface AuthedUser {
  id: string;
  email: string | null;
}

/**
 * Verify the caller is authenticated and return their auth.users row.
 * Returns null on missing / invalid JWT.
 */
async function authenticate(req: Request): Promise<AuthedUser | null> {
  const token = extractBearer(req);
  if (!token) return null;
  const anon = makeAnonClient();
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const requestId = newRequestId();

  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  if (url.searchParams.has('ping')) {
    return jsonResponse({ ok: true, fn: 'manage-collaborators' }, { origin });
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

  // Every action requires authentication.
  const user = await authenticate(req);
  if (!user) {
    return errorResponse('not_authenticated', 'Missing or invalid bearer token', 401, origin);
  }

  try {
    switch (body.action) {
      case 'invite':
        return await handleInvite(req, body, user, requestId, origin);
      case 'accept':
        return await handleAccept(req, body, user, requestId, origin);
      case 'decline':
        return await handleDecline(req, body, user, requestId, origin);
      case 'revoke':
        return await handleRevoke(req, body, user, requestId, origin);
      case 'list':
        return await handleList(req, body, user, requestId, origin);
      default: {
        const _exhaustive: never = body;
        return errorResponse('invalid_input', 'Unknown action', 400, origin);
      }
    }
  } catch (err) {
    log({
      requestId,
      fn: 'manage-collaborators',
      level: 'error',
      action: (body as { action: string }).action,
      err: String(err),
    });
    return errorResponse('internal_error', 'manage-collaborators failed', 500, origin);
  }
}

// ---------------------------------------------------------------------------
// invite
// ---------------------------------------------------------------------------
async function handleInvite(
  req: Request,
  body: z.infer<typeof InviteSchema>,
  user: AuthedUser,
  requestId: string,
  origin: string | null,
): Promise<Response> {
  const userClient = makeUserClient(req);

  // Owner check — RLS-scoped SELECT on trips proves ownership.
  const { data: trip, error: tripErr } = await userClient
    .from('trips')
    .select('id, user_id, title')
    .eq('id', body.tripId)
    .maybeSingle<{ id: string; user_id: string; title: string }>();
  if (tripErr) {
    log({ requestId, fn: 'manage-collaborators', action: 'invite', level: 'error', err: tripErr.message });
    return errorResponse('db_error', tripErr.message, 500, origin);
  }
  if (!trip || trip.user_id !== user.id) {
    return errorResponse('not_owner', 'Only the trip owner can invite collaborators', 403, origin);
  }

  // Insert the pending row via the admin client. The user-JWT INSERT
  // policy would also permit it (we just proved ownership), but the
  // admin path keeps INSERT semantics consistent across actions and
  // avoids any RLS-RETURNING quirks. The trigger fills invite_token if
  // we don't supply one.
  const admin = makeAdminClient();
  const role = body.role ?? 'viewer';
  const normalizedEmail = body.inviteeEmail.toLowerCase();

  // Detect duplicate-invite before INSERT for a cleaner error code than
  // a raw 23505 unique-violation.
  const { data: existing } = await admin
    .from('trip_collaborators')
    .select('id, status')
    .eq('trip_id', body.tripId)
    .eq('invitee_email', normalizedEmail)
    .maybeSingle<{ id: string; status: string }>();
  if (existing) {
    return errorResponse(
      'already_invited',
      `An invite for ${normalizedEmail} already exists (status: ${existing.status})`,
      409,
      origin,
    );
  }

  const { data: inserted, error: insErr } = await admin
    .from('trip_collaborators')
    .insert({
      trip_id: body.tripId,
      invitee_email: normalizedEmail,
      role,
      status: 'pending',
    })
    .select('id, invite_token')
    .single<{ id: string; invite_token: string }>();
  if (insErr || !inserted) {
    log({
      requestId,
      fn: 'manage-collaborators',
      action: 'invite',
      level: 'error',
      err: insErr?.message ?? 'insert returned no row',
    });
    return errorResponse('db_error', insErr?.message ?? 'Failed to create invite', 500, origin);
  }

  // Build an invite URL for the email + the response. The web /invite/
  // route is wired in the client; native deep link is `tripvisor://invite/`.
  const publicUrl = Deno.env.get('TRIPVISOR_PUBLIC_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
  const inviteUrl = `${publicUrl.replace(/\/$/, '')}/invite/${inserted.invite_token}`;

  // Email delivery via Supabase Auth admin invite. This is best-effort:
  // failures are logged and surfaced via emailSent:false but do NOT roll
  // back the row.
  let emailSent = false;
  let emailError: string | null = null;
  try {
    const { error: emailErr } = await admin.auth.admin.inviteUserByEmail(normalizedEmail, {
      redirectTo: inviteUrl,
      data: {
        tripvisor_invite: {
          trip_id: body.tripId,
          trip_title: trip.title,
          invite_token: inserted.invite_token,
          role,
        },
      },
    });
    if (emailErr) {
      emailError = emailErr.message;
    } else {
      emailSent = true;
    }
  } catch (e) {
    emailError = String(e);
  }

  log({
    requestId,
    fn: 'manage-collaborators',
    action: 'invite',
    level: emailSent ? 'info' : 'warn',
    tripId: body.tripId,
    collaboratorId: inserted.id,
    role,
    emailSent,
    emailError,
    tokenPrefix: tokenPrefix(inserted.invite_token),
  });

  return jsonResponse(
    {
      ok: true,
      collaboratorId: inserted.id,
      status: 'pending' as const,
      role,
      emailSent,
      // Surfaced so the owner UI can show "copy link" if the email failed.
      inviteUrl,
      ...(emailSent ? {} : { error_code: 'email_failed' as const, emailError }),
    },
    { origin },
  );
}

// ---------------------------------------------------------------------------
// accept
// ---------------------------------------------------------------------------
async function handleAccept(
  _req: Request,
  body: z.infer<typeof AcceptSchema>,
  user: AuthedUser,
  requestId: string,
  origin: string | null,
): Promise<Response> {
  const admin = makeAdminClient();

  // Look up by token (admin client; the invitee may not yet be bound).
  const { data: row, error } = await admin
    .from('trip_collaborators')
    .select('*')
    .eq('invite_token', body.token)
    .maybeSingle<CollaboratorRow>();
  if (error) {
    return errorResponse('db_error', error.message, 500, origin);
  }
  if (!row) {
    return errorResponse('invite_not_found', 'Invite not found', 404, origin);
  }

  // Email-mismatch guard: the authenticated user's email MUST match the
  // invitee_email (case-insensitive). This prevents URL-stealing.
  const callerEmail = (user.email ?? '').toLowerCase();
  const inviteeEmail = row.invitee_email.toLowerCase();
  if (!callerEmail || callerEmail !== inviteeEmail) {
    log({
      requestId,
      fn: 'manage-collaborators',
      action: 'accept',
      level: 'warn',
      result: 'email_mismatch',
      tokenPrefix: tokenPrefix(body.token),
      collaboratorId: row.id,
    });
    return errorResponse(
      'email_mismatch',
      'This invite is addressed to a different email',
      403,
      origin,
    );
  }

  if (row.status === 'accepted') {
    // Idempotent re-accept: return the current state without touching the row.
    return jsonResponse(
      { ok: true, tripId: row.trip_id, role: row.role, alreadyAccepted: true },
      { origin },
    );
  }
  if (row.status === 'declined' || row.status === 'revoked') {
    return errorResponse(
      'invite_revoked',
      `This invite is no longer valid (status: ${row.status})`,
      410,
      origin,
    );
  }

  // 7-day TTL on pending invites.
  const ageMs = Date.now() - new Date(row.created_at).getTime();
  if (ageMs > INVITE_TTL_MS) {
    return errorResponse(
      'invite_expired',
      'This invite has expired. Ask the trip owner to send a new one.',
      410,
      origin,
    );
  }

  // Bind user_id + flip status. Admin client to keep the write atomic and
  // sidestep the invitee RLS UPDATE policy's nuances (which would also
  // permit this exact write).
  const { error: updErr } = await admin
    .from('trip_collaborators')
    .update({ user_id: user.id, status: 'accepted' })
    .eq('id', row.id);
  if (updErr) {
    return errorResponse('db_error', updErr.message, 500, origin);
  }

  log({
    requestId,
    fn: 'manage-collaborators',
    action: 'accept',
    level: 'info',
    tripId: row.trip_id,
    collaboratorId: row.id,
    role: row.role,
    tokenPrefix: tokenPrefix(body.token),
  });

  return jsonResponse({ ok: true, tripId: row.trip_id, role: row.role }, { origin });
}

// ---------------------------------------------------------------------------
// decline
// ---------------------------------------------------------------------------
async function handleDecline(
  _req: Request,
  body: z.infer<typeof DeclineSchema>,
  user: AuthedUser,
  requestId: string,
  origin: string | null,
): Promise<Response> {
  const admin = makeAdminClient();

  const { data: row, error } = await admin
    .from('trip_collaborators')
    .select('*')
    .eq('invite_token', body.token)
    .maybeSingle<CollaboratorRow>();
  if (error) {
    return errorResponse('db_error', error.message, 500, origin);
  }
  if (!row) {
    return errorResponse('invite_not_found', 'Invite not found', 404, origin);
  }

  const callerEmail = (user.email ?? '').toLowerCase();
  const inviteeEmail = row.invitee_email.toLowerCase();
  if (!callerEmail || callerEmail !== inviteeEmail) {
    return errorResponse(
      'email_mismatch',
      'This invite is addressed to a different email',
      403,
      origin,
    );
  }

  if (row.status === 'declined') {
    return jsonResponse({ ok: true, tripId: row.trip_id, alreadyDeclined: true }, { origin });
  }
  if (row.status === 'revoked') {
    return errorResponse(
      'invite_revoked',
      'This invite is no longer valid',
      410,
      origin,
    );
  }
  if (row.status === 'accepted') {
    return errorResponse(
      'already_accepted',
      'This invite has already been accepted; the owner must revoke instead',
      409,
      origin,
    );
  }

  const { error: updErr } = await admin
    .from('trip_collaborators')
    .update({ user_id: user.id, status: 'declined' })
    .eq('id', row.id);
  if (updErr) {
    return errorResponse('db_error', updErr.message, 500, origin);
  }

  log({
    requestId,
    fn: 'manage-collaborators',
    action: 'decline',
    level: 'info',
    tripId: row.trip_id,
    collaboratorId: row.id,
    tokenPrefix: tokenPrefix(body.token),
  });

  return jsonResponse({ ok: true, tripId: row.trip_id }, { origin });
}

// ---------------------------------------------------------------------------
// revoke
// ---------------------------------------------------------------------------
async function handleRevoke(
  req: Request,
  body: z.infer<typeof RevokeSchema>,
  user: AuthedUser,
  requestId: string,
  origin: string | null,
): Promise<Response> {
  const userClient = makeUserClient(req);
  const admin = makeAdminClient();

  // Look up the row + its trip_id, then prove ownership.
  const { data: row, error } = await admin
    .from('trip_collaborators')
    .select('id, trip_id, status')
    .eq('id', body.collaboratorId)
    .maybeSingle<{ id: string; trip_id: string; status: string }>();
  if (error) {
    return errorResponse('db_error', error.message, 500, origin);
  }
  if (!row) {
    return errorResponse('invite_not_found', 'Collaborator not found', 404, origin);
  }

  // Owner gate via user-JWT SELECT on trips.
  const { data: trip, error: tripErr } = await userClient
    .from('trips')
    .select('id, user_id')
    .eq('id', row.trip_id)
    .maybeSingle<{ id: string; user_id: string }>();
  if (tripErr) {
    return errorResponse('db_error', tripErr.message, 500, origin);
  }
  if (!trip || trip.user_id !== user.id) {
    return errorResponse('not_owner', 'Only the trip owner can revoke collaborators', 403, origin);
  }

  if (row.status === 'revoked') {
    // Idempotent
    return jsonResponse(
      { ok: true, collaboratorId: row.id, status: 'revoked' as const, alreadyRevoked: true },
      { origin },
    );
  }

  const { error: updErr } = await admin
    .from('trip_collaborators')
    .update({ status: 'revoked' })
    .eq('id', row.id);
  if (updErr) {
    return errorResponse('db_error', updErr.message, 500, origin);
  }

  log({
    requestId,
    fn: 'manage-collaborators',
    action: 'revoke',
    level: 'info',
    tripId: row.trip_id,
    collaboratorId: row.id,
  });

  return jsonResponse(
    { ok: true, collaboratorId: row.id, status: 'revoked' as const },
    { origin },
  );
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------
async function handleList(
  req: Request,
  body: z.infer<typeof ListSchema>,
  user: AuthedUser,
  requestId: string,
  origin: string | null,
): Promise<Response> {
  const userClient = makeUserClient(req);

  // Owner gate.
  const { data: trip, error: tripErr } = await userClient
    .from('trips')
    .select('id, user_id')
    .eq('id', body.tripId)
    .maybeSingle<{ id: string; user_id: string }>();
  if (tripErr) {
    return errorResponse('db_error', tripErr.message, 500, origin);
  }
  if (!trip || trip.user_id !== user.id) {
    return errorResponse('not_owner', 'Only the trip owner can list collaborators', 403, origin);
  }

  const { data, error } = await userClient
    .from('trip_collaborators')
    .select('id, trip_id, invitee_email, user_id, role, status, created_at, accepted_at, revoked_at')
    .eq('trip_id', body.tripId)
    .order('created_at', { ascending: true });
  if (error) {
    return errorResponse('db_error', error.message, 500, origin);
  }

  log({
    requestId,
    fn: 'manage-collaborators',
    action: 'list',
    level: 'info',
    tripId: body.tripId,
    count: data?.length ?? 0,
  });

  return jsonResponse({ ok: true, collaborators: data ?? [] }, { origin });
}

Deno.serve(handler);
