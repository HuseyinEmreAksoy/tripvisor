/**
 * Type-resolution entry for the i18n platform seam (same pattern as
 * `src/lib/confirm.ts`). Metro picks `platform.web.ts` or
 * `platform.native.ts` first; this file only exists so `tsc` can resolve
 * `./platform`. Do not add implementation here.
 */
export {
  SYNC_PREFERENCE_READ,
  isStaticRender,
  readStoredPreferenceSync,
  applyDocumentLanguage,
  ensureIntlPolyfills,
} from './platform.web';
