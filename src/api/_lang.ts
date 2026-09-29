// M5 Y2.5 — the `lang` request parameter of the Edge Functions that return
// human-readable text (places-autocomplete, place-details, ai-itinerary,
// ai-edit, poi-recommend).
//
// The servers accept exactly 'en' | 'tr' (anything else is a 400), so the
// app language is narrowed here instead of being passed through: a future
// third app language falls back to English until the servers learn it.
//
// Called at request time, not at render: the query hooks that use it also
// put it in their query key, so switching the language refetches.

import { appLanguage } from '@/i18n';

export type ApiLang = 'en' | 'tr';

export function requestLang(): ApiLang {
  return appLanguage() === 'tr' ? 'tr' : 'en';
}

/** 'tr', 'tr-TR', 'TR' → 'tr'; anything else (or nothing) → the app language. */
export function toApiLang(lang: string | null | undefined): ApiLang {
  if (lang == null || lang === '') return requestLang();
  return lang.trim().toLowerCase().startsWith('tr') ? 'tr' : 'en';
}
