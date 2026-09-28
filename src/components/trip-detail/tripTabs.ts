/**
 * Trip detail tabs (v2 M4 X2.2). The active tab lives in the route's
 * `?tab=` param so back navigation and deep links keep it.
 */
export type TripTabKey = 'plan' | 'map' | 'trip';

/** `?tab=` → tab key. Accepts the pre-X2.2 names so old links still land. */
export function parseTripTab(value: string | string[] | undefined): TripTabKey | null {
  const v = Array.isArray(value) ? value[0] : value;
  switch (v) {
    case 'plan':
    case 'itinerary':
      return 'plan';
    case 'map':
      return 'map';
    case 'trip':
    case 'settings':
      return 'trip';
    default:
      return null;
  }
}

/** The tab to show: the URL's choice, else Plan when there are places, else Map. */
export function resolveTripTab(param: string | string[] | undefined, placesCount: number): TripTabKey {
  return parseTripTab(param) ?? (placesCount > 0 ? 'plan' : 'map');
}
