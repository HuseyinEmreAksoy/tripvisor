/**
 * shareSheet.web.ts — browser share helpers.
 *
 * - `shareLink` uses the Web Share API (`navigator.share`) where available
 *   (mobile Safari/Chrome, some desktop browsers) and falls back to copying
 *   the link to the clipboard everywhere else.
 * - `buildAppUrl` uses the page's own origin so links always point at the
 *   deployment the user is on.
 *
 * The native counterpart is shareSheet.native.ts. Consumers import './shareSheet'.
 */
import { copyToClipboard } from '@/lib/clipboard';
import { joinUrl, type ShareLinkInput, type ShareOutcome, type ShareUrlResult } from './shareSheet.types';

export type { ShareLinkInput, ShareOutcome, ShareUrlResult } from './shareSheet.types';

export async function shareLink({ url, title, message }: ShareLinkInput): Promise<ShareOutcome> {
  const nav: Navigator | undefined = typeof navigator !== 'undefined' ? navigator : undefined;
  const data: ShareData = { title, text: message, url };
  const canShare =
    typeof nav?.share === 'function' && (typeof nav.canShare !== 'function' || nav.canShare(data));
  if (nav && canShare) {
    try {
      await nav.share(data);
      return 'shared';
    } catch (err) {
      // AbortError = the user closed the sheet. Anything else (NotAllowedError
      // outside a user gesture, unsupported payload) → fall back to copying.
      if (err instanceof Error && err.name === 'AbortError') return 'dismissed';
    }
  }
  return (await copyToClipboard(url)) ? 'copied' : 'failed';
}

/** Absolute URL for an in-app path such as `share/<token>`. */
export function buildAppUrl(path: string): ShareUrlResult {
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
  return { url: joinUrl(origin, path), usingDeepLink: false };
}
