/**
 * groupPackingItems — pure grouping for the packing checklist
 * (v2 Phase P2.2). NO hooks, NO network — unit-test friendly.
 *
 * Group order: the canonical seed categories first, in their display order
 * (essentials → clothing → toiletries → electronics → rain gear), then any
 * user-invented categories alphabetically, then the null-category bucket
 * ("Other") last. Items inside a group keep the order the API delivered
 * (created_at then label — see src/api/trip-packing.ts).
 */
import type { TripPackingItem } from '@/api';
import { PACKING_SEED_CATEGORIES } from '@/lib/packingSeed';

export const OTHER_CATEGORY_KEY = 'other';

export interface PackingGroup {
  /** Normalized category key (lowercase; 'other' for null/blank). */
  key: string;
  /** Display title ("Essentials", "Rain gear", "Other"). */
  title: string;
  items: TripPackingItem[];
}

/** Lowercased, trimmed category; null/blank collapse to 'other'. */
export function normalizeCategory(category: string | null): string {
  const c = category?.trim().toLowerCase();
  return c && c.length > 0 ? c : OTHER_CATEGORY_KEY;
}

/** 'rain gear' → 'Rain gear'. */
export function categoryTitle(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function groupPackingItems(items: ReadonlyArray<TripPackingItem>): PackingGroup[] {
  const buckets = new Map<string, TripPackingItem[]>();
  for (const item of items) {
    const key = normalizeCategory(item.category);
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }

  const orderedKeys: string[] = [];
  // 1. Canonical seed categories, in display order.
  for (const seed of PACKING_SEED_CATEGORIES) {
    if (buckets.has(seed)) orderedKeys.push(seed);
  }
  // 2. User-invented categories, alphabetically.
  const seedSet = new Set<string>(PACKING_SEED_CATEGORIES);
  const custom = [...buckets.keys()]
    .filter((k) => !seedSet.has(k) && k !== OTHER_CATEGORY_KEY)
    .sort((a, b) => a.localeCompare(b));
  orderedKeys.push(...custom);
  // 3. Uncategorized last.
  if (buckets.has(OTHER_CATEGORY_KEY)) orderedKeys.push(OTHER_CATEGORY_KEY);

  return orderedKeys.map((key) => ({
    key,
    title: categoryTitle(key),
    // buckets.get is guaranteed by construction; the ?? [] keeps tsc happy.
    items: buckets.get(key) ?? [],
  }));
}
