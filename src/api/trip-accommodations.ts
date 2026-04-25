import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from './supabase';
import type { TripAccommodation, Uuid } from './types';
import { tripsKeys, tripAccommodationsKeys } from './_keys';

// ----- Query keys (re-exported from ./_keys; see comment in trip-days.ts) ---
export { tripAccommodationsKeys };

// Re-export the shared type so consumers can import everything from a single
// module (`import { TripAccommodation, useTripAccommodations } from '@/api'`).
export type { TripAccommodation };

// ===========================================================================
// Zod schemas
// ===========================================================================
//
// `tripAccommodationRowSchema` mirrors the `public.trip_accommodations` columns
// and the CHECK constraints in `0012_trip_accommodations.sql`. The two cross-
// column invariants are enforced both server-side (CHECK) and client-side
// (Zod refinement) so the UI can surface a friendly error before the round
// trip. If you change a constraint in the migration, update this schema in
// lockstep.
//
// We use `z.coerce.date` only at the parsing layer where the wire shape is
// strings (Supabase returns ISO `YYYY-MM-DD` for `date` columns and
// timestamps for `timestamptz`). Internally we keep the values as strings
// to match the rest of the API surface (Trip.start_date, etc.).
const tripAccommodationRowSchema = z
  .object({
    id: z.string().uuid(),
    trip_id: z.string().uuid(),
    name: z.string().min(1).max(200),
    google_place_id: z.string().nullable(),
    address: z.string().nullable(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    check_in_date: z.string(),
    check_out_date: z.string(),
    notes: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .superRefine((row, ctx) => {
    // Invariant 1: check_out > check_in (strictly greater; matches the DB
    // CHECK). Comparing ISO `YYYY-MM-DD` strings lexicographically is safe
    // because the format is zero-padded and fixed-width.
    if (row.check_out_date <= row.check_in_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['check_out_date'],
        message: 'check_out_date must be after check_in_date',
      });
    }
    // Invariant 2: google_place_id implies both lat AND lng are present.
    if (row.google_place_id !== null && (row.lat === null || row.lng === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lat'],
        message: 'lat and lng are required when google_place_id is set',
      });
    }
  });

export const tripAccommodationSchema = tripAccommodationRowSchema;

// Insert payload: server fills id / created_at / updated_at. Same refinement
// rules apply because the DB will reject violations either way — surfacing
// them client-side first is faster and produces a nicer error.
const createTripAccommodationSchema = z
  .object({
    trip_id: z.string().uuid(),
    name: z.string().min(1).max(200),
    google_place_id: z.string().nullish(),
    address: z.string().nullish(),
    lat: z.number().nullish(),
    lng: z.number().nullish(),
    check_in_date: z.string(),
    check_out_date: z.string(),
    notes: z.string().nullish(),
  })
  .superRefine((input, ctx) => {
    if (input.check_out_date <= input.check_in_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['check_out_date'],
        message: 'check_out_date must be after check_in_date',
      });
    }
    if (
      input.google_place_id != null
      && (input.lat == null || input.lng == null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lat'],
        message: 'lat and lng are required when google_place_id is set',
      });
    }
  });

export type CreateTripAccommodationInput = z.infer<
  typeof createTripAccommodationSchema
>;

// Update payload: id is required (we route the UPDATE by id under RLS); every
// other field is optional. We don't allow `trip_id` to change — moving an
// accommodation between trips is a delete + create.
//
// Note on cross-field invariants: a partial update can leave the row in a
// state we can't validate without re-reading the existing row (e.g. caller
// patches only `check_out_date`). We rely on the DB CHECK to catch those at
// commit time and surface the error. Client-side, we only re-validate when
// BOTH dates are in the patch, or BOTH branches of the place/coords pair
// are in the patch — the partial cases fall through to the server.
const updateTripAccommodationSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(200).optional(),
    google_place_id: z.string().nullish(),
    address: z.string().nullish(),
    lat: z.number().nullish(),
    lng: z.number().nullish(),
    check_in_date: z.string().optional(),
    check_out_date: z.string().optional(),
    notes: z.string().nullish(),
  })
  .superRefine((patch, ctx) => {
    if (
      patch.check_in_date !== undefined
      && patch.check_out_date !== undefined
      && patch.check_out_date <= patch.check_in_date
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['check_out_date'],
        message: 'check_out_date must be after check_in_date',
      });
    }
    if (
      patch.google_place_id !== undefined
      && patch.google_place_id !== null
      && patch.lat !== undefined
      && patch.lng !== undefined
      && (patch.lat === null || patch.lng === null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lat'],
        message: 'lat and lng are required when google_place_id is set',
      });
    }
  });

export type UpdateTripAccommodationInput = z.infer<
  typeof updateTripAccommodationSchema
>;

// ===========================================================================
// Hooks
// ===========================================================================

/**
 * List `trip_accommodations` for a trip, sorted by `check_in_date` ascending
 * so the UI shows stays in chronological order — matches the composite
 * index `(trip_id, check_in_date)` we created in 0012. Returns an empty
 * array when the trip has no accommodations recorded.
 *
 * RLS gates this read by the parent trip's `user_id`; an unauthorized
 * caller will receive an empty result rather than a 403, which is fine
 * for the trip-detail surface (the trip itself wouldn't have loaded
 * either).
 */
export function useTripAccommodations(tripId: Uuid | undefined) {
  return useQuery<TripAccommodation[]>({
    queryKey: tripId
      ? tripAccommodationsKeys.forTrip(tripId)
      : ['trip-accommodations', 'none'],
    enabled: Boolean(tripId),
    queryFn: async () => {
      if (!tripId) return [];
      const { data, error } = await supabase
        .from('trip_accommodations')
        .select('*')
        .eq('trip_id', tripId)
        .order('check_in_date', { ascending: true });
      if (error) throw error;
      // Best-effort runtime validation. Match the trip-expenses pattern:
      // a stale UI seeing a row from a future schema is preferable to
      // crashing the whole list, so we cast rather than `parse` per row.
      return (data ?? []) as TripAccommodation[];
    },
  });
}

/**
 * Insert a `trip_accommodations` row for a trip. Mutation invalidates the
 * per-trip accommodations cache AND the trip detail cache, mirroring the
 * trip-expenses convention — the trip-detail surface may want to render a
 * stay summary alongside other trip metadata.
 */
export function useCreateTripAccommodation() {
  const qc = useQueryClient();
  return useMutation<TripAccommodation, Error, CreateTripAccommodationInput>({
    mutationFn: async (input) => {
      const parsed = createTripAccommodationSchema.parse(input);
      const { data, error } = await supabase
        .from('trip_accommodations')
        .insert(parsed)
        .select('*')
        .single();
      if (error) throw error;
      return tripAccommodationRowSchema.parse(data) as TripAccommodation;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({
        queryKey: tripAccommodationsKeys.forTrip(row.trip_id),
      });
      qc.invalidateQueries({ queryKey: tripsKeys.detail(row.trip_id) });
    },
  });
}

/**
 * Patch a `trip_accommodations` row by id. We strip `undefined` values from
 * the payload so the UPDATE only touches columns the caller named — this
 * matches the `useUpdateTripExpense` convention and keeps `updated_at`
 * trigger fires meaningful.
 */
export function useUpdateTripAccommodation() {
  const qc = useQueryClient();
  return useMutation<TripAccommodation, Error, UpdateTripAccommodationInput>({
    mutationFn: async (input) => {
      const parsed = updateTripAccommodationSchema.parse(input);
      const { id, ...patch } = parsed;
      const payload = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      );
      const { data, error } = await supabase
        .from('trip_accommodations')
        .update(payload)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return tripAccommodationRowSchema.parse(data) as TripAccommodation;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({
        queryKey: tripAccommodationsKeys.forTrip(row.trip_id),
      });
      qc.invalidateQueries({ queryKey: tripsKeys.detail(row.trip_id) });
    },
  });
}

/**
 * Delete a `trip_accommodations` row by id. The mutation requires the parent
 * `trip_id` so we can invalidate the right cache scope on success — matches
 * `useDeleteTripExpense`.
 */
export function useDeleteTripAccommodation() {
  const qc = useQueryClient();
  return useMutation<Uuid, Error, { id: Uuid; trip_id: Uuid }>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase
        .from('trip_accommodations')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: (_id, { trip_id }) => {
      qc.invalidateQueries({
        queryKey: tripAccommodationsKeys.forTrip(trip_id),
      });
      qc.invalidateQueries({ queryKey: tripsKeys.detail(trip_id) });
    },
  });
}
