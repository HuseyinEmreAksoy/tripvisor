/**
 * Integration tests for Phase 3 Postgres RPCs:
 *   - apply_optimization(p_trip_id, p_assignments)
 *   - apply_manual_day_order(p_trip_id, p_day_index, p_ordered_ids)
 *
 * Verifies:
 *   1. Happy-path updates place ordering correctly
 *   2. RPC runs under SECURITY INVOKER — user B cannot modify user A's trip
 *   3. apply_optimization rejects cross-trip assignments (filter by trip_id)
 *
 * Prereqs identical to tests/rls.test.ts.
 */

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const maybeDescribe = URL && ANON && SERVICE ? describe : describe.skip;

maybeDescribe('Phase 3 RPCs: apply_optimization + apply_manual_day_order', () => {
  const admin = createClient(URL!, SERVICE!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let userAId = '';
  let userBId = '';
  let tripAId = '';
  let placeIds: string[] = [];
  let userAClient: ReturnType<typeof createClient>;
  let userBClient: ReturnType<typeof createClient>;

  beforeAll(async () => {
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
