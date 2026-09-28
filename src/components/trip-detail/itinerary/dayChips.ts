/**
 * dayChips — pure helpers for the itinerary day-jump strip and the
 * "past days start collapsed" rule (v2 M4 X2.3).
 *
 * Dates are the trip's local calendar strings ('YYYY-MM-DD'); every
 * comparison is calendar arithmetic, never `new Date('YYYY-MM-DD')` (UTC
 * midnight — off by one day west of Greenwich). `dayIndexFor` from
 * tripToday supplies "which day is today" using the DEVICE local date.
 */
import { dayIndexFor, type DatedTrip } from '@/lib/tripToday';

export interface DayChip {
  /** -1 = the Ideas bucket; otherwise the 0-based trip day index. */
  dayIndex: number;
  /** Short visible label: "Ideas", "D1 Mon 12", or "D1" for undated trips. */
  label: string;
  /** Date part alone ("Mon 12"), or null for Ideas / undated trips. */
  dateLabel: string | null;
  /** Screen-reader label: "Ideas", "Day 1, Monday 12 October, today". */
  accessibilityLabel: string;
  isToday: boolean;
  /** Strictly before today's trip day (only ever true while the trip is live). */
  isPast: boolean;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar parts of `start + offsetDays`, or null for a malformed start. */
export function dayDateParts(
  startDate: string | null | undefined,
  offsetDays: number,
): { weekday: number; day: number; month: number } | null {
  if (!startDate) return null;
  const m = DATE_RE.exec(startDate);
  if (!m) return null;
  // Date.UTC keeps the arithmetic DST-free: whole days only.
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + offsetDays);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  return { weekday: d.getUTCDay(), day: d.getUTCDate(), month: d.getUTCMonth() };
}

/**
 * The trip's live day index for `now`, or null when the trip isn't running
 * today (undated, not started, finished, archived).
 */
export function liveDayIndex(trip: DatedTrip, now: Date = new Date()): number | null {
  if (trip.archived_at) return null;
  return dayIndexFor(trip, now);
}

/** Build the strip's chips for the given section day indexes (Ideas = -1). */
export function buildDayChips(
  trip: DatedTrip,
  dayIndexes: readonly number[],
  now: Date = new Date(),
): DayChip[] {
  const today = liveDayIndex(trip, now);
  return dayIndexes.map((dayIndex) => {
    if (dayIndex < 0) {
      return {
        dayIndex,
        label: 'Ideas',
        dateLabel: null,
        accessibilityLabel: 'Ideas, saved places not scheduled yet',
        isToday: false,
        isPast: false,
      };
    }
    const isToday = today !== null && dayIndex === today;
    const isPast = today !== null && dayIndex < today;
    const parts = dayDateParts(trip.start_date, dayIndex);
    const n = dayIndex + 1;
    const dateLabel = parts ? `${WEEKDAY_SHORT[parts.weekday]} ${parts.day}` : null;
    const label = dateLabel ? `D${n} ${dateLabel}` : `Day ${n}`;
    const spoken = parts
      ? `Day ${n}, ${WEEKDAY_LONG[parts.weekday]} ${parts.day} ${MONTH_LONG[parts.month]}`
      : `Day ${n}`;
    return {
      dayIndex,
      label,
      dateLabel,
      accessibilityLabel: `${spoken}${isToday ? ', today' : isPast ? ', past' : ''}`,
      isToday,
      isPast,
    };
  });
}

/**
 * Default collapsed state for a day section when the user hasn't chosen
 * one on this device: while the trip is live, days before today start
 * collapsed; otherwise everything starts open. Ideas never auto-collapse.
 */
export function isCollapsedByDefault(dayIndex: number, todayIndex: number | null): boolean {
  return todayIndex !== null && dayIndex >= 0 && dayIndex < todayIndex;
}

/**
 * Which section is "current" for a scroll offset: the last section whose
 * top is at or above the viewport top (plus a small lead so a header that
 * is just arriving counts). Falls back to the first section.
 */
export function sectionAtOffset(
  offsets: ReadonlyArray<{ dayIndex: number; y: number }>,
  scrollY: number,
  lead = 24,
): number | null {
  if (offsets.length === 0) return null;
  const sorted = [...offsets].sort((a, b) => a.y - b.y);
  let current = sorted[0]!.dayIndex;
  for (const o of sorted) {
    if (o.y <= scrollY + lead) current = o.dayIndex;
    else break;
  }
  return current;
}
