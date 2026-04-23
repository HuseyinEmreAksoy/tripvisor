import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from './supabase';
import type { CreateTripPlaceInput, TripPlace, Uuid } from './types';
import { tripsKeys } from './trips';
import { tripLegsKeys } from './routes';

export const tripPlacesKeys = {
  all: ['trip-places'] as const,
  forTrip: (tripId: Uuid) => [...tripPlacesKeys.all, tripId] as const,
};

const createTripPlaceSchema = z.object({
  trip_id: z.string().uuid(),
  google_place_id: z.string().min(1),
  user_title: z.string().max(200).nullish(),
  category: z.string().max(80).nullish(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  visit_duration_minutes: z.number().int().positive().max(24 * 60).default(60),
  notes: z.string().max(2000).nullish(),
});

export function useTripPlaces(tripId: Uuid | undefined) {
  return useQuery<TripPlace[]>({
    queryKey: tripId ? tripPlacesKeys.forTrip(tripId) : ['trip-places', 'none'],
    enabled: Boolean(tripId),
    queryFn: async () => {
      if (!tripId) return [];
      const { data, error } = await supabase
        .from('trip_places')
        .select('*')
        .eq('trip_id', tripId)
        .order('day_index', { ascending: true, nullsFirst: true })
        .order('order_in_day', { ascending: true, nullsFirst: true });
      if (error) throw error;
      return data as TripPlace[];
    },
  });
}

export function useCreateTripPlace() {
  const qc = useQueryClient();
  return useMutation<TripPlace, Error, CreateTripPlaceInput>({
    mutationFn: async (input) => {
      const parsed = createTripPlaceSchema.parse(input);
      const { data, error } = await supabase
        .from('trip_places')
        .insert(parsed)
        .select('*')
        .single();
      if (error) throw error;
      return data as TripPlace;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: tripPlacesKeys.forTrip(row.trip_id) });
      qc.invalidateQueries({ queryKey: tripsKeys.detail(row.trip_id) });
    },
  });
}

export function useDeleteTripPlace() {
  const qc = useQueryClient();
  return useMutation<TripPlace, Error, { id: Uuid; trip_id: Uuid }>({
    mutationFn: async ({ id }) => {
      const { data, error } = await supabase
        .from('trip_places')
        .delete()
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data as TripPlace;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: tripPlacesKeys.forTrip(row.trip_id) });
    },
  });
}

const updateTripPlaceSchema = z.object({
  id: z.string().uuid(),
  trip_id: z.string().uuid(),
  user_title: z.string().max(200).nullish(),
  category: z.string().max(80).nullish(),
  visit_duration_minutes: z.number().int().positive().max(24 * 60).optional(),
  notes: z.string().max(2000).nullish(),
});

type UpdateTripPlaceInput = z.infer<typeof updateTripPlaceSchema>;

export function useUpdateTripPlace() {
  const qc = useQueryClient();
  return useMutation<TripPlace, Error, UpdateTripPlaceInput>({
    mutationFn: async (input) => {
      const parsed = updateTripPlaceSchema.parse(input);
      const { id, trip_id: _tripId, ...patch } = parsed;
      const payload = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      );
      const { data, error } = await supabase
        .from('trip_places')
        .update(payload)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data as TripPlace;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: tripPlacesKeys.forTrip(row.trip_id) });
      qc.invalidateQueries({ queryKey: tripsKeys.detail(row.trip_id) });
    },
  });
}

export function useReorderDay() {
  const qc = useQueryClient();
  return useMutation<
    { rowsUpdated: number },
    Error,
    { tripId: Uuid; dayIndex: number; orderedIds: Uuid[] }
  >({
    mutationFn: async ({ tripId, dayIndex, orderedIds }) => {
      const { data, error } = await supabase.rpc('apply_manual_day_order', {
        p_trip_id: tripId,
        p_day_index: dayIndex,
        p_ordered_ids: orderedIds,
      });
      if (error) throw error;
      return { rowsUpdated: (data as number | null) ?? 0 };
    },
    onSuccess: (_res, { tripId }) => {
      qc.invalidateQueries({ queryKey: tripPlacesKeys.forTrip(tripId) });
      qc.invalidateQueries({ queryKey: tripLegsKeys.forTrip(tripId) });
    },
  });
}

export function useMoveToDay() {
  const qc = useQueryClient();
  return useMutation<
    TripPlace,
    Error,
    { id: Uuid; tripId: Uuid; toDayIndex: number; positionInDay?: number }
  >({
    mutationFn: async ({ id, tripId, toDayIndex, positionInDay }) => {
      let nextPos = positionInDay;
      if (nextPos === undefined) {
        const { data: existing } = await supabase
          .from('trip_places')
          .select('order_in_day')
          .eq('trip_id', tripId)
          .eq('day_index', toDayIndex);
        const max = (existing ?? []).reduce<number>(
          (m, r) => Math.max(m, (r as { order_in_day: number | null }).order_in_day ?? -1),
          -1,
        );
        nextPos = max + 1;
      }
      const { data, error } = await supabase
        .from('trip_places')
        .update({ day_index: toDayIndex, order_in_day: nextPos })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data as TripPlace;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: tripPlacesKeys.forTrip(row.trip_id) });
      qc.invalidateQueries({ queryKey: tripLegsKeys.forTrip(row.trip_id) });
    },
  });
}
