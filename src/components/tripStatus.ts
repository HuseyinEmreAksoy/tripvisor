/**
 * Where a trip is in time (M5 Y2.4) — drives the hero / card status chip:
 * "Day 3 of 7" while it runs, "In 12 days" before, "Relive" after.
 *
 * Pure: trip dates are local calendar dates (`YYYY-MM-DD`), compared by
 * calendar day on the device clock — the same rule as src/lib/tripToday.ts.
 */
import type { IconName } from './Icon';

export type TripPhase =
  | { kind: 'live'; day: number; total: number }
  | { kind: 'upcoming'; daysUntil: number }
  | { kind: 'past' }
  | { kind: 'undated' };

const DAY_MS = 86_400_000;

function localDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

export function tripPhase(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  now: Date = new Date(),
): TripPhase {
  const start = localDay(startDate);
  if (start === null) return { kind: 'undated' };
  const endRaw = localDay(endDate);
  const end = endRaw !== null && endRaw >= start ? endRaw : start;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  // Math.round absorbs the ±1 h of a DST change inside the span.
  if (today < start) return { kind: 'upcoming', daysUntil: Math.round((start - today) / DAY_MS) };
  if (today > end) return { kind: 'past' };
  return {
    kind: 'live',
    day: Math.round((today - start) / DAY_MS) + 1,
    total: Math.round((end - start) / DAY_MS) + 1,
  };
}

/** The chip icon for a phase (undated trips show no chip). */
export const PHASE_ICON: Record<Exclude<TripPhase['kind'], 'undated'>, IconName> = {
  live: 'sun',
  upcoming: 'calendar',
  past: 'sparkles',
};
