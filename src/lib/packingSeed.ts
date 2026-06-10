// Tripvisor v2 Phase P2 (BUILD-LOG P2.2) — pure packing-list seed template.
//
// PURE function, NO network, NO dates-now, NO randomness — trivially
// unit-testable and shared by whatever surface seeds a checklist (today the
// packing screen's "Seed my list" action; later perhaps the AI plan flow).
// The caller persists the result via `useCreateTripPackingItems` (bulk
// insert, `auto: true`).
//
// Inputs are deliberately minimal:
//   - startMonth + days  — derivable offline from the trip row alone,
//   - hasRainyDay        — the caller computes it from `useDayWeather` data
//                          via `isRainy()` when a forecast exists; the seed
//                          itself never touches the network.
//
// SIMPLIFICATION (documented, accepted): season buckets assume the NORTHERN
// hemisphere (Dec–Feb = winter, Jun–Aug = summer). A Sydney December trip
// gets winter clothing suggestions — wrong, but editable in one tap, and we
// have no reliable hemisphere signal until a destination lat is threaded
// through. Revisit if/when the caller passes the trip anchor's latitude.

export interface PackingSeedOptions {
  /** Trip start month, 1–12 (i.e. `Date#getMonth() + 1`). */
  startMonth: number;
  /** Trip length in days (>= 1). */
  days: number;
  /** True when at least one forecast day is rainy (see `isRainy` in src/api/weather.ts). */
  hasRainyDay?: boolean;
  /**
   * Restrict the output to these categories (case-insensitive match against
   * PACKING_SEED_CATEGORIES). Default: all categories.
   */
  categories?: string[];
}

export interface PackingSeedItem {
  label: string;
  category: string;
}

/** Canonical seed categories, in display order. */
export const PACKING_SEED_CATEGORIES = [
  'essentials',
  'clothing',
  'toiletries',
  'electronics',
  'rain gear',
] as const;

export type PackingSeedCategory = (typeof PACKING_SEED_CATEGORIES)[number];

/** Hard ceiling on seeded items — a checklist, not a homework assignment. */
export const MAX_SEED_ITEMS = 30;

type Season = 'winter' | 'summer' | 'shoulder';

/**
 * Northern-hemisphere season bucket (see the module-header simplification).
 * Out-of-range months are treated as 'shoulder' (fail-soft for bad input).
 * Exported for unit tests.
 */
export function seasonBucket(startMonth: number): Season {
  if (startMonth === 12 || startMonth === 1 || startMonth === 2) return 'winter';
  if (startMonth >= 6 && startMonth <= 8) return 'summer';
  return 'shoulder';
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/**
 * Rule-based packing-list template: ~20–30 deduped items across the
 * categories above.
 *
 * Rules:
 *   - essentials/electronics/toiletries — fixed sensible base set,
 *   - clothing counts scale with trip length (clamped 2..7 — beyond a week
 *     you launder, you don't pack more; trips > 7 days add laundry items),
 *   - season bucket (northern-hemisphere) swaps the outerwear set,
 *   - `hasRainyDay` adds the rain-gear category,
 *   - `categories` filters the output (e.g. seed only 'essentials').
 */
export function seedPackingList(opts: PackingSeedOptions): PackingSeedItem[] {
  const days = clamp(Math.floor(opts.days) || 1, 1, 365);
  const season = seasonBucket(Math.floor(opts.startMonth));
  // Clothing quantity: one per day, floor 2, cap 7 (launder past a week).
  const n = clamp(days, 2, 7);

  const items: PackingSeedItem[] = [];
  const add = (category: PackingSeedCategory, ...labels: string[]) => {
    for (const label of labels) items.push({ label, category });
  };

  // --- essentials ---------------------------------------------------------
  add(
    'essentials',
    'Passport / ID',
    'Tickets & reservations (offline copies)',
    'Wallet + bank cards',
    'Travel insurance details',
    'Medications',
    'House / car keys',
  );

  // --- electronics ---------------------------------------------------------
  add('electronics', 'Phone + charger', 'Power bank', 'Travel adapter');

  // --- clothing ------------------------------------------------------------
  add(
    'clothing',
    `Tops / t-shirts (x${n})`,
    `Underwear (x${n})`,
    `Socks (x${n})`,
    'Comfortable walking shoes',
    'Sleepwear',
  );
  if (season === 'winter') {
    add('clothing', 'Warm coat', 'Sweaters / fleece', 'Hat, gloves & scarf', 'Thermal layers');
  } else if (season === 'summer') {
    add('clothing', 'Sunglasses', 'Sun hat / cap', 'Swimwear', 'Light evening layer');
  } else {
    add('clothing', 'Light jacket', 'Layerable sweater');
  }
  if (days > 7) {
    add('clothing', 'Laundry bag', 'Travel detergent');
  }

  // --- toiletries ----------------------------------------------------------
  add(
    'toiletries',
    'Toothbrush & toothpaste',
    'Deodorant',
    'Shampoo / shower gel (travel size)',
    'Hand sanitizer',
  );
  if (season === 'summer') {
    add('toiletries', 'Sunscreen');
  } else if (season === 'winter') {
    add('toiletries', 'Lip balm & moisturizer');
  }

  // --- rain gear (forecast-driven) ------------------------------------------
  if (opts.hasRainyDay) {
    add('rain gear', 'Compact umbrella', 'Rain jacket');
  }

  // --- category filter -------------------------------------------------------
  let result = items;
  if (opts.categories && opts.categories.length > 0) {
    const wanted = new Set(opts.categories.map((c) => c.trim().toLowerCase()));
    result = result.filter((it) => wanted.has(it.category));
  }

  // --- dedupe (case-insensitive by label) + cap -----------------------------
  const seen = new Set<string>();
  const deduped: PackingSeedItem[] = [];
  for (const it of result) {
    const key = it.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(it);
    if (deduped.length >= MAX_SEED_ITEMS) break;
  }
  return deduped;
}
