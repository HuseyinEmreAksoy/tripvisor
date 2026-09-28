import { describe, expect, it } from '@jest/globals';
import {
  buildDayTabs,
  dayDateLabel,
  formatTravel,
  formatTripRange,
  formatVisit,
  groupByDay,
  indexLegs,
  legKey,
  tripDayCount,
  type SharedTripLeg,
  type SharedTripPlace,
} from '../sharedTripModel';

function place(id: string, day: number | null, order: number | null): SharedTripPlace {
  return {
    id,
    google_place_id: null,
    user_title: id,
    category: null,
    lat: 0,
    lng: 0,
    visit_duration_minutes: 60,
    day_index: day,
    order_in_day: order,
    notes: null,
  } as unknown as SharedTripPlace;
}

describe('groupByDay', () => {
  it('groups by day, sorts stops by order and puts unscheduled last', () => {
    const out = groupByDay([
      place('c', 1, 1),
      place('u', null, null),
      place('a', 0, 2),
      place('b', 0, 1),
      place('d', 1, 0),
    ]);
    expect(out.map((s) => s.dayIndex)).toEqual([0, 1, -1]);
    expect(out[0]!.places.map((p) => p.id)).toEqual(['b', 'a']);
    expect(out[1]!.places.map((p) => p.id)).toEqual(['d', 'c']);
  });
});

describe('dates', () => {
  it('labels trip days from the start date (UTC-safe)', () => {
    expect(dayDateLabel('2026-11-02', 0)).toBe('Mon 2 Nov');
    expect(dayDateLabel('2026-10-31', 1)).toBe('Sun 1 Nov');
    expect(dayDateLabel(null, 0)).toBeNull();
    expect(dayDateLabel('2026-11-02', -1)).toBeNull();
  });

  it('formats ranges compactly', () => {
    expect(formatTripRange('2026-11-03', '2026-11-07')).toBe('3–7 Nov 2026');
    expect(formatTripRange('2026-10-30', '2026-11-02')).toBe('30 Oct – 2 Nov 2026');
    expect(formatTripRange('2026-12-30', '2027-01-02')).toBe('30 Dec 2026 – 2 Jan 2027');
    expect(formatTripRange(null, null)).toBe('Dates not set');
  });

  it('counts days from dates or scheduled places, whichever is larger', () => {
    const sections = groupByDay([place('a', 4, 0)]);
    expect(tripDayCount({ start_date: '2026-11-01', end_date: '2026-11-03' }, sections)).toBe(5);
    expect(tripDayCount({ start_date: '2026-11-01', end_date: '2026-11-10' }, sections)).toBe(10);
  });
});

describe('buildDayTabs', () => {
  it('starts with Overview, then one tab per day with its date', () => {
    const tabs = buildDayTabs(
      '2026-11-02',
      groupByDay([place('a', 0, 0), place('b', 1, 0), place('u', null, null)]),
    );
    expect(tabs.map((t) => t.label)).toEqual(['Overview', 'Day 1', 'Day 2', 'Unscheduled']);
    expect(tabs[2]!.sublabel).toBe('Tue 3 Nov');
  });
});

describe('legs + formatting', () => {
  it('indexes legs by day/from/to', () => {
    const leg = {
      id: 'l',
      day_index: 0,
      from_place_id: 'a',
      to_place_id: 'b',
      duration_seconds: 600,
      distance_meters: 2500,
    } as SharedTripLeg;
    expect(indexLegs([leg]).get(legKey(0, 'a', 'b'))).toBe(leg);
  });

  it('formats travel and visit durations', () => {
    expect(formatTravel(600, 2500)).toBe('10 min · 2.5 km');
    expect(formatTravel(5400, 42000)).toBe('1 h 30 min · 42 km');
    expect(formatTravel(null, null)).toBeNull();
    expect(formatVisit(45)).toBe('45 min');
    expect(formatVisit(120)).toBe('2 h');
    expect(formatVisit(0)).toBeNull();
  });
});
