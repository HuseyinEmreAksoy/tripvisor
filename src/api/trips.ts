import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from './supabase';
import type { CreateTripInput, Trip, Uuid } from './types';

export const tripsKeys = {
  all: ['trips'] as const,
  list: () => [...tripsKeys.all, 'list'] as const,
  detail: (id: Uuid) => [...tripsKeys.all, 'detail', id] as const,
};

const createTripSchema = z.object({
  title: z.string().min(1, 'Title is required').max(120),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  daily_hours_budget: z.number().positive().max(24).default(8),
  transport_mode: z.enum(['driving', 'walking', 'transit']).default('driving'),
  timezone: z.string().nullish(),
});

export function useTrips() {
  return useQuery<Trip[]>({
    queryKey: tripsKeys.list(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trips')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Trip[];
    },
  });
}

export function useTrip(id: Uuid | undefined) {
  return useQuery<Trip | null>({
    queryKey: id ? tripsKeys.detail(id) : ['trips', 'detail', 'none'],
    enabled: Boolean(id),
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('trips')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return (data as Trip | null) ?? null;
    },
  });
}

export function useCreateTrip() {
  const qc = useQueryClient();
  return useMutation<Trip, Error, CreateTripInput>({
    mutationFn: async (input) => {
      const parsed = createTripSchema.parse(input);
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) throw userErr ?? new Error('Not authenticated');
      const { data, error } = await supabase
        .from('trips')
        .insert({ ...parsed, user_id: userData.user.id })
        .select('*')
        .single();
      if (error) throw error;
      return data as Trip;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tripsKeys.list() });
    },
  });
}

export function useDeleteTrip() {
  const qc = useQueryClient();
  return useMutation<Uuid, Error, Uuid>({
    mutationFn: async (id) => {
      const { error } = await supabase.from('trips').delete().eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: tripsKeys.list() });
      qc.removeQueries({ queryKey: tripsKeys.detail(id) });
    },
  });
}
