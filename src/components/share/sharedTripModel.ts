/**
 * sharedTripModel.ts — pure helpers for the public share page
 * (`app/share/[token].tsx`). No React, no platform code.
 *
 * Only Tier-1 trip fields are used (titles, coordinates, durations, day
 * assignment, user notes). `google_place_id` is never rendered.
 */
import type { SharedTrip } from '@/api/types';

export type SharedTripPlace = SharedTrip['places'][number];
export type SharedTripLeg = SharedTrip['legs'][number];

/** Day key: 'all' for the overview tab, else the day index (-1 = unscheduled). */
export type DayKey = 'all' | number;

export interface DaySection {
  dayIndex: number;
  places: SharedTripPlace[];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

function parseIsoDate(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** "Mon 3 Nov" for trip day `dayIndex`, or null when the trip has no start date. */
export function dayDateLabel(startDate: string | null | undefined, dayIndex: number): string | null {
  const start = parseIsoDate(startDate);
  if (start == null || dayIndex < 0) return null;
  const d = new Date(start + dayIndex * 86_400_000);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "3–7 Nov 2026" / "30 Oct – 2 Nov 2026" / "Dates not set". */
export function formatTripRange(start: string | null, end: string | null): string {
  const s = parseIsoDate(start);
  const e = parseIsoDate(end);
  const fmt = (ms: number, withYear: boolean, withMonth = true) => {
    const d = new Date(ms);
    return [d.getUTCDate(), withMonth ? MONTHS[d.getUTCMonth()] : null, withYear ? d.getUTCFullYear() : null]
      .filter((x) => x != null)
      .join(' ');
  };
  if (s != null && e != null) {
    const ds = new Date(s);
    const de = new Date(e);
    if (s === e) return fmt(s, true);
    if (ds.getUTCFullYear() !== de.getUTCFullYear()) return `${fmt(s, true)} – ${fmt(e, true)}`;
    if (ds.getUTCMonth() === de.getUTCMonth()) return `${ds.getUTCDate()}–${fmt(e, true)}`;
    return `${fmt(s, false)} – ${fmt(e, true)}`;
  }
  if (s != null) return `From ${fmt(s, true)}`;
  if (e != null) return `Until ${fmt(e, true)}`;
  return 'Dates not set';
}

/** Inclusive day count from dates, falling back to the highest scheduled day. */
export function tripDayCount(trip: Pick<SharedTrip['trip'], 'start_date' | 'end_date'>, sections: readonly DaySection[]): number {
  const s = parseIsoDate(trip.start_date);
  const e = parseIsoDate(trip.end_date);
  const fromDates = s != null && e != null && e >= s ? Math.round((e - s) / 86_400_000) + 1 : 0;
  const fromPlaces = sections.reduce((max, sec) => Math.max(max, sec.dayIndex + 1), 0);
  return Math.max(fromDates, fromPlaces);
}

export interface DayTab {
  key: DayKey;
  label: string;
  sublabel: string | null;
}

export function buildDayTabs(startDate: string | null, sections: readonly DaySection[]): DayTab[] {
  const tabs: DayTab[] = [{ key: 'all', label: 'Overview', sublabel: null }];
  for (const s of sections) {
    tabs.push(
      s.dayIndex < 0
        ? { key: s.dayIndex, label: 'Unscheduled', sublabel: null }
        : { key: s.dayIndex, label: `Day ${s.dayIndex + 1}`, sublabel: dayDateLabel(startDate, s.dayIndex) },
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

export function formatTravel(seconds: number | null, meters: number | null): string | null {
  if (seconds == null || meters == null) return null;
  const mins = Math.max(1, Math.round(seconds / 60));
  const time = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60 ? `${mins % 60} min` : ''}`.trim() : `${mins} min`;
  const km = meters / 1000;
  return `${time} · ${km.toFixed(km < 10 ? 1 : 0)} km`;
}

export function formatVisit(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
