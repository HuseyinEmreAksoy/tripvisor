/**
 * tripToday — pure "which trip is happening today?" helpers (v2 M4 X1.1).
 *
 * Trip dates are stored as local calendar strings ('YYYY-MM-DD'), not
 * instants. "Today" is therefore the DEVICE's local calendar date, and every
 * comparison here is a plain string/calendar comparison — never
 * `new Date('YYYY-MM-DD')`, which parses as UTC midnight and is off by one
 * day west of Greenwich.
 *
 * Day indexes match `trip_places.day_index`: 0-based, day 0 = start_date.
 *
 * Consumed by the Today tab (X1.1 stub, X2.1 full view) and the itinerary
 * day-jump strip (X2.3).
 */

/** Minimal trip shape these helpers need — `Trip` from `@/api` satisfies it. */
export interface DatedTrip {
  id: string;
  start_date: string | null;
  end_date: string | null;
  archived_at?: string | null;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Local calendar date of `date` as 'YYYY-MM-DD'. */
export function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Day number (days since epoch) of a 'YYYY-MM-DD' string, or null if malformed. */
function dayNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = DATE_RE.exec(value);
  if (!match) return null;
  // Date.UTC keeps the arithmetic free of DST shifts: whole days only.
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(ms) ? null : Math.round(ms / 86_400_000);
}

function todayNumber(date: Date): number {
  return dayNumber(toLocalDateString(date)) as number;
}

/** Inclusive [start, end] day range; a missing end_date means a one-day trip. */
function tripRange(trip: DatedTrip): { start: number; end: number } | null {
  const start = dayNumber(trip.start_date);
  if (start === null) return null;
  const end = dayNumber(trip.end_date) ?? start;
  return { start, end: Math.max(start, end) };
}

/** Is `trip` running on the local calendar day of `date`? Archived trips never are. */
export function isTripActiveOn(trip: DatedTrip, date: Date = new Date()): boolean {
  if (trip.archived_at) return false;
  const range = tripRange(trip);
  if (!range) return false;
  const today = todayNumber(date);
  return today >= range.start && today <= range.end;
}

/**
 * Trips running on `date` (local), soonest-ending first so the trip that
 * finishes today is surfaced before a longer overlapping one.
 */
export function activeTripsOn<T extends DatedTrip>(trips: ReadonlyArray<T>, date: Date = new Date()): T[] {
  return trips
    .filter((trip) => isTripActiveOn(trip, date))
    .sort((a, b) => (tripRange(a)?.end ?? 0) - (tripRange(b)?.end ?? 0));
}

/**
 * 0-based day index of `date` within `trip` (matches `trip_places.day_index`),
 * or null when the trip has no valid start date or `date` is outside it.
 */
export function dayIndexFor(trip: DatedTrip, date: Date = new Date()): number | null {
  const range = tripRange(trip);
  if (!range) return null;
  const today = todayNumber(date);
  if (today < range.start || today > range.end) return null;
  return today - range.start;
}

/** Whole days from `date` (local) until the trip starts; negative once started. */
export function daysUntilStart(trip: DatedTrip, date: Date = new Date()): number | null {
  const range = tripRange(trip);
  if (!range) return null;
  return range.start - todayNumber(date);
}

/**
 * The nearest trip that starts strictly after `date` (local), ignoring
 * archived trips. Ties break on the earlier-listed trip.
 */
export function nextUpcomingTrip<T extends DatedTrip>(
  trips: ReadonlyArray<T>,
  date: Date = new Date(),
): { trip: T; daysUntil: number } | null {
  let best: { trip: T; daysUntil: number } | null = null;
  for (const trip of trips) {
    if (trip.archived_at) continue;
    const daysUntil = daysUntilStart(trip, date);
    if (daysUntil === null || daysUntil <= 0) continue;
    if (!best || daysUntil < best.daysUntil) best = { trip, daysUntil };
  }
  return best;
}
