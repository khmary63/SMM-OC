-- MARIA SMM OS
-- Хранилище секретов интеграций (MVP-вариант Supabase Vault).
--
-- Секреты живут в app_private и НЕ доступны через PostgREST:
-- схема app_private не выставлена в API, доступ только у service_role
-- через security definer функции. В публичной integration_connections
-- хранится только secret_ref (uuid записи).

begin;

create table if not exists app_private.integration_secrets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_id uuid references public.channels(id) on delete cascade,
  secret text not null,
  rotated_at timestamptz,
  created_at timestamptz not null default now()
);

revoke all on app_private.integration_secrets from public, anon, authenticated;

-- Сохранить/обновить секрет канала; возвращает secret_ref.
create or replace function public.store_integration_secret(
  p_workspace_id uuid,
  p_channel_id uuid,
  p_secret text
)
returns uuid
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_id uuid;
begin
  -- Функция вызывается только с service role key (сервер приложения).
  if auth.role() is distinct from 'service_role' then
    raise exception 'store_integration_secret: service role required';
  end if;

  delete from app_private.integration_secrets
   where channel_id = p_channel_id;

  insert into app_private.integration_secrets(workspace_id, channel_id, secret)
  values (p_workspace_id, p_channel_id, p_secret)
  returning id into v_id;

  return v_id;
end;
$$;

-- Получить секрет по ссылке (для n8n secret resolver / server-side кода).
create or replace function public.resolve_integration_secret(p_secret_ref uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, app_private
as $$
declare
  v_secret text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'resolve_integration_secret: service role required';
  end if;

  select secret into v_secret
    from app_private.integration_secrets
   where id = p_secret_ref;

  return v_secret;
end;
$$;

-- Поиск пользователя по email для приглашений (только service role).
create or replace function public.find_user_id_by_email(p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'find_user_id_by_email: service role required';
  end if;

  select id into v_id
    from auth.users
   where lower(email) = lower(p_email)
   limit 1;

  return v_id;
end;
$$;

revoke all on function public.find_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.find_user_id_by_email(text) to service_role;

revoke all on function public.store_integration_secret(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.resolve_integration_secret(uuid) from public, anon, authenticated;
grant execute on function public.store_integration_secret(uuid, uuid, text) to service_role;
grant execute on function public.resolve_integration_secret(uuid) to service_role;

commit;
