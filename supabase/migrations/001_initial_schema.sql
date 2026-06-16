-- MeshSelfie initial Supabase schema
-- Source documents:
-- - docs/meshselfie-prd.md
-- - docs/technical-design.md
-- - docs/supabase-schema.md

begin;

create extension if not exists "pgcrypto";

create type public.user_role as enum ('user', 'admin');

create type public.image_role as enum ('front', 'side', 'angle45');
create type public.image_direction as enum ('left', 'right');
create type public.validation_status as enum ('pending', 'passed', 'warning', 'failed');
create type public.source_image_status as enum ('uploaded', 'linked', 'deleted');

create type public.mesh_status as enum (
  'queued',
  'validating',
  'preprocessing',
  'generating',
  'postprocessing',
  'thumbnailing',
  'completed',
  'failed',
  'canceled',
  'deleted'
);

create type public.job_status as enum (
  'queued',
  'validating',
  'preprocessing',
  'generating',
  'postprocessing',
  'thumbnailing',
  'completed',
  'failed',
  'canceled'
);

create type public.quality_grade as enum ('B', 'A', 'A+');
create type public.model_source as enum ('ai_generated', 'admin_uploaded');
create type public.provider_key as enum ('replicate', 'trellis', 'hunyuan3d', 'triposr', 'self_hosted');
create type public.generation_mode as enum ('photorealistic_human_mesh');

create type public.admin_model_action as enum ('upload', 'replace', 'delete', 'sample_create');
create type public.credit_reason as enum ('signup_bonus', 'generation_used', 'admin_adjustment', 'refund');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role public.user_role not null default 'user',
  mesh_quota_daily integer not null default 3 check (mesh_quota_daily >= 0),
  remaining_credits integer not null default 3 check (remaining_credits >= 0),
  used_credits integer not null default 0 check (used_credits >= 0),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.source_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null default 'avatars',
  object_path text not null,
  image_role public.image_role not null,
  image_direction public.image_direction,
  original_filename text not null,
  content_type text not null check (content_type in ('image/jpeg', 'image/png')),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  checksum_sha256 text,
  validation_status public.validation_status not null default 'pending',
  validation_errors jsonb,
  validation_warnings jsonb,
  face_bbox jsonb,
  blur_score numeric,
  status public.source_image_status not null default 'uploaded',
  soft_deleted_at timestamptz,
  purge_after timestamptz,
  created_at timestamptz not null default now(),

  constraint source_images_direction_required_chk check (
    (image_role = 'front' and image_direction is null)
    or (image_role in ('side', 'angle45') and image_direction is not null)
  ),
  constraint source_images_path_unique unique (bucket, object_path)
);

create table public.human_meshes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  front_source_image_id uuid not null references public.source_images(id),
  side_source_image_id uuid references public.source_images(id),
  angle45_source_image_id uuid references public.source_images(id),

  front_image_url text not null,
  side_image_url text,
  side_direction public.image_direction,
  angle45_image_url text,
  angle45_direction public.image_direction,

  latest_job_id uuid,
  title text,
  status public.mesh_status not null default 'queued',
  input_image_count integer not null check (input_image_count between 1 and 3),
  quality_grade public.quality_grade not null,
  model_source public.model_source not null default 'ai_generated',

  model_bucket text,
  model_object_path text,
  model_content_type text,
  model_file_size_bytes bigint check (model_file_size_bytes is null or model_file_size_bytes > 0),

  quality_notes jsonb,

  thumbnail_bucket text,
  thumbnail_object_path text,
  thumbnail_url text,
  thumbnail_generated_at timestamptz,
  preview_render_object_path text,

  is_featured boolean not null default false,
  featured_at timestamptz,

  completed_at timestamptz,
  failed_at timestamptz,
  soft_deleted_at timestamptz,
  purge_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint human_meshes_side_direction_chk check (
    (side_source_image_id is null and side_direction is null and side_image_url is null)
    or (side_source_image_id is not null and side_direction is not null and side_image_url is not null)
  ),
  constraint human_meshes_angle45_direction_chk check (
    (angle45_source_image_id is null and angle45_direction is null and angle45_image_url is null)
    or (angle45_source_image_id is not null and angle45_direction is not null and angle45_image_url is not null)
  ),
  constraint human_meshes_featured_at_chk check (
    (is_featured = false and featured_at is null)
    or (is_featured = true and featured_at is not null)
  )
);

create table public.ai_provider_versions (
  id uuid primary key default gen_random_uuid(),
  provider_key public.provider_key not null,
  model_name text not null,
  model_version text not null,
  is_active boolean not null default false,
  priority integer not null default 100,
  supports_multi_view boolean not null default true,
  max_input_images integer not null default 1 check (max_input_images > 0),
  estimated_cost_per_job numeric,
  success_rate_rolling numeric check (
    success_rate_rolling is null
    or (success_rate_rolling >= 0 and success_rate_rolling <= 1)
  ),
  config jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ai_provider_versions_unique unique (provider_key, model_name, model_version)
);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  human_mesh_id uuid not null references public.human_meshes(id) on delete cascade,

  front_source_image_id uuid not null references public.source_images(id),
  side_source_image_id uuid references public.source_images(id),
  angle45_source_image_id uuid references public.source_images(id),

  provider public.provider_key not null,
  provider_version_id uuid references public.ai_provider_versions(id),
  model_name text not null,
  generation_mode public.generation_mode not null default 'photorealistic_human_mesh',
  provider_prediction_id text,

  status public.job_status not null default 'queued',
  progress integer check (progress is null or (progress >= 0 and progress <= 100)),
  quality_grade public.quality_grade not null,

  estimated_generation_cost numeric,
  used_credits integer not null default 0 check (used_credits >= 0),
  failover_from_job_id uuid references public.generation_jobs(id),
  attempt_no integer not null default 1 check (attempt_no > 0),

  input_payload jsonb,
  output_payload jsonb,
  error_code text,
  error_message text,
  internal_error text,

  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.human_meshes
  add constraint human_meshes_latest_job_fk
  foreign key (latest_job_id)
  references public.generation_jobs(id);

create table public.admin_model_uploads (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id),
  target_user_id uuid references auth.users(id),
  human_mesh_id uuid references public.human_meshes(id) on delete set null,
  action public.admin_model_action not null,
  model_bucket text,
  model_object_path text,
  original_filename text,
  content_type text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes > 0),
  reason text,
  created_at timestamptz not null default now()
);

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  generation_job_id uuid references public.generation_jobs(id) on delete set null,
  delta integer not null,
  balance_after integer not null check (balance_after >= 0),
  reason public.credit_reason not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    role,
    mesh_quota_daily,
    remaining_credits,
    used_credits
  )
  values (
    new.id,
    coalesce(new.email, ''),
    'user',
    3,
    3,
    0
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger human_meshes_set_updated_at
before update on public.human_meshes
for each row execute function public.set_updated_at();

create trigger ai_provider_versions_set_updated_at
before update on public.ai_provider_versions
for each row execute function public.set_updated_at();

create trigger generation_jobs_set_updated_at
before update on public.generation_jobs
for each row execute function public.set_updated_at();

create index profiles_role_idx on public.profiles(role);
create index profiles_email_idx on public.profiles(email);

create index source_images_user_created_idx on public.source_images(user_id, created_at desc);
create index source_images_user_role_idx on public.source_images(user_id, image_role);
create index source_images_status_idx on public.source_images(status);
create index source_images_purge_idx on public.source_images(purge_after) where purge_after is not null;

create index human_meshes_user_created_idx on public.human_meshes(user_id, created_at desc);
create index human_meshes_user_status_idx on public.human_meshes(user_id, status);
create index human_meshes_source_idx on public.human_meshes(model_source, created_at desc);
create index human_meshes_featured_idx on public.human_meshes(is_featured, featured_at desc) where is_featured = true;
create index human_meshes_purge_idx on public.human_meshes(purge_after) where purge_after is not null;

create index ai_provider_versions_active_idx on public.ai_provider_versions(is_active, priority);

create index generation_jobs_user_created_idx on public.generation_jobs(user_id, created_at desc);
create index generation_jobs_mesh_idx on public.generation_jobs(human_mesh_id, created_at desc);
create index generation_jobs_status_created_idx on public.generation_jobs(status, created_at);
create index generation_jobs_provider_prediction_idx
  on public.generation_jobs(provider, provider_prediction_id)
  where provider_prediction_id is not null;
create index generation_jobs_provider_created_idx on public.generation_jobs(provider, created_at desc);
create index generation_jobs_failover_idx on public.generation_jobs(failover_from_job_id) where failover_from_job_id is not null;

create index admin_model_uploads_admin_created_idx on public.admin_model_uploads(admin_user_id, created_at desc);
create index admin_model_uploads_target_created_idx on public.admin_model_uploads(target_user_id, created_at desc);
create index admin_model_uploads_mesh_idx on public.admin_model_uploads(human_mesh_id);

create index credit_ledger_user_created_idx on public.credit_ledger(user_id, created_at desc);
create index credit_ledger_job_idx on public.credit_ledger(generation_job_id);

create index usage_events_user_created_idx on public.usage_events(user_id, created_at desc);
create index usage_events_type_created_idx on public.usage_events(event_type, created_at desc);

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.source_images enable row level security;
alter table public.human_meshes enable row level security;
alter table public.ai_provider_versions enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.admin_model_uploads enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.usage_events enable row level security;

create policy "profiles_select_own_or_admin"
on public.profiles for select
using (id = auth.uid() or public.is_admin());

create policy "profiles_admin_update"
on public.profiles for update
using (public.is_admin())
with check (public.is_admin());

create policy "source_images_select_own_or_admin"
on public.source_images for select
using (user_id = auth.uid() or public.is_admin());

create policy "source_images_admin_insert"
on public.source_images for insert
with check (public.is_admin());

create policy "source_images_admin_update"
on public.source_images for update
using (public.is_admin())
with check (public.is_admin());

create policy "human_meshes_select_own_admin_or_featured"
on public.human_meshes for select
using (user_id = auth.uid() or public.is_admin() or is_featured = true);

create policy "human_meshes_admin_insert"
on public.human_meshes for insert
with check (public.is_admin());

create policy "human_meshes_admin_update"
on public.human_meshes for update
using (public.is_admin())
with check (public.is_admin());

create policy "generation_jobs_select_own_or_admin"
on public.generation_jobs for select
using (user_id = auth.uid() or public.is_admin());

create policy "generation_jobs_admin_insert"
on public.generation_jobs for insert
with check (public.is_admin());

create policy "generation_jobs_admin_update"
on public.generation_jobs for update
using (public.is_admin())
with check (public.is_admin());

create policy "ai_provider_versions_admin_select"
on public.ai_provider_versions for select
using (public.is_admin());

create policy "ai_provider_versions_admin_all"
on public.ai_provider_versions for all
using (public.is_admin())
with check (public.is_admin());

create policy "admin_model_uploads_admin_select"
on public.admin_model_uploads for select
using (public.is_admin());

create policy "admin_model_uploads_admin_insert"
on public.admin_model_uploads for insert
with check (public.is_admin());

create policy "credit_ledger_select_own_or_admin"
on public.credit_ledger for select
using (user_id = auth.uid() or public.is_admin());

create policy "credit_ledger_admin_insert"
on public.credit_ledger for insert
with check (public.is_admin());

create policy "usage_events_select_own_or_admin"
on public.usage_events for select
using (user_id = auth.uid() or public.is_admin());

create policy "usage_events_insert_own"
on public.usage_events for insert
with check (user_id = auth.uid());

create policy "storage_avatars_select_own_or_admin"
on storage.objects for select
using (
  bucket_id = 'avatars'
  and (
    public.is_admin()
    or (
      (storage.foldername(name))[1] in ('images', 'models', 'thumbnails')
      and (storage.foldername(name))[2] = auth.uid()::text
    )
  )
);

create policy "storage_avatars_insert_own_images"
on storage.objects for insert
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = 'images'
  and (storage.foldername(name))[2] = auth.uid()::text
);

create policy "storage_avatars_admin_all"
on storage.objects for all
using (bucket_id = 'avatars' and public.is_admin())
with check (bucket_id = 'avatars' and public.is_admin());

commit;
