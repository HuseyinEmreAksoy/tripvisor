// Tripvisor v2 Phase P2 (BUILD-LOG P2.1) — weather client wrapper.
//
// Talks to the `weather` Edge Function (Open-Meteo proxy, keyless upstream).
// Works identically on iOS / Android / Web: `supabase.functions.invoke`
// rides the shared Supabase client with no per-platform branching.
//
// Caching model
// -------------
// Forecast models refresh ~hourly, so: `staleTime: 1h` (matches the Edge
// Function's `Cache-Control: private, max-age=3600`), `gcTime: 6h`. The
// query key — and the request body itself — round coordinates to 2 decimals
// (~1.1km): weather does not vary inside that radius, and the rounding
// collapses "same city, slightly different anchor place" into ONE cache
// entry and ONE upstream call.
//
// ATTRIBUTION (CC-BY 4.0): any UI rendering this data MUST show
// "Weather data by Open-Meteo.com" — see supabase/functions/weather/README.md.

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from './supabase';
import { EdgeFunctionError, tryParseEdgeFunctionError } from './_errors';

// ===========================================================================
// Types
// ===========================================================================

/** One forecast day as returned by the `weather` Edge Function. */
export interface DayWeather {
  /** YYYY-MM-DD (local to the queried location — Open-Meteo timezone=auto). */
  date: string;
  /** WMO interpretation code (0 clear … 99 thunderstorm w/ heavy hail). */
  weatherCode: number;
  tMaxC: number;
  tMinC: number;
  /** Max daily precipitation probability in %, or null when the model has no value. */
  precipProbMax: number | null;
}

export interface DayWeatherParams {
  lat: number;
  lng: number;
  /** Trip (or first visible day) start date, YYYY-MM-DD. */
  startDate: string;
  /** Number of forecast days, 1..16 (Open-Meteo horizon). */
  days: number;
}

/**
 * Typed error for the `weather` Edge Function envelope. Known codes (see
 * supabase/functions/weather/index.ts):
 *   - `invalid_input`     — 400 — bad coords / date / days
 *   - `not_authenticated` — 401 — missing/expired session
 *   - `upstream_error`    — 502 — Open-Meteo failure (message may carry the
 *                                  reason, e.g. date beyond the 16-day horizon)
 *   - `upstream_timeout`  — 504 — Open-Meteo exceeded the 8s timeout
 */
export class WeatherError extends EdgeFunctionError {
  constructor(code: string, message: string, status: number) {
    super(code, message, status);
    this.name = 'WeatherError';
  }
}

// ===========================================================================
// Query keys (local, like `placesKeys` — nothing cross-invalidates weather)
// ===========================================================================

export const weatherKeys = {
  all: ['weather'] as const,
  forecast: (lat: number, lng: number, startDate: string, days: number) =>
    [...weatherKeys.all, 'forecast', lat, lng, startDate, days] as const,
};

// ===========================================================================
// Response validation (defence in depth on the Edge Function contract)
// ===========================================================================

const dayWeatherSchema = z.object({
  date: z.string(),
  weatherCode: z.number(),
  tMaxC: z.number(),
  tMinC: z.number(),
  precipProbMax: z.number().nullable(),
});

const weatherResponseSchema = z.object({
  days: z.array(dayWeatherSchema),
});

// ===========================================================================
// Pure helpers
// ===========================================================================

/** Round to 2 decimals (~1.1km) — the cache-key / request granularity. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * WMO weather codes treated as "rainy" (precipitation likely enough to plan
 * around). Source: WMO 4677 interpretation table as published by Open-Meteo
 * (https://open-meteo.com/en/docs — "WMO Weather interpretation codes"):
 *
 *   51/53/55  drizzle (light/moderate/dense)
 *   56/57     freezing drizzle
 *   61/63/65  rain (slight/moderate/heavy)
 *   66/67     freezing rain
 *   71/73/75  snowfall (slight/moderate/heavy)
 *   77        snow grains
 *   80/81/82  rain showers (slight/moderate/violent)
 *   85/86     snow showers
 *   95        thunderstorm
 *   96/99     thunderstorm with hail
 *
 * Deliberately EXCLUDED: 0–3 (clear/cloudy), 45/48 (fog — unpleasant but not
 * wet enough to swap a day indoors).
 */
const RAINY_WMO_CODES: ReadonlySet<number> = new Set([
  51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99,
]);

/**
 * Pure predicate: should this day trigger rain-gear seeding / the indoor-swap
 * nudge? True when the precipitation probability is >= 60% OR the day's WMO
 * code is in the rain/snow/thunderstorm set above (the code catches days
 * where the probability field is null but the model still forecasts rain).
 */
export function isRainy(day: DayWeather): boolean {
  if (day.precipProbMax !== null && day.precipProbMax >= 60) return true;
  return RAINY_WMO_CODES.has(day.weatherCode);
}

// ===========================================================================
// Hook
// ===========================================================================

/**
 * Per-day forecast for a location + date range, via the `weather` Edge
 * Function.
 *
 * `params` may be undefined while the trip row hydrates; pass `enabled=false`
 * (or leave params undefined) to hold the query. Days beyond Open-Meteo's
 * 16-day horizon surface as a `WeatherError` with code `upstream_error` (or
 * `invalid_input` when days > 16) — callers should gate `enabled` on
 * "startDate within ~16 days of today" for trips far in the future.
 *
 * NOTE: returned days are keyed by `date` and may have gaps — always map
 * trip days -> forecast by date, never by array index.
 */
export function useDayWeather(params: DayWeatherParams | undefined, enabled = true) {
  const lat = params ? round2(params.lat) : 0;
  const lng = params ? round2(params.lng) : 0;

  return useQuery<DayWeather[], WeatherError | Error>({
    queryKey: params
      ? weatherKeys.forecast(lat, lng, params.startDate, params.days)
      : [...weatherKeys.all, 'none'],
    enabled: enabled && params !== undefined,
    staleTime: 60 * 60 * 1000, // 1h — matches the server Cache-Control
    gcTime: 6 * 60 * 60 * 1000, // 6h
    retry: (failureCount, error) => {
      // Bad input / auth failures are not transient; retrying only adds noise.
      if (
        error instanceof WeatherError &&
        (error.code === 'invalid_input' || error.code === 'not_authenticated')
      ) {
        return false;
      }
      return failureCount < 2;
    },
    queryFn: async () => {
      if (!params) return [];
      const { data, error } = await supabase.functions.invoke<{ days: DayWeather[] }>(
        'weather',
        {
          // Send the ROUNDED coords (not the raw ones) so the request varies
          // exactly as the cache key does — see the module header.
          body: { lat, lng, startDate: params.startDate, days: params.days },
        },
      );
      if (error) {
        const typed = await tryParseEdgeFunctionError(error, WeatherError);
        if (typed) throw typed;
        throw error;
      }
      // Hard-parse: the payload is tiny (<= 16 rows) and a drifted Edge
      // Function contract should fail loudly here, not render NaN chips.
      return weatherResponseSchema.parse(data ?? { days: [] }).days;
    },
  });
}
