/**
 * clipboard.ts — Type-only re-export for TypeScript resolution.
 *
 * Metro resolves platform extensions before this file:
 *   - clipboard.native.ts  → iOS + Android (expo-clipboard)
 *   - clipboard.web.ts     → Web (navigator.clipboard + execCommand fallback)
 *
 * This file exists solely so `tsc --noEmit` can resolve the `@/lib/clipboard`
 * import path. In a real build, Metro picks the platform-specific extension first
 * and this file is never bundled.
 *
 * Do NOT add implementation here — add it to the platform-specific files.
 */
export { copyToClipboard } from './clipboard.web';
