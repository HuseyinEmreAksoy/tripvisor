// M5 Y2.5 — types for the `share-trip` contract v3 (per-link toggles, the
// owner's "current link" read, and the additive public-read sections).
// Mirrors supabase/functions/share-trip/{handler,public-fields,expense-summary}.ts.
//
// Kept out of ./types.ts (Wave-2 file-ownership rule); re-exported from
// ./share so `import { … } from '@/api'` works.

import type { CreateShareResult, SharedTrip } from './types';

// ===========================================================================
// Owner side: toggles + current link
// ===========================================================================

/** What a public link shows. Defaults: itinerary on, expenses off, memories off. */
export interface ShareSettings {
  showItinerary: boolean;
  showExpenses: boolean;
  showMemories: boolean;
}

export type ShareSettingsPatch = Partial<ShareSettings>;

/** The trip's newest active link, as only the OWNER can read it. */
export interface CurrentShareLink {
  token: string;
  /** ISO time the link was created. */
  createdAt: string;
  settings: ShareSettings;
}

/** `useCreateShareLink().mutate(input?)` — toggles for the new link (left-out keys inherit). */
export interface CreateShareLinkInput {
  settings?: ShareSettingsPatch;
}

/** v3 create response. `createdAt` / `settings` are absent from a v2 server. */
export interface CreateShareLinkResult extends CreateShareResult {
  createdAt?: string;
  settings?: ShareSettings;
}

/**
 * `useUpdateShareSettings(tripId).mutate({ showMemories: true })`. At least
 * one toggle. Without `token` the change applies to EVERY active link of the
 * trip (the UI treats the toggles as per trip).
 */
export type UpdateShareSettingsInput = ShareSettingsPatch & { token?: string };

// ===========================================================================
// Public read (anonymous), contract v3 — every section is optional
// ===========================================================================

/** The owner's toggles as seen by the public page ("hidden" vs "empty"). */
export interface SharedTripSections {
  itinerary: boolean;
  expenses: boolean;
  memories: boolean;
}

/**
 * Expenses SUMMARY (never line items). `totals` / `byCategory` are in
 * `homeCurrency` and exclude pending conversions; `byCurrency` sums the
 * ORIGINAL amounts per original currency (pending included). Format with
 * `formatMoney(amount, currency)`; amounts are not rounded server-side.
 */
export interface SharedExpenseSummary {
  homeCurrency: string;
  count: number;
  totals: { actual: number; estimated: number };
  byCategory: Array<{ category: string; actual: number; estimated: number }>;
  byCurrency: Array<{ currency: string; actual: number; estimated: number; count: number }>;
  pending: {
    count: number;
    actualByCurrency: Record<string, number>;
    estimatedByCurrency: Record<string, number>;
  };
}

export interface SharedJournalEntry {
  id: string;
  /** 0-based trip day. */
  dayIndex: number;
  body: string;
  createdAt: string;
}

/** A member's own 1–5 review (user content, never Google data). */
export interface SharedMemoryReview {
  id: string;
  /** A `places[].id` when that place is on the public itinerary, else null. */
  placeId: string | null;
  /** Live place title, or the snapshot once the place was removed; null = unnamed. */
  placeName: string | null;
  rating: number | null;
  body: string;
  createdAt: string;
}

export interface SharedMemoryPhoto {
  id: string;
  dayIndex: number | null;
  placeId: string | null;
  caption: string | null;
  takenAt: string | null;
  width: number | null;
  height: number | null;
  /** 1 h signed URL of the thumbnail (see `SharedMemories.photoUrlExpiresAt`). */
  thumbUrl: string;
  /**
   * Contract v4: ALSO the thumbnail (=== `thumbUrl`); the read never signs
   * full images. Fetch the full size on demand with
   * `useSharedPhotoUrl(token, photo.id)` (rate-limited `photo_url` op).
   * Kept for v3 clients.
   */
  url: string;
}

/** Only items their authors shared with the trip; `only_me` items are never here. */
export interface SharedMemories {
  journal: SharedJournalEntry[];
  reviews: SharedMemoryReview[];
  photos: SharedMemoryPhoto[];
  /** When the photo URLs stop working; refetch the share after it. null = no photos. */
  photoUrlExpiresAt: string | null;
  /** True when a list hit its server cap (oldest items left out). */
  truncated: boolean;
}

/**
 * `useSharedTrip` data. A v2 server sends no `sections` / `expenses` /
 * `memories`; a v3 server sends `sections` always and each section only when
 * the owner turned it on. `places` / `legs` are empty arrays when the owner
 * hid the itinerary. Render a section only when its key is present.
 */
export interface SharedTripPayload extends SharedTrip {
  sections?: SharedTripSections;
  expenses?: SharedExpenseSummary;
  memories?: SharedMemories;
}
