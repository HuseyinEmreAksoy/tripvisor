/**
 * Integration tests for Postgres RPCs:
 *
 * Phase 3:
 *   - apply_optimization(p_trip_id, p_assignments)
 *   - apply_manual_day_order(p_trip_id, p_day_index, p_ordered_ids)
 *
 * Phase 13:
 *   - claim_trip_optimize(p_trip_id, p_ttl_seconds) → boolean
 *   - release_trip_optimize(p_trip_id) → void
 *
 * Prereqs identical to tests/rls.test.ts.
 */

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const maybeDescribe = URL && ANON && SERVICE ? describe : describe.skip;

maybeDescribe('Phase 3 RPCs: apply_optimization + apply_manual_day_order', () => {
  // Lazy-init: clients are constructed inside beforeAll so that the createClient
  // call (which throws if URL is empty) is never reached when env vars are absent
  // and maybeDescribe resolves to describe.skip.
  let admin: ReturnType<typeof createClient>;
  let userAId = '';
  let userBId = '';
  let tripAId = '';
  let placeIds: string[] = [];
  let userAClient: ReturnType<typeof createClient>;
  let userBClient: ReturnType<typeof createClient>;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const a = await admin.auth.admin.createUser({
      email: `rpc-a-${Date.now()}@test.local`,
      password: 'test-A',
      email_confirm: true,
    });
    const b = await admin.auth.admin.createUser({
      email: `rpc-b-${Date.now()}@test.local`,
      password: 'test-B',
      email_confirm: true,
    });
    userAId = a.data.user!.id;
    userBId = b.data.user!.id;

    const inserted = await admin
      .from('trips')
      .insert({ user_id: userAId, title: 'RPC test trip', daily_hours_budget: 8 })
      .select('id')
      .single();
    tripAId = inserted.data!.id as string;

    const places = await admin
      .from('trip_places')
      .insert(
        [0, 1, 2].map((i) => ({
          trip_id: tripAId,
          google_place_id: `ChIJRpc${i}`,
          lat: 38.7 + i * 0.01,
          lng: -9.1 + i * 0.01,
          visit_duration_minutes: 60,
        })),
      )
      .select('id');
    placeIds = (places.data ?? []).map((p) => p.id as string);

    userAClient = createClient(URL!, ANON!, { auth: { persistSession: false } });
    userBClient = createClient(URL!, ANON!, { auth: { persistSession: false } });
    await userAClient.auth.signInWithPassword({ email: a.data.user!.email!, password: 'test-A' });
    await userBClient.auth.signInWithPassword({ email: b.data.user!.email!, password: 'test-B' });
  });

  afterAll(async () => {
    if (tripAId) await admin.from('trips').delete().eq('id', tripAId);
    if (userAId) await admin.auth.admin.deleteUser(userAId);
    if (userBId) await admin.auth.admin.deleteUser(userBId);
  });

  it('apply_optimization: user A updates their trip', async () => {
    const assignments = placeIds.map((id, i) => ({
      id,
      day_index: i < 2 ? 0 : 1,
      order_in_day: i < 2 ? i : 0,
    }));
    const { data, error } = await userAClient!.rpc('apply_optimization', {
      p_trip_id: tripAId,
      p_assignments: assignments,
    });
    expect(error).toBeNull();
    expect(data).toBe(3);

    const after = await admin
      .from('trip_places')
      .select('id, day_index, order_in_day')
      .eq('trip_id', tripAId)
      .order('id');
    for (const row of after.data!) {
      expect(row.day_index).not.toBeNull();
    }
  });

  it('apply_optimization: user B cannot affect user A\'s trip', async () => {
    const originals = await admin
      .from('trip_places')
      .select('id, day_index, order_in_day')
      .eq('trip_id', tripAId)
      .order('id');
    const originalSnap = JSON.stringify(originals.data);

    const assignments = placeIds.map((id) => ({ id, day_index: 99, order_in_day: 99 }));
    await userBClient!.rpc('apply_optimization', {
      p_trip_id: tripAId,
      p_assignments: assignments,
    });

    const after = await admin
      .from('trip_places')
      .select('id, day_index, order_in_day')
      .eq('trip_id', tripAId)
      .order('id');
    expect(JSON.stringify(after.data)).toBe(originalSnap);
  });

  it('apply_manual_day_order: assigns order_in_day by array position', async () => {
    const reversed = [...placeIds].reverse();
    const { error } = await userAClient!.rpc('apply_manual_day_order', {
      p_trip_id: tripAId,
      p_day_index: 0,
      p_ordered_ids: reversed,
    });
    expect(error).toBeNull();

    const after = await admin
      .from('trip_places')
      .select('id, order_in_day, day_index')
      .in('id', reversed)
      .order('order_in_day', { ascending: true });
    const sortedIds = after.data!.map((r) => r.id);
    expect(sortedIds).toEqual(reversed);
    for (const r of after.data!) expect(r.day_index).toBe(0);
  });

  it('apply_manual_day_order: user B cannot reorder user A\'s day', async () => {
    const before = await admin
      .from('trip_places')
      .select('id, order_in_day')
      .eq('trip_id', tripAId)
      .eq('day_index', 0)
      .order('order_in_day');
    const beforeSnap = JSON.stringify(before.data);

    await userBClient!.rpc('apply_manual_day_order', {
      p_trip_id: tripAId,
      p_day_index: 0,
      p_ordered_ids: [...placeIds],
    });

    const after = await admin
      .from('trip_places')
      .select('id, order_in_day')
      .eq('trip_id', tripAId)
      .eq('day_index', 0)
      .order('order_in_day');
    expect(JSON.stringify(after.data)).toBe(beforeSnap);
  });
});

// ─── Phase 13: claim_trip_optimize / release_trip_optimize ───────────────────
//
// These RPCs are service_role-only. We call them via the admin client.
// Tests cover:
//   1. First claim returns true
//   2. Second claim within TTL returns false (mutex held)
//   3. release clears optimizing_at; subsequent claim returns true
//   4. Stale-claim recovery: a claim older than TTL is stolen (returns true)

maybeDescribe('Phase 13 RPCs: claim_trip_optimize + release_trip_optimize', () => {
  let admin: ReturnType<typeof createClient>;
  let userId = '';
  let tripId = '';

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Create a test user and a test trip via admin.
    const u = await admin.auth.admin.createUser({
      email: `mutex-${Date.now()}@test.local`,
      password: 'mutex-pw',
      email_confirm: true,
    });
    userId = u.data.user!.id;

    const t = await admin
      .from('trips')
      .insert({ user_id: userId, title: 'Mutex test trip', daily_hours_budget: 8 })
      .select('id')
      .single();
    tripId = t.data!.id as string;
  });

  afterAll(async () => {
    // Unconditional cleanup — even if a test left the row claimed.
    if (tripId) await admin.from('trips').delete().eq('id', tripId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  // Ensure the mutex is clear before each test so tests are independent.
  beforeEach(async () => {
    if (tripId) {
      await admin.rpc('release_trip_optimize', { p_trip_id: tripId });
    }
  });

  it('first claim returns true (no prior claim)', async () => {
    const { data, error } = await admin.rpc('claim_trip_optimize', {
      p_trip_id: tripId,
      p_ttl_seconds: 300,
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it('second claim within TTL returns false (mutex held)', async () => {
    // Claim once.
    await admin.rpc('claim_trip_optimize', { p_trip_id: tripId, p_ttl_seconds: 300 });

    // Attempt a second claim — TTL is 300s; the claim is a few milliseconds old.
    const { data, error } = await admin.rpc('claim_trip_optimize', {
      p_trip_id: tripId,
      p_ttl_seconds: 300,
    });
    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  it('claim after release returns true (mutex cleared)', async () => {
    await admin.rpc('claim_trip_optimize', { p_trip_id: tripId, p_ttl_seconds: 300 });
    await admin.rpc('release_trip_optimize', { p_trip_id: tripId });

    const { data, error } = await admin.rpc('claim_trip_optimize', {
      p_trip_id: tripId,
      p_ttl_seconds: 300,
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it('stale-claim recovery: claim older than TTL is stolen (returns true)', async () => {
    // Backdating optimizing_at to 10 minutes ago via admin UPDATE (bypasses RLS).
    // The RPC uses `now() - make_interval(secs => p_ttl_seconds)` for stale detection.
    await admin
      .from('trips')
      .update({ optimizing_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() })
      .eq('id', tripId);

    // TTL of 1 second — so the 10-minute-old claim IS stale.
    const { data, error } = await admin.rpc('claim_trip_optimize', {
      p_trip_id: tripId,
      p_ttl_seconds: 1,
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it('release on an unclaimed row is a no-op (no error)', async () => {
    // Row has been cleared by beforeEach; calling release again should be silent.
    const { error } = await admin.rpc('release_trip_optimize', { p_trip_id: tripId });
    expect(error).toBeNull();
  });

  it('release sets optimizing_at to null', async () => {
    await admin.rpc('claim_trip_optimize', { p_trip_id: tripId, p_ttl_seconds: 300 });
    await admin.rpc('release_trip_optimize', { p_trip_id: tripId });

    const { data } = await admin
      .from('trips')
      .select('optimizing_at')
      .eq('id', tripId)
      .single();
    expect(data!.optimizing_at).toBeNull();
  });
});
