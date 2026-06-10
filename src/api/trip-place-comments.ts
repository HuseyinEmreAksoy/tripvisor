// Tripvisor v2 Phase N2 (BUILD-LOG 2.6) — trip place comments client wrappers.
//
// Mirrors the pattern of `src/api/trip-place-reactions.ts`:
//   - Zod schemas validate the row shape coming back from PostgREST
//     (defence in depth on top of the migration's CHECK constraint).
//   - Query keys live in `./_keys` so cross-module invalidation never
//     creates circular requires (see the comment at the top of `_keys.ts`).
//   - All hooks talk to the table directly under RLS via @supabase/supabase-js
//     — no Edge Function involved. The RLS policies in
//     `0019_v2_realtime_and_comments.sql` are the only authorization gate.
//
// ToS / state-tier note: comments are Tier-1-safe USER content — pure
// user-authored text with zero Google Places data — so they are durable
// server-side and (later) offline-syncable with no 30-day ceiling.
//
// Conflict model (v2 panel decision): comments are append-only per-author
// rows. Two collaborators commenting at once INSERT two distinct rows, so
// there is no shared field for a last-write-wins merge to clobber (unlike
// v1's single shared notes field). "Delete" is a SOFT delete
// (`deleted = true`) — the tombstone row replicates cleanly through offline
// sync; reads in this module exclude tombstones.
//
// Access model: viewer-or-better collaborators can READ the whole thread
// and WRITE their own comments (viewers may comment — it's the group-voice
// feature, same stance as reactions). Edit/delete are author-only.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from './supabase';
import type { Uuid } from './types';
import { tripPlaceCommentsKeys } from './_keys';

// Re-export so consumers can import everything from a single module
// (`import { tripPlaceCommentsKeys, useTripPlaceComments } from '@/api'`).
export { tripPlaceCommentsKeys };

// ===========================================================================
// Types + Zod schemas
// ===========================================================================
//
// The row type lives locally (not in `./types.ts`) — the comments surface is
// self-contained and nothing outside this module's consumers needs the
// shape; `src/api/index.ts` re-exports it for `@/api` importers. Keep in
// lockstep with `0019_v2_realtime_and_comments.sql` — if you widen one,
// widen both.

export interface TripPlaceComment {
  id: Uuid;
  /** Denormalized parent trip (= trip_places.trip_id); powers per-trip batch reads. */
  trip_id: Uuid;
  trip_place_id: Uuid;
  author_id: Uuid;
  body: string;
  created_at: string;
  /** Null until first edit; the set_updated_at trigger stamps it on UPDATE. */
  updated_at: string | null;
  /** Soft-delete tombstone. Reads in this module always exclude `deleted = true`. */
  deleted: boolean;
}

const tripPlaceCommentRowSchema = z.object({
  id: z.string().uuid(),
  trip_id: z.string().uuid(),
  trip_place_id: z.string().uuid(),
  author_id: z.string().uuid(),
  // Mirrors `check (char_length(body) between 1 and 2000)`.
  body: z.string().min(1).max(2000),
  created_at: z.string(),
  updated_at: z.string().nullable(),
  deleted: z.boolean(),
});

// Projection used by every read in this file. Explicit fields (rather than
// `*`) so the wire shape stays stable even if migrations add internal-use
// columns later.
const COMMENT_SELECT_FIELDS =
  'id, trip_id, trip_place_id, author_id, body, created_at, updated_at, deleted';

// Insert payload, validated client-side BEFORE the round trip so the UI gets
// a friendly Zod error ("comment too long") instead of an opaque CHECK
// violation from PostgREST. `author_id` is intentionally absent — it is
// resolved from the live session inside the mutation (and RLS would reject
// any spoofed value anyway).
const createTripPlaceCommentSchema = z.object({
  tripId: z.string().uuid(),
  tripPlaceId: z.string().uuid(),
  body: z.string().min(1, 'Comment cannot be empty').max(2000, 'Comment is too long (max 2000 characters)'),
});

export type CreateTripPlaceCommentInput = z.infer<typeof createTripPlaceCommentSchema>;

export interface DeleteTripPlaceCommentInput {
  commentId: Uuid;
  /** Needed for optimistic cache surgery — not derivable from the UPDATE response without a join. */
  tripPlaceId: Uuid;
  tripId: Uuid;
}

// ===========================================================================
// Pure helpers
// ===========================================================================

/**
 * Roll a per-trip comment list up into `trip_place_id -> count`. Pure +
 * tiny; exported so every badge consumer (itinerary rows, map callouts)
 * shares one implementation instead of re-reducing inline.
 */
export function countCommentsByPlace(
  comments: readonly TripPlaceComment[],
): Map<Uuid, number> {
  const counts = new Map<Uuid, number>();
  for (const c of comments) {
    counts.set(c.trip_place_id, (counts.get(c.trip_place_id) ?? 0) + 1);
  }
  return counts;
}

// ===========================================================================
// Hooks: reads
// ===========================================================================

/**
 * Fetch the comment thread for a single `trip_place`, oldest first
 * (chat-style: new comments append at the bottom). Soft-deleted rows are
 * excluded server-side via `eq('deleted', false)`.
 *
 * Disabled until `tripPlaceId` is known so the place detail sheet can render
 * its skeleton before the place row has hydrated.
 */
export function useTripPlaceComments(tripPlaceId: Uuid | undefined) {
  return useQuery<TripPlaceComment[]>({
    queryKey: tripPlaceId
      ? tripPlaceCommentsKeys.forTripPlace(tripPlaceId)
      : ['trip-place-comments', 'none'],
    enabled: Boolean(tripPlaceId),
    queryFn: async () => {
      if (!tripPlaceId) return [];
      const { data, error } = await supabase
        .from('trip_place_comments')
        .select(COMMENT_SELECT_FIELDS)
        .eq('trip_place_id', tripPlaceId)
        .eq('deleted', false)
        .order('created_at', { ascending: true });
      if (error) throw error;
      // Best-effort runtime validation, matching the trip-expenses policy:
      // lists are cast rather than hard-parsed so an unexpected extra column
      // degrades to "stale UI" instead of crashing the thread.
      return (data ?? []) as TripPlaceComment[];
    },
  });
}

/**
 * Fetch every (non-deleted) comment across a whole trip in ONE query — the
 * batch read that powers per-place comment-count badges on the itinerary
 * without an N-per-place query fan-out. Filters directly on the
 * denormalized `trip_id` column (indexed; no join needed).
 *
 * Pair with `countCommentsByPlace(data)` for the badge map.
 */
export function useTripComments(tripId: Uuid | undefined) {
  return useQuery<TripPlaceComment[]>({
    queryKey: tripId
      ? tripPlaceCommentsKeys.forTrip(tripId)
      : ['trip-place-comments', 'for-trip', 'none'],
    enabled: Boolean(tripId),
    queryFn: async () => {
      if (!tripId) return [];
      const { data, error } = await supabase
        .from('trip_place_comments')
        .select(COMMENT_SELECT_FIELDS)
        .eq('trip_id', tripId)
        .eq('deleted', false)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TripPlaceComment[];
    },
  });
}

// ===========================================================================
// Hooks: mutations
// ===========================================================================

/** Shared rollback context for both mutations below. */
interface CommentsMutationContext {
  previousForPlace: TripPlaceComment[] | undefined;
  previousForTrip: TripPlaceComment[] | undefined;
}

/**
 * Post a comment on a place.
 *
 * Optimistic update + rollback:
 *   - `onMutate` snapshots both the per-place thread cache and the per-trip
 *     batch cache, then appends a synthesized row to each (placeholder id —
 *     replaced when `onSuccess` invalidation round-trips the real row).
 *   - On error both caches restore from the snapshot.
 *
 * `author_id` is resolved from `supabase.auth.getUser()`; RLS additionally
 * pins it server-side (`with check (author_id = auth.uid())`), so a stale
 * or spoofed id can never produce a row attributed to someone else.
 */
export function useCreateTripPlaceComment() {
  const qc = useQueryClient();
  return useMutation<
    TripPlaceComment,
    Error,
    CreateTripPlaceCommentInput,
    CommentsMutationContext
  >({
    mutationFn: async (input) => {
      const { tripId, tripPlaceId, body } = createTripPlaceCommentSchema.parse(input);

      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) {
        throw new Error('not_authenticated');
      }

      const { data, error } = await supabase
        .from('trip_place_comments')
        .insert({
          trip_id: tripId,
          trip_place_id: tripPlaceId,
          author_id: userData.user.id,
          body,
        })
        .select(COMMENT_SELECT_FIELDS)
        .single();
      if (error) throw error;
      // Single-row writes are hard-parsed (vs the cast-only list reads):
      // catching a drifted shape at the write site is cheap and immediate.
      return tripPlaceCommentRowSchema.parse(data) as TripPlaceComment;
    },
    onMutate: async ({ tripId, tripPlaceId, body }) => {
      // Cancel in-flight refetches so they don't clobber the optimistic
      // append we're about to write.
      await qc.cancelQueries({
        queryKey: tripPlaceCommentsKeys.forTripPlace(tripPlaceId),
      });
      await qc.cancelQueries({
        queryKey: tripPlaceCommentsKeys.forTrip(tripId),
      });

      const previousForPlace = qc.getQueryData<TripPlaceComment[]>(
        tripPlaceCommentsKeys.forTripPlace(tripPlaceId),
      );
      const previousForTrip = qc.getQueryData<TripPlaceComment[]>(
        tripPlaceCommentsKeys.forTrip(tripId),
      );

      // Resolve the author id for the synthesized row; on the client this
      // reads session storage, not the network. If unavailable, skip the
      // optimistic append and let mutationFn surface the auth error.
      const { data: userData } = await supabase.auth.getUser();
      const authorId = userData?.user?.id;
      if (!authorId) {
        return { previousForPlace, previousForTrip };
      }

      // Placeholder id: unique per in-flight mutation so two rapid-fire
      // comments never collide on a React list key. Replaced by the real
      // server row via the onSuccess invalidation.
      const synthesized: TripPlaceComment = {
        id: `optimistic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        trip_id: tripId,
        trip_place_id: tripPlaceId,
        author_id: authorId,
        body,
        created_at: new Date().toISOString(),
        updated_at: null,
        deleted: false,
      };

      // Append to both caches when they exist. Threads render ascending by
      // created_at, so push-to-end matches the server order.
      if (previousForPlace) {
        qc.setQueryData<TripPlaceComment[]>(
          tripPlaceCommentsKeys.forTripPlace(tripPlaceId),
          [...previousForPlace, synthesized],
        );
      }
      if (previousForTrip) {
        qc.setQueryData<TripPlaceComment[]>(
          tripPlaceCommentsKeys.forTrip(tripId),
          [...previousForTrip, synthesized],
        );
      }

      return { previousForPlace, previousForTrip };
    },
    onError: (_err, { tripPlaceId, tripId }, context) => {
      if (context?.previousForPlace !== undefined) {
        qc.setQueryData(
          tripPlaceCommentsKeys.forTripPlace(tripPlaceId),
          context.previousForPlace,
        );
      }
      if (context?.previousForTrip !== undefined) {
        qc.setQueryData(
          tripPlaceCommentsKeys.forTrip(tripId),
          context.previousForTrip,
        );
      }
    },
    onSuccess: (_row, { tripPlaceId, tripId }) => {
      // Invalidate so the placeholder id is replaced by the server row and
      // any concurrent collaborator comments land too.
      qc.invalidateQueries({
        queryKey: tripPlaceCommentsKeys.forTripPlace(tripPlaceId),
      });
      qc.invalidateQueries({ queryKey: tripPlaceCommentsKeys.forTrip(tripId) });
    },
  });
}

/**
 * Soft-delete a comment (`deleted = true`) — the NORMAL delete path. The
 * tombstone row stays behind so offline LWW sync replicas converge on the
 * deletion; reads exclude it, so the optimistic update is a plain removal
 * from both caches.
 *
 * RLS allows this only for the comment's author. The trip owner cannot
 * delete someone else's comment (personal voice, same stance as reactions).
 */
export function useDeleteTripPlaceComment() {
  const qc = useQueryClient();
  return useMutation<
    { commentId: Uuid },
    Error,
    DeleteTripPlaceCommentInput,
    CommentsMutationContext
  >({
    mutationFn: async ({ commentId }) => {
      // UPDATE, not DELETE: tombstone semantics (see module header). RLS
      // (`author_id = auth.uid()`) makes the by-id update a no-op 0-row
      // UPDATE for anyone but the author; `select().single()` then errors,
      // which is the correct "you can't delete this" surface.
      const { error } = await supabase
        .from('trip_place_comments')
        .update({ deleted: true })
        .eq('id', commentId)
        .select('id')
        .single();
      if (error) throw error;
      return { commentId };
    },
    onMutate: async ({ commentId, tripPlaceId, tripId }) => {
      await qc.cancelQueries({
        queryKey: tripPlaceCommentsKeys.forTripPlace(tripPlaceId),
      });
      await qc.cancelQueries({
        queryKey: tripPlaceCommentsKeys.forTrip(tripId),
      });

      const previousForPlace = qc.getQueryData<TripPlaceComment[]>(
        tripPlaceCommentsKeys.forTripPlace(tripPlaceId),
      );
      const previousForTrip = qc.getQueryData<TripPlaceComment[]>(
        tripPlaceCommentsKeys.forTrip(tripId),
      );

      // Reads exclude tombstones, so "remove from the list" IS the
      // predicted post-mutation state of both caches.
      if (previousForPlace) {
        qc.setQueryData<TripPlaceComment[]>(
          tripPlaceCommentsKeys.forTripPlace(tripPlaceId),
          previousForPlace.filter((c) => c.id !== commentId),
        );
      }
      if (previousForTrip) {
        qc.setQueryData<TripPlaceComment[]>(
          tripPlaceCommentsKeys.forTrip(tripId),
          previousForTrip.filter((c) => c.id !== commentId),
        );
      }

      return { previousForPlace, previousForTrip };
    },
    onError: (_err, { tripPlaceId, tripId }, context) => {
      if (context?.previousForPlace !== undefined) {
        qc.setQueryData(
          tripPlaceCommentsKeys.forTripPlace(tripPlaceId),
          context.previousForPlace,
        );
      }
      if (context?.previousForTrip !== undefined) {
        qc.setQueryData(
          tripPlaceCommentsKeys.forTrip(tripId),
          context.previousForTrip,
        );
      }
    },
    onSuccess: (_result, { tripPlaceId, tripId }) => {
      qc.invalidateQueries({
        queryKey: tripPlaceCommentsKeys.forTripPlace(tripPlaceId),
      });
      qc.invalidateQueries({ queryKey: tripPlaceCommentsKeys.forTrip(tripId) });
    },
  });
}
