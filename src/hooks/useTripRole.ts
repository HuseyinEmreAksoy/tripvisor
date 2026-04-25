/**
 * useTripRole — derive the current user's effective role on a trip.
 *
 * Returns:
 *   - 'owner'  : current user is the trip.user_id
 *   - 'editor' : current user has an accepted collaborator row with role='editor'
 *   - 'viewer' : current user has an accepted collaborator row with role='viewer'
 *   - null     : loading or not determined yet
 *
 * The hook checks ownership first (cheap, no extra query). Only if the user
 * is NOT the owner does it read the collaborator list (which is already in
 * the TanStack Query cache from useTripCollaborators if the Collaborators
 * screen has been visited, so no extra network round-trip in the common case).
 *
 * canEditTrip: convenience boolean — true when role is 'owner' or 'editor'.
 */
import { useMemo } from 'react';
import { useSession } from '@/api/auth';
import { useTrip } from '@/api/trips';
import { useTripCollaborators } from '@/api/trip-collaborators';
import type { TripCollaboratorRole } from '@/api/types';

export type TripRole = 'owner' | TripCollaboratorRole;

export interface UseTripRoleResult {
  role: TripRole | null;
  canEditTrip: boolean;
  isLoading: boolean;
}

export function useTripRole(tripId: string | undefined): UseTripRoleResult {
  const { data: session, isLoading: sessionLoading } = useSession();
  const { data: trip, isLoading: tripLoading } = useTrip(tripId);

  // We know we're the owner if trip.user_id matches our session uid.
  const isOwner = Boolean(
    trip && session?.user && trip.user_id === session.user.id,
  );

  // Only fetch the collaborator list when we know we're NOT the owner
  // (and tripId + userId are resolved). This avoids a redundant query for owners.
  const skipCollabQuery = sessionLoading || tripLoading || isOwner || !tripId || !session?.user;

  const { data: collaborators = [], isLoading: collabLoading } = useTripCollaborators(
    skipCollabQuery ? undefined : tripId,
  );

  const role = useMemo<TripRole | null>(() => {
    if (sessionLoading || tripLoading) return null;
    if (!session?.user || !trip) return null;
    if (isOwner) return 'owner';
    if (!skipCollabQuery && !collabLoading) {
      const myRow = collaborators.find(
        (c) => c.user_id === session.user.id && c.status === 'accepted',
      );
      if (myRow) return myRow.role;
    }
    return null;
  }, [
    sessionLoading,
    tripLoading,
    collabLoading,
    session,
    trip,
    isOwner,
    collaborators,
    skipCollabQuery,
  ]);

  const isLoading = sessionLoading || tripLoading || (!skipCollabQuery && collabLoading);

  return {
    role,
    canEditTrip: role === 'owner' || role === 'editor',
    isLoading,
  };
}
