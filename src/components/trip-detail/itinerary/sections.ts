/**
 * Pure itinerary helpers moved out of ItineraryTab verbatim in v2 M4 X2.3
 * (file-size split — no behavior change), plus the Assist menu's gap-fill
 * day picker.
 */
import type { TripPlace } from '@/api';
import { formatClockTime, type TimelineStop } from '../computeDayTimeline';

export type DaySection = { dayIndex: number; places: TripPlace[] };

/**
 * v2 P1.1b: human copy for a stop's time-window conflict. Non-blocking by
 * design (ux-principles) — the chip informs; the user decides whether to
 * shorten the visit, reorder the day, or simply ignore it.
 */
export function buildConflictMessage(stop: TimelineStop): string | null {
  if (!stop.conflict) return null;
  // T1: an unreachable pin — the day flow gets here after the pinned time.
  if (stop.conflict === 'pinned_tight') {
    return stop.pinnedStartMinutes !== null
      ? `arrives ${formatClockTime(stop.arrivalMinutes)} — pinned ${formatClockTime(stop.pinnedStartMinutes)}`
      : null;
  }
  if (stop.windowEndMinutes === null) return null;
  const windowEnd = formatClockTime(stop.windowEndMinutes);
  return stop.conflict === 'arrives_late'
    ? `arrives ${formatClockTime(stop.arrivalMinutes)} — window ends ${windowEnd}`
    : `leaves ${formatClockTime(stop.departureMinutes)} — window ends ${windowEnd}`;
}

/**
 * v2 S2.8.7: group an ALREADY display-ordered list (orderPlacesForDisplay's
 * output) into day sections WITHOUT re-sorting inside each day — the
 * helper's per-day order is canonical (rank-aware in manual mode), and
 * re-sorting by order_in_day here (as groupByDay does) would undo it.
 * Section order matches groupByDay's output: Ideas (-1) first, then days
 * ascending — which is also exactly the order orderPlacesForDisplay emits,
 * so the trailing sort is a determinism guarantee, not a reshuffle.
 */
export function groupPlacesPreservingOrder(ordered: readonly TripPlace[]): DaySection[] {
  const map = new Map<number, TripPlace[]>();
  for (const p of ordered) {
    const key = p.day_index ?? -1;
    const arr = map.get(key);
    if (arr) arr.push(p);
    else map.set(key, [p]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dayIndex, ps]) => ({ dayIndex, places: ps }));
}

export function groupByDay(places: TripPlace[]): DaySection[] {
  const map = new Map<number, TripPlace[]>();
  for (const p of places) {
    const key = p.day_index ?? -1;
    const arr = map.get(key) ?? [];
    arr.push(p);
    map.set(key, arr);
  }
  for (const [, arr] of map) {
    arr.sort((a: TripPlace, b: TripPlace) => (a.order_in_day ?? 0) - (b.order_in_day ?? 0));
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dayIndex, ps]) => ({ dayIndex, places: ps }));
}

/**
 * v2 M4 X2.3 (Assist → "Fill free time"): which day to open GapFillSheet
 * for. Today wins while the trip is live and today has room; otherwise the
 * scheduled day with the most slack. Null when no day reaches `minSlack`.
 */
export function pickGapFillDay(
  slackByDay: ReadonlyArray<{ dayIndex: number; slack: number | null }>,
  todayIndex: number | null,
  minSlack: number,
): { dayIndex: number; slack: number } | null {
  const eligible = slackByDay.filter(
    (d): d is { dayIndex: number; slack: number } =>
      d.dayIndex >= 0 && d.slack !== null && d.slack >= minSlack,
  );
  if (eligible.length === 0) return null;
  const today = todayIndex !== null ? eligible.find((d) => d.dayIndex === todayIndex) : undefined;
  if (today) return today;
  return eligible.reduce((best, d) => (d.slack > best.slack ? d : best));
}
