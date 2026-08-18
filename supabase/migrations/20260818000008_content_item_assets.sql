-- ============================================================================
-- Прикрепление медиафайлов (assets) к карточке контента (content_items)
-- целиком — общий набор для всех адаптаций/каналов внутри карточки.
-- ============================================================================

create table if not exists public.content_item_assets (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (content_item_id, asset_id)
);

create index if not exists content_item_assets_item_idx
  on public.content_item_assets(content_item_id, sort_order);

alter table public.content_item_assets enable row level security;

drop policy if exists content_item_assets_select on public.content_item_assets;
create policy content_item_assets_select on public.content_item_assets
for select to authenticated
using (app_private.is_workspace_member(workspace_id));

drop policy if exists content_item_assets_insert on public.content_item_assets;
create policy content_item_assets_insert on public.content_item_assets
for insert to authenticated
with check (
  app_private.has_workspace_role(
    workspace_id,
    array['owner','admin','smm','editor']::public.workspace_role[]
  )
);

drop policy if exists content_item_assets_delete on public.content_item_assets;
create policy content_item_assets_delete on public.content_item_assets
for delete to authenticated
using (
  app_private.has_workspace_role(
    workspace_id,
    array['owner','admin','smm','editor']::public.workspace_role[]
  )
);
