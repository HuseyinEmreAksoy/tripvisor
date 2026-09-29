/**
 * packingSeed.ts — pure rule-based packing-list template.
 */
import { describe, expect, it } from '@jest/globals';
import {
  MAX_SEED_ITEMS,
  PACKING_SEED_CATEGORIES,
  seasonBucket,
  seedPackingList,
  type PackingSeedItem,
} from '../packingSeed';

const labels = (items: PackingSeedItem[]) => items.map((i) => i.label);
const inCategory = (items: PackingSeedItem[], category: string) =>
  items.filter((i) => i.category === category).map((i) => i.label);

describe('seasonBucket (northern hemisphere)', () => {
  it.each([12, 1, 2])('month %i is winter', (m: number) => {
    expect(seasonBucket(m)).toBe('winter');
  });

  it.each([6, 7, 8])('month %i is summer', (m: number) => {
    expect(seasonBucket(m)).toBe('summer');
  });

  it.each([3, 4, 5, 9, 10, 11])('month %i is shoulder', (m: number) => {
    expect(seasonBucket(m)).toBe('shoulder');
  });

  it.each([0, 13, -1, Number.NaN])('out-of-range month %p fails soft to shoulder', (m: number) => {
    expect(seasonBucket(m)).toBe('shoulder');
  });
});

describe('seedPackingList — base sets', () => {
  it('always includes the essentials, electronics and toiletries base set', () => {
    const items = seedPackingList({ startMonth: 4, days: 3 });
    expect(inCategory(items, 'essentials')).toEqual([
      'Passport / ID',
      'Tickets & reservations (offline copies)',
      'Wallet + bank cards',
      'Travel insurance details',
      'Medications',
      'House / car keys',
    ]);
    expect(inCategory(items, 'electronics')).toEqual(['Phone + charger', 'Power bank', 'Travel adapter']);
    expect(inCategory(items, 'toiletries')).toEqual([
      'Toothbrush & toothpaste',
      'Deodorant',
      'Shampoo / shower gel (travel size)',
      'Hand sanitizer',
    ]);
  });

  it('only emits canonical categories, grouped in insertion order', () => {
    const items = seedPackingList({ startMonth: 7, days: 10, hasRainyDay: true });
    const canonical: readonly string[] = PACKING_SEED_CATEGORIES;
    for (const it of items) expect(canonical).toContain(it.category);
    const order = [...new Set(items.map((i) => i.category))];
    expect(order).toEqual(['essentials', 'electronics', 'clothing', 'toiletries', 'rain gear']);
  });

  it('is deterministic (pure)', () => {
    const opts = { startMonth: 1, days: 5, hasRainyDay: true };
    expect(seedPackingList(opts)).toEqual(seedPackingList(opts));
  });

  it('never returns duplicate labels (case-insensitive)', () => {
    const items = seedPackingList({ startMonth: 12, days: 30, hasRainyDay: true });
    const keys = items.map((i) => i.label.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('seedPackingList — clothing quantity scales with trip length', () => {
  it('floors the per-day count at 2 for short trips', () => {
    const items = seedPackingList({ startMonth: 4, days: 1 });
    expect(labels(items)).toEqual(
      expect.arrayContaining(['Tops / t-shirts (x2)', 'Underwear (x2)', 'Socks (x2)']),
    );
  });

  it('uses one per day between 2 and 7 days', () => {
    const items = seedPackingList({ startMonth: 4, days: 5 });
    expect(labels(items)).toEqual(
      expect.arrayContaining(['Tops / t-shirts (x5)', 'Underwear (x5)', 'Socks (x5)']),
    );
  });

  it('caps at 7 and adds laundry items for trips longer than a week', () => {
    const week = seedPackingList({ startMonth: 4, days: 7 });
    expect(labels(week)).toContain('Tops / t-shirts (x7)');
    expect(labels(week)).not.toContain('Laundry bag');

    const long = seedPackingList({ startMonth: 4, days: 14 });
    expect(labels(long)).toContain('Tops / t-shirts (x7)');
    expect(labels(long)).toEqual(expect.arrayContaining(['Laundry bag', 'Travel detergent']));
    expect(long.find((i) => i.label === 'Laundry bag')?.category).toBe('clothing');
  });

  it('floors fractional days', () => {
    const items = seedPackingList({ startMonth: 4, days: 3.9 });
    expect(labels(items)).toContain('Socks (x3)');
  });

  it('treats 0 / NaN / negative days as a 1-day trip (floor 2 clothing)', () => {
    for (const days of [0, Number.NaN, -5]) {
      const items = seedPackingList({ startMonth: 4, days });
      expect(labels(items)).toContain('Socks (x2)');
      expect(labels(items)).not.toContain('Laundry bag');
    }
  });

  it('clamps absurdly long trips (still x7, still laundry)', () => {
    const items = seedPackingList({ startMonth: 4, days: 10_000 });
    expect(labels(items)).toEqual(expect.arrayContaining(['Socks (x7)', 'Laundry bag']));
  });
});

describe('seedPackingList — season swaps outerwear and toiletries', () => {
  it('winter: warm clothing + lip balm, no summer items', () => {
    const items = seedPackingList({ startMonth: 1, days: 4 });
    expect(inCategory(items, 'clothing')).toEqual(
      expect.arrayContaining(['Warm coat', 'Sweaters / fleece', 'Hat, gloves & scarf', 'Thermal layers']),
    );
    expect(inCategory(items, 'toiletries')).toContain('Lip balm & moisturizer');
    expect(labels(items)).not.toContain('Sunscreen');
    expect(labels(items)).not.toContain('Swimwear');
    expect(labels(items)).not.toContain('Light jacket');
  });

  it('summer: sun items + sunscreen, no winter items', () => {
    const items = seedPackingList({ startMonth: 7, days: 4 });
    expect(inCategory(items, 'clothing')).toEqual(
      expect.arrayContaining(['Sunglasses', 'Sun hat / cap', 'Swimwear', 'Light evening layer']),
    );
    expect(inCategory(items, 'toiletries')).toContain('Sunscreen');
    expect(labels(items)).not.toContain('Warm coat');
    expect(labels(items)).not.toContain('Lip balm & moisturizer');
  });

  it('shoulder: light layers, no seasonal toiletries', () => {
    const items = seedPackingList({ startMonth: 10, days: 4 });
    expect(inCategory(items, 'clothing')).toEqual(
      expect.arrayContaining(['Light jacket', 'Layerable sweater']),
    );
    expect(labels(items)).not.toContain('Sunscreen');
    expect(labels(items)).not.toContain('Lip balm & moisturizer');
    expect(labels(items)).not.toContain('Warm coat');
  });

  it('floors a fractional start month before bucketing', () => {
    const items = seedPackingList({ startMonth: 7.8, days: 4 });
    expect(labels(items)).toContain('Swimwear');
  });

  it('exact item counts per season (short trip, no rain)', () => {
    // 6 essentials + 3 electronics + 5 clothing base + 4 toiletries = 18 base.
    expect(seedPackingList({ startMonth: 1, days: 3 })).toHaveLength(18 + 4 + 1);
    expect(seedPackingList({ startMonth: 7, days: 3 })).toHaveLength(18 + 4 + 1);
    expect(seedPackingList({ startMonth: 4, days: 3 })).toHaveLength(18 + 2);
  });
});

describe('seedPackingList — rain gear', () => {
  it('adds rain gear only when a rainy day is forecast', () => {
    const dry = seedPackingList({ startMonth: 4, days: 3 });
    expect(inCategory(dry, 'rain gear')).toEqual([]);

    const explicitDry = seedPackingList({ startMonth: 4, days: 3, hasRainyDay: false });
    expect(inCategory(explicitDry, 'rain gear')).toEqual([]);

    const wet = seedPackingList({ startMonth: 4, days: 3, hasRainyDay: true });
    expect(inCategory(wet, 'rain gear')).toEqual(['Compact umbrella', 'Rain jacket']);
    expect(wet).toHaveLength(dry.length + 2);
  });
});

describe('seedPackingList — category filter', () => {
  it('restricts output to the requested categories', () => {
    const items = seedPackingList({ startMonth: 4, days: 3, categories: ['essentials'] });
    expect(items).toHaveLength(6);
    expect(items.every((i) => i.category === 'essentials')).toBe(true);
  });

  it('matches categories case-insensitively and ignores surrounding whitespace', () => {
    const items = seedPackingList({
      startMonth: 4,
      days: 3,
      hasRainyDay: true,
      categories: ['  ELECTRONICS ', 'Rain Gear'],
    });
    expect(labels(items)).toEqual(['Phone + charger', 'Power bank', 'Travel adapter', 'Compact umbrella', 'Rain jacket']);
  });

  it('an empty categories array means "all categories"', () => {
    const all = seedPackingList({ startMonth: 4, days: 3 });
    expect(seedPackingList({ startMonth: 4, days: 3, categories: [] })).toEqual(all);
  });

  it('unknown categories yield an empty list', () => {
    expect(seedPackingList({ startMonth: 4, days: 3, categories: ['snacks'] })).toEqual([]);
  });

  it('filtering to rain gear on a dry trip yields nothing', () => {
    expect(seedPackingList({ startMonth: 4, days: 3, categories: ['rain gear'] })).toEqual([]);
  });
});

describe('seedPackingList — cap', () => {
  it('never exceeds MAX_SEED_ITEMS, even for the largest combination', () => {
    // Winter + >7 days + rain is the biggest template: 18 + 4 + 2 + 1 + 2 = 27.
    const items = seedPackingList({ startMonth: 12, days: 21, hasRainyDay: true });
    expect(items.length).toBeLessThanOrEqual(MAX_SEED_ITEMS);
    expect(items).toHaveLength(27);
    expect(MAX_SEED_ITEMS).toBe(30);
  });
});
