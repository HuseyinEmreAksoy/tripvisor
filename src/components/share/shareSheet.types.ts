/**
 * shareSheet.types.ts — shared contract for the platform-split share helpers
 * (`shareSheet.native.ts` / `shareSheet.web.ts`). No platform code here.
 */

export interface ShareLinkInput {
  /** The link being shared (public trip link or collaborator invite link). */
  url: string;
  /** Short title — used as the share-sheet subject / email subject. */
  title: string;
  /** One-line message that accompanies the link. */
  message: string;
}

/**
 * - `shared`    the OS share sheet completed (or the platform can't tell us)
 * - `copied`    no share sheet available → link copied to the clipboard
 * - `dismissed` user closed the share sheet without picking a target
 * - `failed`    neither sharing nor copying worked
 */
export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'failed';

export interface ShareUrlResult {
  url: string;
  /**
   * True when the `tripvisor://` deep link was used instead of a public web
   * origin. Kept for API compatibility: native now falls back to
   * DEFAULT_APP_URL, so both platforms currently always return false.
   */
  usingDeepLink: boolean;
}

/**
 * Public web origin used on native when EXPO_PUBLIC_APP_URL is not baked into
 * the build, so shared links always open in any browser (and the Pages
 * Function can serve per-trip link previews) instead of a custom scheme.
 */
export const DEFAULT_APP_URL = 'https://tripvisor.pages.dev';

/** Pure: joins an origin and a path without doubling slashes. */
export function joinUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
