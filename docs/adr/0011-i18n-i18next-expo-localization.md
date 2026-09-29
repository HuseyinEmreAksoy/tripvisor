# ADR-0011: i18n — i18next + react-i18next + expo-localization, bundled namespaces, Intl formatting

**Status**: Accepted (planned in Phase M5, step Y1.4)
**Date**: 2026-09-29

## Context

The user wants full Turkish + English support: language picked automatically from the device, switchable in Profile, and **every** UI string in translation files. Dates, numbers and currency amounts must follow the selected app language, not the device region. The app is one Expo SDK 54 codebase (Hermes on iOS/Android, browsers on web) with about 180 `.tsx` files of hard-coded English. It is offline-first, so translations can't be fetched at runtime. M5 also adds many new screens, and they should be written translated from the start rather than retrofitted.

## Decision

1. **Libraries:** `i18next` + `react-i18next` (hooks, `Trans`, namespaces, interpolation, plurals) + `expo-localization` (`getLocales()` for the initial language). All three are pure JS or have Expo modules on iOS, Android and web.
2. **Layout:** `src/i18n/index.ts` (init, `useT`, `changeLanguage`, `appLocale()`), `src/i18n/format.ts` (`formatMoney`, `formatDate`, `formatDateRange`, `formatNumber`, `formatDuration`, `collator`), and `src/i18n/locales/{en,tr}/<namespace>.json`. There is **one namespace per feature area** (`common`, `shell`, `auth`, `trip`, `memories`, `money`, `routes`, `discover`, `share`, `recap`, `errors`, …) so parallel agents never edit the same JSON file. Every namespace is bundled statically (no HTTP backend) so the app works offline.
3. **Language resolution:** stored choice (AsyncStorage `tv.locale`) → device language (`tr*` → `tr`, else `en`). The Profile switch calls `changeLanguage` and persists the choice. Later it is mirrored to `user_preferences.locale` (Y3.4) so server-side features (AI output language, future push) can use it.
4. **Formatting:** always use `Intl` with the **app** locale (`tr-TR`, or `en-` plus the device region, falling back to `en-US`). The existing `formatCurrency` and `formatDuration` delegate to `src/i18n/format.ts` so their callers don't change. Case-folding and search use `toLocale{Upper,Lower}Case(appLocale)` and `Intl.Collator`, because of the Turkish İ/ı.
5. **Hermes:** if `Intl.PluralRules` is missing at boot, load the `intl-pluralrules` polyfill on native only.
6. **Type safety and gating:** English is the source of truth. `CustomTypeOptions` resource typing makes a mistyped key a tsc error. `npm run i18n:check` fails on keys missing from `tr`, empty values, and (in migrated directories) raw JSX text literals. It runs in the reviewer gate, and from Y4.4 onwards also in CI.

## Alternatives considered

- **i18n-js** (the library Expo's docs show): smaller, but it has no React bindings, so it can't re-render on a language switch, and it has no namespaces. Its plural and interpolation support is weaker. We would end up hand-rolling what react-i18next already provides.
- **FormatJS / react-intl:** full ICU support, but heavy Intl polyfills on Hermes and more bundle weight on web. ICU message syntax is more than two languages need.
- **Lingui:** compile-time extraction is attractive, but it needs a babel macro, Metro config and a CLI step, which risks the SDK 54 web export that already needed a `metro.config.js` fix.

## Consequences

- Infra lands first (M5 Wave 1), so every M5 screen is born translated. Bulk extraction of untouched legacy screens runs last (Wave 4), so it doesn't churn or collide with feature steps. Each feature step extracts strings in the files it touches.
- Agents write the Turkish strings. **A native-speaker review by the user is required** before the phase exits.
- Server-side text (Edge Function errors) stays as English codes plus a client-side `errors` namespace mapping. AI output language is passed as an explicit `lang` parameter.
