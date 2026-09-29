/**
 * encode.ts — type-resolution shim (same pattern as src/api/offline.ts).
 *
 * Metro resolves the platform files first:
 *   - encode.native.ts → iOS + Android (expo-image-manipulator)
 *   - encode.web.ts    → Web (<canvas>)
 * This file exists so `tsc --noEmit` can resolve `./encode`; it is never
 * bundled. Do NOT add implementation here.
 */
export { decodePhoto } from './encode.web';
