-- memories_sweep_0039.sql: assertions for 0039_v2_m5_memories_sweep_cron.sql
-- (the hourly orphan sweep of the trip-memories bucket: pg_cron + pg_net +
-- Vault → memories-sweep Edge Function).
--
-- Plain SQL, same style as m5_wave1_fixes_0038.sql: RAISE on failure, ONE
-- transaction, rolled back. The pg_net request queued in section C is never
-- sent (pg_net's worker only reads COMMITTED queue rows) and the Vault
-- secrets created there disappear with the rollback.
--
-- Run (local stack, after `npx supabase migration up --local`):
--   docker exec -i supabase_db_Tripvisor psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/memories_sweep_0039.sql

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

begin;

\echo '=== A. function + EXECUTE matrix ==='
do $$
declare
  v_secdef boolean;
begin
  select p.prosecdef into v_secdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'invoke_memories_sweep';
  if v_secdef is null then
    raise exception 'FAIL A1: public.invoke_memories_sweep(integer) is missing';
  end if;
  if not v_secdef then
    raise exception 'FAIL A2: invoke_memories_sweep must be SECURITY DEFINER (it reads Vault)';
  end if;
  if has_function_privilege('anon', 'public.invoke_memories_sweep(integer)', 'execute') then
    raise exception 'FAIL A3: anon can execute invoke_memories_sweep';
  end if;
  if has_function_privilege('authenticated', 'public.invoke_memories_sweep(integer)', 'execute') then
    raise exception 'FAIL A4: authenticated can execute invoke_memories_sweep (it would let any user trigger the sweep and read Vault-backed headers)';
  end if;
  if not has_function_privilege('service_role', 'public.invoke_memories_sweep(integer)', 'execute') then
    raise exception 'FAIL A5: service_role cannot execute invoke_memories_sweep';
  end if;
  -- 0038 contract the function relies on stays service-role only.
  if has_function_privilege('authenticated', 'public.trip_memories_sweep_candidates(interval, integer)', 'execute') then
    raise exception 'FAIL A6: authenticated can list sweep candidates';
  end if;
end $$;

\echo '=== B. schedule ==='
do $$
declare
  v_schedule text;
  v_command  text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'SKIP B: pg_cron not installed here';
    return;
  end if;
  select schedule, command into v_schedule, v_command from cron.job where jobname = 'tripvisor-memories-orphan-sweep';
  if v_schedule is null then
    raise exception 'FAIL B1: cron job tripvisor-memories-orphan-sweep is not scheduled';
  end if;
  if v_schedule <> '50 * * * *' then
    raise exception 'FAIL B2: unexpected schedule %', v_schedule;
  end if;
  if v_command not like '%public.invoke_memories_sweep()%' then
    raise exception 'FAIL B3: job command does not call invoke_memories_sweep: %', v_command;
  end if;
  -- No secret may ever be inlined in the job text.
  if v_command ~* '(eyJ|sb_secret|sb_publishable|x-sweep-secret|Bearer)' then
    raise exception 'FAIL B4: the cron command embeds a credential';
  end if;
end $$;

\echo '=== C. invoker: no-op without Vault secrets, correct request with them ==='
do $$
declare
  v_req   bigint;
  v_url   text;
  v_hdrs  jsonb;
  v_body  text;
begin
  if not exists (select 1 from pg_extension where extname = 'supabase_vault')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'SKIP C: Vault or pg_net not installed here';
    return;
  end if;

  -- (rolled back) start from "not configured"
  delete from vault.secrets where name in ('project_url', 'anon_key', 'memories_sweep_secret');
  v_req := public.invoke_memories_sweep();
  if v_req is not null then
    raise exception 'FAIL C1: invoke without Vault secrets must be a no-op (got request %)', v_req;
  end if;

  -- partial setup is still a no-op
  perform vault.create_secret('https://example.test/', 'project_url');
  if public.invoke_memories_sweep() is not null then
    raise exception 'FAIL C2: invoke with only project_url set must be a no-op';
  end if;

  perform vault.create_secret('eyJ.test-anon-jwt.sig', 'anon_key');
  perform vault.create_secret('test-sweep-secret-0123456789abcdef-0123', 'memories_sweep_secret');
  v_req := public.invoke_memories_sweep(99);
  if v_req is null then
    raise exception 'FAIL C3: fully configured invoke returned no pg_net request id';
  end if;

  select q.url, q.headers, convert_from(q.body, 'UTF8') into v_url, v_hdrs, v_body
    from net.http_request_queue q where q.id = v_req;
  if v_url is distinct from 'https://example.test/functions/v1/memories-sweep' then
    raise exception 'FAIL C4: wrong URL %', v_url;
  end if;
  if v_hdrs->>'x-sweep-secret' is distinct from 'test-sweep-secret-0123456789abcdef-0123'
     or v_hdrs->>'Authorization' is distinct from 'Bearer eyJ.test-anon-jwt.sig'
     or v_hdrs->>'apikey' is distinct from 'eyJ.test-anon-jwt.sig' then
    raise exception 'FAIL C5: wrong headers %', v_hdrs;
  end if;
  if (v_body::jsonb)->>'maxBatches' is distinct from '20' then
    raise exception 'FAIL C6: maxBatches must be clamped to 20, body %', v_body;
  end if;
end $$;

\echo 'memories_sweep_0039: all assertions passed'
rollback;
