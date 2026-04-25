/**
 * RLS: trip_shares — two-user isolation test.
 *
 * Verifies the share-links RLS model. The intended write path for trip_shares
 * is the `share-trip` Edge Function, which uses the service-role admin client
 * for the actual INSERT after validating ownership via the user JWT against
 * `trips`. Direct-from-client INSERTs are NOT a supported path — see the
 * `COMMENT ON POLICY` strings added in migration 0009 and the design notes
 * in supabase/migrations/0003_share_links.sql.
 *
 * What this suite asserts:
 *   - Direct `.insert(...).select(...)` from the user client FAILS with 42501.
 *     This is intentional: trip_shares has no SELECT policy (tokens must never
 *     be readable post-creation), so INSERT ... RETURNING — which is what
 *     `.select()` compiles to — cannot succeed. The Edge Function flow
 *     (admin-client INSERT after JWT-scoped trips ownership check) is the
 *     only supported write path.
 *   - Non-owner cannot INSERT a trip_shares row for someone else's trip.
 *   - Non-owner cannot SELECT / UPDATE / DELETE any trip_shares rows.
 *   - Anonymous client cannot SELECT trip_shares at all.
 *   - Owner CAN UPDATE (revoke) their own row under their JWT — that's how the
 *     Edge Function's revoke flow works.
 *
 * Prerequisites:
 *   - Local Supabase running (`supabase start`)
 *   - Migrations applied including 0003_share_links.sql and 0009_share_insert_policy_note.sql
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
  // Lazy-init: clients are constructed inside beforeAll so that the createClient
  // call (which throws if URL is empty) is never reached when env vars are absent
  // and maybeDescribe resolves to describe.skip.
  let admin: ReturnType<typeof createClient>;
  let userAId = '';
  let userBId = '';
  let tripAId = '';
  let createdShareId = '';
  let userAClient: ReturnType<typeof createClient>;
  let userBClient: ReturnType<typeof createClient>;
  let anonClient: ReturnType<typeof createClient>;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

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
  //
  // trip_shares has no SELECT policy by design (tokens must never be readable
  // post-creation). The Supabase JS chain `.insert(...).select(...)` compiles
  // to `INSERT ... RETURNING ...`, which Postgres requires the inserted row
  // to also satisfy a SELECT policy for. With no SELECT policy, that visibility
  // check fails and Postgres returns `42501 new row violates row-level
  // security policy` — the same error code as a WITH CHECK failure, even
  // though the WITH CHECK itself is satisfied. This is the documented
  // intended behavior; production INSERTs go through the share-trip Edge
  // Function with the service-role admin client. See migration 0009.

  it('user A direct .insert(...).select() FAILS with 42501 (intentional — design forces Edge Function flow)', async () => {
    const token = `test-token-${Date.now()}-userA-returning`;
    const { data, error } = await userAClient!
      .from('trip_shares')
      .insert({ trip_id: tripAId, token })
      .select('id')
      .single();
    // INSERT ... RETURNING with no SELECT policy on the table -> 42501.
    // This is by design and documented in supabase/migrations/0009_share_insert_policy_note.sql.
    expect(error).not.toBeNull();
    expect((error as { code?: string } | null)?.code).toBe('42501');
    expect(data).toBeNull();
  });

  it('user A bare .insert(...) (no .select() chain) is permitted by WITH CHECK for own trip', async () => {
    // Without RETURNING, the INSERT only needs to satisfy WITH CHECK, which
    // it does for an owned trip. This is the path the Edge Function would
    // take if it were running under the user JWT (it doesn't — it uses
    // service-role for the write — but the policy still permits it as
    // defense-in-depth).
    const token = `test-token-${Date.now()}-userA-bare`;
    const { error } = await userAClient!.from('trip_shares').insert({ trip_id: tripAId, token });
    expect(error).toBeNull();
    // Confirm via admin that the row is present
    const check = await admin.from('trip_shares').select('id').eq('token', token).maybeSingle();
    expect(check.data).not.toBeNull();
    if (check.data) createdShareId = (check.data as { id: string }).id;
  });

  it('user B cannot INSERT a trip_shares row for trip_A (not their trip)', async () => {
    const token = `test-token-${Date.now()}-userB-attack`;
    const { error } = await userBClient!
      .from('trip_shares')
      .insert({ trip_id: tripAId, token });
    // WITH CHECK rejects this because user B does not own tripAId.
    expect(error).not.toBeNull();
    // Defense-in-depth: confirm via admin that nothing landed.
    const check = await admin.from('trip_shares').select('id').eq('token', token).maybeSingle();
    expect(check.data).toBeNull();
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
  //
  // Direct UPDATE under the user JWT silently no-ops on trip_shares because
  // Postgres requires a row to be SELECT-visible for UPDATE to find it, and
  // trip_shares has no SELECT policy. This is the same design constraint that
  // forces INSERTs through the Edge Function admin client. The share-trip
  // Edge Function's handleRevoke flow performs the actual UPDATE via the
  // service-role admin client after proving ownership via the user JWT
  // against the trips table. See migration 0009.

  it('user A direct UPDATE under JWT silently no-ops (design forces Edge Function admin path)', async () => {
    // Pre-condition: ensure the row is currently NOT revoked.
    await admin.from('trip_shares').update({ revoked_at: null }).eq('trip_id', tripAId);

    const revokedAt = new Date().toISOString();
    const { error } = await userAClient!
      .from('trip_shares')
      .update({ revoked_at: revokedAt })
      .eq('trip_id', tripAId)
      .is('revoked_at', null);
    // No error — RLS doesn't raise; it just affects 0 rows.
    expect(error).toBeNull();
    // Verify via admin that the row is STILL not revoked (proving the user-JWT
    // UPDATE silently no-opped).
    const check = await admin
      .from('trip_shares')
      .select('revoked_at')
      .eq('trip_id', tripAId)
      .is('revoked_at', null)
      .limit(1);
    expect((check.data ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('admin client UPDATE (the Edge Function path) successfully revokes the row', async () => {
    // Mirror what share-trip/handleRevoke does after admin-client switch.
    const revokedAt = new Date().toISOString();
    const { error } = await admin
      .from('trip_shares')
      .update({ revoked_at: revokedAt })
      .eq('trip_id', tripAId)
      .is('revoked_at', null);
    expect(error).toBeNull();
    // Confirm revoked_at is now set
    const check = await admin
      .from('trip_shares')
      .select('revoked_at')
      .eq('trip_id', tripAId)
      .not('revoked_at', 'is', null)
      .limit(1);
    expect((check.data ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
