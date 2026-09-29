/**
 * The Google place a Discover card resolves to (M5 Y3.4), via the api-layer
 * `resolvePoiGooglePlace` (ONE metered places-autocomplete call). Memory-only:
 * the key sits under the 'recommendations' root, which the TanStack persister
 * never writes to disk. Resolved once per card per language (1 h fresh), and
 * the result is handed to `useAddPoiToTrip` as `match`, so "open → add"
 * costs one search, not two.
 */
import { useQuery } from '@tanstack/react-query';
import { requestLang } from '@/api/_lang';
import {
  AddPoiError,
  recommendationKeys,
  resolvePoiGooglePlace,
  type PoiGoogleMatch,
  type PoiItem,
} from '@/api/recommendations';

export function useRecGoogleMatch(item: PoiItem | null, sessionToken: string | undefined) {
  const lang = requestLang();
  return useQuery<PoiGoogleMatch, AddPoiError | Error>({
    queryKey: [...recommendationKeys.all, 'google-match', item?.id ?? 'none', lang],
    enabled: item !== null,
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
    queryFn: () => resolvePoiGooglePlace(item!, { sessionToken, lang }),
  });
}
