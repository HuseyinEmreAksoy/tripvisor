/**
 * confirm.ts — Type-only re-export for TypeScript resolution.
 *
 * Metro resolves platform extensions before this file:
 *   - confirm.native.ts → iOS + Android (React Native Alert)
 *   - confirm.web.ts    → Web (window.confirm)
 *
 * This file exists solely so `tsc --noEmit` can resolve the `@/lib/confirm`
 * import path. In a real build, Metro picks the platform-specific extension
 * first and this file is never bundled.
 *
 * Do NOT add implementation here — add it to the platform-specific files.
 */
export { confirmDestructive } from './confirm.web';
export type { ConfirmDestructiveOpts } from './confirm.web';
