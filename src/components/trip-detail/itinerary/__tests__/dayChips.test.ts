import { describe, expect, it } from '@jest/globals';
import { formatDate } from '@/i18n';
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
    expect(dayDateParts('2026-10-30', 3)).toEqual({ weekday: 1, day: 2, month: 10, year: 2026 });
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
    // Spoken date comes from the shared Intl formatter (app language).
    const spoken = formatDate(new Date(2026, 9, 14), 'weekdayLong', 'en');
    expect(chips[3]!.accessibilityLabel).toBe(`Day 3, ${spoken}, today`);
    expect(chips[1]!.accessibilityLabel).toMatch(/, past$/);
  });

  it('translates labels and dates into Turkish (no English "D1 Thu 18")', () => {
    const chips = buildDayChips(TRIP, [-1, 0, 3], DURING, 'tr');
    const weekday = formatDate(new Date(2026, 9, 15), 'weekdayOnly', 'tr');
    expect(chips[0]!.label).toBe('Fikirler');
    expect(chips[2]!.dateLabel).toBe(`15 ${weekday}`);
    expect(chips[2]!.label).toBe(`4. gün · 15 ${weekday}`);
    expect(chips[2]!.label).not.toMatch(/Thu|D4/);
    expect(chips[1]!.accessibilityLabel).toMatch(/^1\. gün, .*geçti$/);
    const undated = buildDayChips({ ...TRIP, start_date: null, end_date: null }, [0], DURING, 'tr');
    expect(undated[0]!.label).toBe('1. gün');
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
