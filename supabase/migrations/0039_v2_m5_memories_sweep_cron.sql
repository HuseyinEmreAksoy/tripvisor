-- Tripvisor v2 M5 (Y2.1): schedule the orphan sweep of the `trip-memories`
-- Storage bucket (the 0038 §2d follow-up).
--
-- What it does
--   Hourly (at :50 UTC, after the :35 pending-photo purge) pg_cron calls
--   public.invoke_memories_sweep(), which POSTs to the `memories-sweep` Edge
--   Function through pg_net. The function lists
--   trip_memories_sweep_candidates() (objects with no trip_photos row, older
--   than 1 h) and removes them through the Storage API in batches of <= 1000
--   (SQL must not delete Storage objects: storage.protect_delete, and a SQL
--   delete would leave the file in the object store).
--
-- Pattern (Supabase docs, "Scheduling Edge Functions", verified 2026-09-29):
--   pg_cron + pg_net + Vault. Secrets are read from vault.decrypted_secrets
--   at run time, never stored in the job text or in this migration.
--
-- REQUIRED ONE-TIME SETUP per environment (not in this migration: secrets
-- must never live in git). Until all three Vault secrets exist the job is a
-- no-op that raises a NOTICE (visible in cron.job_run_details), never an
-- error:
--   -- SQL editor (cloud) / psql (local):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<legacy ANON key (a JWT: eyJ...)>', 'anon_key');
--   select vault.create_secret('<random >= 32 chars>', 'memories_sweep_secret');
--   -- and the SAME random value as a function secret:
--   --   npx supabase secrets set MEMORIES_SWEEP_SECRET=<random >= 32 chars>
--   --   npx supabase functions deploy memories-sweep
--   (Rotate: vault.update_secret(id, new_secret) + secrets set again.)
--   Why the ANON key: the function keeps verify_jwt = true, so the gateway
--   needs a validly signed JWT; the anon JWT grants nothing by itself, the
--   x-sweep-secret header is what the handler authorizes (least privilege:
--   the service-role key never has to sit in Vault). A project that has
--   DISABLED legacy JWT keys must deploy the function with --no-verify-jwt
--   instead; the handler's explicit secret check still gates it.
--   Local stack: project_url = 'http://kong:8000' (the DB container reaches
--   the API gateway by its docker network name).
--
-- Idempotent: create or replace + cron.schedule upserts by job name.
--
-- Inverse (local only):
--   select cron.unschedule('tripvisor-memories-orphan-sweep');
--   drop function if exists public.invoke_memories_sweep(integer);
--   (Vault secrets, if created: delete from vault.secrets where name in
--    ('project_url','anon_key','memories_sweep_secret');  -- only if nothing else uses them)

-- ============================================================
-- 1. Extensions (guarded; 0019 already enabled pg_cron + pg_net)
-- ============================================================
do $ext$
begin
  begin
    create extension if not exists pg_net;
  exception
    when insufficient_privilege or undefined_file or object_not_in_prerequisite_state then
      raise notice 'pg_net unavailable: enable it via Dashboard -> Database -> Extensions, then re-run 0039.';
  end;
  begin
    create extension if not exists supabase_vault with schema vault;
  exception
    when insufficient_privilege or undefined_file or object_not_in_prerequisite_state or invalid_schema_name then
      raise notice 'supabase_vault unavailable: enable Vault via Dashboard -> Integrations -> Vault, then re-run 0039.';
  end;
end
$ext$;

-- ============================================================
-- 2. The invoker (what the cron job runs)
-- ============================================================
-- SECURITY DEFINER so the job (and only the job / service_role) can read the
-- three Vault secrets; EXECUTE is revoked from everyone else below.
-- Returns the pg_net request id (see net._http_response), or NULL when the
-- setup is incomplete (NOTICE says what is missing). References to vault.*
-- and net.* are resolved at run time, so the function exists even where
-- those extensions are missing.
create or replace function public.invoke_memories_sweep(p_max_batches integer default 5)
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_url     text;
  v_anon    text;
  v_secret  text;
  v_request bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'memories-sweep: pg_net is not installed; not invoked.';
    return null;
  end if;
  if not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    raise notice 'memories-sweep: Vault is not installed; not invoked.';
    return null;
  end if;

  select s.decrypted_secret into v_url    from vault.decrypted_secrets s where s.name = 'project_url'           limit 1;
  select s.decrypted_secret into v_anon   from vault.decrypted_secrets s where s.name = 'anon_key'              limit 1;
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'memories_sweep_secret' limit 1;

  if coalesce(v_url, '') = '' or coalesce(v_anon, '') = '' or coalesce(v_secret, '') = '' then
    raise notice 'memories-sweep: Vault secrets project_url / anon_key / memories_sweep_secret are not all set; not invoked (see 0039 header).';
    return null;
  end if;

  select net.http_post(
           url                  := rtrim(v_url, '/') || '/functions/v1/memories-sweep',
           body                 := jsonb_build_object('maxBatches', greatest(1, least(coalesce(p_max_batches, 5), 20))),
           headers              := jsonb_build_object(
                                     'Content-Type',   'application/json',
                                     'Authorization',  'Bearer ' || v_anon,
                                     'apikey',         v_anon,
                                     'x-sweep-secret', v_secret),
           timeout_milliseconds := 30000
         )
    into v_request;
  return v_request;
end;
$$;

comment on function public.invoke_memories_sweep(integer) is
  'M5 Y2.1 (0039): POSTs to the memories-sweep Edge Function via pg_net with the Vault secrets project_url / anon_key / memories_sweep_secret; returns the pg_net request id, or NULL (NOTICE) when the setup is incomplete. Scheduled hourly by pg_cron (tripvisor-memories-orphan-sweep). postgres / service_role only.';

revoke all on function public.invoke_memories_sweep(integer) from public, anon, authenticated;
grant execute on function public.invoke_memories_sweep(integer) to service_role;

-- ============================================================
-- 3. Schedule (hourly at :50 UTC)
-- ============================================================
do $cron$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed: tripvisor-memories-orphan-sweep NOT scheduled. Re-run this block after enabling the extension.';
    return;
  end if;
  perform cron.schedule(
    'tripvisor-memories-orphan-sweep',
    '50 * * * *',
    $job$ select public.invoke_memories_sweep() $job$
  );
  raise notice 'pg_cron job scheduled: tripvisor-memories-orphan-sweep (hourly at :50 UTC). It stays a no-op until the Vault secrets exist (0039 header).';
exception
  when insufficient_privilege then
    raise notice 'insufficient privilege to schedule pg_cron jobs: schedule tripvisor-memories-orphan-sweep from the Dashboard (Integrations -> Cron).';
end
$cron$;
