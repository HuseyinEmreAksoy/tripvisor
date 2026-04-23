export interface CategoryDefault {
  category: string;
  durationMinutes: number;
}

const RULES: Array<{ test: (types: string[]) => boolean; category: string; minutes: number }> = [
  { test: (t) => t.includes('museum') || t.includes('art_gallery'), category: 'museum', minutes: 120 },
  { test: (t) => t.includes('restaurant') || t.includes('cafe'), category: 'restaurant', minutes: 90 },
  { test: (t) => t.includes('bar') || t.includes('night_club'), category: 'nightlife', minutes: 90 },
  { test: (t) => t.includes('park') || t.includes('garden'), category: 'park', minutes: 60 },
  {
    test: (t) =>
      t.includes('church') || t.includes('mosque') || t.includes('synagogue') || t.includes('hindu_temple'),
    category: 'religious_site',
    minutes: 45,
  },
  { test: (t) => t.includes('tourist_attraction') || t.includes('landmark'), category: 'attraction', minutes: 75 },
  { test: (t) => t.includes('shopping_mall') || t.includes('store'), category: 'shopping', minutes: 60 },
  { test: (t) => t.includes('zoo') || t.includes('aquarium'), category: 'family_attraction', minutes: 120 },
  { test: (t) => t.includes('lodging'), category: 'hotel', minutes: 30 },
  {
    test: (t) =>
      t.includes('natural_feature') || t.includes('point_of_interest_natural') || t.includes('beach'),
    category: 'nature',
    minutes: 90,
  },
];

export function inferCategoryDefault(types: string[]): CategoryDefault {
  for (const rule of RULES) {
    if (rule.test(types)) return { category: rule.category, durationMinutes: rule.minutes };
  }
  return { category: 'general', durationMinutes: 60 };
}
