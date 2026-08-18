-- MARIA SMM OS
-- База знаний бренда: редакционный календарь, брендбук (файлы и ссылки),
-- используемые при генерации контент-плана.
-- Path convention (в бакете smm-assets): <workspace_id>/<brand_id>/knowledge/<source_id>/<filename>

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'smm-assets',
  'smm-assets',
  false,
  524288000,
  array[
    'image/jpeg','image/png','image/webp','image/gif',
    'video/mp4','video/webm','audio/mpeg','audio/wav',
    'application/pdf','text/plain','text/markdown',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
set allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.brand_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  kind text not null default 'other'
    check (kind in ('editorial_calendar','brand_book','other')),
  source_type text not null check (source_type in ('file','link')),
  title text not null,
  url text,
  asset_id uuid references public.assets(id) on delete set null,
  extracted_text text,
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending','done','unsupported','failed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint brand_knowledge_sources_file_or_link check (
    (source_type = 'file' and asset_id is not null and url is null)
    or (source_type = 'link' and url is not null and asset_id is null)
  )
);

create index if not exists brand_knowledge_sources_brand_idx
  on public.brand_knowledge_sources (brand_id, created_at desc);

alter table public.brand_knowledge_sources enable row level security;

drop policy if exists brand_knowledge_sources_select on public.brand_knowledge_sources;
create policy brand_knowledge_sources_select on public.brand_knowledge_sources
for select to authenticated
using (app_private.is_workspace_member(workspace_id));

drop policy if exists brand_knowledge_sources_insert on public.brand_knowledge_sources;
create policy brand_knowledge_sources_insert on public.brand_knowledge_sources
for insert to authenticated
with check (
  app_private.has_workspace_role(
    workspace_id,
    array['owner','admin','smm','editor']::public.workspace_role[]
  )
);

drop policy if exists brand_knowledge_sources_delete on public.brand_knowledge_sources;
create policy brand_knowledge_sources_delete on public.brand_knowledge_sources
for delete to authenticated
using (
  app_private.has_workspace_role(
    workspace_id,
    array['owner','admin','smm','editor']::public.workspace_role[]
  )
);

commit;
