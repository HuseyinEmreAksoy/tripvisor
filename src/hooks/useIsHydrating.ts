/**
 * useIsHydrating — true only while React hydrates the calling component over
 * HTML prerendered by the web static export (`expo export`, web output
 * "static"), and during that prerender itself. False on native, on the web
 * dev server, and in every render after the component has hydrated.
 *
 * Why: the static HTML is rendered in Node with no window, no storage and
 * English. Anything that differs in the browser (app language, window width,
 * stored settings) must render the prerender's value while hydrating, or
 * React throws #418 and throws the server HTML away. React re-renders the
 * caller right after its hydration commits, so it can switch to the real
 * value then. This works per component, so it also covers the route
 * `<Suspense>` boundaries Expo Router adds, which hydrate in later passes.
 *
 * Built on the documented `useSyncExternalStore` contract: React reads
 * `getServerSnapshot` on the server and during hydration only, then
 * re-renders when `getSnapshot` differs.
 */
import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const afterHydration = () => false;
const duringHydration = () => true;

export function useIsHydrating(): boolean {
  return useSyncExternalStore(subscribe, afterHydration, duringHydration);
}
