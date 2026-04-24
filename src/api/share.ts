// Tripvisor Phase 4 — share link client wrappers.
//
// `useCreateShareLink` / `useRevokeShareLink` run under the caller's JWT.
// `useSharedTrip` is anonymous — it hits `share-trip:read` without requiring
// auth. All three funnel through the `share-trip` Edge Function; the
// `trip_shares` table is intentionally not reachable from the client.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type {
  CreateShareResult,
  RevokeShareResult,
  SharedTrip,
  Uuid,
} from './types';

export const shareKeys = {
  all: ['share'] as const,
  trip: (token: string | undefined) => [...shareKeys.all, 'trip', token ?? 'none'] as const,
};

export function useCreateShareLink(tripId: Uuid | undefined) {
  const qc = useQueryClient();
  return useMutation<CreateShareResult, Error, void>({
    mutationFn: async () => {
      if (!tripId) throw new Error('tripId required to create a share link');
      const { data, error } = await supabase.functions.invoke<CreateShareResult>(
        'share-trip',
        { body: { op: 'create', tripId } },
      );
      if (error) throw error;
      if (!data?.token) throw new Error('share-trip returned no token');
      return data;
    },
    onSuccess: () => {
      // Share tokens are write-once-reveal; no query to invalidate directly.
      // Revoke invalidations happen on revoke.
      qc.invalidateQueries({ queryKey: shareKeys.all });
    },
  });
}

export function useRevokeShareLink(tripId: Uuid | undefined) {
  const qc = useQueryClient();
  return useMutation<RevokeShareResult, Error, { token?: string } | void>({
    mutationFn: async (input) => {
      if (!tripId) throw new Error('tripId required to revoke a share link');
      const token = input && 'token' in input ? input.token : undefined;
      const { data, error } = await supabase.functions.invoke<RevokeShareResult>(
        'share-trip',
        { body: { op: 'revoke', tripId, ...(token ? { token } : {}) } },
      );
      if (error) throw error;
      return data ?? { revoked: 0 };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: shareKeys.all });
    },
  });
}

/**
 * Anonymous read of a shared trip by token. No auth required. The Edge
 * Function uses the service-role key to fetch the trip + its ToS-safe
 * fields. Returns null if the token is missing or revoked.
 */
export function useSharedTrip(token: string | undefined) {
  return useQuery<SharedTrip | null>({
    queryKey: shareKeys.trip(token),
    enabled: Boolean(token),
    staleTime: 1000 * 60, // 1 min — share content can change (edits on owner side)
    retry: (failureCount, err) => {
      // 404 means revoked or unknown — don't retry on that.
      const msg = (err as Error).message?.toLowerCase() ?? '';
      if (msg.includes('not_found') || msg.includes('404')) return false;
      return failureCount < 2;
    },
    queryFn: async () => {
      if (!token) return null;
      const { data, error } = await supabase.functions.invoke<SharedTrip>('share-trip', {
        body: { op: 'read', token },
      });
      if (error) {
        // Edge Function returns 404 for missing/revoked — surface as null so the
        // consuming screen can show a friendly "link no longer available" state.
        const status = (error as { context?: { status?: number } }).context?.status;
        if (status === 404) return null;
        throw error;
      }
      return data ?? null;
    },
  });
}
