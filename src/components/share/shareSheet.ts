/**
 * shareSheet.ts — type-resolution barrel only.
 *
 * Metro resolves shareSheet.native.ts (iOS/Android) or shareSheet.web.ts
 * (web) before this file, so it is never bundled. It exists so
 * `tsc --noEmit` can resolve `./shareSheet`. Do NOT add implementation here.
 */
export { shareLink, buildAppUrl } from './shareSheet.web';
export type { ShareLinkInput, ShareOutcome, ShareUrlResult } from './shareSheet.types';
