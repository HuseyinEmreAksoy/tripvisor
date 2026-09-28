/**
 * shareSheet.native.ts — iOS / Android share helpers.
 *
 * - `shareLink` opens the OS share sheet via React Native's `Share.share`.
 *   Android ignores `url`, so the link is appended to the message there.
 * - `buildAppUrl` prefers EXPO_PUBLIC_APP_URL (a real HTTPS origin, so the
 *   recipient can open it in any browser) and falls back to the live web
 *   origin (DEFAULT_APP_URL) when it is unset — never the custom scheme,
 *   which only works for recipients who already have the app installed.
 *
 * The web counterpart is shareSheet.web.ts. Consumers import './shareSheet'.
 */
import { Platform, Share } from 'react-native';
import { DEFAULT_APP_URL, joinUrl, type ShareLinkInput, type ShareOutcome, type ShareUrlResult } from './shareSheet.types';

export type { ShareLinkInput, ShareOutcome, ShareUrlResult } from './shareSheet.types';

export async function shareLink({ url, title, message }: ShareLinkInput): Promise<ShareOutcome> {
  try {
    const result = await Share.share(
      Platform.OS === 'ios'
        ? { title, message, url }
        : { title, message: `${message}\n${url}` },
      { subject: title, dialogTitle: title },
    );
    return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch {
    return 'failed';
  }
}

function configuredAppUrl(): string | undefined {
  // Static read so Expo inlines it at build time; the optional-chained read is
  // the dev/jest fallback (release bundles have no runtime process.env).
  const raw =
    process.env.EXPO_PUBLIC_APP_URL ??
    (typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_APP_URL : undefined);
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/** Absolute URL for an in-app path such as `share/<token>`. */
export function buildAppUrl(path: string): ShareUrlResult {
  const appUrl = configuredAppUrl() ?? DEFAULT_APP_URL;
  return { url: joinUrl(appUrl, path), usingDeepLink: false };
}
