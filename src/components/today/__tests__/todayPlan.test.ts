import { describe, expect, it } from '@jest/globals';
import {
  approxTravelMinutes,
  buildAddressDirectionsUrl,
  formatMinutesLeft,
  haversineKm,
  minutesSinceMidnight,
  selectNextStop,
  staysForNight,
  tripDayCount,
  type PlanStop,
} from '../todayPlan';

const hm = (h: number, m = 0) => h * 60 + m;
// 09:00–10:00, 10:30–12:30, 13:00–14:00
const stops: PlanStop[] = [
  { placeId: 'a', arrivalMinutes: hm(9), departureMinutes: hm(10) },
  { placeId: 'b', arrivalMinutes: hm(10, 30), departureMinutes: hm(12, 30) },
  { placeId: 'c', arrivalMinutes: hm(13), departureMinutes: hm(14) },
];

describe('selectNextStop', () => {
  it('returns empty for a day with no stops', () => {
    expect(selectNextStop({ stops: [], nowMinutes: hm(10), checkoffs: {} })).toEqual({ kind: 'empty' });
  });

  it('before the day starts, the first stop is upcoming with time until arrival', () => {
    const r = selectNextStop({ stops, nowMinutes: hm(8, 15), checkoffs: {} });
    expect(r).toMatchObject({ kind: 'next', index: 0, phase: 'upcoming', minutesLeft: 45 });
  });

  it('inside a visit window the stop is "now" with time until departure', () => {
    const r = selectNextStop({ stops, nowMinutes: hm(11), checkoffs: { a: 'done' } });
    expect(r).toMatchObject({ kind: 'next', stop: { placeId: 'b' }, phase: 'now', minutesLeft: 90 });
  });

  it('an unchecked stop whose departure passed stays next, flagged late', () => {
    const r = selectNextStop({ stops, nowMinutes: hm(12, 45), checkoffs: {} });
    expect(r).toMatchObject({
      kind: 'next',
      stop: { placeId: 'a' },
      index: 0,
      phase: 'late',
      minutesLeft: 0,
      minutesLate: 165,
      remainingUnchecked: 3,
    });
  });

  it('a departure exactly at now counts as late', () => {
    const r = selectNextStop({ stops, nowMinutes: hm(10), checkoffs: {} });
    expect(r).toMatchObject({ kind: 'next', stop: { placeId: 'a' }, phase: 'late', minutesLate: 0 });
  });

  it('checking off the late stops moves on to the one at or after now', () => {
    const r = selectNextStop({ stops, nowMinutes: hm(12, 45), checkoffs: { a: 'done', b: 'skipped' } });
    expect(r).toMatchObject({ kind: 'next', stop: { placeId: 'c' }, phase: 'upcoming', minutesLeft: 15, remainingUnchecked: 1 });
  });

  it('check-offs skip stops regardless of the clock', () => {
    const r = selectNextStop({ stops, nowMinutes: hm(8), checkoffs: { a: 'done', b: 'skipped' } });
    expect(r).toMatchObject({ kind: 'next', stop: { placeId: 'c' }, index: 2, phase: 'upcoming' });
  });

  it('finished when everything is checked off', () => {
    const r = selectNextStop({ stops, nowMinutes: hm(9), checkoffs: { a: 'done', b: 'done', c: 'skipped' } });
    expect(r).toEqual({ kind: 'finished' });
  });

  it('after the last departure, unchecked stops still offer the earliest as next (never "finished")', () => {
    const r = selectNextStop({ stops, nowMinutes: hm(20), checkoffs: { a: 'done' } });
    expect(r).toMatchObject({ kind: 'next', stop: { placeId: 'b' }, phase: 'late', minutesLate: 450, remainingUnchecked: 2 });
  });
});

describe('formatMinutesLeft / minutesSinceMidnight', () => {
  it('formats minutes compactly', () => {
    expect(formatMinutesLeft(0)).toBe('now');
    expect(formatMinutesLeft(5)).toBe('5 min');
    expect(formatMinutesLeft(60)).toBe('1 h');
    expect(formatMinutesLeft(130)).toBe('2 h 10 min');
  });
  it('reads local clock minutes', () => {
    expect(minutesSinceMidnight(new Date(2026, 8, 28, 14, 5))).toBe(hm(14, 5));
  });
});

describe('approximate distance', () => {
  const colosseum = { lat: 41.8902, lng: 12.4922 };
  const trevi = { lat: 41.9009, lng: 12.4833 };

  it('haversine is ~1.4 km Colosseum → Trevi', () => {
    expect(haversineKm(colosseum, trevi)).toBeCloseTo(1.4, 1);
  });

  it('scales with transport mode and never returns < 1', () => {
    const walk = approxTravelMinutes(colosseum, trevi, 'walking');
    const drive = approxTravelMinutes(colosseum, trevi, 'driving');
    expect(walk).toBeGreaterThan(drive);
    expect(walk).toBeGreaterThanOrEqual(20);
    expect(walk).toBeLessThanOrEqual(30);
    expect(approxTravelMinutes(colosseum, colosseum, 'driving')).toBe(1);
  });
});

describe('staysForNight', () => {
  const stays = [
    { id: 'h1', check_in_date: '2026-09-27', check_out_date: '2026-09-29' },
    { id: 'h2', check_in_date: '2026-09-29', check_out_date: '2026-10-01' },
    { id: 'gone', check_in_date: '2026-09-27', check_out_date: '2026-10-01', deleted: true },
  ];
  it('covers check-in ≤ night < check-out and ignores tombstones', () => {
    expect(staysForNight(stays, '2026-09-28').map((s) => s.id)).toEqual(['h1']);
    expect(staysForNight(stays, '2026-09-29').map((s) => s.id)).toEqual(['h2']);
    expect(staysForNight(stays, '2026-10-01')).toEqual([]);
  });
});

describe('tripDayCount / buildAddressDirectionsUrl', () => {
  it('counts inclusive days, one-day default, null on bad start', () => {
    expect(tripDayCount('2026-09-28', '2026-10-02')).toBe(5);
    expect(tripDayCount('2026-09-28', null)).toBe(1);
    expect(tripDayCount(null, '2026-10-02')).toBeNull();
    expect(tripDayCount('2026-03-28', '2026-03-30')).toBe(3); // across a DST change
  });
  it('encodes the address as the destination', () => {
    expect(buildAddressDirectionsUrl('Via Roma 1, Roma')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=Via%20Roma%201%2C%20Roma',
    );
  });
});
