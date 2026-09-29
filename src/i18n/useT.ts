/**
 * `useT` — react-i18next's `useTranslation` (same typed keys and options),
 * made safe for hydrating the web static export.
 *
 * `expo export` prerenders every page in English. While a component hydrates
 * over that HTML it must render English too, whatever the visitor's language,
 * or React throws #418 and client-renders the page from scratch. So during
 * hydration `useT` pins `lng` to the prerender language, and the component
 * re-renders in the app language right after it hydrates (`useIsHydrating`).
 * An explicit `lng` option always wins. Native and the dev server never
 * hydrate, so there this is plain `useTranslation`.
 */
import { useTranslation } from 'react-i18next';
import { useIsHydrating } from '@/hooks/useIsHydrating';
import { STATIC_RENDER_LANGUAGE } from './instance';

type UseTranslationArgs = Parameters<typeof useTranslation>;

function useHydrationSafeTranslation(ns?: UseTranslationArgs[0], options?: UseTranslationArgs[1]) {
  const hydrating = useIsHydrating();
  const pinned = hydrating && !options?.lng ? { ...options, lng: STATIC_RENDER_LANGUAGE } : options;
  return useTranslation(ns, pinned);
}

// Same call signature and key typing as `useTranslation`; only the language
// used during hydration differs.
export const useT = useHydrationSafeTranslation as typeof useTranslation;
