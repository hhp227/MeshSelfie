-- PRD v2.0 (Photogrammetry Hybrid): 스캔 입력 세션
-- Supabase SQL Editor에서 이 파일 전체를 실행한다.

-- 1) 품질 등급에 스캔용 상위 등급 추가 (append-only, 기존 값 영향 없음)
alter type public.quality_grade add value if not exists 'S';
alter type public.quality_grade add value if not exists 'S+';

-- 2) 스캔 기반 mesh/job은 source_images를 참조하지 않는다
alter table public.human_meshes alter column front_source_image_id drop not null;
alter table public.human_meshes alter column front_image_url drop not null;
alter table public.generation_jobs alter column front_source_image_id drop not null;

-- 스캔은 입력 프레임이 최대 80장이다 (기존 1~3 제한 완화)
alter table public.human_meshes
  drop constraint if exists human_meshes_input_image_count_check;
alter table public.human_meshes
  add constraint human_meshes_input_image_count_check
  check (input_image_count between 1 and 200);

-- 3) 스캔 세션: 동영상 또는 다중 사진 업로드 단위
create table public.scan_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null default 'avatars',
  input_kind text not null check (input_kind in ('video', 'photos')),
  video_object_path text,
  frame_object_paths jsonb,
  frame_count integer check (frame_count is null or frame_count > 0),
  quality_grade public.quality_grade,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'completed', 'failed', 'deleted')),
  human_mesh_id uuid references public.human_meshes(id) on delete set null,
  soft_deleted_at timestamptz,
  purge_after timestamptz,
  created_at timestamptz not null default now(),

  constraint scan_sessions_input_chk check (
    (input_kind = 'video' and video_object_path is not null)
    or (input_kind = 'photos' and frame_object_paths is not null)
  )
);

create index scan_sessions_user_created_idx
  on public.scan_sessions(user_id, created_at desc);
create index scan_sessions_purge_idx
  on public.scan_sessions(purge_after) where purge_after is not null;

alter table public.scan_sessions enable row level security;

create policy "users can read own scan sessions"
on public.scan_sessions for select
using (user_id = auth.uid() or public.is_admin());

-- 쓰기는 service role(Route Handler)만 수행한다 (source_images와 동일 원칙)
create policy "scan_sessions_admin_insert"
on public.scan_sessions for insert
with check (public.is_admin());

create policy "scan_sessions_admin_update"
on public.scan_sessions for update
using (public.is_admin())
with check (public.is_admin());
