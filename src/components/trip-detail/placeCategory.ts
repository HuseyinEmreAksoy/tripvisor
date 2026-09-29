/**
 * Place categories on itinerary rows (M5 Y2.4). `trip_places.category` holds
 * either a machine code from inferCategoryDefault (`tourist_attraction`,
 * `religious_site`) or a free-text label from the AI planner ("Seaside
 * Promenade"). Two views of it:
 *   - categoryIcon: the PlaceThumb tile icon (keyword match, any language-
 *     neutral code or English label; unknown → map pin);
 *   - useCategoryLabel: the row's text — machine codes translated
 *     (`trip:category.*`), free text as written, none → "Unclassified".
 */
import type { IconName } from '@/components/Icon';
import { useT } from '@/i18n';

/** Category (machine code or AI label, any case) → tile icon. Exported for tests. */
const CATEGORY_ICONS: Array<[RegExp, IconName]> = [
  [/zoo|animal|wildlife/, 'paw-print'],
  [/family|kids|amusement|theme park/, 'ferris-wheel'],
  [/museum|gallery|\bart\b|exhibit/, 'landmark'],
  [/religious|mosque|church|cathedral|temple|synagogue|shrine/, 'landmark'],
  [/castle|fort|palace|archaeolog|ruin|historic|ancient|monument/, 'castle'],
  [/restaurant|food|dining|meyhane|lokanta|bakery|kitchen/, 'utensils'],
  [/café|\bcafe|coffee|\btea\b/, 'coffee'],
  [/\bbar\b|night|club|\bpub\b|wine|brew/, 'wine'],
  [/beach|\bsea|coast|promenade|harbou?r|lake|river|waterfront|aquarium/, 'waves'],
  [/park|garden|nature|forest|trail|hike/, 'trees'],
  [/viewpoint|\bview|lookout|panoram|scenic/, 'binoculars'],
  [/shop|market|bazaar|mall|store|souvenir/, 'shopping-bag'],
  [/hotel|lodging|hostel|\bstay/, 'bed'],
  [/airport|flight/, 'plane'],
  [/station|transport|transit|train|metro|\bbus\b|ferry|\bport\b/, 'train-front'],
  [/attraction|landmark|sight|tourist/, 'camera'],
];

export function categoryIcon(category: string | null | undefined): IconName {
  const c = (category ?? '').toLowerCase().replace(/_/g, ' ');
  for (const [re, icon] of CATEGORY_ICONS) if (re.test(c)) return icon;
  return 'map-pin';
}

/** Known machine category codes → `trip:category.*` keys. */
const CATEGORY_KEYS = {
  museum: 'category.museum',
  restaurant: 'category.restaurant',
  nightlife: 'category.nightlife',
  park: 'category.park',
  religious_site: 'category.religious_site',
  attraction: 'category.attraction',
  tourist_attraction: 'category.attraction',
  shopping: 'category.shopping',
  family_attraction: 'category.family_attraction',
  hotel: 'category.hotel',
  nature: 'category.nature',
  general: 'category.general',
} as const;

/**
 * A row's category label: machine codes (`tourist_attraction`) are
 * translated; free-text labels from the AI planner ("Seaside Promenade")
 * show as written; none → "Unclassified".
 */
export function useCategoryLabel(category: string | null | undefined): string {
  const { t: tx } = useT('trip');
  if (!category) return tx('category.none');
  const key = CATEGORY_KEYS[category as keyof typeof CATEGORY_KEYS];
  return key ? tx(key) : category;
}
