import { afterEach, describe, expect, it } from '@jest/globals';
import { act } from '@testing-library/react-native';
import { formatDate, formatDateRange, formatDistance, formatDuration, setLanguagePreference } from '@/i18n';
import {
  buildDayTabs,
  dayDateLabel,
  formatTravel,
  formatTripRange,
  formatVisit,
  groupByDay,
  indexLegs,
  isEstimatedSharedLeg,
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

afterEach(async () => {
  await act(() => setLanguagePreference('system'));
});

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
  it('labels trip days from the start date in the app language (no day shift)', () => {
    expect(dayDateLabel('2026-11-02', 0)).toBe(formatDate(new Date(2026, 10, 2), 'weekday'));
    expect(dayDateLabel('2026-10-31', 1)).toBe(formatDate(new Date(2026, 10, 1), 'weekday'));
    expect(dayDateLabel(null, 0)).toBeNull();
    expect(dayDateLabel('2026-11-02', -1)).toBeNull();
  });

  it('formats ranges with the shared formatter, or says dates are not set', () => {
    expect(formatTripRange('2026-11-03', '2026-11-07')).toBe(
      formatDateRange(new Date(2026, 10, 3), new Date(2026, 10, 7)),
    );
    expect(formatTripRange('2026-11-03', '2026-11-07')).toMatch(/2026/);
    expect(formatTripRange(null, null)).toBe('Dates not set');
  });

  it('switches labels to Turkish', async () => {
    await act(() => setLanguagePreference('tr'));
    expect(formatTripRange(null, null)).toBe('Tarih belirlenmedi');
    expect(buildDayTabs(null, groupByDay([place('a', 0, 0)])).map((t) => t.label)).toEqual(['Genel bakış', '1. gün']);
  });

  it('counts days from dates or scheduled places, whichever is larger', () => {
    const sections = groupByDay([place('a', 4, 0)]);
    expect(tripDayCount({ start_date: '2026-11-01', end_date: '2026-11-03' }, sections)).toBe(5);
    expect(tripDayCount({ start_date: '2026-11-01', end_date: '2026-11-10' }, sections)).toBe(10);
    // Across a European DST change (25 Oct 2026).
    expect(tripDayCount({ start_date: '2026-10-24', end_date: '2026-10-26' }, [])).toBe(3);
  });
});

describe('buildDayTabs', () => {
  it('starts with Overview, then one tab per day with its date', () => {
    const tabs = buildDayTabs(
      '2026-11-02',
      groupByDay([place('a', 0, 0), place('b', 1, 0), place('u', null, null)]),
    );
    expect(tabs.map((t) => t.label)).toEqual(['Overview', 'Day 1', 'Day 2', 'Unscheduled']);
    expect(tabs[2]!.sublabel).toBe(formatDate(new Date(2026, 10, 3), 'weekday'));
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

  it('formats travel and visit durations with the shared formatters', () => {
    expect(formatTravel(600, 2500)).toBe(`${formatDuration(10)} · ${formatDistance(2500)}`);
    expect(formatTravel(5400, null)).toBe(formatDuration(90));
    expect(formatTravel(null, null)).toBeNull();
    expect(formatVisit(45)).toBe(formatDuration(45));
    expect(formatVisit(0)).toBeNull();
  });

  it('flags estimated legs only', () => {
    const base = { id: 'l', day_index: 0, from_place_id: 'a', to_place_id: 'b' } as SharedTripLeg;
    expect(isEstimatedSharedLeg({ ...base, source: 'estimate' })).toBe(true);
    expect(isEstimatedSharedLeg({ ...base, source: 'ors' })).toBe(false);
    expect(isEstimatedSharedLeg(base)).toBe(false);
  });
});
