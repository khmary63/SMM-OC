-- MARIA SMM OS
-- Supabase/PostgreSQL MVP migration
-- Version 1.0 | 2026-07-10
--
-- Assumptions:
-- 1. Supabase Auth schema `auth` already exists.
-- 2. API tokens are NOT stored in public tables.
-- 3. `integration_connections.secret_ref` points to Vault/secret manager/n8n credential.
-- 4. n8n uses the service role only on the server side.

begin;

create extension if not exists pgcrypto;

create schema if not exists app_private;
revoke all on schema app_private from public;

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.workspace_role as enum
    ('owner','admin','smm','editor','approver','viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.channel_platform as enum
    ('vk','telegram','max','youtube','dzen','ok','website','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.connection_status as enum
    ('disconnected','active','expired','error','disabled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.content_status as enum
    ('idea','planned','in_progress','text_ready','design_ready',
     'awaiting_approval','revision_requested','approved','scheduled',
     'published','publish_error','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.content_format as enum
    ('text','image','gallery','carousel','video','short_video',
     'story','link','poll','document','mixed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.content_goal as enum
    ('reach','engagement','growth','trust','expertise','traffic',
     'leads','sales','retention','awareness');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.asset_type as enum
    ('image','video','audio','document','logo','template','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.approval_status as enum
    ('pending','approved','rejected','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.publication_status as enum
    ('draft','queued','processing','published','failed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.metric_scope as enum
    ('organic','paid','combined');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.recommendation_confidence as enum
    ('insufficient','low','medium','high');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_status as enum
    ('pending','processing','succeeded','failed','cancelled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- COMMON FUNCTIONS
-- ---------------------------------------------------------------------------

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- USERS / WORKSPACES
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  locale text not null default 'ru',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  timezone text not null default 'Europe/London',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'viewer',
  is_active boolean not null default true,
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- ---------------------------------------------------------------------------
-- BRANDS / CHANNELS
-- ---------------------------------------------------------------------------

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  status text not null default 'active'
    check (status in ('active','paused','archived')),
  timezone text not null default 'Europe/London',
  locale text not null default 'ru',
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table if not exists public.brand_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null unique references public.brands(id) on delete cascade,
  positioning text,
  products_services jsonb not null default '[]'::jsonb,
  audience jsonb not null default '[]'::jsonb,
  geography jsonb not null default '[]'::jsonb,
  business_goals jsonb not null default '[]'::jsonb,
  tone_of_voice text,
  prohibited_topics jsonb not null default '[]'::jsonb,
  prohibited_phrases jsonb not null default '[]'::jsonb,
  brand_colors jsonb not null default '[]'::jsonb,
  fonts jsonb not null default '[]'::jsonb,
  visual_references jsonb not null default '[]'::jsonb,
  prompt_rules text,
  kpis jsonb not null default '{}'::jsonb,
  content_score_weights jsonb not null default
    '{"reach":0.30,"engagement":0.25,"shares":0.20,"velocity":0.15,"clicks":0.10}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  platform public.channel_platform not null,
  name text not null,
  external_channel_id text,
  username text,
  public_url text,
  status public.connection_status not null default 'disconnected',
  timezone text,
  capabilities jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_successful_sync_at timestamptz,
  sync_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists channels_platform_external_uidx
  on public.channels(platform, external_channel_id)
  where external_channel_id is not null;

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_id uuid not null unique references public.channels(id) on delete cascade,
  provider text not null,
  auth_type text not null,
  secret_ref text not null,
  granted_scopes text[] not null default '{}',
  status public.connection_status not null default 'disconnected',
  expires_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  connector_version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- CONTENT
-- ---------------------------------------------------------------------------

create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  title text not null,
  body text,
  source_type text,
  source_url text,
  source_payload jsonb not null default '{}'::jsonb,
  status text not null default 'new'
    check (status in ('new','selected','converted','archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  source_idea_id uuid references public.ideas(id) on delete set null,
  title text not null,
  topic text,
  rubric text,
  goal public.content_goal,
  funnel_stage text,
  audience_segment text,
  base_text text,
  hook text,
  cta text,
  format public.content_format not null default 'text',
  status public.content_status not null default 'idea',
  planned_at timestamptz,
  owner_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  ai_generated boolean not null default false,
  approved_version_no integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_variants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  channel_id uuid references public.channels(id) on delete cascade,
  version_no integer not null default 1 check (version_no > 0),
  title text,
  body text,
  hook text,
  cta text,
  hashtags text[] not null default '{}',
  scheduled_at timestamptz,
  status public.content_status not null default 'in_progress',
  platform_payload jsonb not null default '{}'::jsonb,
  generation_metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists content_variants_version_uidx
  on public.content_variants(
    content_item_id,
    coalesce(channel_id, '00000000-0000-0000-0000-000000000000'::uuid),
    version_no
  );

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  type public.asset_type not null,
  storage_bucket text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  duration_seconds numeric(12,3) check (duration_seconds is null or duration_seconds >= 0),
  checksum_sha256 text,
  ai_provider text,
  generation_prompt text,
  source_asset_id uuid references public.assets(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

create table if not exists public.content_assets (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_variant_id uuid not null references public.content_variants(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  role text not null default 'attachment'
    check (role in ('attachment','cover','thumbnail','source','audio','subtitle','logo')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (content_variant_id, asset_id, role)
);

create table if not exists public.content_tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  category text not null,
  auto_generated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_id, category, name)
);

create table if not exists public.content_tag_links (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  tag_id uuid not null references public.content_tags(id) on delete cascade,
  value_text text,
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  created_at timestamptz not null default now(),
  primary key (content_item_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- REVIEW / APPROVAL
-- ---------------------------------------------------------------------------

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_variant_id uuid not null references public.content_variants(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  approver_user_id uuid references auth.users(id) on delete set null,
  version_no integer not null check (version_no > 0),
  status public.approval_status not null default 'pending',
  comment text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists approvals_one_pending_uidx
  on public.approvals(content_variant_id, version_no)
  where status = 'pending';

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_type text not null
    check (entity_type in ('content_item','content_variant','asset','approval','publication','report')),
  entity_id uuid not null,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- PUBLICATION
-- ---------------------------------------------------------------------------

create table if not exists public.publications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_variant_id uuid not null references public.content_variants(id) on delete restrict,
  channel_id uuid not null references public.channels(id) on delete restrict,
  scheduled_at timestamptz not null,
  status public.publication_status not null default 'draft',
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  external_post_id text,
  external_url text,
  published_at timestamptz,
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  failure_code text,
  failure_message text,
  locked_at timestamptz,
  locked_by text,
  connector_version text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, external_post_id)
);

create table if not exists public.publication_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  publication_id uuid not null references public.publications(id) on delete cascade,
  attempt_no integer not null check (attempt_no > 0),
  workflow_execution_id text,
  status public.job_status not null default 'processing',
  request_payload jsonb,
  response_payload jsonb,
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (publication_id, attempt_no)
);

-- ---------------------------------------------------------------------------
-- METRICS
-- ---------------------------------------------------------------------------

create table if not exists public.channel_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  captured_at timestamptz not null,
  local_date date not null,
  scope public.metric_scope not null default 'combined',
  followers bigint,
  subscriptions bigint,
  unsubscriptions bigint,
  reach bigint,
  impressions bigint,
  views bigint,
  reactions bigint,
  comments bigint,
  shares bigint,
  clicks bigint,
  posts_count bigint,
  raw_payload jsonb not null default '{}'::jsonb,
  connector_version text,
  created_at timestamptz not null default now(),
  unique (channel_id, local_date, scope)
);

create table if not exists public.post_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  publication_id uuid not null references public.publications(id) on delete cascade,
  captured_at timestamptz not null,
  age_bucket text not null
    check (age_bucket in ('1h','6h','24h','72h','7d','30d','daily','manual')),
  scope public.metric_scope not null default 'combined',
  reach bigint,
  impressions bigint,
  views bigint,
  reactions bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  saves bigint,
  clicks bigint,
  follower_reach bigint,
  non_follower_reach bigint,
  subscriber_delta_estimate numeric(14,4),
  raw_payload jsonb not null default '{}'::jsonb,
  connector_version text,
  created_at timestamptz not null default now(),
  unique (publication_id, age_bucket, scope)
);

-- ---------------------------------------------------------------------------
-- EXPERIMENTS / INSIGHTS / REPORTS
-- ---------------------------------------------------------------------------

create table if not exists public.experiments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  hypothesis text not null,
  primary_metric text not null,
  success_threshold numeric,
  start_date date,
  end_date date,
  status text not null default 'draft'
    check (status in ('draft','active','completed','cancelled')),
  result jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.insights (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  channel_id uuid references public.channels(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  insight_type text not null,
  title text not null,
  body text not null,
  evidence jsonb not null default '[]'::jsonb,
  confidence public.recommendation_confidence not null default 'insufficient',
  model_name text,
  prompt_version text,
  created_at timestamptz not null default now()
);

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  insight_id uuid references public.insights(id) on delete set null,
  action text not null,
  reason text not null,
  evidence jsonb not null default '[]'::jsonb,
  confidence public.recommendation_confidence not null default 'insufficient',
  test_metric text,
  test_period_days integer check (test_period_days is null or test_period_days > 0),
  status text not null default 'proposed'
    check (status in ('proposed','accepted','rejected','implemented','expired')),
  accepted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.monthly_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  report_month date not null check (extract(day from report_month) = 1),
  period_start date not null,
  period_end date not null,
  status public.job_status not null default 'pending',
  summary_json jsonb not null default '{}'::jsonb,
  report_asset_id uuid references public.assets(id) on delete set null,
  generated_at timestamptz,
  generated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, report_month)
);

-- ---------------------------------------------------------------------------
-- AUTOMATION / OPERATIONS
-- ---------------------------------------------------------------------------

create table if not exists public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_type text not null,
  entity_type text,
  entity_id uuid,
  status public.job_status not null default 'pending',
  priority integer not null default 100,
  run_after timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  locked_at timestamptz,
  locked_by text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  last_error text,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  request_id text,
  ip_hash text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------

create index if not exists workspace_members_user_idx
  on public.workspace_members(user_id, is_active);

create index if not exists brands_workspace_idx
  on public.brands(workspace_id, status);

create index if not exists channels_brand_idx
  on public.channels(brand_id, platform, status);

create index if not exists ideas_brand_status_idx
  on public.ideas(brand_id, status, created_at desc);

create index if not exists content_items_calendar_idx
  on public.content_items(brand_id, planned_at, status);

create index if not exists content_items_workspace_idx
  on public.content_items(workspace_id, updated_at desc);

create index if not exists content_variants_item_idx
  on public.content_variants(content_item_id, channel_id, version_no desc);

create index if not exists assets_workspace_idx
  on public.assets(workspace_id, created_at desc);

create index if not exists approvals_approver_idx
  on public.approvals(approver_user_id, status, requested_at desc);

create index if not exists publications_due_idx
  on public.publications(status, scheduled_at)
  where status in ('queued','failed');

create index if not exists publications_channel_published_idx
  on public.publications(channel_id, published_at desc);

create index if not exists channel_metrics_channel_date_idx
  on public.channel_metric_snapshots(channel_id, local_date desc);

create index if not exists post_metrics_publication_time_idx
  on public.post_metric_snapshots(publication_id, captured_at desc);

create index if not exists insights_brand_period_idx
  on public.insights(brand_id, period_start, period_end);

create index if not exists recommendations_brand_status_idx
  on public.recommendations(brand_id, status, created_at desc);

create index if not exists automation_jobs_claim_idx
  on public.automation_jobs(status, run_after, priority, created_at)
  where status in ('pending','failed');

create index if not exists notifications_user_unread_idx
  on public.notifications(user_id, created_at desc)
  where read_at is null;

create index if not exists audit_logs_workspace_time_idx
  on public.audit_logs(workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- TRIGGERS
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles','workspaces','workspace_members','brands','brand_profiles',
    'channels','integration_connections','ideas','content_items',
    'content_variants','assets','approvals','comments','publications',
    'experiments','recommendations','monthly_reports','automation_jobs'
  ]
  loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', t, t);
    execute format(
      'create trigger trg_%I_updated_at before update on public.%I
       for each row execute function app_private.set_updated_at()',
      t, t
    );
  end loop;
end $$;

create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function app_private.handle_new_user();

create or replace function app_private.handle_new_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_members(workspace_id, user_id, role, is_active)
  values (new.id, new.owner_user_id, 'owner', true)
  on conflict (workspace_id, user_id)
  do update set role = 'owner', is_active = true;
  return new;
end;
$$;

drop trigger if exists on_workspace_created on public.workspaces;
create trigger on_workspace_created
after insert on public.workspaces
for each row execute function app_private.handle_new_workspace();

-- ---------------------------------------------------------------------------
-- RLS HELPERS
-- ---------------------------------------------------------------------------

create or replace function app_private.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.is_active = true
  );
$$;

create or replace function app_private.has_workspace_role(
  target_workspace_id uuid,
  allowed_roles public.workspace_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.is_active = true
      and wm.role = any(allowed_roles)
  );
$$;

create or replace function app_private.shares_workspace_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs
      on theirs.workspace_id = mine.workspace_id
     and theirs.is_active = true
    where mine.user_id = auth.uid()
      and mine.is_active = true
      and theirs.user_id = target_user_id
  );
$$;

grant usage on schema app_private to authenticated, service_role;
grant execute on function app_private.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function app_private.has_workspace_role(uuid, public.workspace_role[]) to authenticated, service_role;
grant execute on function app_private.shares_workspace_with(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ENABLE RLS
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles','workspaces','workspace_members','brands','brand_profiles',
    'channels','integration_connections','ideas','content_items',
    'content_variants','assets','content_assets','content_tags',
    'content_tag_links','approvals','comments','publications',
    'publication_attempts','channel_metric_snapshots','post_metric_snapshots',
    'experiments','insights','recommendations','monthly_reports',
    'automation_jobs','notifications','audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (id = auth.uid() or app_private.shares_workspace_with(id));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Workspaces
drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
for select to authenticated
using (app_private.is_workspace_member(id));

drop policy if exists workspaces_insert on public.workspaces;
create policy workspaces_insert on public.workspaces
for insert to authenticated
with check (owner_user_id = auth.uid());

drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_update on public.workspaces
for update to authenticated
using (app_private.has_workspace_role(id, array['owner','admin']::public.workspace_role[]))
with check (app_private.has_workspace_role(id, array['owner','admin']::public.workspace_role[]));

drop policy if exists workspaces_delete on public.workspaces;
create policy workspaces_delete on public.workspaces
for delete to authenticated
using (owner_user_id = auth.uid());

-- Workspace members
drop policy if exists workspace_members_select on public.workspace_members;
create policy workspace_members_select on public.workspace_members
for select to authenticated
using (app_private.is_workspace_member(workspace_id));

drop policy if exists workspace_members_insert on public.workspace_members;
create policy workspace_members_insert on public.workspace_members
for insert to authenticated
with check (
  app_private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[])
);

drop policy if exists workspace_members_update on public.workspace_members;
create policy workspace_members_update on public.workspace_members
for update to authenticated
using (
  app_private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[])
)
with check (
  app_private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[])
);

drop policy if exists workspace_members_delete on public.workspace_members;
create policy workspace_members_delete on public.workspace_members
for delete to authenticated
using (
  app_private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[])
  and role <> 'owner'
);

-- Generic editable workspace tables
do $$
declare
  t text;
begin
  foreach t in array array[
    'brands','brand_profiles','ideas','content_items','content_variants',
    'assets','content_assets','content_tags','content_tag_links','experiments'
  ]
  loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated
       using (app_private.is_workspace_member(workspace_id))',
      t, t
    );

    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated
       with check (
         app_private.has_workspace_role(
           workspace_id,
           array[''owner'',''admin'',''smm'',''editor'']::public.workspace_role[]
         )
       )',
      t, t
    );

    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated
       using (
         app_private.has_workspace_role(
           workspace_id,
           array[''owner'',''admin'',''smm'',''editor'']::public.workspace_role[]
         )
       )
       with check (
         app_private.has_workspace_role(
           workspace_id,
           array[''owner'',''admin'',''smm'',''editor'']::public.workspace_role[]
         )
       )',
      t, t
    );

    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated
       using (
         app_private.has_workspace_role(
           workspace_id,
           array[''owner'',''admin'']::public.workspace_role[]
         )
       )',
      t, t
    );
  end loop;
end $$;

-- Channels / connections: admin-controlled
do $$
declare
  t text;
begin
  foreach t in array array['channels','integration_connections']
  loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated
       using (app_private.is_workspace_member(workspace_id))',
      t, t
    );

    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated
       with check (
         app_private.has_workspace_role(
           workspace_id,
           array[''owner'',''admin'']::public.workspace_role[]
         )
       )',
      t, t
    );

    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated
       using (
         app_private.has_workspace_role(
           workspace_id,
           array[''owner'',''admin'']::public.workspace_role[]
         )
       )
       with check (
         app_private.has_workspace_role(
           workspace_id,
           array[''owner'',''admin'']::public.workspace_role[]
         )
       )',
      t, t
    );

    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated
       using (
         app_private.has_workspace_role(
           workspace_id,
           array[''owner'',''admin'']::public.workspace_role[]
         )
       )',
      t, t
    );
  end loop;
end $$;

-- Approvals
drop policy if exists approvals_select on public.approvals;
create policy approvals_select on public.approvals
for select to authenticated
using (app_private.is_workspace_member(workspace_id));

drop policy if exists approvals_insert on public.approvals;
create policy approvals_insert on public.approvals
for insert to authenticated
with check (
  app_private.has_workspace_role(
    workspace_id,
    array['owner','admin','smm','editor']::public.workspace_role[]
  )
);

drop policy if exists approvals_update on public.approvals;
create policy approvals_update on public.approvals
for update to authenticated
using (
  app_private.has_workspace_role(
    workspace_id,
    array['owner','admin','smm']::public.workspace_role[]
  )
  or approver_user_id = auth.uid()
)
with check (
  app_private.has_workspace_role(
    workspace_id,
    array['owner','admin','smm']::public.workspace_role[]
  )
  or approver_user_id = auth.uid()
);

-- Comments
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments
for select to authenticated
using (app_private.is_workspace_member(workspace_id));

drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments
for insert to authenticated
with check (
  author_user_id = auth.uid()
  and app_private.is_workspace_member(workspace_id)
);

drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments
for update to authenticated
using (
  author_user_id = auth.uid()
  or app_private.has_workspace_role(
    workspace_id, array['owner','admin']::public.workspace_role[]
  )
)
with check (
  author_user_id = auth.uid()
  or app_private.has_workspace_role(
    workspace_id, array['owner','admin']::public.workspace_role[]
  )
);

drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments
for delete to authenticated
using (
  author_user_id = auth.uid()
  or app_private.has_workspace_role(
    workspace_id, array['owner','admin']::public.workspace_role[]
  )
);

-- Publications: user can create/schedule; integration worker writes attempts/results.
drop policy if exists publications_select on public.publications;
create policy publications_select on public.publications
for select to authenticated
using (app_private.is_workspace_member(workspace_id));

drop policy if exists publications_insert on public.publications;
create policy publications_insert on public.publications
for insert to authenticated
with check (
  app_private.has_workspace_role(
    workspace_id, array['owner','admin','smm']::public.workspace_role[]
  )
);

drop policy if exists publications_update on public.publications;
create policy publications_update on public.publications
for update to authenticated
using (
  app_private.has_workspace_role(
    workspace_id, array['owner','admin','smm']::public.workspace_role[]
  )
)
with check (
  app_private.has_workspace_role(
    workspace_id, array['owner','admin','smm']::public.workspace_role[]
  )
);

drop policy if exists publications_delete on public.publications;
create policy publications_delete on public.publications
for delete to authenticated
using (
  app_private.has_workspace_role(
    workspace_id, array['owner','admin']::public.workspace_role[]
  )
  and status in ('draft','cancelled')
);

-- Read-only operational and analytical tables for workspace members.
do $$
declare
  t text;
begin
  foreach t in array array[
    'publication_attempts','channel_metric_snapshots','post_metric_snapshots',
    'insights','monthly_reports','automation_jobs','audit_logs'
  ]
  loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated
       using (app_private.is_workspace_member(workspace_id))',
      t, t
    );
  end loop;
end $$;

-- Recommendations: members read; content team can change status.
drop policy if exists recommendations_select on public.recommendations;
create policy recommendations_select on public.recommendations
for select to authenticated
using (app_private.is_workspace_member(workspace_id));

drop policy if exists recommendations_update on public.recommendations;
create policy recommendations_update on public.recommendations
for update to authenticated
using (
  app_private.has_workspace_role(
    workspace_id, array['owner','admin','smm','editor']::public.workspace_role[]
  )
)
with check (
  app_private.has_workspace_role(
    workspace_id, array['owner','admin','smm','editor']::public.workspace_role[]
  )
);

-- Notifications
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
for select to authenticated
using (user_id = auth.uid());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- PRIVILEGES
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- ---------------------------------------------------------------------------
-- ANALYTICAL VIEWS
-- ---------------------------------------------------------------------------

create or replace view public.v_channel_daily_growth
with (security_invoker = true)
as
select
  s.workspace_id,
  s.channel_id,
  c.brand_id,
  c.platform,
  s.local_date,
  s.scope,
  s.followers,
  s.followers
    - lag(s.followers) over (
        partition by s.channel_id, s.scope
        order by s.local_date
      ) as follower_delta,
  case
    when lag(s.followers) over (
      partition by s.channel_id, s.scope
      order by s.local_date
    ) > 0
    then round(
      (
        (s.followers - lag(s.followers) over (
          partition by s.channel_id, s.scope
          order by s.local_date
        ))::numeric
        /
        lag(s.followers) over (
          partition by s.channel_id, s.scope
          order by s.local_date
        )::numeric
      ) * 100,
      4
    )
  end as follower_growth_pct,
  s.reach,
  s.impressions,
  s.views,
  s.reactions,
  s.comments,
  s.shares,
  s.clicks
from public.channel_metric_snapshots s
join public.channels c on c.id = s.channel_id;

create or replace view public.v_publication_latest_metrics
with (security_invoker = true)
as
select distinct on (m.publication_id, m.scope)
  m.workspace_id,
  m.publication_id,
  m.scope,
  m.captured_at,
  m.age_bucket,
  m.reach,
  m.impressions,
  m.views,
  m.reactions,
  m.likes,
  m.comments,
  m.shares,
  m.saves,
  m.clicks,
  m.follower_reach,
  m.non_follower_reach,
  case
    when coalesce(m.reach, m.views, 0) > 0
    then round(
      (
        coalesce(m.reactions, 0)
        + coalesce(m.comments, 0)
        + coalesce(m.shares, 0)
        + coalesce(m.saves, 0)
      )::numeric
      / coalesce(nullif(m.reach, 0), nullif(m.views, 0))::numeric
      * 100,
      4
    )
  end as engagement_rate,
  case
    when coalesce(m.reach, m.views, 0) > 0
    then round(
      coalesce(m.shares, 0)::numeric
      / coalesce(nullif(m.reach, 0), nullif(m.views, 0))::numeric
      * 100,
      4
    )
  end as share_rate,
  case
    when m.reach > 0 and m.non_follower_reach is not null
    then round(m.non_follower_reach::numeric / m.reach::numeric * 100, 4)
  end as viral_share
from public.post_metric_snapshots m
order by m.publication_id, m.scope, m.captured_at desc;

create or replace view public.v_content_performance
with (security_invoker = true)
as
select
  p.workspace_id,
  p.id as publication_id,
  p.channel_id,
  ch.brand_id,
  ch.platform,
  p.published_at,
  ci.id as content_item_id,
  ci.title,
  ci.rubric,
  ci.goal,
  ci.format,
  lm.scope,
  lm.reach,
  lm.impressions,
  lm.views,
  lm.reactions,
  lm.comments,
  lm.shares,
  lm.saves,
  lm.clicks,
  lm.engagement_rate,
  lm.share_rate,
  lm.viral_share
from public.publications p
join public.channels ch on ch.id = p.channel_id
join public.content_variants cv on cv.id = p.content_variant_id
join public.content_items ci on ci.id = cv.content_item_id
left join public.v_publication_latest_metrics lm
  on lm.publication_id = p.id
where p.status = 'published';

-- ---------------------------------------------------------------------------
-- JOB CLAIM FUNCTION FOR N8N
-- ---------------------------------------------------------------------------

create or replace function app_private.claim_automation_jobs(
  worker_name text,
  requested_job_type text default null,
  batch_size integer default 10
)
returns setof public.automation_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select j.id
    from public.automation_jobs j
    where j.status in ('pending','failed')
      and j.run_after <= now()
      and j.attempts < j.max_attempts
      and (requested_job_type is null or j.job_type = requested_job_type)
    order by j.priority asc, j.created_at asc
    for update skip locked
    limit greatest(1, least(batch_size, 100))
  )
  update public.automation_jobs j
     set status = 'processing',
         locked_at = now(),
         locked_by = worker_name,
         attempts = j.attempts + 1,
         updated_at = now()
    from candidates c
   where j.id = c.id
  returning j.*;
end;
$$;

revoke all on function app_private.claim_automation_jobs(text,text,integer) from public;
grant execute on function app_private.claim_automation_jobs(text,text,integer)
  to service_role;

commit;
