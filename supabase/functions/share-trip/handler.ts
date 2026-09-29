// share-trip — create / read / revoke read-only share links for a trip,
// plus the owner's per-link toggles and "current link" read (M5 Y2.5).
//
// Contract:
//   POST { op: "create", tripId, settings? }                (auth required, OWNER only)
//     -> { token, createdAt, settings }
//        `settings` (optional, partial) = the new link's toggles. Keys left
//        out inherit from the trip's newest ACTIVE link, else the column
//        defaults (itinerary on, expenses off, memories off). v2 clients read
//        only `token`, which is unchanged.
//   POST { op: "current", tripId }                          (auth required, OWNER only)
//     -> { share: { token, createdAt, settings } | null, meta: { contractVersion: 3 } }
//        The trip's newest active (not revoked) link, so the owner's UI can
//        show it again after a reload. null = no active link.
//   POST { op: "update_settings", tripId, token?, settings } (auth required, OWNER only)
//     -> { share: { token, createdAt, settings }, updated: number, meta }
//        `settings` = a partial { showItinerary?, showExpenses?, showMemories? }
//        with at least one key. Applies to EVERY active link of the trip (the
//        toggles are per trip in the UI), or only to `token` when given.
//        No active link -> 404 no_active_link.
//   POST { op: "read",   token }                            (anonymous)
//     -> { trip, places, legs, sections, expenses?, memories?,
//          meta: { contractVersion: 3 } } — allow-listed fields only
//        (see ./public-fields.ts for the list + version history, and
//        ./expense-summary.ts for the expenses summary)
//   POST { op: "revoke", tripId, token? }                   (auth required, OWNER only)
//     -> { revoked: number }
//   GET  ?ping
//     -> { ok: true, fn: "share-trip" }
//
// Security model:
//   - The `trip_shares` table has NO SELECT policy. All reads go through this
//     function using the service-role client.
//   - Every op except `read` is OWNER-ONLY (security audit #5, 2026-09-29;
//     `current` / `update_settings` follow the same rule). The caller is
//     identified with `auth.getUser(jwt)`, the trip is looked up under the
//     caller's JWT (RLS: not visible → 404), and anything but
//     `trip.user_id === caller.id` → 403 `not_owner`. Accepted viewers AND
//     editors are refused: publishing a trip to the internet, choosing what
//     it shows, and seeing the live token are the owner's alone. The token
//     is returned only to the owner (`create`, `current`, `update_settings`).
//   - `read` is anonymous and returns ONLY the allow-listed fields in
//     ./public-fields.ts: never `user_id`, never `trip.id`, never notes
//     (private by default), never author ids, and never Google-ToS-restricted
//     content (reviews, photos, rating, website, phone, opening_hours are not
//     persisted anywhere in our DB in the first place).
//   - Sections follow the link's toggles, FAIL-CLOSED: expenses and memories
//     are fetched and returned only when their column is exactly `true`.
//     Expenses are a summary (no line items). Memories are only rows with
//     visibility = 'trip' AND deleted = false (+ status = 'ready' for
//     photos): the query filters them and every row is re-checked in code,
//     so an `only_me` item can never reach a public link. Photos are served
//     through 1 h signed URLs of the PRIVATE `trip-memories` bucket, minted
//     here with the service role (justification: anonymous viewers have no
//     Storage identity, and the bucket must stay private). Only paths of
//     rows that passed the public predicate are signed.
//   - Tokens are 128 bits of `crypto.getRandomValues` entropy, base64url-encoded.
//     Only a token prefix (8 chars) is ever logged.
//
// Error codes: invalid_input 400 · not_authenticated 401 · not_owner 403 ·
//   not_found 404 · no_active_link 404 · method_not_allowed 405 ·
//   db_error / internal_error 500.

// @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { handlePreflight } from '../_shared/cors.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { log, newRequestId } from '../_shared/logger.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { makeAdminClient, makeUserClient } from '../_shared/supabase-admin.ts';
import {
  buildPublicMemories,
  buildPublicSharePayload,
  DEFAULT_SHARE_SETTINGS,
  LEG_FIELDS,
  MAX_PUBLIC_JOURNAL,
  MAX_PUBLIC_PHOTOS,
  MAX_PUBLIC_REVIEWS,
  photoPathsToSign,
  PLACE_FIELDS,
  PUBLIC_JOURNAL_FIELDS,
  PUBLIC_PHOTO_FIELDS,
  PUBLIC_REVIEW_FIELDS,
  SHARE_READ_CONTRACT_VERSION,
  SHARE_SETTINGS_COLUMNS,
  settingsFromRow,
  settingsToColumns,
  TRIP_FIELDS,
  type PublicMemories,
  type ShareSettings,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from './public-fields.ts';
import {
  EXPENSE_SUMMARY_FIELDS,
  rateKey,
  rateLookupsNeeded,
  summarizeExpenses,
  type ExpenseSummaryRow,
  type PublicExpenseSummary,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from './expense-summary.ts';

const SettingsPatchSchema = z
  .object({
    showItinerary: z.boolean().optional(),
    showExpenses: z.boolean().optional(),
    showMemories: z.boolean().optional(),
  })
  .strict();

const CreateSchema = z.object({
  op: z.literal('create'),
  tripId: z.string().uuid(),
  settings: SettingsPatchSchema.optional(),
});

const ReadSchema = z.object({
  op: z.literal('read'),
  token: z.string().min(16).max(128),
});

const RevokeSchema = z.object({
  op: z.literal('revoke'),
  tripId: z.string().uuid(),
  token: z.string().min(16).max(128).optional(),
});

const CurrentSchema = z.object({
  op: z.literal('current'),
  tripId: z.string().uuid(),
});

const UpdateSettingsSchema = z.object({
  op: z.literal('update_settings'),
  tripId: z.string().uuid(),
  token: z.string().min(16).max(128).optional(),
  settings: SettingsPatchSchema.refine(
    (s: Partial<ShareSettings>) => Object.values(s).some((v) => typeof v === 'boolean'),
    { message: 'settings must set at least one toggle' },
  ),
});

const BodySchema = z.union([CreateSchema, ReadSchema, RevokeSchema, CurrentSchema, UpdateSettingsSchema]);

type Body =
  | { op: 'create'; tripId: string; settings?: Partial<ShareSettings> }
  | { op: 'read'; token: string }
  | { op: 'revoke'; tripId: string; token?: string }
  | { op: 'current'; tripId: string }
  | { op: 'update_settings'; tripId: string; token?: string; settings: Partial<ShareSettings> };

type OwnerOp = Exclude<Body['op'], 'read'>;

// 30-day TTL on trip_legs. Legs derive from the Google Routes API (polyline,
// duration, distance) and fall under the 30-day ToS ceiling. Any leg whose
// `computed_at` is older than this window must be re-fetched — and must NOT be
// returned over the public share endpoint.
const LEG_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Lifetime of the memory photo URLs on a public read (BUILD-LOG Y2.5: 1 h). */
const PHOTO_URL_TTL_S = 60 * 60;
const MEMORIES_BUCKET = 'trip-memories';

/** Expenses are summed server-side; read them in pages (PostgREST max-rows is 1000). */
const EXPENSE_PAGE = 1000;
const EXPENSE_MAX_PAGES = 10;
/** fx_rates `in()` filter chunk (URL length). */
const RATE_DATE_CHUNK = 100;

/** Columns of a link row the owner ops return (token included: owner only). */
const OWNER_LINK_COLUMNS = `token, created_at, ${SHARE_SETTINGS_COLUMNS}`;

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function newToken(): string {
  const bytes = new Uint8Array(16); // 128 bits
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

function prefix(token: string): string {
  return token.slice(0, 8);
}

interface OwnerLinkView {
  token: string;
  createdAt: string;
  settings: ShareSettings;
}

function toOwnerLinkView(row: Record<string, unknown>): OwnerLinkView {
  return {
    token: String(row.token ?? ''),
    createdAt: String(row.created_at ?? ''),
    settings: settingsFromRow(row),
  };
}

function newestFirst(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return [...rows].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
}

// ---- caller identity (owner ops) ----------------------------------------------

function extractBearer(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? '';
  const m = /^Bearer\s+(.+)$/.exec(header);
  return m?.[1] ? m[1].trim() : null;
}

type UserClient = ReturnType<typeof makeUserClient>;
type AdminClient = ReturnType<typeof makeAdminClient>;
type DbRow = Record<string, unknown>;
type DbError = { message: string } | null;

/**
 * Verify the bearer JWT and return the caller's user id, or null when the
 * header is missing, is the anon key (anonymous share viewers send it), or is
 * otherwise invalid. `userClient` is the anon-key client carrying the caller's
 * JWT (makeUserClient) — no RLS bypass. `auth.getUser(jwt)` round-trips to
 * GoTrue, so a forged / expired / signed-out token is rejected.
 */
async function authenticate(userClient: UserClient, req: Request): Promise<{ id: string } | null> {
  const jwt = extractBearer(req);
  if (!jwt) return null;
  const { data, error } = await userClient.auth.getUser(jwt);
  if (error || !data?.user?.id) return null;
  return { id: data.user.id };
}

/**
 * Owner gate shared by every owner op. Returns an error Response to send, or
 * null when the caller owns the trip.
 *   - trip not visible under the caller's JWT (RLS)   → 404 not_found
 *   - visible but `user_id !== caller` (collaborator)  → 403 not_owner
 */
async function requireOwner(
  user: UserClient,
  tripId: string,
  callerId: string,
  op: OwnerOp,
  requestId: string,
  origin: string | null,
): Promise<Response | null> {
  const { data: trip, error: tripErr } = await user
    .from('trips')
    .select('id, user_id')
    .eq('id', tripId)
    .maybeSingle();
  if (tripErr) {
    log({ requestId, fn: 'share-trip', op, level: 'error', tripId, err: tripErr.message });
    return errorResponse('db_error', 'Failed to load trip', 500, origin);
  }
  if (!trip) {
    return errorResponse('not_found', 'Trip not found or forbidden', 404, origin);
  }
  if ((trip as { user_id?: string }).user_id !== callerId) {
    log({
      requestId,
      fn: 'share-trip',
      op,
      level: 'warn',
      result: 'not_owner',
      tripId,
      userId: callerId,
    });
    return errorResponse(
      'not_owner',
      'Only the trip owner can manage public share links',
      403,
      origin,
    );
  }
  return null;
}

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const requestId = newRequestId();

  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  if (url.searchParams.has('ping')) {
    return jsonResponse({ ok: true, fn: 'share-trip' }, { origin });
  }

  if (req.method !== 'POST') {
    return errorResponse('method_not_allowed', 'Only POST is allowed', 405, origin);
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse('invalid_input', 'Invalid JSON', 400, origin);
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(
      'invalid_input',
      parsed.error.issues.map((i: { message: string }) => i.message).join('; '),
      400,
      origin,
    );
  }
  const body = parsed.data as Body;

  try {
    if (body.op === 'read') return await handleRead(body, requestId, origin);

    const userClient = makeUserClient(req);
    const caller = await authenticate(userClient, req);
    if (!caller) {
      return errorResponse('not_authenticated', 'Missing or invalid bearer token', 401, origin);
    }
    const denied = await requireOwner(userClient, body.tripId, caller.id, body.op, requestId, origin);
    if (denied) return denied;
    switch (body.op) {
      case 'create':
        return await handleCreate(body, caller.id, requestId, origin);
      case 'revoke':
        return await handleRevoke(body, caller.id, requestId, origin);
      case 'current':
        return await handleCurrent(body, caller.id, requestId, origin);
      case 'update_settings':
        return await handleUpdateSettings(body, caller.id, requestId, origin);
      default:
        return errorResponse('invalid_input', 'Unknown op', 400, origin);
    }
  } catch (err) {
    log({
      requestId,
      fn: 'share-trip',
      level: 'error',
      op: body.op,
      err: String(err),
    });
    return errorResponse('internal_error', 'share-trip failed', 500, origin);
  }
}

// ---- create ---------------------------------------------------------------

async function handleCreate(
  body: { tripId: string; settings?: Partial<ShareSettings> },
  callerId: string,
  requestId: string,
  origin: string | null,
): Promise<Response> {
  // Ownership was proven by requireOwner (auth.getUser + RLS-scoped trip
  // read + user_id match). Insert via the admin client so the token is always
  // generated server-side; `trip_shares` has no client-facing write path.
  const admin = makeAdminClient();

  // Toggles not given in the request inherit from the newest active link,
  // so minting a second link never silently changes what the trip shows.
  // A failed read fails CLOSED (no link) rather than guessing defaults that
  // could be wider than what the owner chose.
  const { data: prev, error: prevErr } = await admin
    .from('trip_shares')
    .select(`created_at, ${SHARE_SETTINGS_COLUMNS}`)
    .eq('trip_id', body.tripId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (prevErr) {
    log({ requestId, fn: 'share-trip', op: 'create', level: 'error', stage: 'inherit', err: prevErr.message });
    return errorResponse('db_error', 'Failed to create share', 500, origin);
  }
  const base = prev ? settingsFromRow(prev as DbRow) : { ...DEFAULT_SHARE_SETTINGS };
  const settings: ShareSettings = { ...base, ...(body.settings ? pickDefined(body.settings) : {}) };

  const token = newToken();
  const createdAt = new Date().toISOString();
  const { error: insertErr } = await admin
    .from('trip_shares')
    .insert({ trip_id: body.tripId, token, created_at: createdAt, ...settingsToColumns(settings) });
  if (insertErr) {
    log({
      requestId,
      fn: 'share-trip',
      op: 'create',
      level: 'error',
      err: insertErr.message,
    });
    return errorResponse('db_error', 'Failed to create share', 500, origin);
  }

  log({
    requestId,
    fn: 'share-trip',
    op: 'create',
    level: 'info',
    tripId: body.tripId,
    userId: callerId,
    tokenPrefix: prefix(token),
    settings,
  });

  return jsonResponse({ token, createdAt, settings }, { origin });
}

function pickDefined(patch: Partial<ShareSettings>): Partial<ShareSettings> {
  const out: Partial<ShareSettings> = {};
  if (typeof patch.showItinerary === 'boolean') out.showItinerary = patch.showItinerary;
  if (typeof patch.showExpenses === 'boolean') out.showExpenses = patch.showExpenses;
  if (typeof patch.showMemories === 'boolean') out.showMemories = patch.showMemories;
  return out;
}

// ---- current (owner "get current link") ---------------------------------------

async function handleCurrent(
  body: { tripId: string },
  callerId: string,
  requestId: string,
  origin: string | null,
): Promise<Response> {
  // Owner proven by requireOwner. Admin read: `trip_shares` has no SELECT
  // policy (tokens stay unreadable to every client role); this owner-gated
  // op is the one place a live token is re-revealed, and only to the owner.
  const admin = makeAdminClient();
  const { data, error } = await admin
    .from('trip_shares')
    .select(OWNER_LINK_COLUMNS)
    .eq('trip_id', body.tripId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    log({ requestId, fn: 'share-trip', op: 'current', level: 'error', err: error.message });
    return errorResponse('db_error', 'Failed to read share link', 500, origin);
  }
  const share = data ? toOwnerLinkView(data as DbRow) : null;
  log({
    requestId,
    fn: 'share-trip',
    op: 'current',
    level: 'info',
    tripId: body.tripId,
    userId: callerId,
    tokenPrefix: share ? prefix(share.token) : null,
  });
  return jsonResponse({ share, meta: { contractVersion: SHARE_READ_CONTRACT_VERSION } }, { origin });
}

// ---- update_settings (owner toggles) -------------------------------------------

async function handleUpdateSettings(
  body: { tripId: string; token?: string; settings: Partial<ShareSettings> },
  callerId: string,
  requestId: string,
  origin: string | null,
): Promise<Response> {
  // Admin write for the same reason as revoke (no SELECT policy → an UPDATE
  // under the user JWT matches 0 rows). Owner proven by requireOwner; the
  // trip_id filter keeps the write inside that trip even with a `token`.
  const admin = makeAdminClient();
  const columns = settingsToColumns(body.settings);
  let q = admin.from('trip_shares').update(columns).eq('trip_id', body.tripId).is('revoked_at', null);
  if (body.token) q = q.eq('token', body.token);
  const { data, error } = await q.select(OWNER_LINK_COLUMNS);
  if (error) {
    log({ requestId, fn: 'share-trip', op: 'update_settings', level: 'error', err: error.message });
    return errorResponse('db_error', 'Failed to update share settings', 500, origin);
  }
  const rows = newestFirst((data ?? []) as DbRow[]);
  if (rows.length === 0) {
    return errorResponse('no_active_link', 'This trip has no active share link', 404, origin);
  }
  const share = toOwnerLinkView(rows[0]!);
  log({
    requestId,
    fn: 'share-trip',
    op: 'update_settings',
    level: 'info',
    tripId: body.tripId,
    userId: callerId,
    tokenPrefix: body.token ? prefix(body.token) : null,
    updated: rows.length,
    columns,
  });
  return jsonResponse(
    { share, updated: rows.length, meta: { contractVersion: SHARE_READ_CONTRACT_VERSION } },
    { origin },
  );
}

// ---- read (anonymous) -----------------------------------------------------

interface ReadSection<T> {
  value: T | null;
  error: DbError;
}

async function fetchExpenseSummary(
  admin: AdminClient,
  tripId: string,
  homeCurrency: string,
): Promise<ReadSection<PublicExpenseSummary>> {
  const rows: ExpenseSummaryRow[] = [];
  for (let page = 0; page < EXPENSE_MAX_PAGES; page++) {
    const from = page * EXPENSE_PAGE;
    const { data, error } = await admin
      .from('trip_expenses')
      .select(EXPENSE_SUMMARY_FIELDS)
      .eq('trip_id', tripId)
      // Tombstones are deleted expenses: never part of any total.
      .eq('deleted', false)
      .order('id', { ascending: true })
      .range(from, from + EXPENSE_PAGE - 1);
    if (error) return { value: null, error };
    const batch = (data ?? []) as ExpenseSummaryRow[];
    rows.push(...batch);
    if (batch.length < EXPENSE_PAGE) break;
  }

  const rates = new Map<string, number>();
  const need = rateLookupsNeeded(rows, homeCurrency);
  if (need.dates.length > 0 && need.quotes.length > 0) {
    for (let i = 0; i < need.dates.length; i += RATE_DATE_CHUNK) {
      const { data, error } = await admin
        .from('fx_rates')
        .select('quote, rate_date, rate')
        .eq('base', 'EUR')
        .in('quote', need.quotes)
        .in('rate_date', need.dates.slice(i, i + RATE_DATE_CHUNK));
      if (error) return { value: null, error };
      for (const r of (data ?? []) as DbRow[]) {
        const rate = Number(r.rate);
        if (typeof r.quote === 'string' && typeof r.rate_date === 'string' && rate > 0) {
          rates.set(rateKey(r.rate_date.slice(0, 10), r.quote), rate);
        }
      }
    }
  }
  return { value: summarizeExpenses(rows, homeCurrency, rates), error: null };
}

async function fetchMemories(
  admin: AdminClient,
  tripId: string,
  places: readonly DbRow[],
  publicPlaceIds: ReadonlySet<string>,
  requestId: string,
): Promise<ReadSection<PublicMemories>> {
  // The privacy filter is IN THE QUERY (least data fetched) and re-applied
  // by buildPublicMemories / photoPathsToSign (defense in depth).
  const [journalRes, reviewsRes, photosRes] = await Promise.all([
    admin
      .from('trip_journal_entries')
      .select(PUBLIC_JOURNAL_FIELDS)
      .eq('trip_id', tripId)
      .eq('visibility', 'trip')
      .eq('deleted', false)
      .order('day_index', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(MAX_PUBLIC_JOURNAL + 1),
    admin
      .from('trip_place_reviews')
      .select(PUBLIC_REVIEW_FIELDS)
      .eq('trip_id', tripId)
      .eq('visibility', 'trip')
      .eq('deleted', false)
      .order('created_at', { ascending: false })
      .limit(MAX_PUBLIC_REVIEWS + 1),
    admin
      .from('trip_photos')
      .select(PUBLIC_PHOTO_FIELDS)
      .eq('trip_id', tripId)
      .eq('visibility', 'trip')
      .eq('deleted', false)
      .eq('status', 'ready')
      .order('day_index', { ascending: true, nullsFirst: false })
      .order('taken_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(MAX_PUBLIC_PHOTOS + 1),
  ]);
  const error = journalRes.error ?? reviewsRes.error ?? photosRes.error;
  if (error) return { value: null, error };

  const journal = ((journalRes.data ?? []) as DbRow[]);
  const reviews = ((reviewsRes.data ?? []) as DbRow[]);
  const photos = ((photosRes.data ?? []) as DbRow[]);
  const truncated =
    journal.length > MAX_PUBLIC_JOURNAL || reviews.length > MAX_PUBLIC_REVIEWS || photos.length > MAX_PUBLIC_PHOTOS;
  const keptPhotos = photos.slice(0, MAX_PUBLIC_PHOTOS);

  const signed = new Map<string, string>();
  let photoUrlExpiresAt: string | null = null;
  const paths = photoPathsToSign(keptPhotos);
  if (paths.length > 0) {
    photoUrlExpiresAt = new Date(Date.now() + PHOTO_URL_TTL_S * 1000).toISOString();
    const { data, error: signErr } = await admin.storage
      .from(MEMORIES_BUCKET)
      .createSignedUrls(paths, PHOTO_URL_TTL_S);
    if (signErr) {
      // A Storage hiccup hides the photos; the rest of the page still loads.
      log({ requestId, fn: 'share-trip', op: 'read', level: 'warn', stage: 'sign', err: signErr.message });
    }
    for (const d of (data ?? []) as Array<{ path?: string | null; signedUrl?: string | null; error?: unknown }>) {
      // Absolute URLs on SUPABASE_URL: the public project URL in production.
      // Locally the edge runtime signs on its docker-internal origin
      // (http://kong:8000); src/api/share.ts re-bases signed Storage URLs
      // onto the app's own Supabase URL, so the app works in both.
      if (d.path && d.signedUrl && !d.error) signed.set(d.path, d.signedUrl);
    }
  }

  return {
    value: buildPublicMemories({
      journal: journal.slice(0, MAX_PUBLIC_JOURNAL),
      reviews: reviews.slice(0, MAX_PUBLIC_REVIEWS),
      photos: keptPhotos,
      places,
      publicPlaceIds,
      signed,
      photoUrlExpiresAt,
      truncated,
    }),
    error: null,
  };
}

async function handleRead(
  body: { token: string },
  requestId: string,
  origin: string | null,
): Promise<Response> {
  const admin = makeAdminClient();

  const { data: share, error: shareErr } = await admin
    .from('trip_shares')
    .select(`trip_id, revoked_at, ${SHARE_SETTINGS_COLUMNS}`)
    .eq('token', body.token)
    .maybeSingle();

  if (shareErr) {
    log({ requestId, fn: 'share-trip', op: 'read', level: 'error', err: shareErr.message });
    return errorResponse('db_error', 'Failed to read share link', 500, origin);
  }
  const shareRow = share as ({ trip_id: string; revoked_at: string | null } & DbRow) | null;
  if (!shareRow || shareRow.revoked_at) {
    log({
      requestId,
      fn: 'share-trip',
      op: 'read',
      level: 'info',
      result: 'not_found',
      tokenPrefix: prefix(body.token),
    });
    return errorResponse('not_found', 'Share link not found or revoked', 404, origin);
  }
  const tripId = shareRow.trip_id;
  const settings = settingsFromRow(shareRow);

  // Fetch the trip, its places, and its legs — allow-listed columns only
  // (./public-fields.ts), then re-shaped through the same allow-list below.
  //
  // `trip_legs` is additionally filtered by a 30-day TTL on `computed_at` — any
  // leg older than `LEG_TTL_MS` has aged past the Google Routes ToS ceiling
  // and must not be returned. Stale legs are quietly omitted; the client will
  // render those segments as degraded/missing until the owner re-optimizes.
  //
  // Places are also read when only memories are on: review names come from
  // the live place titles (they are not returned unless the itinerary is on).
  const legTtlCutoff = new Date(Date.now() - LEG_TTL_MS).toISOString();
  const needPlaces = settings.showItinerary || settings.showMemories;
  const empty = Promise.resolve({ data: [] as DbRow[], error: null as DbError });
  const [tripRes, placesRes, legsRes] = await Promise.all([
    admin
      .from('trips')
      // `currency` only feeds the expenses summary; pickPublic drops it.
      .select(settings.showExpenses ? `${TRIP_FIELDS}, currency` : TRIP_FIELDS)
      .eq('id', tripId)
      .maybeSingle(),
    needPlaces
      ? admin
        .from('trip_places')
        .select(PLACE_FIELDS)
        .eq('trip_id', tripId)
        // v2 S2.8.1: soft-delete tombstones (migration 0027, NOT NULL DEFAULT
        // false) must never surface on a share link — this read runs under the
        // admin client, so the filter is the only thing standing between a
        // user-deleted place and an anonymous viewer.
        .eq('deleted', false)
        .order('day_index', { ascending: true, nullsFirst: true })
        .order('order_in_day', { ascending: true, nullsFirst: true })
      : empty,
    settings.showItinerary
      ? admin
        .from('trip_legs')
        .select(LEG_FIELDS)
        .eq('trip_id', tripId)
        .gte('computed_at', legTtlCutoff)
      : empty,
  ]);

  // DB error text is logged, never echoed to anonymous callers.
  const dbErr = tripRes.error ?? placesRes.error ?? legsRes.error;
  if (dbErr) {
    log({ requestId, fn: 'share-trip', op: 'read', level: 'error', err: dbErr.message });
    return errorResponse('db_error', 'Failed to load shared trip', 500, origin);
  }
  if (!tripRes.data) {
    // Trip was deleted but the share row survived (shouldn't happen with FK cascade,
    // but defensive).
    return errorResponse('not_found', 'Trip no longer exists', 404, origin);
  }
  const trip = tripRes.data as unknown as DbRow;
  const places = (placesRes.data ?? []) as unknown as DbRow[];
  const legs = (legsRes.data ?? []) as unknown as DbRow[];
  const publicPlaceIds = new Set<string>(
    settings.showItinerary ? places.map((p) => String(p.id ?? '')).filter(Boolean) : [],
  );

  const homeCurrency = typeof trip.currency === 'string' && /^[A-Z]{3}$/.test(trip.currency)
    ? trip.currency
    : 'EUR';
  const [expensesRes, memoriesRes] = await Promise.all([
    settings.showExpenses
      ? fetchExpenseSummary(admin, tripId, homeCurrency)
      : Promise.resolve({ value: null, error: null } as ReadSection<PublicExpenseSummary>),
    settings.showMemories
      ? fetchMemories(admin, tripId, places, publicPlaceIds, requestId)
      : Promise.resolve({ value: null, error: null } as ReadSection<PublicMemories>),
  ]);
  const sectionErr = expensesRes.error ?? memoriesRes.error;
  if (sectionErr) {
    log({ requestId, fn: 'share-trip', op: 'read', level: 'error', stage: 'sections', err: sectionErr.message });
    return errorResponse('db_error', 'Failed to load shared trip', 500, origin);
  }

  const payload = buildPublicSharePayload<PublicExpenseSummary>({
    trip,
    places,
    legs,
    settings,
    expenses: expensesRes.value,
    memories: memoriesRes.value,
  });

  log({
    requestId,
    fn: 'share-trip',
    op: 'read',
    level: 'info',
    tokenPrefix: prefix(body.token),
    tripId,
    sections: payload.sections,
    placeCount: payload.places.length,
    legCount: payload.legs.length,
    expenseCount: payload.expenses?.count ?? null,
    memoryCounts: payload.memories
      ? {
        journal: payload.memories.journal.length,
        reviews: payload.memories.reviews.length,
        photos: payload.memories.photos.length,
      }
      : null,
  });

  return jsonResponse(payload, { origin });
}

// ---- revoke ---------------------------------------------------------------

async function handleRevoke(
  body: { tripId: string; token?: string },
  callerId: string,
  requestId: string,
  origin: string | null,
): Promise<Response> {
  // Update via the admin client. We CANNOT use the user-JWT client here:
  // `trip_shares` has no SELECT policy by design (tokens must never be
  // readable post-creation), and Postgres requires a row to be visible via
  // the SELECT policy in order for UPDATE / DELETE to find it. Without that,
  // an UPDATE under the user JWT silently affects 0 rows even though the
  // UPDATE policy's USING clause would otherwise permit it. Ownership has
  // already been proven by requireOwner (caller === trips.user_id), so the
  // admin client write is safe.
  const admin = makeAdminClient();
  const nowIso = new Date().toISOString();
  let q = admin.from('trip_shares').update({ revoked_at: nowIso }).eq('trip_id', body.tripId);
  if (body.token) q = q.eq('token', body.token);
  // Don't re-stamp already-revoked rows.
  q = q.is('revoked_at', null);
  const { error: updErr } = await q;
  if (updErr) {
    log({
      requestId,
      fn: 'share-trip',
      op: 'revoke',
      level: 'error',
      err: updErr.message,
    });
    return errorResponse('db_error', 'Failed to revoke share', 500, origin);
  }

  // Count rows just revoked via admin client (no SELECT policy for owner).
  let countQ = admin
    .from('trip_shares')
    .select('id', { count: 'exact', head: true })
    .eq('trip_id', body.tripId)
    .eq('revoked_at', nowIso);
  if (body.token) countQ = countQ.eq('token', body.token);
  const { count, error: countErr } = await countQ;
  if (countErr) {
    log({
      requestId,
      fn: 'share-trip',
      op: 'revoke',
      level: 'warn',
      err: countErr.message,
    });
  }

  log({
    requestId,
    fn: 'share-trip',
    op: 'revoke',
    level: 'info',
    tripId: body.tripId,
    userId: callerId,
    tokenPrefix: body.token ? prefix(body.token) : null,
    revoked: count ?? 0,
  });

  return jsonResponse({ revoked: count ?? 0 }, { origin });
}

