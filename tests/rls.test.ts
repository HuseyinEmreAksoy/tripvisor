/**
 * RLS two-user isolation test.
 *
 * Verifies that Row Level Security prevents user A from seeing or
 * modifying user B's trips and trip_places.
 *
 * Prerequisites:
 *   - Local Supabase running (`supabase start`)
 *   - Migrations applied (`supabase db reset`)
 *   - Env vars:
 *       SUPABASE_URL              (local, e.g. http://127.0.0.1:54321)
 *       SUPABASE_ANON_KEY
 *       SUPABASE_SERVICE_ROLE_KEY (needed to create users)
 *
 * Run: npx jest tests/rls.test.ts
 */

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const maybeDescribe = URL && ANON && SERVICE ? describe : describe.skip;

maybeDescribe('RLS: trips + trip_places isolate users', () => {
  // Lazy-init: clients are constructed inside beforeAll so that the createClient
  // call (which throws if URL is empty) is never reached when env vars are absent
  // and maybeDescribe resolves to describe.skip.
  let admin: ReturnType<typeof createClient>;
  let userAId = '';
  let userBId = '';
  let tripAId = '';
  let userAClient: ReturnType<typeof createClient>;
  let userBClient: ReturnType<typeof createClient>;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Create user A + user B
    const a = await admin.auth.admin.createUser({
      email: `rls-a-${Date.now()}@test.local`,
      password: 'test-password-A',
      email_confirm: true,
    });
    const b = await admin.auth.admin.createUser({
      email: `rls-b-${Date.now()}@test.local`,
      password: 'test-password-B',
      email_confirm: true,
    });
    userAId = a.data.user!.id;
    userBId = b.data.user!.id;

    // Seed trip for user A via admin (bypasses RLS to inject a known row)
    const inserted = await admin
      .from('trips')
      .insert({
        user_id: userAId,
        title: 'User A trip',
        daily_hours_budget: 8,
        transport_mode: 'driving',
      })
      .select('id')
      .single();
    tripAId = inserted.data!.id as string;

    // Sign in as A and B to get per-user RLS-scoped clients
    userAClient = createClient(URL!, ANON!, { auth: { persistSession: false } });
    userBClient = createClient(URL!, ANON!, { auth: { persistSession: false } });
    await userAClient.auth.signInWithPassword({
      email: a.data.user!.email!,
      password: 'test-password-A',
    });
    await userBClient.auth.signInWithPassword({
      email: b.data.user!.email!,
      password: 'test-password-B',
    });
  });

  afterAll(async () => {
    if (tripAId) await admin.from('trips').delete().eq('id', tripAId);
    if (userAId) await admin.auth.admin.deleteUser(userAId);
    if (userBId) await admin.auth.admin.deleteUser(userBId);
  });

  it('user A can read their own trip', async () => {
    const { data, error } = await userAClient!.from('trips').select('*').eq('id', tripAId);
    expect(error).toBeNull();
    expect(data!.length).toBe(1);
  });

  it('user B cannot read user A trips', async () => {
    const { data, error } = await userBClient!.from('trips').select('*').eq('id', tripAId);
    expect(error).toBeNull();
    expect(data!.length).toBe(0);
  });

  it('user B cannot update user A trip', async () => {
    const { data, error } = await userBClient!
      .from('trips')
      .update({ title: 'hacked' })
      .eq('id', tripAId)
      .select('*');
    // Either an error OR zero rows affected — both are acceptable RLS outcomes
    expect(error || (data ?? []).length === 0).toBeTruthy();
    // Verify the row is untouched
    const check = await admin.from('trips').select('title').eq('id', tripAId).single();
    expect(check.data!.title).toBe('User A trip');
  });

  it('user B cannot delete user A trip', async () => {
    const { error } = await userBClient!.from('trips').delete().eq('id', tripAId);
    // RLS delete silently affects zero rows — just verify row still present
    expect(error).toBeNull();
    const check = await admin.from('trips').select('id').eq('id', tripAId).maybeSingle();
    expect(check.data).not.toBeNull();
  });

  it('user B cannot insert a trip_place targeting user A trip', async () => {
    const { error } = await userBClient!.from('trip_places').insert({
      trip_id: tripAId,
      google_place_id: 'ChIJSpoof',
      lat: 0,
      lng: 0,
      visit_duration_minutes: 60,
    });
    expect(error).not.toBeNull();
  });

  // ---- gap #14: anon denial (Step 5.3) ------------------------------------

  it('anonymous client cannot SELECT trips', async () => {
    const anonClient = createClient(URL!, ANON!, { auth: { persistSession: false } });
    // anonClient is not signed in — all RLS for `trips` requires auth
    const { data, error } = await anonClient.from('trips').select('*').eq('id', tripAId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });

  it('anonymous client cannot SELECT trip_places', async () => {
    const anonClient = createClient(URL!, ANON!, { auth: { persistSession: false } });
    const { data, error } = await anonClient.from('trip_places').select('*');
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });
});
