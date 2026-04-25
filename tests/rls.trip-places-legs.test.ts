/**
 * RLS: trip_places + trip_legs — two-user isolation test (Step 5.3).
 *
 * Fills gaps #4 and #5 from the Phase 5 review:
 *   - trip_places SELECT / UPDATE / DELETE isolation (user B cannot act on
 *     places owned by user A's trip)
 *   - trip_legs full 4×4 matrix: SELECT / UPDATE / DELETE by user B, and
 *     anonymous SELECT — all must be denied
 *
 * Pattern mirrors tests/rls.test.ts and tests/rls.share.test.ts.
 *
 * Prerequisites:
 *   - Local Supabase running (`npx supabase start`)
 *   - Migrations applied (`npx supabase db reset`)
 *   - Env vars:
 *       SUPABASE_URL              (local, e.g. http://127.0.0.1:54321)
 *       SUPABASE_ANON_KEY
 *       SUPABASE_SERVICE_ROLE_KEY
 *
 * Run: npx jest tests/rls.trip-places-legs.test.ts
 */

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const maybeDescribe = URL && ANON && SERVICE ? describe : describe.skip;

maybeDescribe('RLS: trip_places + trip_legs — user isolation', () => {
  // Lazy-init: clients are constructed inside beforeAll so that the createClient
  // call (which throws if URL is empty) is never reached when env vars are absent
  // and maybeDescribe resolves to describe.skip.
  let admin: ReturnType<typeof createClient>;

  const stamp = Date.now();
  let userAId = '';
  let userBId = '';
  let tripAId = '';
  let placeAId = '';
  let legAId = '';
  let userAClient: ReturnType<typeof createClient>;
  let userBClient: ReturnType<typeof createClient>;
  let anonClient: ReturnType<typeof createClient>;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Create user A + user B
    const a = await admin.auth.admin.createUser({
      email: `rls-tpl-a-${stamp}@test.local`,
      password: 'test-password-tplA',
      email_confirm: true,
    });
    const b = await admin.auth.admin.createUser({
      email: `rls-tpl-b-${stamp}@test.local`,
      password: 'test-password-tplB',
      email_confirm: true,
    });
    userAId = a.data.user!.id;
    userBId = b.data.user!.id;

    // Seed trip for user A (bypasses RLS)
    const trip = await admin
      .from('trips')
      .insert({
        user_id: userAId,
        title: 'User A RLS trip',
        daily_hours_budget: 8,
        transport_mode: 'driving',
      })
      .select('id')
      .single();
    tripAId = trip.data!.id as string;

    // Seed trip_place for user A (admin insert, bypasses RLS)
    const place = await admin
      .from('trip_places')
      .insert({
        trip_id: tripAId,
        google_place_id: 'ChIJRLS_PLACE',
        lat: 38.7,
        lng: -9.1,
        visit_duration_minutes: 60,
      })
      .select('id')
      .single();
    placeAId = place.data!.id as string;

    // Seed trip_leg for user A (admin insert, bypasses RLS)
    const leg = await admin
      .from('trip_legs')
      .insert({
        trip_id: tripAId,
        from_place_id: placeAId,
        to_place_id: placeAId,
        day_index: 0,
        transport_mode: 'driving',
        duration_seconds: 300,
        distance_meters: 1000,
        polyline: 'abcd',
        computed_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    legAId = leg.data!.id as string;

    // Sign in as A and B
    userAClient = createClient(URL!, ANON!, { auth: { persistSession: false } });
    userBClient = createClient(URL!, ANON!, { auth: { persistSession: false } });
    anonClient = createClient(URL!, ANON!, { auth: { persistSession: false } });

    await userAClient.auth.signInWithPassword({
      email: a.data.user!.email!,
      password: 'test-password-tplA',
    });
    await userBClient.auth.signInWithPassword({
      email: b.data.user!.email!,
      password: 'test-password-tplB',
    });
    // anonClient stays unauthenticated
  });

  afterAll(async () => {
    if (legAId) await admin.from('trip_legs').delete().eq('id', legAId);
    if (placeAId) await admin.from('trip_places').delete().eq('id', placeAId);
    if (tripAId) await admin.from('trips').delete().eq('id', tripAId);
    if (userAId) await admin.auth.admin.deleteUser(userAId);
    if (userBId) await admin.auth.admin.deleteUser(userBId);
  });

  // ─── trip_places — positive (user A) ───────────────────────────────────────

  it('user A can SELECT their own trip_places', async () => {
    const { data, error } = await userAClient!
      .from('trip_places')
      .select('*')
      .eq('trip_id', tripAId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  });

  // ─── trip_places — SELECT isolation ────────────────────────────────────────

  it('user B cannot SELECT trip_places owned by user A', async () => {
    const { data, error } = await userBClient!
      .from('trip_places')
      .select('*')
      .eq('trip_id', tripAId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });

  it('anonymous client cannot SELECT trip_places', async () => {
    const { data, error } = await anonClient!.from('trip_places').select('*');
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });

  // ─── trip_places — UPDATE isolation ────────────────────────────────────────

  it('user B cannot UPDATE trip_places owned by user A', async () => {
    const { data, error } = await userBClient!
      .from('trip_places')
      .update({ visit_duration_minutes: 999 })
      .eq('id', placeAId)
      .select('*');
    // RLS: either error or 0 rows affected
    expect(error || (data ?? []).length === 0).toBeTruthy();
    // Verify the row is untouched via admin
    const check = await admin
      .from('trip_places')
      .select('visit_duration_minutes')
      .eq('id', placeAId)
      .single();
    expect(check.data!.visit_duration_minutes).toBe(60);
  });

  // ─── trip_places — DELETE isolation ────────────────────────────────────────

  it('user B cannot DELETE trip_places owned by user A', async () => {
    const { error } = await userBClient!
      .from('trip_places')
      .delete()
      .eq('id', placeAId);
    // RLS silently ignores the delete — verify via admin the row survives
    expect(error).toBeNull();
    const check = await admin
      .from('trip_places')
      .select('id')
      .eq('id', placeAId)
      .maybeSingle();
    expect(check.data).not.toBeNull();
  });

  // ─── trip_legs — positive (user A) ─────────────────────────────────────────

  it('user A can SELECT their own trip_legs', async () => {
    const { data, error } = await userAClient!
      .from('trip_legs')
      .select('*')
      .eq('trip_id', tripAId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  });

  // ─── trip_legs — SELECT isolation ──────────────────────────────────────────

  it('user B cannot SELECT trip_legs owned by user A', async () => {
    const { data, error } = await userBClient!
      .from('trip_legs')
      .select('*')
      .eq('trip_id', tripAId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });

  it('anonymous client cannot SELECT trip_legs', async () => {
    const { data, error } = await anonClient!.from('trip_legs').select('*');
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });

  // ─── trip_legs — UPDATE isolation ──────────────────────────────────────────

  it('user B cannot UPDATE trip_legs owned by user A', async () => {
    const { data, error } = await userBClient!
      .from('trip_legs')
      .update({ duration_seconds: 9999 })
      .eq('id', legAId)
      .select('*');
    expect(error || (data ?? []).length === 0).toBeTruthy();
    // Verify the row is untouched via admin
    const check = await admin
      .from('trip_legs')
      .select('duration_seconds')
      .eq('id', legAId)
      .single();
    expect(check.data!.duration_seconds).toBe(300);
  });

  // ─── trip_legs — DELETE isolation ──────────────────────────────────────────

  it('user B cannot DELETE trip_legs owned by user A', async () => {
    const { error } = await userBClient!
      .from('trip_legs')
      .delete()
      .eq('id', legAId);
    expect(error).toBeNull();
    const check = await admin
      .from('trip_legs')
      .select('id')
      .eq('id', legAId)
      .maybeSingle();
    expect(check.data).not.toBeNull();
  });
});
