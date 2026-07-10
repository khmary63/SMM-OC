-- MARIA SMM OS
-- Supabase Storage buckets and RLS policies
-- Version 1.0 | 2026-07-10
--
-- Path convention:
--   smm-assets/<workspace_id>/<brand_id>/<asset_id>/<filename>
--   smm-reports/<workspace_id>/<brand_id>/<report_month>/<filename>

begin;

create or replace function app_private.try_uuid(value text)
returns uuid
language plpgsql
immutable
as $$
begin
  return value::uuid;
exception when others then
  return null;
end;
$$;

grant execute on function app_private.try_uuid(text) to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'smm-assets',
  'smm-assets',
  false,
  524288000,
  array[
    'image/jpeg','image/png','image/webp','image/gif',
    'video/mp4','video/webm','audio/mpeg','audio/wav',
    'application/pdf','text/plain'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'smm-reports',
  'smm-reports',
  false,
  52428800,
  array['application/pdf','text/html','application/json']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- READ: all active workspace members
-- ---------------------------------------------------------------------------

drop policy if exists smm_assets_select on storage.objects;
create policy smm_assets_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'smm-assets'
  and app_private.is_workspace_member(
    app_private.try_uuid((storage.foldername(name))[1])
  )
);

drop policy if exists smm_reports_select on storage.objects;
create policy smm_reports_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'smm-reports'
  and app_private.is_workspace_member(
    app_private.try_uuid((storage.foldername(name))[1])
  )
);

-- ---------------------------------------------------------------------------
-- WRITE: content team for assets
-- ---------------------------------------------------------------------------

drop policy if exists smm_assets_insert on storage.objects;
create policy smm_assets_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'smm-assets'
  and app_private.has_workspace_role(
    app_private.try_uuid((storage.foldername(name))[1]),
    array['owner','admin','smm','editor']::public.workspace_role[]
  )
);

drop policy if exists smm_assets_update on storage.objects;
create policy smm_assets_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'smm-assets'
  and app_private.has_workspace_role(
    app_private.try_uuid((storage.foldername(name))[1]),
    array['owner','admin','smm','editor']::public.workspace_role[]
  )
)
with check (
  bucket_id = 'smm-assets'
  and app_private.has_workspace_role(
    app_private.try_uuid((storage.foldername(name))[1]),
    array['owner','admin','smm','editor']::public.workspace_role[]
  )
);

drop policy if exists smm_assets_delete on storage.objects;
create policy smm_assets_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'smm-assets'
  and app_private.has_workspace_role(
    app_private.try_uuid((storage.foldername(name))[1]),
    array['owner','admin']::public.workspace_role[]
  )
);

-- Reports are written only by server-side service role.
-- No INSERT/UPDATE/DELETE policies for authenticated users.

commit;
