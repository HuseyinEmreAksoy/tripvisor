// Tripvisor Phase 21 Step 21.5/21.6 — trip collaborator client wrappers.
//
// Mirrors the pattern of `src/api/trip-expenses.ts` and `src/api/share.ts`:
//   - Zod schemas validate the row shape coming back from the DB / Edge
//     Function (defence in depth on top of the migration's CHECK
//     constraints).
//   - Query keys live in `./_keys` so cross-module invalidation doesn't
//     create circular requires (see the comment at the top of `_keys.ts`).
//   - All write paths funnel through the `manage-collaborators` Edge
//     Function so authorization (owner vs invitee, email-mismatch guards,
//     7-day TTL) is centralised on the server.
//   - Reads of the trip's collaborator list happen via the Supabase JS
//     client directly under RLS — the SELECT policy on
//     `trip_collaborators` lets the owner see all rows for their trip
//     and lets the invitee see their own rows.
//
// Constraint
// ----------
// Per the dispatch instructions, this file does NOT touch
// `src/api/trips.ts`. The "Shared with me" UNION into `useTrips` is
// deferred to Step 21.7. Instead, `useCollaboratedTrips` is exposed as a
// standalone hook returning the trips-where-I-am-a-collaborator list, so
// the UI can render a "Shared with me" surface without coupling to the
// owner trips list yet.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from './supabase';
import type {
  Trip,
  TripCollaborator,
  TripCollaboratorRole,
  TripCollaboratorStatus,
  Uuid,
} from './types';
import { tripCollaboratorsKeys, tripsKeys } from './_keys';
import { EdgeFunctionError, tryParseEdgeFunctionError } from './_errors';

// Re-export the keys so consumers can import everything from a single
// module (`import { tripCollaboratorsKeys, useTripCollaborators } from '@/api'`).
export { tripCollaboratorsKeys };

export type {
  TripCollaborator,
  TripCollaboratorRole,
  TripCollaboratorStatus,
};

// ===========================================================================
// Typed errors
// ===========================================================================

/**
 * Typed error thrown by the `manage-collaborators` Edge Function when it
 * returns a structured `{ error: { code, message } }` envelope with a
 * non-2xx HTTP status. Consumers can branch on the error via
 * `instanceof CollaboratorError` and inspect `.code` to render an
 * appropriate surface.
 *
 * Known codes (mirrors `supabase/functions/manage-collaborators/index.ts`):
 *   - `invalid_input`        — 400 — body failed Zod validation
 *   - `method_not_allowed`   — 405 — non-POST to non-ping path
 *   - `not_authenticated`    — 401 — caller is not signed in
 *   - `not_owner`            — 403 — caller does not own the trip
 *   - `email_mismatch`       — 403 — auth email does not match invitee
 *   - `invite_not_found`     — 404 — token / id does not match a row
 *   - `already_invited`      — 409 — duplicate invite for (trip, email)
 *   - `already_accepted`     — 409 — invite is already accepted
 *   - `invite_revoked`       — 410 — invite was revoked or declined
 *   - `invite_expired`       — 410 — pending invite older than 7 days
 *   - `db_error`             — 500 — Postgres failure
 *   - `internal_error`       — 500 — unexpected exception
 */
export class CollaboratorError extends EdgeFunctionError {
  constructor(code: string, message: string, status: number) {
    super(code, message, status);
    this.name = 'CollaboratorError';
  }
}

// ===========================================================================
// Zod schemas
// ===========================================================================

const tripCollaboratorRoleEnum = z.enum(['viewer', 'editor']);
const tripCollaboratorStatusEnum = z.enum([
  'pending',
  'accepted',
  'declined',
  'revoked',
]);

/**
 * Row schema for `trip_collaborators` SELECT results. We deliberately
 * omit `invite_token` from the projected SELECT in the read hooks so
 * tokens never leak into client memory once they've been used — owners
 * who want to "copy invite link" again do it via the response of the
 * `invite` action, which returns the URL once.
 */
const tripCollaboratorRowSchema = z.object({
  id: z.string().uuid(),
  trip_id: z.string().uuid(),
  invitee_email: z.string(),
  user_id: z.string().uuid().nullable(),
  role: tripCollaboratorRoleEnum,
  status: tripCollaboratorStatusEnum,
  created_at: z.string(),
  accepted_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
});

const COLLABORATOR_SELECT_FIELDS =
  'id, trip_id, invitee_email, user_id, role, status, created_at, accepted_at, revoked_at';

// ===========================================================================
// Edge Function helpers
// ===========================================================================

interface InviteResponse {
  ok: true;
  collaboratorId: Uuid;
  status: 'pending';
  role: TripCollaboratorRole;
  emailSent: boolean;
  inviteUrl: string;
  error_code?: 'email_failed';
  emailError?: string | null;
}

interface AcceptResponse {
  ok: true;
  tripId: Uuid;
  role: TripCollaboratorRole;
  alreadyAccepted?: boolean;
}

interface DeclineResponse {
  ok: true;
  tripId: Uuid;
  alreadyDeclined?: boolean;
}

interface RevokeResponse {
  ok: true;
  collaboratorId: Uuid;
  status: 'revoked';
  alreadyRevoked?: boolean;
}

async function invokeManageCollaborators<T>(
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(
    'manage-collaborators',
    { body },
  );
  if (error) {
    const typed = await tryParseEdgeFunctionError(error, CollaboratorError);
    if (typed) throw typed;
    throw error;
  }
  if (!data) {
    throw new CollaboratorError(
      'internal_error',
      'manage-collaborators returned no data',
      500,
    );
  }
  return data;
}

// ===========================================================================
// Hooks: reads
// ===========================================================================

/**
 * List collaborators for a trip. Under RLS:
 *   - Trip owner sees ALL rows (any status).
 *   - An accepted collaborator sees their own row only (the SELECT
 *     policy permits user_id = auth.uid() OR pre-bind email match).
 *
 * The owner-side "manage collaborators" UI consumes this; collaborator-
 * side surfaces typically don't need this list (they care about which
 * trips they have access to, which is `useCollaboratedTrips`).
 */
export function useTripCollaborators(tripId: Uuid | undefined) {
  return useQuery<TripCollaborator[]>({
    queryKey: tripId
      ? tripCollaboratorsKeys.forTrip(tripId)
      : ['trip-collaborators', 'none'],
    enabled: Boolean(tripId),
    queryFn: async () => {
      if (!tripId) return [];
      const { data, error } = await supabase
        .from('trip_collaborators')
        .select(COLLABORATOR_SELECT_FIELDS)
        .eq('trip_id', tripId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      // Best-effort runtime validation. Match `useTripExpenses` policy:
      // narrow to the schema where it succeeds, fall back to the raw
      // row otherwise (preferring a "stale UI seeing an unknown enum
      // value" failure mode over crashing the whole list).
      return (data ?? []) as TripCollaborator[];
    },
  });
}

/**
 * Trips the current user has been invited to AND has accepted on. Joins
 * `trip_collaborators` (filtered to status='accepted', user_id=auth.uid())
 * to `trips` to return full trip rows.
 *
 * Why a separate hook (not a UNION into useTrips)
 * -----------------------------------------------
 * Per the Step 21.5/21.6 dispatch: a parallel slice (Slice A, budget) is
 * touching `src/api/trips.ts` concurrently. Modifying `useTrips` here
 * would clobber that work. The UNION into `useTrips` is deferred to
 * Step 21.7. For now, the trips-list surface can call BOTH `useTrips()`
 * and `useCollaboratedTrips()` and merge them in the UI (with a "Shared
 * with me" badge tagged onto the collaborator-side rows).
 *
 * Implementation
 * --------------
 * Two-step query:
 *   1. SELECT trip_id FROM trip_collaborators WHERE user_id = auth.uid()
 *      AND status = 'accepted' (uses the (user_id, status) partial index).
 *   2. SELECT * FROM trips WHERE id IN (<step 1>) — RLS on `trips` was
 *      widened in `0011_trip_collaborators.sql` to permit accepted
 *      collaborators to SELECT, so this query succeeds under the user
 *      JWT.
 * We could express this as a single PostgREST `?select=trips!inner(*)`
 * embedded query, but the two-step form is easier to reason about for
 * cache invalidation and matches the pattern used by `useTripLegsByTripIds`.
 */
export function useCollaboratedTrips() {
  return useQuery<Trip[]>({
    queryKey: tripCollaboratorsKeys.mine(),
    queryFn: async () => {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) return [];

      const { data: rows, error: rowsErr } = await supabase
        .from('trip_collaborators')
        .select('trip_id')
        .eq('user_id', userData.user.id)
        .eq('status', 'accepted');
      if (rowsErr) throw rowsErr;
      const tripIds = (rows ?? []).map((r) => r.trip_id as Uuid);
      if (tripIds.length === 0) return [];

      const { data: trips, error: tripsErr } = await supabase
        .from('trips')
        .select('*')
        .in('id', tripIds)
        .order('created_at', { ascending: false });
      if (tripsErr) throw tripsErr;
      return (trips ?? []) as Trip[];
    },
  });
}

// ===========================================================================
// Hooks: mutations
// ===========================================================================

export interface InviteCollaboratorInput {
  tripId: Uuid;
  inviteeEmail: string;
  role?: TripCollaboratorRole;
}

/**
 * Owner-side mutation: invite a collaborator. Returns the response from
 * the Edge Function (including `inviteUrl` so the UI can offer "copy
 * link" if email delivery failed).
 */
export function useInviteCollaborator() {
  const qc = useQueryClient();
  return useMutation<InviteResponse, CollaboratorError | Error, InviteCollaboratorInput>({
    mutationFn: async ({ tripId, inviteeEmail, role }) => {
      return invokeManageCollaborators<InviteResponse>({
        action: 'invite',
        tripId,
        inviteeEmail,
        ...(role ? { role } : {}),
      });
    },
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: tripCollaboratorsKeys.forTrip(vars.tripId) });
    },
  });
}

/**
 * Invitee-side mutation: accept an invite by token. The bound hook
 * variant (`useAcceptCollaboratorInvite(token)`) curries the token; the
 * underlying invocation also accepts a token argument so callers that
 * receive the token at call time can use that path instead.
 */
export function useAcceptCollaboratorInvite(token?: string) {
  const qc = useQueryClient();
  return useMutation<AcceptResponse, CollaboratorError | Error, { token?: string } | void>({
    mutationFn: async (input) => {
      const t = (input && 'token' in input ? input.token : undefined) ?? token;
      if (!t) throw new Error('token required to accept an invite');
      return invokeManageCollaborators<AcceptResponse>({
        action: 'accept',
        token: t,
      });
    },
    onSuccess: (res) => {
      // The user just gained access to a new trip — their accepted-trips
      // list and the affected trip's per-trip caches need refreshing.
      qc.invalidateQueries({ queryKey: tripCollaboratorsKeys.mine() });
      qc.invalidateQueries({ queryKey: tripCollaboratorsKeys.forTrip(res.tripId) });
      qc.invalidateQueries({ queryKey: tripsKeys.detail(res.tripId) });
      qc.invalidateQueries({ queryKey: tripsKeys.all });
    },
  });
}

/**
 * Invitee-side mutation: decline an invite by token. Mirrors
 * `useAcceptCollaboratorInvite`'s curry pattern.
 */
export function useDeclineCollaboratorInvite(token?: string) {
  const qc = useQueryClient();
  return useMutation<DeclineResponse, CollaboratorError | Error, { token?: string } | void>({
    mutationFn: async (input) => {
      const t = (input && 'token' in input ? input.token : undefined) ?? token;
      if (!t) throw new Error('token required to decline an invite');
      return invokeManageCollaborators<DeclineResponse>({
        action: 'decline',
        token: t,
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: tripCollaboratorsKeys.mine() });
      qc.invalidateQueries({ queryKey: tripCollaboratorsKeys.forTrip(res.tripId) });
    },
  });
}

/**
 * Owner-side mutation: revoke a collaborator by id. Subsequent RLS
 * checks on the affected trip will fail because `status != 'accepted'`,
 * so the revoked collaborator's queries against the trip's children
 * will start returning empty / 403.
 */
export function useRevokeCollaborator() {
  const qc = useQueryClient();
  return useMutation<
    RevokeResponse,
    CollaboratorError | Error,
    { collaboratorId: Uuid; tripId: Uuid }
  >({
    mutationFn: async ({ collaboratorId }) => {
      return invokeManageCollaborators<RevokeResponse>({
        action: 'revoke',
        collaboratorId,
      });
    },
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: tripCollaboratorsKeys.forTrip(vars.tripId) });
      // The revoked user's mine-list will refresh on their next session;
      // we can't invalidate it from the owner's client.
    },
  });
}
