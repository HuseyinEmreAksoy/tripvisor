/**
 * tripWeather — pure helpers behind the itinerary weather chips
 * (v2 Phase P2.1). NO hooks, NO network — trivially unit-testable, mirrors
 * the computeDayTimeline.ts "pure math module" pattern.
 *
 * Responsibilities:
 *   - WMO weather-code → emoji + spoken label (chip face + a11y copy),
 *   - local YYYY-MM-DD date math (parse / format / add — never UTC; trip
 *     dates are calendar dates, and `new Date('YYYY-MM-DD')` is UTC-parsed,
 *     which shifts the day west of Greenwich),
 *   - buildTripWeatherParams: turn (trip start date, places, last scheduled
 *     day) into ONE `useDayWeather` request — centroid of ALL trip places,
 *     date range clamped to Open-Meteo's ~16-day horizon. Returns undefined
 *     when nothing useful can be fetched, which holds the query entirely.
 *   - indexWeatherByDate: forecast days are keyed by DATE and may have gaps
 *     (see src/api/weather.ts) — trip days must map by date, never by index.
 *
 * ATTRIBUTION reminder (CC-BY 4.0): any UI rendering this data must show
 * "Weather data by Open-Meteo.com" — ItineraryTab owns that line.
 */
import type { DayWeather, DayWeatherParams } from '@/api';

/** Open-Meteo forecast horizon: today + 15 more days (16 total). */
export const FORECAST_HORIZON_DAYS = 16;

// ---------------------------------------------------------------------------
// WMO code groups → emoji + label
// ---------------------------------------------------------------------------

interface WmoGroup {
  codes: ReadonlySet<number>;
  emoji: string;
  label: string;
}

// Grouping follows the WMO 4677 interpretation table as published by
// Open-Meteo (same source as isRainy in src/api/weather.ts).
const WMO_GROUPS: readonly WmoGroup[] = [
  { codes: new Set([0, 1]), emoji: '☀️', label: 'clear' },
  { codes: new Set([2]), emoji: '⛅', label: 'partly cloudy' },
  { codes: new Set([3]), emoji: '☁️', label: 'overcast' },
  { codes: new Set([45, 48]), emoji: '🌫️', label: 'fog' },
  { codes: new Set([51, 53, 55, 56, 57]), emoji: '🌦️', label: 'drizzle' },
  // ☔ matches the spec'd chip face for proper rain ("☔ 18°").
  { codes: new Set([61, 63, 65, 66, 67, 80, 81, 82]), emoji: '☔', label: 'rain' },
  { codes: new Set([71, 73, 75, 77, 85, 86]), emoji: '🌨️', label: 'snow' },
  { codes: new Set([95, 96, 99]), emoji: '⛈️', label: 'thunderstorm' },
];

/** Compact chip face for a WMO code; unknown codes degrade to a mild sun. */
export function weatherEmoji(code: number): string {
  for (const g of WMO_GROUPS) if (g.codes.has(code)) return g.emoji;
  return '🌤️';
}

/** Spoken condition for screen-reader copy ("rain", "partly cloudy", …). */
export function weatherLabel(code: number): string {
  for (const g of WMO_GROUPS) if (g.codes.has(code)) return g.label;
  return 'mixed conditions';
}

// ---------------------------------------------------------------------------
// Local-date string math (YYYY-MM-DD, no UTC drift)
// ---------------------------------------------------------------------------

/** Format a Date as local YYYY-MM-DD. */
export function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD into a LOCAL-midnight Date (never `new Date(str)`). */
function parseLocalDate(dateStr: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** `addDaysToDateString('2026-06-11', 2)` → `'2026-06-13'`. */
export function addDaysToDateString(dateStr: string, days: number): string | null {
  const d = parseLocalDate(dateStr);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return localDateString(d);
}

/** Whole days from `a` to `b` (positive when b is later). Null on bad input. */
function diffInDays(a: string, b: string): number | null {
  const da = parseLocalDate(a);
  const db = parseLocalDate(b);
  if (!da || !db) return null;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

/** The 1-based month of a YYYY-MM-DD string, or null on bad input. */
export function monthOfDateString(dateStr: string): number | null {
  const d = parseLocalDate(dateStr);
  return d ? d.getMonth() + 1 : null;
}

// ---------------------------------------------------------------------------
// Request builder + date-keyed lookup
// ---------------------------------------------------------------------------

export interface TripWeatherInputs {
  /** trips.start_date — null disables weather entirely. */
  tripStartDate: string | null;
  /** ALL trip places (scheduled + Ideas) — the centroid uses every pin. */
  places: ReadonlyArray<{ lat: number; lng: number }>;
  /** Highest scheduled day_index (0-based); -1 when nothing is scheduled. */
  maxDayIndex: number;
  /** Injectable clock for tests; defaults to now. */
  now?: Date;
}

/**
 * ONE weather request for the whole trip, or undefined when out of horizon /
 * no dates / no places (callers pass undefined straight to useDayWeather,
 * which holds the query — the spec'd "quietly hide" behavior).
 *
 * Range logic: request from max(today, trip start) through min(last
 * scheduled day, horizon end). A trip already underway still gets chips for
 * its remaining days; a trip starting beyond ~16 days gets nothing.
 */
export function buildTripWeatherParams(inputs: TripWeatherInputs): DayWeatherParams | undefined {
  const { tripStartDate, places, maxDayIndex } = inputs;
  if (!tripStartDate || places.length === 0 || maxDayIndex < 0) return undefined;

  const today = localDateString(inputs.now ?? new Date());
  const horizonEnd = addDaysToDateString(today, FORECAST_HORIZON_DAYS - 1);
  const tripEnd = addDaysToDateString(tripStartDate, maxDayIndex);
  if (!horizonEnd || !tripEnd) return undefined; // malformed start_date

  // YYYY-MM-DD compares correctly as a string (fixed-width, big-endian).
  const startDate = tripStartDate > today ? tripStartDate : today;
  const endDate = tripEnd < horizonEnd ? tripEnd : horizonEnd;
  if (startDate > endDate) return undefined; // fully past, or fully beyond horizon

  const span = diffInDays(startDate, endDate);
  if (span === null) return undefined;
  const days = Math.max(1, Math.min(FORECAST_HORIZON_DAYS, span + 1));

  // Centroid across ALL trip places — one query for the whole trip. The
  // weather hook rounds to 2 decimals anyway, so city-scale precision is all
  // that survives (and all that matters for a forecast).
  let latSum = 0;
  let lngSum = 0;
  for (const p of places) {
    latSum += p.lat;
    lngSum += p.lng;
  }

  return {
    lat: latSum / places.length,
    lng: lngSum / places.length,
    startDate,
    days,
  };
}

/**
 * Forecast rows keyed by their YYYY-MM-DD date. ALWAYS look trip days up
 * through this (backend warns the array may have gaps — index math lies).
 */
export function indexWeatherByDate(days: ReadonlyArray<DayWeather>): ReadonlyMap<string, DayWeather> {
  const m = new Map<string, DayWeather>();
  for (const d of days) m.set(d.date, d);
  return m;
}
