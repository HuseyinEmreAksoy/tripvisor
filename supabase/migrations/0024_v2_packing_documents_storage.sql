-- Tripvisor v2 Phase P2 — packing lists + document metadata + Storage bucket
-- (BUILD-LOG P2.2 / P2.3; N2.2's deferred Storage buckets land here).
--
-- Four clearly-separated sections (3 depends on 2 — the helper MUST exist
-- before the trip_documents INSERT policy that references it):
--
--   1. `trip_packing_items`            — per-trip packing checklist (P2.2)
--   2. `storage_path_trip_id()` helper — injection-safe path → trip uuid parse
--   3. `trip_documents`                — METADATA rows for uploaded docs (P2.3)
--   4. Storage bucket `trip-docs` + storage.objects RLS policies (N2.2→P2.3)
--
-- Defensive-by-design (same stance as 0019): sections 1–3 are plain Postgres
-- and must always apply. Section 4 touches the `storage` schema, whose
-- ownership varies by environment (hosted Supabase has tightened
-- storage.objects ownership over time; a bare local stack may lack the
-- schema entirely) — every storage statement is wrapped in a DO block that
-- degrades to a NOTICE with copy-pasteable dashboard instructions instead
-- of failing the migration.
--
-- Rollback
-- --------
--   -- Section 4 (storage):
--   drop policy if exists "trip_docs_viewer_select" on storage.objects;
--   drop policy if exists "trip_docs_editor_insert" on storage.objects;
--   drop policy if exists "trip_docs_editor_delete" on storage.objects;
--   delete from storage.objects where bucket_id = 'trip-docs'; -- empties the bucket
--   delete from storage.buckets where id = 'trip-docs';
--   -- Section 3 (table BEFORE the function — its INSERT policy references it):
--   drop table if exists public.trip_documents;
--   -- Section 2:
--   drop function if exists public.storage_path_trip_id(text);
--   -- Section 1:
--   drop trigger if exists trip_packing_items_set_updated_at on public.trip_packing_items;
--   drop table if exists public.trip_packing_items;

-- ============================================================
-- 1. trip_packing_items (BUILD-LOG P2.2)
-- ============================================================
--
-- A per-trip checklist. Rows come from two sources, distinguished by `auto`:
--   - auto = true  — seeded by the client from the pure rule-based template
--                    (src/lib/packingSeed.ts; ~20–30 rows bulk-inserted once)
--   - auto = false — added by the user afterwards
-- The flag lets a future "re-seed" affordance replace only the auto rows
-- without touching what the user typed.
--
-- ToS note: pure USER content (Tier-1 durable per docs/v2/conventions.md) —
-- no Google Places data, so the 30-day retention ceiling does not apply.
--
-- Delete model: HARD delete. Packing items predate the offline sync engine
-- (S2) and are personal low-conflict data; when packing joins the synced-
-- entity set, S2.1's tombstone sweep (`deleted` column + handle_times()) can
-- add soft-delete then. Choosing hard delete NOW avoids shipping tombstone
-- semantics nothing consumes yet.

create table if not exists public.trip_packing_items (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  label       text not null check (char_length(label) between 1 and 120),
  -- Free-form grouping ("clothing", "toiletries", …). Nullable — ungrouped
  -- items render in an "other" bucket client-side. Light length guard only;
  -- the canonical seed categories live in src/lib/packingSeed.ts.
  category    text null check (category is null or char_length(category) between 1 and 60),
  checked     boolean not null default false,
  -- true = seeded from the packing template, false = user-added (see header).
  auto        boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.trip_packing_items is
  'v2 P2.2: per-trip packing checklist. auto=true rows were bulk-seeded from the pure client template (src/lib/packingSeed.ts), auto=false rows are user-added. Pure user content (no Google data → no 30-day ToS ceiling). Hard delete is the delete model until the S2 sync engine adds tombstones to the synced-entity set.';

comment on column public.trip_packing_items.auto is
  'true = row was seeded by the packing template; false = user-added. Lets a future re-seed replace only auto rows.';

-- Dominant access pattern: load a trip's whole checklist in one query.
create index if not exists trip_packing_items_trip_idx
  on public.trip_packing_items (trip_id);

-- updated_at trigger (reuses public.set_updated_at from 0001_init.sql).
drop trigger if exists trip_packing_items_set_updated_at on public.trip_packing_items;
create trigger trip_packing_items_set_updated_at
  before update on public.trip_packing_items
  for each row execute function public.set_updated_at();

-- RLS — viewer reads, editor writes, all via user_can_access_trip (0011,
-- security definer — no policy recursion). Per-action policies (not FOR ALL)
-- per the 0010/0012 convention: PostgREST emits cleaner per-verb errors.
alter table public.trip_packing_items enable row level security;

drop policy if exists "trip_packing_items_viewer_select" on public.trip_packing_items;
create policy "trip_packing_items_viewer_select"
  on public.trip_packing_items for select
  to authenticated
  using (public.user_can_access_trip(trip_id, auth.uid(), 'viewer'));

drop policy if exists "trip_packing_items_editor_insert" on public.trip_packing_items;
create policy "trip_packing_items_editor_insert"
  on public.trip_packing_items for insert
  to authenticated
  with check (public.user_can_access_trip(trip_id, auth.uid(), 'editor'));

-- UPDATE: WITH CHECK re-asserts editor access on the post-image so a row
-- cannot be "re-parented" onto a trip the caller cannot edit (RLS cannot
-- compare OLD vs NEW; checking the post-state is the only closure).
drop policy if exists "trip_packing_items_editor_update" on public.trip_packing_items;
create policy "trip_packing_items_editor_update"
  on public.trip_packing_items for update
  to authenticated
  using      (public.user_can_access_trip(trip_id, auth.uid(), 'editor'))
  with check (public.user_can_access_trip(trip_id, auth.uid(), 'editor'));

drop policy if exists "trip_packing_items_editor_delete" on public.trip_packing_items;
create policy "trip_packing_items_editor_delete"
  on public.trip_packing_items for delete
  to authenticated
  using (public.user_can_access_trip(trip_id, auth.uid(), 'editor'));

-- ============================================================
-- 2. storage_path_trip_id() — injection-safe path → trip_id parse
-- ============================================================
--
-- Defined BEFORE trip_documents: section 3's INSERT policy references it.
--
-- Storage policies must derive "which trip does this object belong to?"
-- from nothing but the object key. Panel-flagged risk: a naive
-- `(string_to_array(name,'/'))[1]::uuid` cast inside a policy turns a
-- malformed first segment into a thrown 22P02 error — at best a confusing
-- 500, at worst an oracle. This helper:
--
--   1. takes ONLY the first path segment via split_part (so neither '../'
--      games nor extra segments ever reach the cast),
--   2. validates it against the full canonical uuid shape BEFORE casting —
--      8-4-4-4-12 hex, NOT a loose '[0-9a-f-]{36}' (which would accept
--      garbage like 36 dashes and still blow up the cast),
--   3. returns NULL on any mismatch — and user_can_access_trip(NULL, …)
--      is simply false, so malformed paths fail CLOSED, without errors.
--
-- IMMUTABLE + STRICT: pure string parsing, no table access, NULL in → NULL
-- out. Not SECURITY DEFINER — it needs no elevated rights.

create or replace function public.storage_path_trip_id(object_name text)
returns uuid
language plpgsql
immutable
strict
set search_path = public, pg_catalog
as $$
declare
  seg text;
begin
  seg := split_part(object_name, '/', 1);
  if seg ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return seg::uuid;
  end if;
  return null;
end;
$$;

comment on function public.storage_path_trip_id(text) is
  'v2 P2.3: extracts the first path segment of a trip-docs object key and returns it as a uuid, or NULL when it is not a canonical uuid (fail-closed — no cast errors reachable from user-controlled paths). Used by storage.objects policies and the trip_documents INSERT consistency check.';

-- Storage policies evaluate under the caller's role; trip_documents' INSERT
-- policy does too. Grant broadly — the function is pure and leaks nothing.
grant execute on function public.storage_path_trip_id(text) to authenticated, anon, service_role;

-- ============================================================
-- 3. trip_documents (BUILD-LOG P2.3)
-- ============================================================
--
-- METADATA ONLY. The document BYTES live in the private Storage bucket
-- `trip-docs` (section 4) under the path convention `<trip_id>/<filename>`;
-- this table is the listable, RLS-gated index of what was uploaded. The
-- client uploads the object FIRST, then inserts this row (and removes the
-- object again if the row insert fails) — so an orphaned OBJECT is the
-- worst-case inconsistency (invisible, cheap), never an orphaned ROW
-- pointing at nothing.
--
-- No UPDATE policy on purpose: a document is immutable once uploaded
-- (rename/replace = delete + re-upload). That keeps `storage_path` forever
-- in lockstep with the object and removes a whole class of path-swap bugs.

create table if not exists public.trip_documents (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips(id) on delete cascade,
  -- User-facing display name (the original filename, pre-sanitization).
  name          text not null check (char_length(name) between 1 and 200),
  -- Full object key in the trip-docs bucket: '<trip_id>/<ts>_<safeName>'.
  -- UNIQUE doubles as the lookup index for delete-by-path.
  storage_path  text not null unique,
  mime          text null check (mime is null or char_length(mime) between 1 and 127),
  size_bytes    bigint null check (size_bytes is null or size_bytes >= 0),
  created_at    timestamptz not null default now()
);

comment on table public.trip_documents is
  'v2 P2.3: metadata rows for ticket/document uploads. The BYTES live in the private Storage bucket trip-docs (path <trip_id>/<filename>); this row is just the listable index. Immutable after insert (no UPDATE policy) — replace = delete + re-upload. User content only: never store Google Places data here.';

comment on column public.trip_documents.storage_path is
  'Object key in the trip-docs bucket. INSERT policy enforces that its first path segment equals trip_id (via storage_path_trip_id), keeping the metadata row and the object''s RLS scope in lockstep.';

create index if not exists trip_documents_trip_idx
  on public.trip_documents (trip_id);

-- RLS — viewer reads, editor insert/delete, NO update (immutability).
alter table public.trip_documents enable row level security;

drop policy if exists "trip_documents_viewer_select" on public.trip_documents;
create policy "trip_documents_viewer_select"
  on public.trip_documents for select
  to authenticated
  using (public.user_can_access_trip(trip_id, auth.uid(), 'viewer'));

-- INSERT: editor access AND path consistency — the storage_path's first
-- segment must BE the claimed trip_id. Without this, an editor of trip A
-- could register a metadata row whose path points into trip B's folder
-- (they still couldn't read B's bytes — storage RLS gates by path — but the
-- dangling cross-trip row would confuse listings and deletes).
drop policy if exists "trip_documents_editor_insert" on public.trip_documents;
create policy "trip_documents_editor_insert"
  on public.trip_documents for insert
  to authenticated
  with check (
    public.user_can_access_trip(trip_id, auth.uid(), 'editor')
    and public.storage_path_trip_id(storage_path) = trip_id
  );

drop policy if exists "trip_documents_editor_delete" on public.trip_documents;
create policy "trip_documents_editor_delete"
  on public.trip_documents for delete
  to authenticated
  using (public.user_can_access_trip(trip_id, auth.uid(), 'editor'));

-- ============================================================
-- 4. Storage bucket `trip-docs` + storage.objects policies (P2.3)
-- ============================================================
--
-- Private bucket; every object key MUST start with '<trip_id>/'. Authz model:
--   SELECT (download / createSignedUrl) — viewer-or-better on the trip
--   INSERT (upload, upsert=false)       — editor-or-better on the trip
--   DELETE                              — editor-or-better on the trip
--   UPDATE — deliberately NO policy: objects are immutable (no overwrite;
--            replace = delete + upload). Client uploads use upsert: false.
--
-- storage.objects already has RLS enabled by the Supabase storage stack —
-- we do NOT (and on hosted, COULD not) alter the table itself; we only add
-- policies. Both blocks degrade to a NOTICE when the environment forbids
-- them (newer hosted projects restrict storage.objects ownership; bare
-- local stacks may lack the schema) — the NOTICE carries the exact SQL to
-- run from the Dashboard SQL editor / Storage policy UI instead.

-- 4a. Bucket row + defensive limits (10MB cap, doc/image mime allow-list).
do $bucket$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    raise notice 'storage.buckets not found — skipping bucket creation (bare local stack?). Create a PRIVATE bucket "trip-docs" (10MB limit; mime: application/pdf, image/png, image/jpeg, image/webp) via Dashboard -> Storage.';
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('trip-docs', 'trip-docs', false)
  on conflict (id) do nothing;

  -- Defensive per-file limits — guarded per column because older/local
  -- storage schemas may predate them. 10MB is generous for tickets/PDFs and
  -- keeps a hostile client from filling the free-tier 1GB in a loop; the
  -- mime allow-list blocks executable smuggling through signed URLs.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets'
      and column_name = 'file_size_limit'
  ) then
    update storage.buckets set file_size_limit = 10485760 where id = 'trip-docs';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets'
      and column_name = 'allowed_mime_types'
  ) then
    update storage.buckets
      set allowed_mime_types = array[
        'application/pdf', 'image/png', 'image/jpeg', 'image/webp'
      ]
      where id = 'trip-docs';
  end if;

  raise notice 'storage bucket trip-docs ensured (private, 10MB, pdf/png/jpeg/webp).';
exception
  when insufficient_privilege then
    raise notice 'insufficient privilege to write storage.buckets — create a PRIVATE bucket "trip-docs" (10MB limit; mime: application/pdf, image/png, image/jpeg, image/webp) via Dashboard -> Storage.';
end
$bucket$;

-- 4b. storage.objects policies for the trip-docs bucket.
do $objpolicies$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'objects'
  ) then
    raise notice 'storage.objects not found — skipping object policies (bare local stack?).';
    return;
  end if;

  -- Idempotent: drop-then-create, all inside this privilege-guarded block.
  drop policy if exists "trip_docs_viewer_select" on storage.objects;
  create policy "trip_docs_viewer_select"
    on storage.objects for select
    to authenticated
    using (
      bucket_id = 'trip-docs'
      and public.user_can_access_trip(public.storage_path_trip_id(name), auth.uid(), 'viewer')
    );

  drop policy if exists "trip_docs_editor_insert" on storage.objects;
  create policy "trip_docs_editor_insert"
    on storage.objects for insert
    to authenticated
    with check (
      bucket_id = 'trip-docs'
      and public.user_can_access_trip(public.storage_path_trip_id(name), auth.uid(), 'editor')
    );

  drop policy if exists "trip_docs_editor_delete" on storage.objects;
  create policy "trip_docs_editor_delete"
    on storage.objects for delete
    to authenticated
    using (
      bucket_id = 'trip-docs'
      and public.user_can_access_trip(public.storage_path_trip_id(name), auth.uid(), 'editor')
    );

  raise notice 'storage.objects policies for trip-docs created (viewer select / editor insert+delete; no update by design).';
exception
  when insufficient_privilege then
    raise notice 'insufficient privilege to manage storage.objects policies — create them via Dashboard -> Storage -> Policies (or the SQL editor as the dashboard role) using the next three NOTICE lines:';
    raise notice 'create policy "trip_docs_viewer_select" on storage.objects for select to authenticated using (bucket_id = ''trip-docs'' and public.user_can_access_trip(public.storage_path_trip_id(name), auth.uid(), ''viewer''));';
    raise notice 'create policy "trip_docs_editor_insert" on storage.objects for insert to authenticated with check (bucket_id = ''trip-docs'' and public.user_can_access_trip(public.storage_path_trip_id(name), auth.uid(), ''editor''));';
    raise notice 'create policy "trip_docs_editor_delete" on storage.objects for delete to authenticated using (bucket_id = ''trip-docs'' and public.user_can_access_trip(public.storage_path_trip_id(name), auth.uid(), ''editor''));';
end
$objpolicies$;
