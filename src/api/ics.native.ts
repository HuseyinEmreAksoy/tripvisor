// Tripvisor Phase 4 — .ics download hook (native).
//
// Generates the calendar string via the pure `tripToIcs` and then writes it
// to the app cache dir and opens the system share sheet. Requires the trip
// + its places + legs to already be in the React Query cache.

import { useMutation } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase } from './supabase';
import type { Trip, TripLeg, TripPlace, Uuid } from './types';
import { icsFilenameForTitle, tripToIcs } from '@/lib/ics/generate';

export interface DownloadIcsResult {
  filename: string;
  uri: string;
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
      const uri = `${FileSystem.cacheDirectory ?? ''}${filename}`;
      await FileSystem.writeAsStringAsync(uri, ics, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      let shared = false;
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'text/calendar',
          UTI: 'public.calendar-event',
          dialogTitle: 'Export trip to calendar',
        });
        shared = true;
      }

      return {
        filename,
        uri,
        bytes: new TextEncoder().encode(ics).length,
        shared,
      };
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
