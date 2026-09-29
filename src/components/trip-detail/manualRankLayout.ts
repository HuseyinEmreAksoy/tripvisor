/**
 * Moved verbatim out of app/(app)/trip/[id]/index.tsx (M5 Y2.4, file-size
 * rule); the route shell keys its auto-optimize on it.
 */
import { orderPlacesForDisplay, type TripPlace } from '@/api';

/**
 * v2 S2.8.7: the flag-on manual-mode layout key — per scheduled day, the
 * rank-ordered place-id chain (via orderPlacesForDisplay, the same canonical
 * rule ItineraryTab renders with and optimize-trip's manual branch persists
 * from). Ideas (day_index NULL) are excluded: the optimizer skips them, so
 * their internal order can never affect legs (entering/leaving Ideas still
 * changes a day's chain, which is what matters). Derived from the id
 * SEQUENCE only — never from order_in_day values — so the optimizer writing
 * derived order_in_day back cannot re-change the key (auto-optimize loop
 * guard). Output is deterministic: days ascending, ids joined in display
 * order.
 */
export function manualRankLayout(places: TripPlace[]): string[] {
  const ordered = orderPlacesForDisplay(places, 'manual', true);
  const chains = new Map<number, string[]>();
  for (const p of ordered) {
    if (p.day_index === null) continue;
    const chain = chains.get(p.day_index);
    if (chain) chain.push(p.id);
    else chains.set(p.day_index, [p.id]);
  }
  return [...chains.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, ids]) => `${day}:${ids.join('>')}`);
}
