import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { tripsKeys } from './trips';
import { tripPlacesKeys } from './trip-places';
import type { TripLeg, Uuid } from './types';

export const tripLegsKeys = {
  all: ['trip-legs'] as const,
  forTrip: (tripId: Uuid) => [...tripLegsKeys.all, tripId] as const,
};

export interface OptimizeResult {
  stateHash: string;
  days: Array<{ dayIndex: number; orderedPlaceIds: string[]; totalMinutes: number }>;
  placesUpdated: number;
  legsWritten: number;
  cacheHit: boolean;
  polylineDays: number;
}

export function useTripLegs(tripId: Uuid | undefined) {
  return useQuery<TripLeg[]>({
    queryKey: tripId ? tripLegsKeys.forTrip(tripId) : ['trip-legs', 'none'],
    enabled: Boolean(tripId),
    queryFn: async () => {
      if (!tripId) return [];
      const { data, error } = await supabase
        .from('trip_legs')
        .select('*')
        .eq('trip_id', tripId);
      if (error) throw error;
      return (data ?? []) as TripLeg[];
    },
  });
}

export function useOptimizeTrip() {
  const qc = useQueryClient();
  return useMutation<OptimizeResult, Error, { tripId: Uuid }>({
    mutationFn: async ({ tripId }) => {
      const { data, error } = await supabase.functions.invoke<OptimizeResult>(
        'optimize-trip',
        { body: { tripId } },
      );
      if (error) throw error;
      if (!data) throw new Error('optimize-trip returned no data');
      return data;
    },
    onSuccess: (_res, { tripId }) => {
      qc.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
      qc.invalidateQueries({ queryKey: tripPlacesKeys.forTrip(tripId) });
      qc.invalidateQueries({ queryKey: tripLegsKeys.forTrip(tripId) });
    },
  });
}
