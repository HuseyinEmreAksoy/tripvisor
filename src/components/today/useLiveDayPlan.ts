/**
 * useLiveDayPlan — derives today's plan for one running trip (v2 M4 X2.1).
 *
 * Reads only existing hooks (Tier-1-backed places/days when the sync flag
 * is on; cached TanStack reads otherwise) — no Google or routing calls.
 * Missing trip_legs (offline, not optimized yet) degrade exactly like the
 * itinerary: that hop counts as 0 min and the stop is flagged
 * `travelUnknown`.
 *
 * Weather: ONE Open-Meteo (keyless, via the `weather` Edge Function) query
 * for today at the centroid of today's stops (all places when today is
 * empty). Not a Google call.
 */
import { useMemo } from 'react';
import {
  orderPlacesForDisplay,
  useDayWeather,
  useTripAccommodations,
  useTripDays,
  useTripLegs,
  useTripPlaces,
  type Trip,
  type TripAccommodation,
  type TripPlace,
} from '@/api';
import type { DayWeather } from '@/api';
import { isTier1SyncActive } from '@/sync/mutations';
import {
  computeDayTimeline,
  parseStartTime,
  type TimelineStop,
} from '@/components/trip-detail/computeDayTimeline';
import { buildTripWeatherParams } from '@/components/trip-detail/tripWeather';
import { dayIndexFor, toLocalDateString } from '@/lib/tripToday';
import { staysForNight } from './todayPlan';

export interface LiveDayPlan {
  dayIndex: number | null;
  todayDate: string;
  /** Today's places in visit order. */
  places: TripPlace[];
  /** Timeline stop per place id. */
  timeline: Map<string, TimelineStop>;
  stays: TripAccommodation[];
  weather: DayWeather | undefined;
  isLoading: boolean;
  error: Error | null;
  refetchPlaces: () => void;
}

export function useLiveDayPlan(trip: Trip, now: Date): LiveDayPlan {
  const todayDate = toLocalDateString(now);
  const dayIndex = dayIndexFor(trip, now);

  const placesQuery = useTripPlaces(trip.id);
  const { data: legs = [] } = useTripLegs(trip.id);
  const { data: tripDays = [] } = useTripDays(trip.id);
  const { data: accommodations = [] } = useTripAccommodations(trip.id);

  const allPlaces = placesQuery.data;
  const tier1Active = isTier1SyncActive();

  const places = useMemo(() => {
    if (!allPlaces || dayIndex === null) return [];
    return orderPlacesForDisplay(
      allPlaces.filter((p) => !p.deleted),
      trip.route_render_mode,
      tier1Active,
    ).filter((p) => p.day_index === dayIndex);
  }, [allPlaces, dayIndex, trip.route_render_mode, tier1Active]);

  const startMinutes = useMemo(() => {
    const record = tripDays.find((d) => d.day_index === dayIndex);
    return parseStartTime(record?.start_time);
  }, [tripDays, dayIndex]);

  const timeline = useMemo(
    () => computeDayTimeline({ dayStartMinutes: startMinutes, places, legs }),
    [startMinutes, places, legs],
  );

  const stays = useMemo(() => staysForNight(accommodations, todayDate), [accommodations, todayDate]);

  const weatherParams = useMemo(() => {
    const anchor = places.length > 0 ? places : (allPlaces ?? []);
    return buildTripWeatherParams({ tripStartDate: todayDate, places: anchor, maxDayIndex: 0, now });
    // `now` only matters through todayDate; excluding it keeps the key stable within a day.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, allPlaces, todayDate]);
  const { data: weatherDays } = useDayWeather(weatherParams);
  const weather = weatherDays?.find((d) => d.date === todayDate);

  return {
    dayIndex,
    todayDate,
    places,
    timeline,
    stays,
    weather,
    isLoading: placesQuery.isLoading,
    error: allPlaces ? null : (placesQuery.error ?? null),
    refetchPlaces: () => {
      void placesQuery.refetch();
    },
  };
}
