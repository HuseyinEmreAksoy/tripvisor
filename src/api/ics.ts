/**
 * ics.ts — Type-only re-export for TypeScript resolution.
 *
 * Metro resolves platform extensions before this file:
 *   - ics.native.ts  → iOS + Android (expo-file-system + expo-sharing)
 *   - ics.web.ts     → Web (Blob + anchor download)
 *
 * This file exists solely so `tsc --noEmit` can resolve `@/api/ics`.
 * In a real build, Metro picks the platform-specific extension and this
 * file is never bundled.
 *
 * Do NOT add implementation here.
 */
export { useDownloadTripIcs, type DownloadIcsResult } from './ics.web';
