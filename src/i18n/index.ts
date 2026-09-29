/**
 * Tripvisor i18n (ADR-0011) — the only module UI code imports for strings,
 * languages and formatting. Importing it initialises i18next synchronously.
 *
 *   const { t } = useT('auth');           // namespace = your feature area
 *   t('login.title');                      // typed key in that namespace
 *   t('common:actions.cancel');            // another namespace, `ns:` prefix
 *   <Trans t={t} i18nKey="inbox.body" values={{ email }} components={{ email: <Text /> }} />
 *   formatMoney(12.5, expense.currency);   // app language, row's own currency
 *
 * Keys live in `src/i18n/locales/{en,tr}/<ns>.json`; `npm run i18n:check`
 * enforces en/tr parity, no empty values, no unused keys, and no raw JSX
 * text in migrated directories.
 */
export { useTranslation as useT, Trans } from 'react-i18next';
export { i18n, appLocale, currentLanguage as appLanguage } from './instance';
export {
  SUPPORTED_LANGUAGES,
  LOCALE_STORAGE_KEY,
  type AppLanguage,
  type LanguagePreference,
} from './languages';
export {
  deviceLanguage,
  getLanguagePreference,
  hydrateLanguagePreference,
  setLanguagePreference,
  useAppLocale,
  useI18nReady,
  useLanguagePreference,
  useSystemLanguageSync,
} from './preference';
export * from './format';
export type { Namespace } from './resources';
