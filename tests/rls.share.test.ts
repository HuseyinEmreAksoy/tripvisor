/**
 * RLS: trip_shares — two-user isolation test.
 *
 * Verifies the share-links RLS model:
 *   - Owner can INSERT a trip_shares row for their own trip
 *   - Non-owner cannot INSERT a trip_shares row for someone else's trip
 *   - Non-owner cannot SELECT / UPDATE / DELETE any trip_shares rows
 *   - Anonymous client (no auth) cannot SELECT trip_shares at all
 *
 * Prerequisites:
 *   - Local Supabase running (`supabase start`)
 *   - Migrations applied including 0003_share_links.sql
 *   - Env vars:
 *       SUPABASE_URL              (local, e.g. http://127.0.0.1:54321)
 *       SUPABASE_ANON_KEY
 *       SUPABASE_SERVICE_ROLE_KEY
 *
 * Run: npx jest tests/rls.share.test.ts
 */

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const maybeDescribe = URL && ANON && SERVICE ? describe : describe.skip;

maybeDescribe('RLS: trip_shares — owner vs. non-owner access', () => {
  const admin = createClient(URL!, SERVICE!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let userAId = '';
  let userBId = '';
  let tripAId = '';
  let createdShareId = '';
  let userAClient: ReturnType<typeof createClient>;
  let userBClient: ReturnType<typeof createClient>;
  let anonClient: ReturnType<typeof createClient>;

  beforeAll(async () => {
    // Create user A + user B
    const stamp = Date.now();
    const a = await admin.auth.admin.createUser({
      email: `rls-share-a-${stamp}@test.local`,
      password: 'test-password-shareA',
      email_confirm: true,
    });
    const b = await admin.auth.admin.createUser({
      email: `rls-share-b-${stamp}@test.local`,
      password: 'test-password-shareB',
      email_confirm: true,
    });
    userAId = a.data.user!.id;
    userBId = b.data.user!.id;

    // Seed a trip for user A via admin (bypasses RLS)
    const inserted = await admin
      .from('trips')
      .insert({
        user_id: userAId,
        title: 'Share RLS Test Trip',
        daily_hours_budget: 8,
        transport_mode: 'driving',
      })
      .select('id')
      .single();
    tripAId = inserted.data!.id as string;

    // Sign in as A and B
    userAClient = createClient(URL!, ANON!, { auth: { persistSession: false } });
    userBClient = createClient(URL!, ANON!, { auth: { persistSession: false } });
    anonClient = createClient(URL!, ANON!, { auth: { persistSession: false } });

    await userAClient.auth.signInWithPassword({
      email: a.data.user!.email!,
      password: 'test-password-shareA',
    });
    await userBClient.auth.signInWithPassword({
      email: b.data.user!.email!,
      password: 'test-password-shareB',
    });
    // anonClient stays unauthenticated
  });

  afterAll(async () => {
    if (tripAId) await admin.from('trips').delete().eq('id', tripAId);
    if (userAId) await admin.auth.admin.deleteUser(userAId);
    if (userBId) await admin.auth.admin.deleteUser(userBId);
  });

  // ---- INSERT policies -------------------------------------------------------

  it('user A can INSERT a trip_shares row for their own trip', async () => {
    const token = `test-token-${Date.now()}-userA`;
    const { data, error } = await userAClient!
      .from('trip_shares')
      .insert({ trip_id: tripAId, token })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    if (data) createdShareId = (data as { id: string }).id;
  });

  it('user B cannot INSERT a trip_shares row for trip_A (not their trip)', async () => {
    const token = `test-token-${Date.now()}-userB-attack`;
    const { error } = await userBClient!
      .from('trip_shares')
      .insert({ trip_id: tripAId, token });
    // RLS INSERT WITH CHECK should reject this — error is non-null
    expect(error).not.toBeNull();
  });

  // ---- SELECT policy ---------------------------------------------------------

  it('user A cannot SELECT from trip_shares (no SELECT policy exists)', async () => {
    // Even the owner has no SELECT policy — reads go through the Edge Function only.
    const { data } = await userAClient!
      .from('trip_shares')
      .select('*')
      .eq('trip_id', tripAId);
    // RLS returns an empty set (not an error) when there is no SELECT policy;
    // zero rows is the correct outcome.
    expect((data ?? []).length).toBe(0);
  });

  it('user B cannot SELECT any trip_shares rows', async () => {
    const { data, error } = await userBClient!.from('trip_shares').select('*');
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });

  it('anonymous client cannot SELECT any trip_shares rows', async () => {
    const { data, error } = await anonClient!.from('trip_shares').select('*');
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });

  // ---- UPDATE policy ---------------------------------------------------------

  it('user B cannot UPDATE trip_shares rows owned by user A', async () => {
    // Without a SELECT policy user B cannot see the row; UPDATE on a non-visible
    // row silently affects 0 rows (no error).
    const { error } = await userBClient!
      .from('trip_shares')
      .update({ revoked_at: new Date().toISOString() })
      .eq('trip_id', tripAId);
    // Either error or 0 rows affected — both prove isolation
    if (error) {
      expect(error).not.toBeNull();
    } else {
      // Verify via admin that the row is still present and not revoked
      const check = await admin
        .from('trip_shares')
        .select('revoked_at')
        .eq('trip_id', tripAId)
        .is('revoked_at', null)
        .limit(1);
      // If user B's update had actually revoked the row, this would return 0 rows.
      // The fact it returns ≥1 row means the update was silently ignored by RLS.
      expect((check.data ?? []).length).toBeGreaterThanOrEqual(1);
    }
  });

  // ---- DELETE policy ---------------------------------------------------------

  it('user B cannot DELETE trip_shares rows owned by user A', async () => {
    const { error } = await userBClient!
      .from('trip_shares')
      .delete()
      .eq('trip_id', tripAId);
    // RLS silently ignores the delete — verify via admin the row survives
    expect(error).toBeNull();
    const check = await admin
      .from('trip_shares')
      .select('id')
      .eq('trip_id', tripAId)
      .limit(1);
    expect((check.data ?? []).length).toBeGreaterThanOrEqual(1);
  });

  // ---- Owner UPDATE (revoke) -------------------------------------------------

  it('user A can UPDATE (revoke) their own trip_shares row', async () => {
    // The owner has an UPDATE policy, so they can set revoked_at.
    // There is no SELECT policy, so we verify the update via admin.
    const revokedAt = new Date().toISOString();
    const { error } = await userAClient!
      .from('trip_shares')
      .update({ revoked_at: revokedAt })
      .eq('trip_id', tripAId)
      .is('revoked_at', null);
    expect(error).toBeNull();
    // Confirm via admin that revoked_at is now set
    const check = await admin
      .from('trip_shares')
      .select('revoked_at')
      .eq('trip_id', tripAId)
      .not('revoked_at', 'is', null)
      .limit(1);
    expect((check.data ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
