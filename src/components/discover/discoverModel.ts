/**
 * Discover (M5 Y3.4) — pure mapping helpers shared by the screen, the detail
 * sheet, the onboarding interests card and the Profile preferences section.
 * No React, no I/O: error objects and codes in, i18n KEYS out (the caller
 * translates, so a language switch re-renders the right text).
 */
import type { IconName } from '@/components/Icon';
import {
  INTERESTS,
  AddPoiError,
  RecommendationsError,
  isInterest,
  type AddPoiErrorCode,
  type Interest,
  type RecommendationsDegraded,
} from '@/api/recommendations';

export { INTERESTS, isInterest, type Interest };

/** The i18n namespace every key built here belongs to. */
export const DISCOVER_NS = 'discover';

/** One icon per interest (all in the Icon set). */
export const INTEREST_ICONS: Readonly<Record<Interest, IconName>> = {
  history: 'castle',
  food: 'utensils',
  nature: 'trees',
  museums: 'landmark',
  nightlife: 'wine',
  shopping: 'shopping-bag',
  kids: 'ferris-wheel',
  viewpoints: 'binoculars',
};

/** i18n key of an interest's label (`discover:` namespace). */
export function interestLabelKey(i: Interest) {
  return `interests.${i}` as const;
}

/** Only known interest keys, de-duplicated, in the canonical INTERESTS order. */
export function normalizeInterests(values: readonly string[] | null | undefined): Interest[] {
  const set = new Set((values ?? []).filter(isInterest));
  return INTERESTS.filter((i) => set.has(i));
}

/** Toggle one interest (keeps canonical order). */
export function toggleInterest(current: readonly Interest[], i: Interest): Interest[] {
  const set = new Set(current);
  if (set.has(i)) set.delete(i);
  else set.add(i);
  return INTERESTS.filter((x) => set.has(x));
}

/** Same set, order-insensitive. */
export function sameInterests(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/**
 * The chips Discover opens with: the saved preferences, else what the user
 * picked in onboarding before signing up, else none (the screen then asks).
 */
export function initialInterests(saved: readonly string[] | undefined, pending: readonly string[] | null): Interest[] {
  const fromPrefs = normalizeInterests(saved);
  if (fromPrefs.length > 0) return fromPrefs;
  return normalizeInterests(pending);
}

export type AddPoiErrorKey = `addError.${AddPoiErrorCode}`;

const ADD_CODES: readonly AddPoiErrorCode[] = [
  'no_match',
  'quota_exceeded',
  'places_unavailable',
  'not_authenticated',
  'already_in_trip',
  'create_failed',
  'invalid_input',
];

/** `AddPoiError` (or anything) → a `discover:addError.*` key. */
export function addPoiErrorKey(err: unknown): AddPoiErrorKey {
  if (err instanceof AddPoiError && ADD_CODES.includes(err.code)) return `addError.${err.code}`;
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && (ADD_CODES as readonly string[]).includes(code)) {
    return `addError.${code as AddPoiErrorCode}`;
  }
  return 'addError.places_unavailable';
}

export type RecErrorKey =
  | 'error.quota_exceeded'
  | 'error.recommendations_disabled'
  | 'error.not_authenticated'
  | 'error.generic';

/** A `useRecommendations` error → a `discover:error.*` key. */
export function recommendationsErrorKey(err: unknown): RecErrorKey {
  const code =
    err instanceof RecommendationsError ? err.code : (err as { code?: unknown } | null)?.code;
  if (code === 'quota_exceeded') return 'error.quota_exceeded';
  if (code === 'recommendations_disabled') return 'error.recommendations_disabled';
  if (code === 'not_authenticated') return 'error.not_authenticated';
  return 'error.generic';
}

/** Retrying cannot help for these (the query hook does not retry them either). */
export function isPermanentRecommendationsError(err: unknown): boolean {
  const key = recommendationsErrorKey(err);
  return key !== 'error.generic';
}

/** `response.degraded` → a `discover:degraded.*` key (null = full results). */
export function degradedKey(d: RecommendationsDegraded | null | undefined) {
  return d ? (`degraded.${d}` as const) : null;
}

/** Where Discover searches: the whole trip, one day, or the device location. */
export type CenterMode = { kind: 'trip' } | { kind: 'day'; dayIndex: number } | { kind: 'here' };

export function centerModeKey(m: CenterMode): string {
  return m.kind === 'day' ? `day-${m.dayIndex}` : m.kind;
}

/** Whether the `?day=` route param is a usable 0-based day index. */
export function parseDayParam(raw: string | string[] | undefined, dayCount: number): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) return null;
  if (dayCount > 0 && n >= dayCount) return null;
  return n;
}

/** Inclusive day count from 'YYYY-MM-DD' dates (0 when undated). */
export function tripDayCountOf(start: string | null | undefined, end: string | null | undefined): number {
  const parse = (value: string | null | undefined): number | null => {
    const m = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : null;
  };
  const s = parse(start);
  if (s === null) return 0;
  const e = parse(end) ?? s;
  return Math.max(1, Math.round(e - s) + 1);
}

/** Only http(s) links are opened from third-party payloads. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}
