/**
 * Pure timeline helpers for the memories screen (M5 Y3.1).
 */
import { toDate } from '@/i18n/format';
import type { MemoryDayGroup } from '@/api/memories.types';

/** Every trip day (0..n-1) gets a section; memory groups fill them; undated last. */
export function mergeTripDays(groups: readonly MemoryDayGroup[], dayCount: number): MemoryDayGroup[] {
  const byDay = new Map<number | null, MemoryDayGroup>();
  for (const g of groups) byDay.set(g.dayIndex, g);
  const out: MemoryDayGroup[] = [];
  const maxDay = Math.max(dayCount - 1, ...groups.map((g) => g.dayIndex ?? -1));
  for (let d = 0; d <= maxDay; d++) out.push(byDay.get(d) ?? { dayIndex: d, items: [] });
  const undated = byDay.get(null);
  if (undated && undated.items.length > 0) out.push(undated);
  return out;
}

/** Inclusive day count of a dated trip (0 without both dates). */
export function tripDayCount(start: string | null | undefined, end: string | null | undefined): number {
  const s = toDate(start ?? null);
  const e = toDate(end ?? null);
  if (!s || !e) return 0;
  return Math.max(0, Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1);
}

/** The local calendar date of a 0-based trip day. */
export function dayDate(start: string | null | undefined, dayIndex: number | null): Date | null {
  const s = toDate(start ?? null);
  if (!s || dayIndex === null) return null;
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() + dayIndex);
}
