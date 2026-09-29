/**
 * blobStore.ts — type-resolution shim (Metro picks blobStore.native.ts /
 * blobStore.web.ts first; see src/api/offline.ts for the pattern).
 * Do NOT add implementation here.
 */
export { createPhotoBlobStore } from './blobStore.web';
