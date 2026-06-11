/**
 * persistence.ts — Type-only re-export for TypeScript resolution.
 *
 * Metro resolves platform extensions before this file:
 *   - persistence.native.ts → iOS + Android (expo-sqlite over JSI)
 *   - persistence.web.ts    → Web (wa-sqlite/OPFS with R5 in-memory degrade)
 *
 * Exists solely so `tsc --noEmit` can resolve `./persistence` — same
 * convention as src/api/offline.ts. Do NOT add implementation here.
 */
export { createSyncPersistence } from './persistence.web';
export type { SyncPersistenceResult } from './persistence.types';
