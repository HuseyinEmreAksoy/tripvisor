/**
 * offline.ts — Type-only re-export for TypeScript resolution.
 *
 * Metro resolves platform extensions before this file:
 *   - offline.native.ts  → iOS + Android (uses @react-native-community/netinfo)
 *   - offline.web.ts     → Web (uses navigator.onLine)
 *
 * This file exists solely so `tsc --noEmit` can resolve `@/api/offline`.
 * In a real build, Metro picks the platform-specific extension and this
 * file is never bundled.
 *
 * Do NOT add implementation here.
 */
export {
  shouldDehydrateQuery,
  isOnline,
  useIsOnline,
} from './offline.web';
