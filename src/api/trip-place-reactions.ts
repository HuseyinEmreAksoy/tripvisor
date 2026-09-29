// Tripvisor Phase 24 Step 24.2 — trip place reactions client wrappers.
//
// Mirrors the pattern of `src/api/trip-expenses.ts`:
//   - Zod schemas validate the row shape coming back from PostgREST
//     (defence in depth on top of the migration's CHECK constraint).
//   - Query keys live in `./_keys` so cross-module invalidation never
//     creates circular requires (see the comment at the top of `_keys.ts`).
//   - All hooks talk to the table directly under RLS via @supabase/supabase-js
//     — there is no Edge Function involved. The RLS policies in
//     `0017_trip_place_reactions.sql` are the only authorization gate.
//
// Reactions are personal opinions, not trip artefacts. Viewer-level
// access to the parent trip is the minimum bar to read OR write a row;
// `user_can_access_trip(_, _, 'viewer')` gates the SELECT / INSERT
// policies, while UPDATE / DELETE are pinned to `user_id = auth.uid()`
// (a collaborator can SEE another collaborator's reaction but never
// mutate it).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from './supabase';
import type {
  TripPlaceReaction,
  TripPlaceReactionType,
  Uuid,
} from './types';
import { tripPlaceReactionsKeys } from './_keys';

// Re-export so consumers can import everything from a single module
// (`import { tripPlaceReactionsKeys, useSetTripPlaceReaction } from '@/api'`).
export { tripPlaceReactionsKeys };

export type { TripPlaceReaction, TripPlaceReactionType };

// ===========================================================================
// Zod schemas
// ===========================================================================
//
// Mirrors the `public.trip_place_reactions` columns and the CHECK
// constraint on `reaction`. Keep in lockstep with
// `0017_trip_place_reactions.sql` and the `TripPlaceReactionType` union
// in `./types.ts` — if you widen one, widen all three.

const tripPlaceReactionEnum = z.enum(['liked', 'disliked']);

const tripPlaceReactionRowSchema = z.object({
  id: z.string().uuid(),
  trip_place_id: z.string().uuid(),
  user_id: z.string().uuid(),
  reaction: tripPlaceReactionEnum,
  created_at: z.string(),
  updated_at: z.string(),
});

// Projection used by every read in this file. Explicit fields (rather
// than `*`) so the wire shape stays stable even if migrations add
// internal-use columns later.
const REACTION_SELECT_FIELDS =
  'id, trip_place_id, user_id, reaction, created_at, updated_at';

/**
 * Unique, uuid-shaped temp id for an optimistic first reaction (the row type
 * and list keys expect a uuid). `crypto.randomUUID` where available (Hermes
 * on SDK 52+, modern browsers), else an RFC4122-v4-shaped Math.random id.
 */
export function optimisticReactionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the Math.random fallback
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ===========================================================================
// Hooks: reads
// ===========================================================================

/**
 * Fetch the current user's reaction for a single `trip_place`. Returns
 * `null` when the user has not reacted yet — the hook's `data` is a
 * `TripPlaceReaction | null`, not a thrown error or empty array, because
 * "no reaction" is the dominant state for any place a user has not
 * specifically opined on.
 *
 * RLS on the SELECT policy lets every viewer-or-better collaborator read
 * every reaction for the trip; we narrow to the caller's row by
 * `eq('user_id', userId)` for the UI's per-card "your reaction" state.
 *
 * Disabled when either `tripPlaceId` or `userId` is undefined so the
 * trip detail screen can render skeleton cards before the auth + place
 * data have hydrated.
 */
export function useTripPlaceReaction(
  tripPlaceId: Uuid | undefined,
  userId: Uuid | undefined,
) {
  return useQuery<TripPlaceReaction | null>({
    // User-scoped: after an account switch the previous user's cached
    // reaction lives under a different key and can never be served.
    queryKey:
      tripPlaceId && userId
        ? tripPlaceReactionsKeys.forTripPlaceUser(tripPlaceId, userId)
        : ['trip-place-reactions', 'none'],
    enabled: Boolean(tripPlaceId && userId),
    queryFn: async () => {
      if (!tripPlaceId || !userId) return null;
      // `.maybeSingle()` returns `data: null` (not an error) when zero
      // rows match. The `(trip_place_id, user_id)` unique constraint
      // guarantees at most one row, so this is the correct shape.
      const { data, error } = await supabase
        .from('trip_place_reactions')
        .select(REACTION_SELECT_FIELDS)
        .eq('trip_place_id', tripPlaceId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      // Best-effort runtime validation. Match `useTripExpenses` policy:
      // narrow to the schema where it succeeds, fall back to the raw
      // row otherwise (preferring a "stale UI seeing an unknown enum
      // value" failure mode over crashing the place card).
      return tripPlaceReactionRowSchema.parse(data) as TripPlaceReaction;
    },
  });
}

/**
 * Fetch every reaction on every place in a trip. Used by the trip detail
 * catalog sections (e.g. "places your travel companions liked"). Joins
 * via PostgREST's embedded resource shortcut so we filter by
 * `trip_places.trip_id = tripId` without a second round-trip.
 *
 * Returns the rows in chronological order (oldest first) — the catalog
 * UI sorts client-side by reaction type / collaborator, but the server
 * order is deterministic.
 */
export function useTripReactions(tripId: Uuid | undefined) {
  return useQuery<TripPlaceReaction[]>({
    queryKey: tripId
      ? tripPlaceReactionsKeys.forTrip(tripId)
      : ['trip-place-reactions', 'for-trip', 'none'],
    enabled: Boolean(tripId),
    queryFn: async () => {
      if (!tripId) return [];
      // Embedded filter: PostgREST returns reactions whose parent
      // trip_place is in this trip. The inner `!inner` makes the join
      // an INNER JOIN so reactions whose trip_places row was deleted
      // (cascade should prevent this, but defence in depth) won't
      // surface with a null parent. `trip_places(trip_id)` is the
      // join predicate; we filter on it via the URL syntax below.
      const { data, error } = await supabase
        .from('trip_place_reactions')
        .select(`${REACTION_SELECT_FIELDS}, trip_places!inner(trip_id)`)
        .eq('trip_places.trip_id', tripId)
        // v2 S2.8.1: the !inner join means this embedded filter drops
        // reactions whose parent place is a soft-delete tombstone
        // (trip_places.deleted, migration 0027) — tombstoning doesn't
        // cascade to reactions, so without this a deleted place would
        // resurface through its companions' likes.
        .eq('trip_places.deleted', false)
        .order('created_at', { ascending: true });
      if (error) throw error;
      // Strip the embedded `trip_places` field before validation — Zod's
      // `.parse` rejects unknown keys by default and we don't want the
      // join column polluting the row type.
      const rows = (data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id,
        trip_place_id: r.trip_place_id,
        user_id: r.user_id,
        reaction: r.reaction,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
      return rows as TripPlaceReaction[];
    },
  });
}

/**
 * Fetch every reaction the current user has placed across every trip
 * they can see. Powers the cross-trip analytics screen (Phase 24 Step
 * 24.x — "places I liked / disliked across all my trips").
 *
 * RLS scopes the result to trips the user has at least viewer access
 * to, so a caller who is no longer a collaborator on trip X will not
 * see their old reactions on X (the `trip_place_reactions_collab_select`
 * policy joins through `trip_places` -> `user_can_access_trip`).
 *
 * Note: this can be a sizeable list for power users (N trips × M places
 * each). The (user_id, reaction) index in the migration keeps the
 * server-side scan cheap; the client-side render is expected to bucket
 * by reaction kind and lazy-load place details.
 *
 * `userId` (the signed-in user, e.g. `useSession().data?.user.id`) is part of
 * the query key so an account switch never shows the previous user's cached
 * list. The query stays idle (data `undefined`) until it is known.
 */
export function useAllUserReactions(userId: Uuid | undefined) {
  return useQuery<TripPlaceReaction[]>({
    queryKey: userId
      ? tripPlaceReactionsKeys.mineFor(userId)
      : [...tripPlaceReactionsKeys.mine(), 'none'],
    enabled: Boolean(userId),
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('trip_place_reactions')
        .select(REACTION_SELECT_FIELDS)
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as TripPlaceReaction[];
    },
  });
}

// ===========================================================================
// Hooks: mutations
// ===========================================================================

export interface SetTripPlaceReactionInput {
  tripPlaceId: Uuid;
  /**
   * `'liked' | 'disliked'` upserts the row; `null` deletes it
   * ("clear my reaction"). The DB schema has no nullable third state —
   * absence of a row IS the "no reaction" state.
   */
  reaction: TripPlaceReactionType | null;
  /**
   * The parent trip id. Required for cache invalidation — we cannot
   * derive it from the response of an UPSERT/DELETE without an extra
   * round trip (PostgREST DELETE with a `select` of an embedded
   * resource is awkward and not worth the complexity here).
   */
  tripId: Uuid;
}

/**
 * Result returned by the mutation:
 *   - For an upsert: the persisted row.
 *   - For a clear (DELETE): `{ deleted: true, tripPlaceId }`.
 * The discriminator lets `onSuccess` invalidate the right caches without
 * branching on the input variables.
 */
export type SetTripPlaceReactionResult =
  | { kind: 'upserted'; row: TripPlaceReaction }
  | { kind: 'deleted'; tripPlaceId: Uuid };

/**
 * Toggle / clear a reaction on a place.
 *
 * Behaviour:
 *   - `reaction: 'liked' | 'disliked'` → UPSERT via `ON CONFLICT
 *     (trip_place_id, user_id) DO UPDATE`. We use Supabase's
 *     `.upsert(_, { onConflict: 'trip_place_id,user_id' })` which maps
 *     directly to PostgREST's `Prefer: resolution=merge-duplicates`
 *     header. The resulting row has the new `reaction` and the
 *     trigger-stamped `updated_at`.
 *   - `reaction: null` → DELETE the row scoped by `(trip_place_id,
 *     user_id)`. RLS pins the delete to the caller's row anyway, but
 *     filtering explicitly keeps the SQL deterministic.
 *
 * Optimistic update + rollback:
 *   - `onMutate` snapshots both the per-place cache
 *     (`forTripPlace(tripPlaceId)`) and the per-trip cache
 *     (`forTrip(tripId)`), then writes the predicted post-mutation
 *     state into both. On error we restore from the snapshot.
 *   - On success we still invalidate so the trigger-stamped timestamps
 *     and any server-side normalization round-trip cleanly. Belt-and-
 *     suspenders: optimistic UI for snappy feel, invalidation for
 *     correctness.
 */
export function useSetTripPlaceReaction() {
  const qc = useQueryClient();
  return useMutation<
    SetTripPlaceReactionResult,
    Error,
    SetTripPlaceReactionInput,
    {
      /** The session user the optimistic write was keyed to (absent = no write). */
      userId?: Uuid;
      previousForPlace: TripPlaceReaction | null | undefined;
      previousForTrip: TripPlaceReaction[] | undefined;
    }
  >({
    mutationFn: async ({ tripPlaceId, reaction }) => {
      // Resolve the caller's user id — required for both upsert (to
      // populate `user_id`) and delete (to scope the DELETE WHERE).
      // RLS would reject a mismatch anyway, but supplying the right
      // id up front avoids a 0-row UPDATE on the upsert path.
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) {
        throw new Error('not_authenticated');
      }
      const userId = userData.user.id;

      if (reaction === null) {
        // Clear: DELETE the (trip_place_id, user_id) row. RLS already
        // pins to user_id = auth.uid() but we filter explicitly so a
        // caller couldn't accidentally delete every reaction on the
        // place if the policy were ever loosened.
        const { error } = await supabase
          .from('trip_place_reactions')
          .delete()
          .eq('trip_place_id', tripPlaceId)
          .eq('user_id', userId);
        if (error) throw error;
        return { kind: 'deleted', tripPlaceId };
      }

      // Upsert: insert OR update the row keyed by the unique
      // (trip_place_id, user_id) constraint. `ignoreDuplicates: false`
      // is the default but spelt out for clarity — we explicitly want
      // duplicates to UPDATE the existing row, not be silently
      // dropped.
      const { data, error } = await supabase
        .from('trip_place_reactions')
        .upsert(
          { trip_place_id: tripPlaceId, user_id: userId, reaction },
          {
            onConflict: 'trip_place_id,user_id',
            ignoreDuplicates: false,
          },
        )
        .select(REACTION_SELECT_FIELDS)
        .single();
      if (error) throw error;
      return {
        kind: 'upserted',
        row: tripPlaceReactionRowSchema.parse(data) as TripPlaceReaction,
      };
    },
    onMutate: async ({ tripPlaceId, tripId, reaction }) => {
      // Resolve the user id from the LOCAL session (`getSession` reads
      // storage; `getUser` is a network round-trip that would stall or fail
      // the optimistic update offline). If we can't read it, skip the
      // optimistic update and let mutationFn surface the auth error.
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (!userId) {
        return { previousForPlace: undefined, previousForTrip: undefined };
      }
      const placeKey = tripPlaceReactionsKeys.forTripPlaceUser(tripPlaceId, userId);

      // Cancel in-flight refetches so they don't clobber the optimistic
      // state we're about to write.
      await qc.cancelQueries({ queryKey: placeKey });
      await qc.cancelQueries({
        queryKey: tripPlaceReactionsKeys.forTrip(tripId),
      });

      // Snapshot for rollback.
      const previousForPlace = qc.getQueryData<TripPlaceReaction | null>(placeKey);
      const previousForTrip = qc.getQueryData<TripPlaceReaction[]>(
        tripPlaceReactionsKeys.forTrip(tripId),
      );

      const nowIso = new Date().toISOString();

      // Optimistic update for the per-place cache.
      if (reaction === null) {
        qc.setQueryData<TripPlaceReaction | null>(placeKey, null);
      } else {
        // Synthesise the predicted row. We don't know the eventual
        // server-assigned `id` for a brand-new row: reuse the previous id
        // when present, else mint a unique temp uuid (a shared constant
        // would collide for concurrent first reactions on different places
        // in the per-trip list). The `onSuccess` refetch replaces it.
        const synthesized: TripPlaceReaction = {
          id: previousForPlace?.id ?? optimisticReactionId(),
          trip_place_id: tripPlaceId,
          user_id: userId,
          reaction,
          created_at: previousForPlace?.created_at ?? nowIso,
          updated_at: nowIso,
        };
        qc.setQueryData<TripPlaceReaction | null>(placeKey, synthesized);

        // Optimistic update for the per-trip list cache.
        if (previousForTrip) {
          const existingIdx = previousForTrip.findIndex(
            (r) => r.trip_place_id === tripPlaceId && r.user_id === userId,
          );
          const next =
            existingIdx >= 0
              ? [
                  ...previousForTrip.slice(0, existingIdx),
                  { ...previousForTrip[existingIdx]!, reaction, updated_at: nowIso },
                  ...previousForTrip.slice(existingIdx + 1),
                ]
              : [...previousForTrip, synthesized];
          qc.setQueryData<TripPlaceReaction[]>(
            tripPlaceReactionsKeys.forTrip(tripId),
            next,
          );
        }
      }

      // For the DELETE path, also drop the row from the per-trip cache.
      if (reaction === null && previousForTrip) {
        qc.setQueryData<TripPlaceReaction[]>(
          tripPlaceReactionsKeys.forTrip(tripId),
          previousForTrip.filter(
            (r) => !(r.trip_place_id === tripPlaceId && r.user_id === userId),
          ),
        );
      }

      return { userId, previousForPlace, previousForTrip };
    },
    onError: (_err, { tripPlaceId, tripId }, context) => {
      // Rollback to the snapshot. The `context` is whatever `onMutate`
      // returned; only restore caches we actually wrote.
      if (!context?.userId) return;
      const placeKey = tripPlaceReactionsKeys.forTripPlaceUser(tripPlaceId, context.userId);
      if (context.previousForPlace !== undefined) {
        qc.setQueryData(placeKey, context.previousForPlace);
      }
      if (context.previousForTrip !== undefined) {
        qc.setQueryData(
          tripPlaceReactionsKeys.forTrip(tripId),
          context.previousForTrip,
        );
      }
    },
    onSuccess: (_result, { tripPlaceId, tripId }) => {
      // Invalidate so trigger-stamped timestamps and any other
      // server-side normalisation round-trip cleanly. The `mine()`
      // cache is also invalidated because the analytics screen
      // (cross-trip) needs to reflect the change.
      qc.invalidateQueries({
        queryKey: tripPlaceReactionsKeys.forTripPlace(tripPlaceId),
      });
      qc.invalidateQueries({
        queryKey: tripPlaceReactionsKeys.forTrip(tripId),
      });
      qc.invalidateQueries({ queryKey: tripPlaceReactionsKeys.mine() });
    },
  });
}
