// Tripvisor Phase 4 — .ics download hook (web).
//
// Generates the calendar string via the pure `tripToIcs` and triggers a
// Blob download via an anchor click.

import { useMutation } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { Trip, TripLeg, TripPlace, Uuid } from './types';
import { icsFilenameForTitle, tripToIcs } from '@/lib/ics/generate';

export interface DownloadIcsResult {
  filename: string;
  bytes: number;
  shared: boolean;
}

export function useDownloadTripIcs(tripId: Uuid | undefined) {
  return useMutation<DownloadIcsResult, Error, void>({
    mutationFn: async () => {
      if (!tripId) throw new Error('tripId is required');
      const { trip, places, legs } = await fetchTripBundle(tripId);
      const ics = tripToIcs(
        {
          id: trip.id,
          title: trip.title,
          start_date: trip.start_date,
          timezone: trip.timezone,
        },
        places.map((p) => ({
          id: p.id,
          user_title: p.user_title,
          lat: p.lat,
          lng: p.lng,
          visit_duration_minutes: p.visit_duration_minutes,
          day_index: p.day_index,
          order_in_day: p.order_in_day,
        })),
        legs,
      );
      const filename = icsFilenameForTitle(trip.title);
      const bytes = new TextEncoder().encode(ics).length;

      if (typeof window === 'undefined' || typeof document === 'undefined') {
        // SSR / service-worker context — throw so React Query surfaces the error
        // through its onError path and the trip detail screen's existing error
        // banner appears, rather than silently reporting success with no download.
        throw new Error('Browser not available for .ics download');
      }

      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        // Defer revoke one tick so Safari has time to start the download.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      return { filename, bytes, shared: true };
    },
  });
}

async function fetchTripBundle(tripId: Uuid): Promise<{
  trip: Trip;
  places: TripPlace[];
  legs: TripLeg[];
}> {
  const [tripRes, placesRes, legsRes] = await Promise.all([
    supabase.from('trips').select('*').eq('id', tripId).maybeSingle(),
    supabase
      .from('trip_places')
      .select('*')
      .eq('trip_id', tripId)
      .order('day_index', { ascending: true, nullsFirst: true })
      .order('order_in_day', { ascending: true, nullsFirst: true }),
    supabase.from('trip_legs').select('*').eq('trip_id', tripId),
  ]);
  if (tripRes.error) throw tripRes.error;
  if (!tripRes.data) throw new Error('Trip not found');
  if (placesRes.error) throw placesRes.error;
  if (legsRes.error) throw legsRes.error;
  return {
    trip: tripRes.data as Trip,
    places: (placesRes.data ?? []) as TripPlace[],
    legs: (legsRes.data ?? []) as TripLeg[],
  };
}
