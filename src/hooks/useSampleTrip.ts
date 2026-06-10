/**
 * useSampleTrip — one-tap onboarding sample trip (v2 Phase N1 step 1.5).
 *
 * Creates a REAL 2-day Lisbon trip via the existing mutations so the new
 * user sees the core loop working (itinerary + timeline + map pins) before
 * any Google API key burns:
 *   1. useCreateTrip            → "Lisbon Getaway (Sample)"
 *   2. useCreateTripPlace ×5    → famous Lisbon spots, real coordinates
 *   3. useMoveToDay ×5          → prefilled day_index/order_in_day so the
 *                                 itinerary + timeline render instantly
 *
 * ToS note: google_place_id values are PLACEHOLDER strings ('sample-…').
 * These are user-authored rows — no Google content is persisted, so the
 * 30-day ceiling doesn't apply. Consequences (acceptable for a sample):
 * place-details lookups for thumbnails/details fail quietly, and the
 * auto-optimizer works purely off the stored lat/lng.
 *
 * Not a useMutation wrapper because it composes three existing mutation
 * hooks sequentially; exposes the same {isCreating, error} surface.
 */
import { useCallback, useState } from 'react';
import { useCreateTrip, useCreateTripPlace, useMoveToDay } from '@/api';

interface SamplePlace {
  google_place_id: string;
  user_title: string;
  category: string;
  lat: number;
  lng: number;
  visit_duration_minutes: number;
  day_index: number;
  order_in_day: number;
}

// Real coordinates; placeholder ids (see ToS note above).
const SAMPLE_PLACES: SamplePlace[] = [
  // Day 1 — Alfama + downtown on foot
  { google_place_id: 'sample-castelo-sao-jorge', user_title: 'Castelo de São Jorge', category: 'Castle', lat: 38.7139, lng: -9.1335, visit_duration_minutes: 90, day_index: 0, order_in_day: 0 },
  { google_place_id: 'sample-se-de-lisboa', user_title: 'Lisbon Cathedral (Sé)', category: 'Landmark', lat: 38.7098, lng: -9.1326, visit_duration_minutes: 45, day_index: 0, order_in_day: 1 },
  { google_place_id: 'sample-time-out-market', user_title: 'Time Out Market', category: 'Food hall', lat: 38.7070, lng: -9.1459, visit_duration_minutes: 75, day_index: 0, order_in_day: 2 },
  // Day 2 — Belém riverside
  { google_place_id: 'sample-torre-de-belem', user_title: 'Belém Tower', category: 'Landmark', lat: 38.6916, lng: -9.2160, visit_duration_minutes: 60, day_index: 1, order_in_day: 0 },
  { google_place_id: 'sample-mosteiro-jeronimos', user_title: 'Jerónimos Monastery', category: 'Monastery', lat: 38.6979, lng: -9.2068, visit_duration_minutes: 75, day_index: 1, order_in_day: 1 },
];

/** YYYY-MM-DD for (today + offsetDays), in local time. */
function isoDatePlusDays(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function useSampleTrip() {
  const createTrip = useCreateTrip();
  const createPlace = useCreateTripPlace();
  const moveToDay = useMoveToDay();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const createTripAsync = createTrip.mutateAsync;
  const createPlaceAsync = createPlace.mutateAsync;
  const moveToDayAsync = moveToDay.mutateAsync;

  /** Creates the sample trip and resolves with the new trip id. */
  const create = useCallback(async (): Promise<string> => {
    setIsCreating(true);
    setError(null);
    try {
      const trip = await createTripAsync({
        title: 'Lisbon Getaway (Sample)',
        // Two weeks out, two days long — the countdown card on Home gets
        // something to count down to.
        start_date: isoDatePlusDays(14),
        end_date: isoDatePlusDays(15),
        daily_hours_budget: 8,
        transport_mode: 'walking',
      });

      // Sequential on purpose: tiny payloads, and order keeps the optimistic
      // cache + RLS checks simple. createTripPlace's schema strips scheduling
      // fields, so day assignment happens via moveToDay with an explicit
      // position (no extra lookup round-trip).
      for (const sample of SAMPLE_PLACES) {
        const { day_index, order_in_day, ...placeInput } = sample;
        const row = await createPlaceAsync({ trip_id: trip.id, ...placeInput });
        await moveToDayAsync({
          id: row.id,
          tripId: trip.id,
          toDayIndex: day_index,
          positionInDay: order_in_day,
        });
      }

      return trip.id;
    } catch (e) {
      const err = e instanceof Error ? e : new Error('Could not create the sample trip');
      setError(err);
      throw err;
    } finally {
      setIsCreating(false);
    }
  }, [createTripAsync, createPlaceAsync, moveToDayAsync]);

  return { create, isCreating, error };
}
