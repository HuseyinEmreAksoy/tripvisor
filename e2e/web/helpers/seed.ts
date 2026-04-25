/**
 * Playwright seed helpers (Step 5.4).
 *
 * Used to insert test data directly into the local Supabase instance using
 * the service-role client, bypassing RLS. Suitable for test setup / teardown
 * only — never run against the production project.
 *
 * Guard: all helpers throw if EXPO_PUBLIC_SUPABASE_URL does not contain
 * "localhost" or "127.0.0.1" to prevent accidental prod writes.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ── types ─────────────────────────────────────────────────────────────────────

export interface SeedPlace {
  google_place_id: string;
  lat: number;
  lng: number;
  visit_duration_minutes?: number;
  user_title?: string;
  category?: string;
}

export interface SeedTripInput {
  userId: string;
  title: string;
  places?: SeedPlace[];
  /** ISO date string, e.g. "2026-06-01". Optional. */
  startDate?: string;
  /** ISO date string. Optional. */
  endDate?: string;
  dailyHoursBudget?: number;
  transportMode?: string;
}

export interface SeedTripResult {
  tripId: string;
  placeIds: string[];
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a Supabase service-role admin client from env.
 * Throws loud if URL points to production.
 */
export function makeAdminClient(): SupabaseClient {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!url) {
    throw new Error('[seed] SUPABASE_URL is not set — cannot seed without a DB URL');
  }
  if (!/localhost|127\.0\.0\.1|54321/.test(url)) {
    throw new Error(
      `[seed] Refusing to seed against non-local Supabase URL: ${url}. ` +
        'Only localhost/127.0.0.1 is allowed in E2E helpers.',
    );
  }
  if (!key) {
    throw new Error('[seed] SUPABASE_SERVICE_ROLE_KEY is not set');
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Insert a trip + optional places directly into the DB, bypassing RLS.
 * Returns the created IDs for cleanup.
 */
export async function seedTrip(
  serviceClient: SupabaseClient,
  input: SeedTripInput,
): Promise<SeedTripResult> {
  const tripInsert = await serviceClient
    .from('trips')
    .insert({
      user_id: input.userId,
      title: input.title,
      daily_hours_budget: input.dailyHoursBudget ?? 8,
      transport_mode: input.transportMode ?? 'driving',
      ...(input.startDate ? { start_date: input.startDate } : {}),
      ...(input.endDate ? { end_date: input.endDate } : {}),
    })
    .select('id')
    .single();

  if (tripInsert.error) {
    throw new Error(`[seed] Failed to insert trip: ${tripInsert.error.message}`);
  }

  const tripId = tripInsert.data!.id as string;
  const placeIds: string[] = [];

  const places = input.places ?? [];
  for (let i = 0; i < places.length; i++) {
    const p = places[i]!;
    const placeInsert = await serviceClient
      .from('trip_places')
      .insert({
        trip_id: tripId,
        google_place_id: p.google_place_id,
        lat: p.lat,
        lng: p.lng,
        visit_duration_minutes: p.visit_duration_minutes ?? 60,
        user_title: p.user_title ?? null,
        category: p.category ?? null,
        day_index: 0,
        order_in_day: i,
      })
      .select('id')
      .single();

    if (placeInsert.error) {
      throw new Error(`[seed] Failed to insert place ${p.google_place_id}: ${placeInsert.error.message}`);
    }
    placeIds.push(placeInsert.data!.id as string);
  }

  return { tripId, placeIds };
}

/**
 * Remove a trip and all its child rows (cascade should handle children,
 * but we delete places explicitly to be safe with future migrations).
 */
export async function clearTrip(
  serviceClient: SupabaseClient,
  tripId: string,
): Promise<void> {
  await serviceClient.from('trip_legs').delete().eq('trip_id', tripId);
  await serviceClient.from('trip_places').delete().eq('trip_id', tripId);
  await serviceClient.from('trip_shares').delete().eq('trip_id', tripId);
  await serviceClient.from('trips').delete().eq('id', tripId);
}
