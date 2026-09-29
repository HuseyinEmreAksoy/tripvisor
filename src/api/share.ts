// Tripvisor Phase 4 — share link client wrappers (+ M5 Y2.5 toggles).
//
// Owner side (all OWNER-ONLY server-side; collaborators get
// `ShareLinkError('not_owner')`, so only mount these for the owner):
//   - `useCreateShareLink` / `useRevokeShareLink` — mint / kill links.
//   - `useCurrentShareLink` — the trip's newest active link (token + toggles),
//     so the share card can show the link again after a reload.
//   - `useTripShareSettings` — just the toggles of that link (null = no link).
//   - `useUpdateShareSettings` — flip show itinerary / expenses / memories
//     (optimistic; rolls back on failure).
// Public side:
//   - `useSharedTrip` — anonymous read of a link (contract v3: optional
//     `sections` / `expenses` / `memories`, see ./share.types.ts).
// Everything funnels through the `share-trip` Edge Function; the
// `trip_shares` table is intentionally not reachable from the client.
// The 'share' query root is memory-only (not in the persister allowlist), so
// tokens and signed photo URLs never reach disk.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from './supabase';
import { EdgeFunctionError, tryParseEdgeFunctionError } from './_errors';
import type { RevokeShareResult, Uuid } from './types';
import type {
  CreateShareLinkInput,
  CreateShareLinkResult,
  CurrentShareLink,
  ShareSettings,
  SharedTripPayload,
  UpdateShareSettingsInput,
} from './share.types';

export type {
  CreateShareLinkInput,
  CreateShareLinkResult,
  CurrentShareLink,
  ShareSettings,
  ShareSettingsPatch,
  SharedExpenseSummary,
  SharedJournalEntry,
  SharedMemories,
  SharedMemoryPhoto,
  SharedMemoryReview,
  SharedTripPayload,
  SharedTripSections,
  UpdateShareSettingsInput,
} from './share.types';

/** `meta.contractVersion` of the share-trip read this client understands. */
export const SHARE_CONTRACT_VERSION = 3;

/** Toggles of a brand-new link when nothing is chosen (server column defaults). */
export const DEFAULT_SHARE_SETTINGS: Readonly<ShareSettings> = Object.freeze({
  showItinerary: true,
  showExpenses: false,
  showMemories: false,
});

/**
 * Typed failure of the `share-trip` owner ops. Branch on `.code`:
 *   - `not_owner`         — 403 — caller is a collaborator, not the owner
 *                            (public links are OWNER-ONLY, security audit #5)
 *   - `not_authenticated` — 401 — no / expired session
 *   - `not_found`         — 404 — trip missing or not visible to the caller
 *   - `no_active_link`    — 404 — update_settings with no live link (create one)
 *   - `invalid_input` 400 · `db_error` / `internal_error` 500
 * Non-envelope failures (network, gateway) are rethrown as-is.
 */
export class ShareLinkError extends EdgeFunctionError {
  constructor(code: string, message: string, status: number) {
    super(code, message, status);
    this.name = 'ShareLinkError';
  }
}

async function throwShareError(error: unknown): Promise<never> {
  const typed = await tryParseEdgeFunctionError(error, ShareLinkError);
  throw typed ?? error;
}

export const shareKeys = {
  all: ['share'] as const,
  trip: (token: string | undefined) => [...shareKeys.all, 'trip', token ?? 'none'] as const,
  /** The owner's current-link read (token + toggles) for one trip. */
  current: (tripId: string | undefined) => [...shareKeys.all, 'current', tripId ?? 'none'] as const,
};

/** 4xx answers (auth / ownership / validation) and contract drift don't get better on retry. */
function retryShare(failureCount: number, error: Error): boolean {
  if (error instanceof ShareLinkError && error.status < 500) return false;
  if (error instanceof z.ZodError) return false;
  return failureCount < 2;
}

// ===========================================================================
// Response validation (owner ops) — contract drift fails loudly
// ===========================================================================

const settingsSchema = z.object({
  showItinerary: z.boolean(),
  showExpenses: z.boolean(),
  showMemories: z.boolean(),
});

const linkSchema = z.object({
  token: z.string().min(16),
  createdAt: z.string(),
  settings: settingsSchema,
});

const currentResponseSchema = z.object({ share: linkSchema.nullable() });
const updateResponseSchema = z.object({ share: linkSchema });

// ===========================================================================
// Create / revoke (Phase 4, owner only)
// ===========================================================================

/**
 * Mint a new public link. `mutate()` keeps working; `mutate({ settings })`
 * picks the new link's toggles (keys left out inherit from the trip's newest
 * active link, else the defaults). The owner's current-link cache is primed
 * from the response.
 */
export function useCreateShareLink(tripId: Uuid | undefined) {
  const qc = useQueryClient();
  return useMutation<CreateShareLinkResult, Error, CreateShareLinkInput | void>({
    mutationFn: async (input) => {
      if (!tripId) throw new Error('tripId required to create a share link');
      const settings = input && input.settings ? input.settings : undefined;
      const { data, error } = await supabase.functions.invoke<CreateShareLinkResult>(
        'share-trip',
        { body: { op: 'create', tripId, ...(settings ? { settings } : {}) } },
      );
      if (error) await throwShareError(error);
      if (!data?.token) throw new Error('share-trip returned no token');
      return data;
    },
    onSuccess: (data) => {
      if (tripId && data.createdAt && data.settings) {
        const link: CurrentShareLink = { token: data.token, createdAt: data.createdAt, settings: data.settings };
        qc.setQueryData(shareKeys.current(tripId), link);
      }
      qc.invalidateQueries({ queryKey: shareKeys.all });
    },
  });
}

export function useRevokeShareLink(tripId: Uuid | undefined) {
  const qc = useQueryClient();
  return useMutation<RevokeShareResult, Error, { token?: string } | void>({
    mutationFn: async (input) => {
      if (!tripId) throw new Error('tripId required to revoke a share link');
      const token = input && 'token' in input ? input.token : undefined;
      const { data, error } = await supabase.functions.invoke<RevokeShareResult>(
        'share-trip',
        { body: { op: 'revoke', tripId, ...(token ? { token } : {}) } },
      );
      if (error) await throwShareError(error);
      return data ?? { revoked: 0 };
    },
    onSuccess: (_data, input) => {
      const token = input && 'token' in input ? input.token : undefined;
      if (tripId) {
        const current = qc.getQueryData<CurrentShareLink | null>(shareKeys.current(tripId));
        // Revoking everything, or exactly the link on screen, hides it now;
        // the refetch below brings back an older link that is still live.
        if (!token || current?.token === token) qc.setQueryData(shareKeys.current(tripId), null);
      }
      qc.invalidateQueries({ queryKey: shareKeys.all });
    },
  });
}

// ===========================================================================
// M5 Y2.5 — current link + toggles (owner only)
// ===========================================================================

export async function fetchCurrentShareLink(tripId: Uuid): Promise<CurrentShareLink | null> {
  const { data, error } = await supabase.functions.invoke('share-trip', {
    body: { op: 'current', tripId },
  });
  if (error) await throwShareError(error);
  return currentResponseSchema.parse(data).share;
}

/**
 * The trip's newest ACTIVE public link (token + toggles), or null when there
 * is none. OWNER-ONLY: pass `{ enabled: isOwner }` so collaborators never
 * fire it (the server answers them 403 `not_owner`, never the token).
 */
export function useCurrentShareLink(tripId: Uuid | undefined, options: { enabled?: boolean } = {}) {
  return useQuery<CurrentShareLink | null, ShareLinkError | Error>({
    queryKey: shareKeys.current(tripId),
    enabled: Boolean(tripId) && (options.enabled ?? true),
    staleTime: 5 * 60 * 1000,
    retry: retryShare,
    queryFn: () => fetchCurrentShareLink(tripId!),
  });
}

/**
 * Toggles of the trip's current link (same query as `useCurrentShareLink`,
 * no extra request). `data` is null when the trip has no active link: show
 * `DEFAULT_SHARE_SETTINGS` and pass the chosen toggles to
 * `useCreateShareLink().mutate({ settings })`.
 */
export function useTripShareSettings(tripId: Uuid | undefined, options: { enabled?: boolean } = {}) {
  return useQuery<CurrentShareLink | null, ShareLinkError | Error, ShareSettings | null>({
    queryKey: shareKeys.current(tripId),
    enabled: Boolean(tripId) && (options.enabled ?? true),
    staleTime: 5 * 60 * 1000,
    retry: retryShare,
    queryFn: () => fetchCurrentShareLink(tripId!),
    select: (link) => link?.settings ?? null,
  });
}

/**
 * Flip one or more toggles: `mutate({ showMemories: true })`. Optimistic on
 * the current-link cache, rolled back on failure. Applies to every active
 * link of the trip unless `token` is given. `no_active_link` (404) means the
 * link was revoked meanwhile.
 */
export function useUpdateShareSettings(tripId: Uuid | undefined) {
  const qc = useQueryClient();
  return useMutation<
    CurrentShareLink,
    ShareLinkError | Error,
    UpdateShareSettingsInput,
    { previous: CurrentShareLink | null | undefined }
  >({
    mutationFn: async ({ token, ...patch }) => {
      if (!tripId) throw new Error('tripId required to update share settings');
      const settings: Partial<ShareSettings> = {};
      if (typeof patch.showItinerary === 'boolean') settings.showItinerary = patch.showItinerary;
      if (typeof patch.showExpenses === 'boolean') settings.showExpenses = patch.showExpenses;
      if (typeof patch.showMemories === 'boolean') settings.showMemories = patch.showMemories;
      if (Object.keys(settings).length === 0) throw new Error('at least one share toggle is required');
      const { data, error } = await supabase.functions.invoke('share-trip', {
        body: { op: 'update_settings', tripId, settings, ...(token ? { token } : {}) },
      });
      if (error) await throwShareError(error);
      return updateResponseSchema.parse(data).share;
    },
    onMutate: async ({ token: _token, ...patch }) => {
      const key = shareKeys.current(tripId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<CurrentShareLink | null>(key);
      if (previous) {
        const optimistic: CurrentShareLink = {
          ...previous,
          settings: { ...previous.settings, ...definedToggles(patch) },
        };
        qc.setQueryData(key, optimistic);
      }
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context && context.previous !== undefined) {
        qc.setQueryData(shareKeys.current(tripId), context.previous);
      }
    },
    onSuccess: (link) => {
      qc.setQueryData(shareKeys.current(tripId), link);
    },
    onSettled: () => {
      // What an anonymous read on this device returns changed too.
      qc.invalidateQueries({ queryKey: [...shareKeys.all, 'trip'] });
    },
  });
}

function definedToggles(patch: Partial<ShareSettings>): Partial<ShareSettings> {
  const out: Partial<ShareSettings> = {};
  if (typeof patch.showItinerary === 'boolean') out.showItinerary = patch.showItinerary;
  if (typeof patch.showExpenses === 'boolean') out.showExpenses = patch.showExpenses;
  if (typeof patch.showMemories === 'boolean') out.showMemories = patch.showMemories;
  return out;
}

// ===========================================================================
// Public read (anonymous)
// ===========================================================================

/**
 * Anonymous read of a shared trip by token. No auth required. The Edge
 * Function uses the service-role key to fetch the trip + its ToS-safe
 * fields. Returns null if the token is missing or revoked. With contract v3
 * the payload may carry `sections`, `expenses` and `memories` (each only when
 * the owner turned it on); memory photo URLs expire after 1 h, so the 1 min
 * staleTime keeps them fresh on an open page.
 */
export function useSharedTrip(token: string | undefined) {
  return useQuery<SharedTripPayload | null>({
    queryKey: shareKeys.trip(token),
    enabled: Boolean(token),
    staleTime: 1000 * 60, // 1 min — share content can change (edits on owner side)
    retry: (failureCount, err) => {
      // 404 means revoked or unknown — don't retry on that.
      const msg = (err as Error).message?.toLowerCase() ?? '';
      if (msg.includes('not_found') || msg.includes('404')) return false;
      return failureCount < 2;
    },
    queryFn: async () => {
      if (!token) return null;
      const { data, error } = await supabase.functions.invoke<SharedTripPayload>('share-trip', {
        body: { op: 'read', token },
      });
      if (error) {
        // Edge Function returns 404 for missing/revoked — surface as null so the
        // consuming screen can show a friendly "link no longer available" state.
        const status = (error as { context?: { status?: number } }).context?.status;
        if (status === 404) return null;
        throw error;
      }
      return data ? withReachablePhotoUrls(data) : null;
    },
  });
}

const SIGNED_OBJECT_PATH = '/storage/v1/object/sign/';

/**
 * Re-base a signed Storage URL onto `origin` (keeps path + token). The
 * signature covers the object path, not the host, so the URL stays valid.
 * Anything that is not a signed Storage URL is returned unchanged.
 */
export function rebaseSignedStorageUrl(url: string, origin: string): string {
  const at = url.indexOf(SIGNED_OBJECT_PATH);
  if (at < 0 || !origin) return url;
  return `${origin.replace(/\/+$/, '')}${url.slice(at)}`;
}

/** This app's Supabase origin, from the client's own Storage URL builder (no request). */
function appSupabaseOrigin(): string {
  const probe = supabase.storage.from('trip-memories').getPublicUrl('x').data.publicUrl;
  const at = probe.indexOf('/storage/v1/');
  return at > 0 ? probe.slice(0, at) : '';
}

/**
 * Memory photo URLs are signed by the Edge Function on ITS Supabase URL. In
 * production that is the public project URL (a no-op here); on the local
 * stack it is the docker-internal `http://kong:8000`, which no browser or
 * phone can reach, so re-base them onto the URL this app talks to.
 */
function withReachablePhotoUrls(payload: SharedTripPayload): SharedTripPayload {
  const photos = payload.memories?.photos;
  if (!photos || photos.length === 0) return payload;
  const origin = appSupabaseOrigin();
  return {
    ...payload,
    memories: {
      ...payload.memories!,
      photos: photos.map((p) => ({
        ...p,
        url: rebaseSignedStorageUrl(p.url, origin),
        thumbUrl: rebaseSignedStorageUrl(p.thumbUrl, origin),
      })),
    },
  };
}
