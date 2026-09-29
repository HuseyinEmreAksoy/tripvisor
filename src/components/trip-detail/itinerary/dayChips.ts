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
import { formatDate, formatNumber, i18n, type AppLanguage } from '@/i18n';

export interface DayChip {
  /** -1 = the Ideas bucket; otherwise the 0-based trip day index. */
  dayIndex: number;
  /** Short visible label in the app language: "Ideas", "D1 Mon 12" / "1. gün 12 Pzt", or "Day 1" undated. */
  label: string;
  /** Date part alone ("Mon 12"), or null for Ideas / undated trips. */
  dateLabel: string | null;
  /** Screen-reader label: "Ideas", "Day 1, Monday 12 October, today". */
  accessibilityLabel: string;
  isToday: boolean;
  /** Strictly before today's trip day (only ever true while the trip is live). */
  isPast: boolean;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar parts of `start + offsetDays`, or null for a malformed start. */
export function dayDateParts(
  startDate: string | null | undefined,
  offsetDays: number,
): { weekday: number; day: number; month: number; year: number } | null {
  if (!startDate) return null;
  const m = DATE_RE.exec(startDate);
  if (!m) return null;
  // Date.UTC keeps the arithmetic DST-free: whole days only.
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + offsetDays);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  return { weekday: d.getUTCDay(), day: d.getUTCDate(), month: d.getUTCMonth(), year: d.getUTCFullYear() };
}

/**
 * The trip's live day index for `now`, or null when the trip isn't running
 * today (undated, not started, finished, archived).
 */
export function liveDayIndex(trip: DatedTrip, now: Date = new Date()): number | null {
  if (trip.archived_at) return null;
  return dayIndexFor(trip, now);
}

/**
 * Build the strip's chips for the given section day indexes (Ideas = -1).
 * M5 Y3.3: labels and dates are in the app language (`lng`, default the
 * active one) — `routes:dayChip.*` keys + the shared Intl formatters, so a
 * Turkish trip reads "1. gün 18 Per", not "D1 Thu 18". Callers re-run it
 * when the language changes (useDayNavigation keys its memo on it).
 */
export function buildDayChips(
  trip: DatedTrip,
  dayIndexes: readonly number[],
  now: Date = new Date(),
  lng?: AppLanguage,
): DayChip[] {
  const today = liveDayIndex(trip, now);
  const opt = lng ? { lng } : {};
  return dayIndexes.map((dayIndex) => {
    if (dayIndex < 0) {
      return {
        dayIndex,
        label: i18n.t('routes:dayChip.ideas', opt),
        dateLabel: null,
        accessibilityLabel: i18n.t('routes:dayChip.ideasA11y', opt),
        isToday: false,
        isPast: false,
      };
    }
    const isToday = today !== null && dayIndex === today;
    const isPast = today !== null && dayIndex < today;
    const parts = dayDateParts(trip.start_date, dayIndex);
    const n = dayIndex + 1;
    // Local-midnight Date from calendar parts (never a UTC string parse).
    const date = parts ? new Date(parts.year, parts.month, parts.day) : null;
    const dateLabel = date
      ? i18n.t('routes:dayChip.date', {
          ...opt,
          weekday: formatDate(date, 'weekdayOnly', lng),
          day: formatNumber(date.getDate(), {}, lng),
        })
      : null;
    const label = dateLabel
      ? i18n.t('routes:dayChip.label', { ...opt, day: n, date: dateLabel })
      : i18n.t('routes:dayChip.undated', { ...opt, day: n });
    const spokenDate = date ? formatDate(date, 'weekdayLong', lng) : null;
    const spoken = spokenDate
      ? isToday
        ? i18n.t('routes:dayChip.a11yToday', { ...opt, day: n, date: spokenDate })
        : isPast
          ? i18n.t('routes:dayChip.a11yPast', { ...opt, day: n, date: spokenDate })
          : i18n.t('routes:dayChip.a11y', { ...opt, day: n, date: spokenDate })
      : isToday
        ? i18n.t('routes:dayChip.a11yUndatedToday', { ...opt, day: n })
        : i18n.t('routes:dayChip.undated', { ...opt, day: n });
    return {
      dayIndex,
      label,
      dateLabel,
      accessibilityLabel: spoken,
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
