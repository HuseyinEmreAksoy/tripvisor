/**
 * account-export.ts — Type-only re-export for TypeScript resolution.
 *
 * Metro resolves platform extensions before this file:
 *   - account-export.native.ts  → iOS + Android (expo-file-system + expo-sharing)
 *   - account-export.web.ts     → Web (Blob + anchor download)
 *
 * This file exists solely so `tsc --noEmit` can resolve `@/api/account-export`.
 * In a real build, Metro picks the platform-specific extension and this
 * file is never bundled.
 *
 * Do NOT add implementation here.
 */
export { useExportAccount, type AccountExportResult } from './account-export.web';
