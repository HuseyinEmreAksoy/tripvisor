/**
 * sharedTripModel.ts — pure helpers for the public share page
 * (`app/share/[token].tsx`). No React, no platform code.
 *
 * Only Tier-1 trip fields are used (titles, coordinates, durations, day
 * assignment, user notes). `google_place_id` is never rendered. Labels and
 * dates go through the app i18n (`share` namespace + shared formatters);
 * pass the render language (`useAppLocale().language`) as `lng`.
 */
import type { SharedTrip, TripLeg } from '@/api/types';
import { isEstimatedLeg } from '@/api/routes.types';
import { formatDate, formatDateRange, formatDistance, formatDuration, i18n, type AppLanguage } from '@/i18n';

export type SharedTripPlace = SharedTrip['places'][number];
/** Contract v4 legs also carry `source` (ors | google | estimate | user). */
export type SharedTripLeg = SharedTrip['legs'][number] & Partial<Pick<TripLeg, 'source'>>;

/** Day key: 'all' for the overview tab, else the day index (-1 = unscheduled). */
export type DayKey = 'all' | number;

export interface DaySection {
  dayIndex: number;
  places: SharedTripPlace[];
}

export function groupByDay(places: readonly SharedTripPlace[]): DaySection[] {
  const map = new globalThis.Map<number, SharedTripPlace[]>();
  for (const p of places) {
    const key = p.day_index ?? -1;
    const arr = map.get(key) ?? [];
    arr.push(p);
    map.set(key, arr);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => (a.order_in_day ?? 0) - (b.order_in_day ?? 0));
  }
  // Scheduled days ascending, "Unscheduled" (-1) last.
  return [...map.entries()]
    .sort(([a], [b]) => (a < 0 ? 1 : b < 0 ? -1 : a - b))
    .map(([dayIndex, ps]) => ({ dayIndex, places: ps }));
}

function isoParts(iso: string | null | undefined): [number, number, number] | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? [Number(m[1]), Number(m[2]) - 1, Number(m[3])] : null;
}

/** A LOCAL-midnight Date for a `YYYY-MM-DD` (+ offset days), so formatting never shifts the day. */
function localDate(iso: string | null | undefined, plusDays = 0): Date | null {
  const p = isoParts(iso);
  return p ? new Date(p[0], p[1], p[2] + plusDays) : null;
}

/** Day number since the epoch (UTC, so DST never skews a difference). */
function isoDayNumber(iso: string | null | undefined): number | null {
  const p = isoParts(iso);
  return p ? Date.UTC(p[0], p[1], p[2]) / 86_400_000 : null;
}

/** "Mon, 3 Nov" / "3 Kas Pzt" for trip day `dayIndex`, or null when the trip has no start date. */
export function dayDateLabel(startDate: string | null | undefined, dayIndex: number, lng?: AppLanguage): string | null {
  if (dayIndex < 0) return null;
  const d = localDate(startDate, dayIndex);
  return d ? formatDate(d, 'weekday', lng) : null;
}

/** The trip's date span in the app language, or "Dates not set". */
export function formatTripRange(start: string | null, end: string | null, lng?: AppLanguage): string {
  return formatDateRange(localDate(start), localDate(end), lng) ?? i18n.t('share:page.datesNotSet', { lng });
}

/** Inclusive day count from dates, falling back to the highest scheduled day. */
export function tripDayCount(trip: Pick<SharedTrip['trip'], 'start_date' | 'end_date'>, sections: readonly DaySection[]): number {
  const s = isoDayNumber(trip.start_date);
  const e = isoDayNumber(trip.end_date);
  const fromDates = s != null && e != null && e >= s ? Math.round(e - s) + 1 : 0;
  const fromPlaces = sections.reduce((max, sec) => Math.max(max, sec.dayIndex + 1), 0);
  return Math.max(fromDates, fromPlaces);
}

export interface DayTab {
  key: DayKey;
  label: string;
  sublabel: string | null;
}

export function buildDayTabs(startDate: string | null, sections: readonly DaySection[], lng?: AppLanguage): DayTab[] {
  const tabs: DayTab[] = [{ key: 'all', label: i18n.t('share:timeline.overview', { lng }), sublabel: null }];
  for (const s of sections) {
    tabs.push(
      s.dayIndex < 0
        ? { key: s.dayIndex, label: i18n.t('share:timeline.unscheduled', { lng }), sublabel: null }
        : {
            key: s.dayIndex,
            label: i18n.t('share:timeline.day', { lng, day: s.dayIndex + 1 }),
            sublabel: dayDateLabel(startDate, s.dayIndex, lng),
          },
    );
  }
  return tabs;
}

export function legKey(dayIndex: number, fromId: string, toId: string): string {
  return `${dayIndex}|${fromId}|${toId}`;
}

export function indexLegs(legs: readonly SharedTripLeg[]): globalThis.Map<string, SharedTripLeg> {
  const m = new globalThis.Map<string, SharedTripLeg>();
  for (const l of legs) {
    if (l.day_index != null) m.set(legKey(l.day_index, l.from_place_id, l.to_place_id), l);
  }
  return m;
}

/** "10m · 2.5 km" (the duration alone when the distance is unknown), or null without a duration. */
export function formatTravel(seconds: number | null, meters: number | null, lng?: AppLanguage): string | null {
  if (seconds == null) return null;
  const duration = formatDuration(Math.max(1, Math.round(seconds / 60)), lng);
  if (meters == null) return duration;
  return i18n.t('share:timeline.travel', { lng, duration, distance: formatDistance(meters, lng) });
}

/** True when the leg's time is an estimate (rendered with "≈"). */
export function isEstimatedSharedLeg(leg: SharedTripLeg): boolean {
  return leg.source != null && isEstimatedLeg({ source: leg.source });
}

export function formatVisit(minutes: number | null | undefined, lng?: AppLanguage): string | null {
  if (!minutes || minutes <= 0) return null;
  return formatDuration(minutes, lng);
}
