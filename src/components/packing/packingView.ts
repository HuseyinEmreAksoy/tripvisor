/**
 * packingView — pure view-model helpers for the packing screen (v2 M4 X2.4).
 * NO hooks, NO network — unit-test friendly.
 */
import type { TripPackingItem } from '@/api';
import type { PackingSeedItem } from '@/lib/packingSeed';
import type { PackingGroup } from './groupPackingItems';

export interface PackingGroupView extends PackingGroup {
  /** Items to render (packed ones removed when hiding packed). */
  visible: TripPackingItem[];
  packed: number;
  total: number;
}

/**
 * Attach per-group progress and apply the "hide packed" filter. With
 * `hidePacked`, groups whose items are all packed drop out entirely.
 */
export function viewPackingGroups(groups: ReadonlyArray<PackingGroup>, hidePacked: boolean): PackingGroupView[] {
  return groups
    .map((g) => {
      const packed = g.items.filter((i) => i.checked).length;
      return {
        ...g,
        packed,
        total: g.items.length,
        visible: hidePacked ? g.items.filter((i) => !i.checked) : g.items,
      };
    })
    .filter((g) => g.visible.length > 0);
}

/**
 * Seed suggestions not already on the list (case-insensitive label match),
 * in seed order, capped at `limit`.
 */
export function pendingSuggestions(
  seed: ReadonlyArray<PackingSeedItem>,
  items: ReadonlyArray<Pick<TripPackingItem, 'label'>>,
  limit = Infinity,
): PackingSeedItem[] {
  const existing = new Set(items.map((i) => i.label.trim().toLowerCase()));
  const seen = new Set<string>();
  const out: PackingSeedItem[] = [];
  for (const s of seed) {
    const key = s.label.trim().toLowerCase();
    if (existing.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}
