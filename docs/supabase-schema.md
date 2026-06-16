# MeshSelfie Supabase 데이터베이스 스키마 설계

| 항목 | 내용 |
| --- | --- |
| 버전 | 0.1 |
| 기준 문서 | `docs/technical-design.md` |
| 대상 | Supabase PostgreSQL + RLS + Private Storage |
| Migration 대상 | `supabase/migrations/*_initial_schema.sql`로 변환 |

## 1. 설계 원칙

| 원칙 | 결정 |
| --- | --- |
| 인증 원본 | `auth.users`를 identity source로 사용 |
| 도메인 소유권 | 사용자 소유 row는 `user_id uuid references auth.users(id)` 사용 |
| 관리자 권한 | `profiles.role = 'admin'` |
| 파일 보안 | DB에는 bucket/object path를 저장하고 signed URL은 server API에서 발급 |
| 삭제 정책 | Soft Delete 후 30일 보관, 이후 purge |
| 결제 준비 | MVP에서는 credit schema만 준비하고 결제 연동은 제외 |
| Provider 독립성 | Provider version을 DB에 저장하고 job에서 참조 |

## 2. 확장 기능

필수 extension:

```sql
create extension if not exists "pgcrypto";
```

`pgcrypto`는 `gen_random_uuid()` 생성을 위해 사용한다.

## 3. Enum 타입

상태값 일관성을 위해 PostgreSQL enum을 사용한다.

```sql
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
```

## 4. Helper 함수

### 4.1 `set_updated_at()`

```sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
```

### 4.2 `handle_new_user()`

```sql
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
```

이 trigger는 `profiles` table 생성 후 추가한다.

```sql
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
```

### 4.3 `is_admin()`

이 함수는 `profiles` table 생성 후 추가한다.

```sql
create or replace function public.is_admin()
returns boolean
language sql
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
```

## 5. 테이블

### 5.1 `profiles`

```sql
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
```

Index:

```sql
create index profiles_role_idx on public.profiles(role);
create index profiles_email_idx on public.profiles(email);
```

### 5.2 `source_images`

```sql
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
```

Index:

```sql
create index source_images_user_created_idx on public.source_images(user_id, created_at desc);
create index source_images_user_role_idx on public.source_images(user_id, image_role);
create index source_images_status_idx on public.source_images(status);
create index source_images_purge_idx on public.source_images(purge_after) where purge_after is not null;
```

### 5.3 `human_meshes`

```sql
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
```

`generation_jobs` 생성 후 순환 참조를 추가한다.

```sql
alter table public.human_meshes
  add constraint human_meshes_latest_job_fk
  foreign key (latest_job_id)
  references public.generation_jobs(id);
```

Index:

```sql
create index human_meshes_user_created_idx on public.human_meshes(user_id, created_at desc);
create index human_meshes_user_status_idx on public.human_meshes(user_id, status);
create index human_meshes_source_idx on public.human_meshes(model_source, created_at desc);
create index human_meshes_featured_idx on public.human_meshes(is_featured, featured_at desc) where is_featured = true;
create index human_meshes_purge_idx on public.human_meshes(purge_after) where purge_after is not null;
```

### 5.4 `ai_provider_versions`

```sql
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
```

Index:

```sql
create index ai_provider_versions_active_idx
  on public.ai_provider_versions(is_active, priority);
```

### 5.5 `generation_jobs`

```sql
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
  updated_at timestamptz not null default now(),

  constraint generation_jobs_provider_prediction_unique unique (provider, provider_prediction_id)
);
```

Index:

```sql
create index generation_jobs_user_created_idx on public.generation_jobs(user_id, created_at desc);
create index generation_jobs_mesh_idx on public.generation_jobs(human_mesh_id, created_at desc);
create index generation_jobs_status_created_idx on public.generation_jobs(status, created_at);
create index generation_jobs_provider_created_idx on public.generation_jobs(provider, created_at desc);
create index generation_jobs_failover_idx on public.generation_jobs(failover_from_job_id) where failover_from_job_id is not null;
```

### 5.6 `admin_model_uploads`

```sql
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
```

Index:

```sql
create index admin_model_uploads_admin_created_idx on public.admin_model_uploads(admin_user_id, created_at desc);
create index admin_model_uploads_target_created_idx on public.admin_model_uploads(target_user_id, created_at desc);
create index admin_model_uploads_mesh_idx on public.admin_model_uploads(human_mesh_id);
```

### 5.7 `credit_ledger`

```sql
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
```

Index:

```sql
create index credit_ledger_user_created_idx on public.credit_ledger(user_id, created_at desc);
create index credit_ledger_job_idx on public.credit_ledger(generation_job_id);
```

### 5.8 `usage_events`

```sql
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);
```

Index:

```sql
create index usage_events_user_created_idx on public.usage_events(user_id, created_at desc);
create index usage_events_type_created_idx on public.usage_events(event_type, created_at desc);
```

## 6. Updated At 트리거

```sql
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
```

## 7. RLS 정책

RLS 활성화:

```sql
alter table public.profiles enable row level security;
alter table public.source_images enable row level security;
alter table public.human_meshes enable row level security;
alter table public.ai_provider_versions enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.admin_model_uploads enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.usage_events enable row level security;
```

### 7.1 `profiles`

```sql
create policy "users can read own profile"
on public.profiles for select
using (id = auth.uid() or public.is_admin());

create policy "admins can update profiles"
on public.profiles for update
using (public.is_admin())
with check (public.is_admin());
```

MVP에서는 일반 사용자가 `profiles`를 직접 update하지 않는다. 프로필 수정이 필요하면 server endpoint를 통해 처리한다. 이렇게 해야 client가 `role`, `remaining_credits`, quota field를 조작할 가능성을 줄일 수 있다.

### 7.2 `source_images`

```sql
create policy "users can read own source images"
on public.source_images for select
using (user_id = auth.uid() or public.is_admin());

create policy "source_images_admin_insert"
on public.source_images for insert
with check (public.is_admin());

create policy "source_images_admin_update"
on public.source_images for update
using (public.is_admin())
with check (public.is_admin());
```

일반 사용자 업로드는 Next.js 서버 API가 service role로 `source_images` row를 생성한다. 클라이언트가 직접 이미지 메타데이터를 조작하지 못하도록 insert/update는 관리자 또는 service role 경로로 제한한다.

### 7.3 `human_meshes`

```sql
create policy "users can read own meshes"
on public.human_meshes for select
using (user_id = auth.uid() or public.is_admin() or is_featured = true);

create policy "human_meshes_admin_insert"
on public.human_meshes for insert
with check (public.is_admin());

create policy "human_meshes_admin_update"
on public.human_meshes for update
using (public.is_admin())
with check (public.is_admin());
```

`human_meshes` 생성과 상태 변경은 일반 사용자 클라이언트가 직접 수행하지 않는다. 생성 요청, 완료 처리, soft delete는 서버 API 또는 background job의 service role로 처리한다.

### 7.4 `generation_jobs`

```sql
create policy "users can read own generation jobs"
on public.generation_jobs for select
using (user_id = auth.uid() or public.is_admin());

create policy "generation_jobs_admin_insert"
on public.generation_jobs for insert
with check (public.is_admin());

create policy "admins can update generation jobs"
on public.generation_jobs for update
using (public.is_admin())
with check (public.is_admin());
```

`generation_jobs` 생성과 상태 변경은 service role을 사용하는 신뢰 가능한 Route Handler 또는 worker에서 수행한다.

### 7.5 `ai_provider_versions`

```sql
create policy "admins can read provider versions"
on public.ai_provider_versions for select
using (public.is_admin());

create policy "admins can manage provider versions"
on public.ai_provider_versions for all
using (public.is_admin())
with check (public.is_admin());
```

일반 사용자 요청에서 provider 선택은 server-side service role로 처리한다.

### 7.6 `admin_model_uploads`

```sql
create policy "admins can read admin uploads"
on public.admin_model_uploads for select
using (public.is_admin());

create policy "admins can insert admin uploads"
on public.admin_model_uploads for insert
with check (public.is_admin());
```

### 7.7 `credit_ledger`

```sql
create policy "users can read own credit ledger"
on public.credit_ledger for select
using (user_id = auth.uid() or public.is_admin());

create policy "admins can insert credit ledger"
on public.credit_ledger for insert
with check (public.is_admin());
```

생성 작업에서 credit ledger를 추가할 때는 client 조작을 막기 위해 service role을 사용한다.

### 7.8 `usage_events`

```sql
create policy "users can read own usage events"
on public.usage_events for select
using (user_id = auth.uid() or public.is_admin());

create policy "users can insert own usage events"
on public.usage_events for insert
with check (user_id = auth.uid());
```

## 8. Storage 스키마

Bucket:

```sql
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;
```

Object path:

```text
images/{user_id}/{human_mesh_id}/front.{ext}
images/{user_id}/{human_mesh_id}/side.{ext}
images/{user_id}/{human_mesh_id}/angle45.{ext}
models/{user_id}/{human_mesh_id}/mesh.glb
models/{user_id}/{human_mesh_id}/admin_uploaded.{glb|gltf}
thumbnails/{user_id}/{human_mesh_id}/thumbnail.jpg
thumbnails/{user_id}/{human_mesh_id}/preview.jpg
admin/sample_models/{sample_id}/mesh.{glb|gltf}
admin/sample_models/{sample_id}/thumbnail.jpg
```

권장 Storage RLS policy:

```sql
create policy "users can read own avatar objects"
on storage.objects for select
using (
  bucket_id = 'avatars'
  and (
    (storage.foldername(name))[2] = auth.uid()::text
    or public.is_admin()
  )
);

create policy "users can upload own images"
on storage.objects for insert
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = 'images'
  and (storage.foldername(name))[2] = auth.uid()::text
);

create policy "admins can manage avatar objects"
on storage.objects for all
using (bucket_id = 'avatars' and public.is_admin())
with check (bucket_id = 'avatars' and public.is_admin());
```

구현 메모: 모델과 썸네일 쓰기는 직접 브라우저 업로드를 설계하지 않는 한 server-side service role로 처리한다.

## 9. 데이터 라이프사이클

Soft delete field:

| 테이블 | 필드 |
| --- | --- |
| `source_images` | `soft_deleted_at`, `purge_after`, `status = 'deleted'` |
| `human_meshes` | `soft_deleted_at`, `purge_after`, `status = 'deleted'` |

Purge job 동작:

1. `purge_after <= now()`인 row를 찾는다.
2. 관련 Storage object를 삭제한다.
3. job payload와 usage metadata에서 개인정보를 삭제 또는 익명화한다.
4. 필요한 경우 비개인 집계 데이터만 보관한다.

## 10. Migration 작성 순서

1. Extension
2. Enum
3. `set_updated_at()`, `handle_new_user()`
4. 순환 참조 없는 table
5. `is_admin()`
6. `human_meshes.latest_job_id` FK
7. Index
8. Trigger, `on_auth_user_created` 포함
9. Storage bucket
10. RLS policy

실제 SQL migration에서는 table을 다음 순서로 생성한다.

1. `profiles`
2. `source_images`
3. `human_meshes`
4. `ai_provider_versions`
5. `generation_jobs`
6. `human_meshes.latest_job_id` FK 추가
7. `admin_model_uploads`
8. `credit_ledger`
9. `usage_events`
