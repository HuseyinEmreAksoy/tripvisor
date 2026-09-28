import { describe, expect, it } from '@jest/globals';
import {
  buildDayChips,
  dayDateParts,
  isCollapsedByDefault,
  liveDayIndex,
  sectionAtOffset,
} from '../dayChips';
import { pickGapFillDay } from '../sections';

// 2026-10-12 is a Monday. Local-time Date (never a UTC string parse).
const TRIP = { id: 't1', start_date: '2026-10-12', end_date: '2026-10-15', archived_at: null };
const DURING = new Date(2026, 9, 14, 10, 0); // Wed 14 Oct → day index 2
const BEFORE = new Date(2026, 9, 1, 10, 0);

describe('dayDateParts', () => {
  it('adds whole days across a month boundary', () => {
    expect(dayDateParts('2026-10-30', 3)).toEqual({ weekday: 1, day: 2, month: 10 });
  });
  it('returns null for undated or malformed trips', () => {
    expect(dayDateParts(null, 0)).toBeNull();
    expect(dayDateParts('12/10/2026', 0)).toBeNull();
  });
});

describe('buildDayChips', () => {
  it('labels Ideas and dated days, marking today and past days while live', () => {
    const chips = buildDayChips(TRIP, [-1, 0, 1, 2, 3], DURING);
    expect(chips.map((c) => c.label)).toEqual(['Ideas', 'D1 Mon 12', 'D2 Tue 13', 'D3 Wed 14', 'D4 Thu 15']);
    expect(chips.map((c) => c.isToday)).toEqual([false, false, false, true, false]);
    expect(chips.map((c) => c.isPast)).toEqual([false, true, true, false, false]);
    expect(chips[3]!.dateLabel).toBe('Wed 14');
    expect(chips[3]!.accessibilityLabel).toBe('Day 3, Wednesday 14 October, today');
  });

  it('has no today/past before the trip starts', () => {
    const chips = buildDayChips(TRIP, [0, 1], BEFORE);
    expect(chips.every((c) => !c.isToday && !c.isPast)).toBe(true);
  });

  it('falls back to "Day N" for undated trips', () => {
    const chips = buildDayChips({ ...TRIP, start_date: null, end_date: null }, [0], DURING);
    expect(chips[0]!.label).toBe('Day 1');
    expect(chips[0]!.dateLabel).toBeNull();
  });

  it('treats archived trips as not live', () => {
    expect(liveDayIndex({ ...TRIP, archived_at: '2026-10-13T00:00:00Z' }, DURING)).toBeNull();
    expect(liveDayIndex(TRIP, DURING)).toBe(2);
  });
});

describe('isCollapsedByDefault', () => {
  it('collapses only past scheduled days while the trip is live', () => {
    expect(isCollapsedByDefault(0, 2)).toBe(true);
    expect(isCollapsedByDefault(2, 2)).toBe(false);
    expect(isCollapsedByDefault(3, 2)).toBe(false);
    expect(isCollapsedByDefault(-1, 2)).toBe(false); // Ideas never auto-collapse
    expect(isCollapsedByDefault(0, null)).toBe(false); // not live
  });
});

describe('sectionAtOffset', () => {
  const offsets = [
    { dayIndex: 1, y: 600 },
    { dayIndex: -1, y: 0 },
    { dayIndex: 0, y: 300 },
  ];
  it('returns the last section whose top has reached the viewport', () => {
    expect(sectionAtOffset(offsets, 0)).toBe(-1);
    expect(sectionAtOffset(offsets, 290)).toBe(0);
    expect(sectionAtOffset(offsets, 2000)).toBe(1);
  });
  it('returns null with no sections', () => {
    expect(sectionAtOffset([], 100)).toBeNull();
  });
});

describe('pickGapFillDay', () => {
  const slack = [
    { dayIndex: -1, slack: null },
    { dayIndex: 0, slack: 90 },
    { dayIndex: 1, slack: 200 },
    { dayIndex: 2, slack: 70 },
  ];
  it('prefers today when it has room', () => {
    expect(pickGapFillDay(slack, 2, 60)).toEqual({ dayIndex: 2, slack: 70 });
  });
  it('otherwise picks the day with the most slack', () => {
    expect(pickGapFillDay(slack, null, 60)).toEqual({ dayIndex: 1, slack: 200 });
  });
  it('returns null when no day reaches the minimum', () => {
    expect(pickGapFillDay(slack, null, 500)).toBeNull();
  });
});
