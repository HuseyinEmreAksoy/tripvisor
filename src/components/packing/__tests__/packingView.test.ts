import { describe, expect, it } from '@jest/globals';
import type { TripPackingItem } from '@/api';
import { groupPackingItems } from '../groupPackingItems';
import { pendingSuggestions, viewPackingGroups } from '../packingView';

function item(label: string, category: string | null, checked = false): TripPackingItem {
  return {
    id: label,
    trip_id: 't1',
    label,
    category,
    checked,
    auto: false,
    created_at: '2026-01-01T00:00:00Z',
  } as TripPackingItem;
}

describe('viewPackingGroups', () => {
  const groups = groupPackingItems([
    item('Passport', 'essentials', true),
    item('Charger', 'electronics', true),
    item('Socks', 'clothing'),
    item('Shirt', 'clothing', true),
  ]);

  it('reports packed/total per group', () => {
    const view = viewPackingGroups(groups, false);
    const clothing = view.find((g) => g.key === 'clothing');
    expect(clothing?.packed).toBe(1);
    expect(clothing?.total).toBe(2);
    expect(clothing?.visible.map((i) => i.label)).toEqual(['Socks', 'Shirt']);
  });

  it('hides packed items and fully-packed groups', () => {
    const view = viewPackingGroups(groups, true);
    expect(view.map((g) => g.key)).toEqual(['clothing']);
    expect(view[0]?.visible.map((i) => i.label)).toEqual(['Socks']);
    // Progress still counts the hidden packed item.
    expect(view[0]?.packed).toBe(1);
  });
});

describe('pendingSuggestions', () => {
  const seed = [
    { label: 'Passport', category: 'essentials' },
    { label: 'Sunscreen', category: 'toiletries' },
    { label: 'Umbrella', category: 'rain gear' },
    { label: 'sunscreen', category: 'toiletries' },
  ];

  it('drops labels already on the list (case-insensitive) and duplicates', () => {
    const out = pendingSuggestions(seed, [{ label: ' passport ' }]);
    expect(out.map((s) => s.label)).toEqual(['Sunscreen', 'Umbrella']);
  });

  it('respects the limit', () => {
    expect(pendingSuggestions(seed, [], 1).map((s) => s.label)).toEqual(['Passport']);
  });
});
