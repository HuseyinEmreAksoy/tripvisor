/**
 * mutations.ts — the app-facing write API for the Tier-1 write-enabled slice
 * (v2 S2 Wave 3a; trips + trip_places per S2.4).
 *
 * This is the surface Wave 3b's drag path and the eventual flag-flip repoint
 * call INSTEAD of the v1 PostgREST hooks. Every helper writes the
 * `tier1Store$` observables only — the sync engine (hydrate.ts) diffs the
 * change, runs it through the sanitizeForTier1Write firewall, and queues the
 * PostgREST write (offline-safe, infinite retry). Nothing here touches the
 * network directly.
 *
 * ── Rules inherited from the Wave-2 engine (hydrate.ts header — read it):
 *   - CLIENT MINTS IDS: the engine has no generateId; `crypto.randomUUID()`
 *     with a Math.random RFC4122-shaped fallback (Postgres uuid columns
 *     reject non-uuid strings, so the ai.ts-style compact fallback is NOT
 *     usable here).
 *   - NEVER set created_at/updated_at: created_at ABSENCE is the plugin's
 *     create/update discriminator (a client-set created_at would make the
 *     engine misclassify the create as an update → `.eq('id', …)` UPDATE on
 *     a row that doesn't exist → silent no-op). updated_at is the LWW clock,
 *     server-stamped by handle_times().
 *   - CREATES ARE COMPLETE: every allowlisted field is set explicitly, nulls
 *     included. The plugin sends FULL rows (updatePartial: false), so an
 *     update racing its own unacked create must find every field already in
 *     the store row — a sparse create + racing update can drop fields or
 *     no-op.
 *   - DELETE = TOMBSTONE: `deleted: true` (trip_places). Trips have NO
 *     tombstone column by design (0027) — archive is their lifecycle, so
 *     `tombstoneTrip` archives.
 *
 * ── Gating
 * Every helper throws {@link SyncWriteError} when the Tier-1 engine is not
 * the active write path (flag off / not initialized / torn down) or the
 * table is outside the write slice. Callers MUST branch on
 * {@link isTier1SyncActive} and fall back to the v1 PostgREST hooks — this
 * keeps the engine flag-gated OFF without dual-writing.
 *
 * ── Undo integration (S2.5)
 * update/tombstone/rank helpers capture prior values BEFORE mutating and
 * return an {@link UndoEntry} — push it onto the session stack:
 * `undo.push(updateTrip(id, patch))`. Creates return the minted id (create
 * undo = tombstone, composed by the caller when wanted). Bulk rank
 * snapshot/restore primitives back the optimize/AI-apply undo cases — see
 * the five-case catalog in undo.ts.
 */

import type {
  RouteRenderMode,
  TransportMode,
  Trip,
  TripCurrency,
  TripPlace,
} from '../api/types';
import {
  TIER1_WRITE_FIELDS,
  isTier1WriteTable,
  type Tier1Table,
} from './allowlist';
import { isTier1SyncEnabled } from './flags';
import { isTier1SyncInitialized } from './hydrate';
import { tier1Store$ } from './store';

// Legend-State record nodes are materialized on first access — indexing
// never yields undefined at runtime (.peek() returns undefined for missing
// ROWS, but the NODE itself always exists). This bridge satisfies
// noUncheckedIndexedAccess without sprinkling non-null assertions.
function node<T>(maybe: T | undefined): T {
  return maybe as T;
}
import type { UndoEntry } from './undo';

// ───────────────────────────────────────────────────────────────────────────
// Gate
// ───────────────────────────────────────────────────────────────────────────

/**
 * Is the Tier-1 sync engine the ACTIVE write path right now?
 * True only when the flag resolved on AND initTier1Sync attached the engine
 * this session (and it has not been torn down). Callers branch on this and
 * use the v1 PostgREST hooks otherwise.
 */
export function isTier1SyncActive(): boolean {
  return isTier1SyncEnabled() && isTier1SyncInitialized();
}

export type SyncWriteErrorCode = 'sync_inactive' | 'table_not_writable' | 'row_not_found';

/** Typed error for the gate + lookup failures (mirrors PlacesError/AuthMutationError). */
export class SyncWriteError extends Error {
  readonly code: SyncWriteErrorCode;

  constructor(code: SyncWriteErrorCode, message: string) {
    super(`[sync.mutations] ${message}`);
    this.name = 'SyncWriteError';
    this.code = code;
  }
}

function assertWritable(table: Tier1Table): void {
  if (!isTier1SyncActive()) {
    throw new SyncWriteError(
      'sync_inactive',
      'Tier-1 sync is not active (flag off, not initialized, or torn down) — use the v1 PostgREST mutation hooks. Branch on isTier1SyncActive().',
    );
  }
  if (!isTier1WriteTable(table)) {
    throw new SyncWriteError(
      'table_not_writable',
      `table "${table}" is not in the Tier-1 write slice (S2.4: trips, trip_places)`,
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Id minting
// ───────────────────────────────────────────────────────────────────────────

/**
 * Client-minted row UUID. crypto.randomUUID ships in Expo SDK 52+ Hermes and
 * every modern browser; the fallback is the RFC4122-v4-shaped Math.random
 * pattern (same as AccommodationEditSheet.makeSessionToken) because the
 * Postgres `uuid` PK rejects anything that doesn't parse as a UUID.
 */
function mintId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to fallback
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Patch hygiene
// ───────────────────────────────────────────────────────────────────────────

/** Runtime mirrors of the compile-time patch types: only client-writable,
 * non-structural fields may enter the store through update helpers. The
 * write firewall (transform.save) would strip junk on the wire anyway, but
 * filtering here keeps the STORE clean too (defense in depth — a junk field
 * would otherwise sit in SQLite until the next cold-start sanitize). */
const TRIP_PATCH_FIELDS: ReadonlySet<string> = new Set(TIER1_WRITE_FIELDS.trips);
const PLACE_PATCH_FIELDS: ReadonlySet<string> = new Set(
  // `deleted` is excluded: tombstonePlace() is the only sanctioned writer.
  TIER1_WRITE_FIELDS.trip_places.filter((f) => f !== 'deleted'),
);

/**
 * Project `patch` onto `allowed`, skipping undefined values (undefined would
 * clobber store merges; "set to null" is the explicit clear). Returns the
 * cleaned patch and the captured prior values for the inverse op.
 */
function capturePatch(
  patch: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  prev: Record<string, unknown>,
): { clean: Record<string, unknown>; prior: Record<string, unknown> } {
  const clean: Record<string, unknown> = {};
  const prior: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key) || patch[key] === undefined) continue;
    clean[key] = patch[key];
    // Absent prior value (sparse hydrated row) restores as explicit null —
    // assigning undefined back would be a no-op merge, not a revert.
    prior[key] = prev[key] === undefined ? null : prev[key];
  }
  return { clean, prior };
}

// ───────────────────────────────────────────────────────────────────────────
// Trips
// ───────────────────────────────────────────────────────────────────────────

export interface CreateTripInput {
  title: string;
  start_date?: string | null;
  end_date?: string | null;
  /** Defaults to 8 (mirrors the DB default — sent explicitly per the complete-create rule). */
  daily_hours_budget?: number;
  anchor_place_id?: string | null;
  /** Defaults to 'driving' (DB default). */
  transport_mode?: TransportMode;
  timezone?: string | null;
  /** Defaults to 'USD' (DB default). */
  currency?: TripCurrency;
  total_budget?: number | null;
  /** Defaults to 'optimized' (DB default). */
  route_render_mode?: RouteRenderMode;
  cover_photo_google_place_id?: string | null;
}

/** Store shape of a locally-created trip: no server-stamped fields, no
 * client-derived view-model fields. `user_id` is stamped by hydrate.ts from
 * the authenticated session at the write boundary — never set here. */
type TripCreateRow = Omit<Trip, 'user_id' | 'created_at' | 'updated_at' | 'isOwner' | 'collaboratorRole'>;

/**
 * Create a trip through the sync engine. Returns the minted trip id
 * synchronously — the row is in the local store immediately (optimistic);
 * the engine queues the INSERT (offline-safe).
 */
export function createTrip(input: CreateTripInput): string {
  assertWritable('trips');
  const id = mintId();
  // COMPLETE create: every write-allowlisted field explicit (nulls included),
  // created_at/updated_at/user_id deliberately ABSENT — see module header.
  const row: TripCreateRow = {
    id,
    title: input.title,
    start_date: input.start_date ?? null,
    end_date: input.end_date ?? null,
    daily_hours_budget: input.daily_hours_budget ?? 8,
    anchor_place_id: input.anchor_place_id ?? null,
    transport_mode: input.transport_mode ?? 'driving',
    timezone: input.timezone ?? null,
    archived_at: null,
    currency: input.currency ?? 'USD',
    total_budget: input.total_budget ?? null,
    route_render_mode: input.route_render_mode ?? 'optimized',
    cover_photo_google_place_id: input.cover_photo_google_place_id ?? null,
  };
  // Cast rationale: the store row type (Trip) declares the server-stamped
  // fields as required because HYDRATED rows always carry them; a local
  // create must omit them (created_at absence IS the create signal). The
  // server's returned row merges them in on ack.
  node(tier1Store$.trips[id]).set(row as Trip);
  return id;
}

/** Client-writable trip fields (the TIER1_WRITE_FIELDS.trips subset). */
export type TripWritePatch = Partial<
  Pick<
    Trip,
    | 'title'
    | 'start_date'
    | 'end_date'
    | 'daily_hours_budget'
    | 'anchor_place_id'
    | 'transport_mode'
    | 'timezone'
    | 'archived_at'
    | 'currency'
    | 'total_budget'
    | 'route_render_mode'
    | 'cover_photo_google_place_id'
  >
>;

/**
 * Patch a trip. Captures prior values first and returns the inverse-op
 * entry: `undo.push(updateTrip(id, { title }))`.
 */
export function updateTrip(id: string, patch: TripWritePatch, label = 'Edit trip'): UndoEntry {
  assertWritable('trips');
  const prev = node(tier1Store$.trips[id]).peek();
  if (!prev) throw new SyncWriteError('row_not_found', `trip "${id}" is not in the local store`);
  const { clean, prior } = capturePatch(
    patch as Record<string, unknown>,
    TRIP_PATCH_FIELDS,
    prev as unknown as Record<string, unknown>,
  );
  node(tier1Store$.trips[id]).assign(clean as TripWritePatch);
  return {
    label,
    inverse: () => {
      assertWritable('trips');
      node(tier1Store$.trips[id]).assign(prior as TripWritePatch);
    },
  };
}

/**
 * "Tombstone" a trip — which for trips means ARCHIVE (`archived_at = now`).
 * Trips have no `deleted` column on purpose (0027: archive is the trip
 * lifecycle; account deletion cascades server-side, and the engine's
 * fieldDeleted is not configured for trips). Inverse restores the prior
 * archived_at (normally null → un-archive).
 */
export function tombstoneTrip(id: string, label = 'Archive trip'): UndoEntry {
  return updateTrip(id, { archived_at: new Date().toISOString() }, label);
}

// ───────────────────────────────────────────────────────────────────────────
// Trip places
// ───────────────────────────────────────────────────────────────────────────

export interface CreatePlaceInput {
  trip_id: string;
  google_place_id: string;
  lat: number;
  lng: number;
  user_title?: string | null;
  category?: string | null;
  /** Defaults to 60 (DB default). */
  visit_duration_minutes?: number;
  notes?: string | null;
  arrive_after?: string | null;
  leave_before?: string | null;
  pinned_start?: string | null;
  /** Fractional-index user order (rank.ts). Defaults to null = "never
   * hand-ordered" — callers that insert into an ordered list compute
   * rankBetween(prevNeighbor, nextNeighbor) themselves. */
  manual_rank?: string | null;
}

/** Store shape of a locally-created place (no server timestamps). The
 * server-only order fields are present AS NULL: they belong to the READ
 * allowlist (so the store row carries them) but transform.save strips them
 * from the wire payload (C1 — optimizer-owned). */
type PlaceCreateRow = Omit<TripPlace, 'created_at' | 'updated_at'>;

/**
 * Create a place through the sync engine. Returns the minted place id.
 * Create-undo, when a flow wants it, is `tombstonePlace(id)` composed by the
 * caller.
 */
export function createPlace(input: CreatePlaceInput): string {
  assertWritable('trip_places');
  const id = mintId();
  const row: PlaceCreateRow = {
    id,
    trip_id: input.trip_id,
    google_place_id: input.google_place_id,
    user_title: input.user_title ?? null,
    category: input.category ?? null,
    lat: input.lat,
    lng: input.lng,
    visit_duration_minutes: input.visit_duration_minutes ?? 60,
    day_index: null,
    order_in_day: null,
    notes: input.notes ?? null,
    details_refreshed_at: null,
    arrive_after: input.arrive_after ?? null,
    leave_before: input.leave_before ?? null,
    pinned_start: input.pinned_start ?? null,
    manual_rank: input.manual_rank ?? null,
    deleted: false,
  };
  // Same cast rationale as createTrip: server-stamped fields must be absent.
  node(tier1Store$.tripPlaces[id]).set(row as TripPlace);
  return id;
}

/** Client-writable place fields. `deleted` is deliberately excluded —
 * tombstonePlace() owns the delete lifecycle (and its inverse). */
export type PlaceWritePatch = Partial<
  Pick<
    TripPlace,
    | 'google_place_id'
    | 'user_title'
    | 'category'
    | 'lat'
    | 'lng'
    | 'visit_duration_minutes'
    | 'notes'
    | 'arrive_after'
    | 'leave_before'
    | 'pinned_start'
    | 'manual_rank'
  >
>;

/** Patch a place; returns the inverse-op entry (prior values restore). */
export function updatePlace(id: string, patch: PlaceWritePatch, label = 'Edit place'): UndoEntry {
  assertWritable('trip_places');
  const prev = node(tier1Store$.tripPlaces[id]).peek();
  if (!prev) throw new SyncWriteError('row_not_found', `place "${id}" is not in the local store`);
  const { clean, prior } = capturePatch(
    patch as Record<string, unknown>,
    PLACE_PATCH_FIELDS,
    prev as unknown as Record<string, unknown>,
  );
  node(tier1Store$.tripPlaces[id]).assign(clean as PlaceWritePatch);
  return {
    label,
    inverse: () => {
      assertWritable('trip_places');
      node(tier1Store$.tripPlaces[id]).assign(prior as PlaceWritePatch);
    },
  };
}

/**
 * Tombstone a place (`deleted: true` → the engine emits
 * UPDATE … SET deleted = true; hard DELETEs don't replicate — hydrate.ts
 * header). Inverse un-tombstones: if the row is still in the local store it
 * just flips `deleted: false`; if the engine pruned it locally, the full
 * captured snapshot is re-seeded (its created_at marks it as an UPDATE of
 * the still-existing server row, never a duplicate INSERT).
 */
export function tombstonePlace(id: string, label = 'Remove place'): UndoEntry {
  assertWritable('trip_places');
  const prev = node(tier1Store$.tripPlaces[id]).peek();
  if (!prev) throw new SyncWriteError('row_not_found', `place "${id}" is not in the local store`);
  const snapshot: TripPlace = { ...prev };
  node(tier1Store$.tripPlaces[id]).deleted.set(true);
  return {
    label,
    inverse: () => {
      assertWritable('trip_places');
      const current = node(tier1Store$.tripPlaces[id]).peek();
      if (current) {
        node(tier1Store$.tripPlaces[id]).deleted.set(false);
      } else {
        node(tier1Store$.tripPlaces[id]).set({ ...snapshot, deleted: false });
      }
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Manual rank (S2.6 primitive) + bulk snapshot/restore (S2.5 cases 4–5)
// ───────────────────────────────────────────────────────────────────────────

/**
 * THE S2.6 primitive: write a place's user-intent order key. The rank comes
 * from rankBetween() over the new neighbors (rank.ts). LWW-synced, never
 * reverted on reconnect (C1: manual_rank is the only client-writable order
 * field; day_index/order_in_day stay optimizer-owned).
 */
export function setPlaceManualRank(placeId: string, rank: string, label = 'Reorder'): UndoEntry {
  assertWritable('trip_places');
  const prev = node(tier1Store$.tripPlaces[placeId]).peek();
  if (!prev) {
    throw new SyncWriteError('row_not_found', `place "${placeId}" is not in the local store`);
  }
  const prior = prev.manual_rank ?? null;
  node(tier1Store$.tripPlaces[placeId]).manual_rank.set(rank);
  return {
    label,
    inverse: () => {
      assertWritable('trip_places');
      node(tier1Store$.tripPlaces[placeId]).manual_rank.set(prior);
    },
  };
}

export interface RankSnapshot {
  tripId: string;
  /** Epoch ms — lets a future UI warn when restoring a stale snapshot. */
  takenAt: number;
  /** placeId → manual_rank at snapshot time (non-tombstoned places only). */
  ranks: Record<string, string | null>;
}

/**
 * Capture every (live) place's manual_rank for a trip — taken BEFORE an
 * optimize/AI-apply pass so its bulk overwrite is undoable (cases 4–5 in
 * undo.ts). Pure read; pair with restoreRanks in an UndoEntry closure.
 */
export function snapshotRanks(tripId: string): RankSnapshot {
  assertWritable('trip_places');
  const all = tier1Store$.tripPlaces.peek() ?? {};
  const ranks: Record<string, string | null> = {};
  for (const [id, row] of Object.entries(all)) {
    if (!row || row.trip_id !== tripId || row.deleted === true) continue;
    ranks[id] = row.manual_rank ?? null;
  }
  return { tripId, takenAt: Date.now(), ranks };
}

/**
 * Bulk-restore a rank snapshot. Places that vanished (tombstoned/pruned)
 * since the snapshot are SKIPPED — restoring order must never resurrect a
 * deleted place (that's tombstonePlace's inverse, a separate entry).
 */
export function restoreRanks(snapshot: RankSnapshot): void {
  assertWritable('trip_places');
  for (const [id, rank] of Object.entries(snapshot.ranks)) {
    const row = node(tier1Store$.tripPlaces[id]).peek();
    if (!row || row.deleted === true) continue;
    node(tier1Store$.tripPlaces[id]).manual_rank.set(rank);
  }
}
