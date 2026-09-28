import { describe, expect, it } from '@jest/globals';
import {
  activeTripsOn,
  dayIndexFor,
  daysUntilStart,
  isTripActiveOn,
  nextUpcomingTrip,
  toLocalDateString,
  type DatedTrip,
} from '../tripToday';

// Local-time constructor: (y, monthIndex, d, h) — never a UTC ISO string.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0);

const trip = (id: string, start: string | null, end: string | null, archived_at: string | null = null): DatedTrip => ({
  id,
  start_date: start,
  end_date: end,
  archived_at,
});

describe('toLocalDateString', () => {
  it('formats the LOCAL calendar date, zero-padded', () => {
    expect(toLocalDateString(at(2026, 3, 7))).toBe('2026-03-07');
  });

  it('uses the local day at the edges of the day (no UTC shift)', () => {
    expect(toLocalDateString(at(2026, 9, 28, 0))).toBe('2026-09-28');
    expect(toLocalDateString(new Date(2026, 8, 28, 23, 59, 59))).toBe('2026-09-28');
  });
});

describe('isTripActiveOn / dayIndexFor', () => {
  const lisbon = trip('a', '2026-09-27', '2026-09-30');

  it('is active on the first and last day (inclusive)', () => {
    expect(isTripActiveOn(lisbon, at(2026, 9, 27, 0))).toBe(true);
    expect(isTripActiveOn(lisbon, at(2026, 9, 30, 23))).toBe(true);
  });

  it('is not active the day before or after', () => {
    expect(isTripActiveOn(lisbon, at(2026, 9, 26, 23))).toBe(false);
    expect(isTripActiveOn(lisbon, at(2026, 10, 1, 0))).toBe(false);
  });

  it('returns a 0-based day index matching trip_places.day_index', () => {
    expect(dayIndexFor(lisbon, at(2026, 9, 27))).toBe(0);
    expect(dayIndexFor(lisbon, at(2026, 9, 29))).toBe(2);
    expect(dayIndexFor(lisbon, at(2026, 10, 1))).toBeNull();
  });

  it('treats a missing end_date as a one-day trip', () => {
    const dayTrip = trip('b', '2026-09-28', null);
    expect(dayIndexFor(dayTrip, at(2026, 9, 28))).toBe(0);
    expect(isTripActiveOn(dayTrip, at(2026, 9, 29))).toBe(false);
  });

  it('crosses month and DST boundaries by calendar day', () => {
    const autumn = trip('c', '2026-10-24', '2026-10-27'); // EU DST ends 2026-10-25
    expect(dayIndexFor(autumn, at(2026, 10, 27))).toBe(3);
    const newYear = trip('d', '2026-12-30', '2027-01-02');
    expect(dayIndexFor(newYear, at(2027, 1, 1))).toBe(2);
  });

  it('ignores undated, malformed and archived trips', () => {
    expect(isTripActiveOn(trip('e', null, null), at(2026, 9, 28))).toBe(false);
    expect(isTripActiveOn(trip('f', '28/09/2026', null), at(2026, 9, 28))).toBe(false);
    expect(isTripActiveOn(trip('g', '2026-09-28', '2026-09-29', '2026-09-01T00:00:00Z'), at(2026, 9, 28))).toBe(
      false,
    );
  });
});

describe('activeTripsOn', () => {
  it('returns only trips running today, soonest-ending first', () => {
    const long = trip('long', '2026-09-20', '2026-10-10');
    const short = trip('short', '2026-09-28', '2026-09-29');
    const past = trip('past', '2026-09-01', '2026-09-05');
    expect(activeTripsOn([long, past, short], at(2026, 9, 28)).map((t) => t.id)).toEqual(['short', 'long']);
  });

  it('returns an empty list when nothing is active', () => {
    expect(activeTripsOn([], at(2026, 9, 28))).toEqual([]);
  });
});

describe('nextUpcomingTrip / daysUntilStart', () => {
  it('picks the nearest trip starting after today', () => {
    const trips = [
      trip('far', '2026-12-01', '2026-12-05'),
      trip('soon', '2026-10-03', '2026-10-06'),
      trip('now', '2026-09-28', '2026-09-30'),
      trip('past', '2026-09-01', '2026-09-03'),
    ];
    const next = nextUpcomingTrip(trips, at(2026, 9, 28));
    expect(next?.trip.id).toBe('soon');
    expect(next?.daysUntil).toBe(5);
  });

  it('skips archived and undated trips and returns null when none qualify', () => {
    const trips = [trip('a', '2026-10-01', null, '2026-09-01T00:00:00Z'), trip('b', null, null)];
    expect(nextUpcomingTrip(trips, at(2026, 9, 28))).toBeNull();
  });

  it('counts whole calendar days regardless of the time of day', () => {
    const tomorrow = trip('t', '2026-09-29', null);
    expect(daysUntilStart(tomorrow, at(2026, 9, 28, 23))).toBe(1);
    expect(daysUntilStart(tomorrow, at(2026, 9, 28, 0))).toBe(1);
  });
});
