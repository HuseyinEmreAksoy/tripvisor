// Shared Supabase client factory for Edge Functions.
// Uses the incoming user's Authorization header so RLS runs as that user.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export function makeUserClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) throw new Error('Supabase env vars missing');
  return createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Service-role client. Use SPARINGLY — bypasses RLS. */
export function makeAdminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) throw new Error('Supabase admin env vars missing');
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
