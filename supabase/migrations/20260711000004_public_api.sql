-- MARIA SMM OS
-- Публичный API и вебхуки + платформы YouTube/RuTube/Instagram
-- Version 1.1 | 2026-07-11

-- Новые значения enum нельзя использовать в той же транзакции,
-- поэтому добавляем их до begin.
alter type public.channel_platform add value if not exists 'rutube';
alter type public.channel_platform add value if not exists 'instagram';

begin;

-- ---------------------------------------------------------------------------
-- API-КЛЮЧИ ДЛЯ ВНЕШНИХ ИНТЕГРАЦИЙ
-- Хранится только sha256-хэш ключа; сам ключ показывается один раз.
-- ---------------------------------------------------------------------------

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists api_keys_workspace_idx
  on public.api_keys(workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- ИСХОДЯЩИЕ ВЕБХУКИ
-- ---------------------------------------------------------------------------

create table if not exists public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  url text not null,
  -- секрет для HMAC-подписи; показывается один раз, хранится для подписи доставок
  secret text not null,
  events text[] not null default '{}',
  is_active boolean not null default true,
  description text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.job_status not null default 'pending',
  attempts integer not null default 0,
  response_status integer,
  last_error text,
  next_retry_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists webhook_deliveries_endpoint_idx
  on public.webhook_deliveries(endpoint_id, created_at desc);

create index if not exists webhook_deliveries_retry_idx
  on public.webhook_deliveries(status, next_retry_at)
  where status in ('pending','failed');

drop trigger if exists trg_webhook_endpoints_updated_at on public.webhook_endpoints;
create trigger trg_webhook_endpoints_updated_at
before update on public.webhook_endpoints
for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.api_keys enable row level security;
alter table public.webhook_endpoints enable row level security;
alter table public.webhook_deliveries enable row level security;

-- API-ключи и вебхуки управляются owner/admin
do $$
declare
  t text;
begin
  foreach t in array array['api_keys','webhook_endpoints']
  loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated
       using (app_private.has_workspace_role(
         workspace_id, array[''owner'',''admin'']::public.workspace_role[]))',
      t, t
    );

    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format(
      'create policy %I_write on public.%I for all to authenticated
       using (app_private.has_workspace_role(
         workspace_id, array[''owner'',''admin'']::public.workspace_role[]))
       with check (app_private.has_workspace_role(
         workspace_id, array[''owner'',''admin'']::public.workspace_role[]))',
      t, t
    );
  end loop;
end $$;

drop policy if exists webhook_deliveries_select on public.webhook_deliveries;
create policy webhook_deliveries_select on public.webhook_deliveries
for select to authenticated
using (
  app_private.has_workspace_role(
    workspace_id, array['owner','admin']::public.workspace_role[]
  )
);

commit;
