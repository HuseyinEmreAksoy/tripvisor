import { inferCategoryDefault } from '../categoryDurations';

describe('inferCategoryDefault', () => {
  const cases: Array<{ name: string; types: string[]; category: string; minutes: number }> = [
    { name: 'museum', types: ['museum', 'point_of_interest'], category: 'museum', minutes: 120 },
    { name: 'art gallery', types: ['art_gallery'], category: 'museum', minutes: 120 },
    { name: 'restaurant', types: ['restaurant', 'food'], category: 'restaurant', minutes: 90 },
    { name: 'cafe', types: ['cafe'], category: 'restaurant', minutes: 90 },
    { name: 'park', types: ['park'], category: 'park', minutes: 60 },
    { name: 'church', types: ['church', 'place_of_worship'], category: 'religious_site', minutes: 45 },
    { name: 'landmark', types: ['tourist_attraction', 'landmark'], category: 'attraction', minutes: 75 },
    { name: 'shopping', types: ['shopping_mall'], category: 'shopping', minutes: 60 },
    { name: 'zoo', types: ['zoo'], category: 'family_attraction', minutes: 120 },
    { name: 'beach', types: ['beach', 'natural_feature'], category: 'nature', minutes: 90 },
    { name: 'hotel', types: ['lodging'], category: 'hotel', minutes: 30 },
    { name: 'unknown', types: ['ferry_terminal'], category: 'general', minutes: 60 },
    { name: 'empty', types: [], category: 'general', minutes: 60 },
  ];

  it.each(cases)('classifies $name as $category ($minutes min)', ({ types, category, minutes }) => {
    const result = inferCategoryDefault(types);
    expect(result.category).toBe(category);
    expect(result.durationMinutes).toBe(minutes);
  });

  it('prefers museum rule over tourist_attraction when both present', () => {
    expect(inferCategoryDefault(['museum', 'tourist_attraction']).category).toBe('museum');
  });
});
