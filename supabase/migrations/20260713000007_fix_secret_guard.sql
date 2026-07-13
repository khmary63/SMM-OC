-- MARIA SMM OS
-- Фикс: функции секретов должны работать и при прямом подключении к БД (n8n),
-- а не только через PostgREST с service_role. Блокируем лишь браузерные роли.
-- Version 1.4 | 2026-07-13

begin;

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
  -- Блокируем только браузерные роли; прямое подключение (postgres) и
  -- service_role — разрешены.
  if current_user in ('anon', 'authenticated') then
    raise exception 'store_integration_secret: server-side access required';
  end if;

  delete from app_private.integration_secrets
   where channel_id = p_channel_id;

  insert into app_private.integration_secrets(workspace_id, channel_id, secret)
  values (p_workspace_id, p_channel_id, p_secret)
  returning id into v_id;

  return v_id;
end;
$$;

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
  if current_user in ('anon', 'authenticated') then
    raise exception 'resolve_integration_secret: server-side access required';
  end if;

  select secret into v_secret
    from app_private.integration_secrets
   where id = p_secret_ref;

  return v_secret;
end;
$$;

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
  if current_user in ('anon', 'authenticated') then
    raise exception 'find_user_id_by_email: server-side access required';
  end if;

  select id into v_id
    from auth.users
   where lower(email) = lower(p_email)
   limit 1;

  return v_id;
end;
$$;

-- n8n подключается к БД напрямую (роль postgres) — даём право выполнять.
grant execute on function public.store_integration_secret(uuid, uuid, text) to service_role, postgres;
grant execute on function public.resolve_integration_secret(uuid) to service_role, postgres;
grant execute on function public.find_user_id_by_email(text) to service_role, postgres;
grant usage on schema app_private to postgres;

commit;
