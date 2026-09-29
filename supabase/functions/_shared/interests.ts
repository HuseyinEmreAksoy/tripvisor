// _shared/interests.ts: the interest -> OpenStreetMap tag map behind
// poi-recommend (ADR-0013 §2, M5 Y1.3).
//
// Pure data + pure functions: no Deno globals, no URL imports, no I/O, so
// the repo-level tsc checks this file like any other module and both the
// Edge Function and its Deno tests share one source of truth.
//
// One interest = a list of TagFilters. A filter matches an OSM element when
// ALL of its conditions hold (AND); an interest matches when ANY of its
// filters does (OR). Every Overpass statement also requires `name` (only
// named features are recommended, ADR-0013 §2), which the query builder adds.
//
// Weights (0..1) feed the "tag weight" term of the ranking in
// poi-recommend/rank.ts: notability (wikidata/wikipedia) > distance > tag
// weight. They express "how likely is this a thing a traveller would go out of
// their way for": a castle beats a memorial plaque, a nightclub beats a pub.
//
// Tuning is a redeploy, not a migration: poi_cache keys carry TAGMAP_VERSION,
// so bumping it after a filter change makes every tile refetch lazily instead
// of serving results computed with the old map.

export const INTERESTS = [
  'history',
  'food',
  'nature',
  'museums',
  'nightlife',
  'shopping',
  'kids',
  'viewpoints',
] as const;

export type Interest = (typeof INTERESTS)[number];

/** Bump when INTEREST_FILTERS changes in a way cached tiles should not survive. */
export const TAGMAP_VERSION = 1;

/**
 * One tag condition value:
 *   'x'           the tag equals 'x'
 *   ['a', 'b']    the tag equals one of the values
 *   true          the tag is present with any value
 */
export type TagCondition = string | readonly string[] | true;

export interface TagFilter {
  /** All conditions must hold (AND). */
  readonly tags: Readonly<Record<string, TagCondition>>;
  /** Ranking weight, 0..1. */
  readonly weight: number;
}

export const INTEREST_FILTERS: Readonly<Record<Interest, readonly TagFilter[]>> = {
  history: [
    {
      tags: {
        historic: ['castle', 'palace', 'fort', 'archaeological_site', 'city_gate', 'citywalls', 'aqueduct'],
      },
      weight: 0.9,
    },
    {
      tags: { historic: ['ruins', 'monument', 'monastery', 'church', 'mosque', 'tomb', 'tower', 'building'] },
      weight: 0.6,
    },
    { tags: { historic: 'memorial' }, weight: 0.3 },
    { tags: { tourism: 'museum', museum: ['history', 'archaeological'] }, weight: 0.8 },
    // Landmarks whose `historic` value is outside the lists above (Istanbul's
    // Basilica Cistern is historic=cistern + tourism=attraction).
    { tags: { tourism: 'attraction', historic: true }, weight: 0.8 },
    // Landmark temples are often tagged as places of worship + attraction
    // rather than `historic=*` (Hagia Sophia, many cathedrals).
    { tags: { amenity: 'place_of_worship', tourism: 'attraction' }, weight: 0.8 },
    { tags: { tourism: 'attraction', heritage: true }, weight: 0.7 },
  ],
  food: [
    { tags: { amenity: 'restaurant' }, weight: 0.7 },
    { tags: { amenity: 'marketplace' }, weight: 0.6 },
    { tags: { amenity: ['cafe', 'ice_cream'] }, weight: 0.5 },
    { tags: { amenity: 'food_court' }, weight: 0.4 },
  ],
  nature: [
    { tags: { boundary: 'national_park' }, weight: 0.9 },
    { tags: { natural: ['beach', 'peak', 'waterfall', 'cave_entrance'] }, weight: 0.8 },
    { tags: { leisure: 'nature_reserve' }, weight: 0.8 },
    { tags: { leisure: ['park', 'garden'] }, weight: 0.6 },
  ],
  museums: [
    { tags: { tourism: ['museum', 'gallery'] }, weight: 0.9 },
    { tags: { amenity: ['theatre', 'arts_centre'] }, weight: 0.6 },
    { tags: { tourism: 'artwork' }, weight: 0.4 },
  ],
  nightlife: [
    { tags: { amenity: 'nightclub' }, weight: 0.7 },
    { tags: { amenity: ['bar', 'pub', 'biergarten'] }, weight: 0.6 },
  ],
  shopping: [
    { tags: { amenity: 'marketplace' }, weight: 0.8 },
    { tags: { shop: ['mall', 'department_store'] }, weight: 0.7 },
    { tags: { shop: ['gift', 'craft'] }, weight: 0.4 },
  ],
  kids: [
    { tags: { tourism: ['zoo', 'aquarium', 'theme_park'] }, weight: 0.9 },
    { tags: { leisure: 'water_park' }, weight: 0.8 },
    { tags: { leisure: 'playground' }, weight: 0.3 },
  ],
  viewpoints: [
    { tags: { man_made: 'tower', 'tower:type': 'observation' }, weight: 0.9 },
    { tags: { tourism: 'viewpoint' }, weight: 0.8 },
  ],
};

export function isInterest(v: unknown): v is Interest {
  return typeof v === 'string' && (INTERESTS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Local matching (classifying elements Overpass returned)
// ---------------------------------------------------------------------------

function conditionHolds(value: string | undefined, cond: TagCondition): boolean {
  if (value === undefined) return false;
  if (cond === true) return true;
  if (typeof cond === 'string') return value === cond;
  return cond.includes(value);
}

export function filterMatches(tags: Readonly<Record<string, string>>, filter: TagFilter): boolean {
  for (const [key, cond] of Object.entries(filter.tags)) {
    if (!conditionHolds(tags[key], cond)) return false;
  }
  return true;
}

/**
 * Best (max) filter weight of `interest` for these tags, or 0 when no filter
 * matches. Requires a non-empty `name`, like the Overpass statements.
 */
export function interestWeight(tags: Readonly<Record<string, string>>, interest: Interest): number {
  if (!tags.name) return 0;
  let best = 0;
  for (const f of INTEREST_FILTERS[interest]) {
    if (f.weight > best && filterMatches(tags, f)) best = f.weight;
  }
  return best;
}

/** Every interest these tags match, with its weight (empty when none). */
export function matchInterests(
  tags: Readonly<Record<string, string>>,
  among: readonly Interest[] = INTERESTS,
): Array<{ interest: Interest; weight: number }> {
  const out: Array<{ interest: Interest; weight: number }> = [];
  for (const interest of among) {
    const weight = interestWeight(tags, interest);
    if (weight > 0) out.push({ interest, weight });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Overpass QL fragments
// ---------------------------------------------------------------------------

/** Escape a string for an Overpass QL double-quoted literal. */
export function qlString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Escape regex metacharacters (values are constants, but stay defensive). */
function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `["k"="v"]`, `["k"~"^(a|b)$"]` or `["k"]` for one condition. */
export function qlCondition(key: string, cond: TagCondition): string {
  if (cond === true) return `[${qlString(key)}]`;
  if (typeof cond === 'string') return `[${qlString(key)}=${qlString(cond)}]`;
  if (cond.length === 1) return `[${qlString(key)}=${qlString(cond[0]!)}]`;
  return `[${qlString(key)}~${qlString(`^(${cond.map(reEscape).join('|')})$`)}]`;
}

/**
 * The tag-filter part of one `nwr` statement per filter of `interest`,
 * each already requiring `name`. The caller appends the bbox.
 */
export function qlFiltersFor(interest: Interest): string[] {
  return INTEREST_FILTERS[interest].map(
    (f) =>
      Object.entries(f.tags)
        .map(([k, c]) => qlCondition(k, c))
        .join('') + '["name"]',
  );
}
