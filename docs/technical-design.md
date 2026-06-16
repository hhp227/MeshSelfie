# MeshSelfie 기술 설계서

| 항목 | 내용 |
| --- | --- |
| 버전 | 0.1 |
| 기준 PRD | `docs/meshselfie-prd.md` v1.1 |
| 범위 | MVP 구현 설계와 Supabase 데이터베이스 스키마 설계까지 |
| 현재 스택 기준 | 현재 저장소는 Next.js `16.2.9`, React `19.2.4`, TypeScript, TailwindCSS, `@supabase/supabase-js` v2를 사용한다. |

## 1. 아키텍처 개요

MeshSelfie는 사용자의 얼굴 사진을 기반으로 Photorealistic Human Mesh GLB 파일을 생성하는 웹 애플리케이션이다. MVP는 Supabase Auth, PostgreSQL, Private Storage를 사용하고, 백엔드는 Next.js App Router Route Handler로 구성한다. AI 생성은 특정 서비스에 직접 결합하지 않고 AI Provider 추상화 계층을 통해 호출한다.

```text
Browser
  |
  | Supabase Auth session
  v
Next.js App Router
  |-- 보호 페이지용 Server Component
  |-- 업로드, 폴링, 3D 뷰어용 Client Component
  |-- app/api/** Route Handler
  |
  | service role은 서버에서만 사용
  v
Supabase
  |-- Auth
  |-- PostgreSQL + RLS
  |-- Private Storage bucket: avatars
  |
  v
AI Provider Layer
  |-- Provider Registry
  |-- Provider Adapter, MVP 초기 구현은 Replicate 호환 adapter
  |-- Generation Pipeline
```

## 2. MVP 범위

### 포함

| 영역 | MVP 결정 |
| --- | --- |
| 인증 | Supabase 이메일/비밀번호 인증 |
| 업로드 입력 | `front` 필수, `side` 선택, `angle45` 선택 |
| 방향 메타데이터 | `side_direction`, `angle45_direction`에 `left` 또는 `right` 저장 |
| 생성 | pipeline 상태를 가진 비동기 job |
| AI 추상화 | interface와 registry를 먼저 설계하고, 실제 provider는 하나부터 구현 가능 |
| Storage | `avatars` 단일 private Supabase bucket |
| 3D 뷰어 | GLB 회전, 확대/축소, 다운로드 |
| 관리자 | role 기반 모델 업로드, 교체, 삭제, Featured Mesh 지정 |
| 크레딧 | 스키마와 ledger만 설계, 실제 결제 연동은 제외 |
| 삭제 | Soft Delete 후 30일 보관, 이후 purge |

### 제외 또는 후순위

| 영역 | 결정 |
| --- | --- |
| 결제 | Stripe 등 결제 provider 연동은 후순위 |
| 좌/우 45도 별도 슬롯 | 품질 개선 단계에서 확장, MVP에서는 `angle45` 1장 |
| 좌/우 측면 별도 슬롯 | 품질 개선 단계에서 확장, MVP에서는 `side` 1장 |
| 전용 background worker | 초기에는 Route Handler/webhook 기반으로 시작하고 필요 시 queue/worker로 분리 |
| 완전 자동 썸네일 렌더링 인프라 | 스키마와 API 계약을 먼저 만들고, 구현은 server-side render job 또는 provider thumbnail로 시작 가능 |

## 3. 도메인 모델

### 핵심 엔티티

| 엔티티 | 목적 |
| --- | --- |
| `profiles` | 앱 사용자 프로필, role, quota, credit |
| `source_images` | 업로드 원본 이미지 메타데이터와 품질 검증 결과 |
| `human_meshes` | 사용자가 보는 AI 생성 또는 관리자 업로드 Human Mesh 모델 |
| `generation_jobs` | AI 생성 pipeline 실행 기록 |
| `ai_provider_versions` | Provider registry와 모델 버전 설정 |
| `admin_model_uploads` | 관리자 업로드/교체/삭제 감사 기록 |
| `credit_ledger` | 향후 결제를 위한 credit 증감 이력 |
| `usage_events` | 제품/운영 이벤트 기록 |

### 입력 모델

| 슬롯 | 필수 | 방향 | 최대 개수 | Storage object |
| --- | --- | --- | --- | --- |
| `front` | 예 | 없음 | 1 | `images/{user_id}/uploads/{upload_group_id}/front.{ext}` |
| `side` | 아니오 | `left` 또는 `right` | 1 | `images/{user_id}/uploads/{upload_group_id}/side.{ext}` |
| `angle45` | 아니오 | `left` 또는 `right` | 1 | `images/{user_id}/uploads/{upload_group_id}/angle45.{ext}` |

품질 등급은 입력 정보량 기준 예상 등급이다.

| 입력 조합 | 등급 |
| --- | --- |
| `front` | `B` |
| `front + side` | `A` |
| `front + angle45` | `A` |
| `front + side + angle45` | `A+` |

## 4. 애플리케이션 플로우

### 4.1 회원가입/로그인

1. 사용자가 Supabase Auth로 가입한다.
2. 가입된 `auth.users`에 대응하는 `profiles` row를 생성한다.
3. 기본 role은 `user`다.
4. 기본 credit과 일일 quota를 부여한다.

### 4.2 업로드

1. 사용자가 `/upload`에 접근한다.
2. 사용자는 `front`를 필수로 업로드하고, 필요하면 `side`, `angle45`를 추가한다.
3. API는 파일 크기, MIME type, image role, direction metadata, 소유권을 검증한다.
4. 업로드 직후 이미지 품질 검증을 실행한다.
5. 이미지는 private `avatars` bucket에 저장한다.
6. `source_images` row를 생성한다.

### 4.3 생성 요청

1. 사용자가 source image ID로 `POST /api/generate`를 호출한다.
2. API는 이미지 소유권과 role을 검증한다.
3. API는 `input_image_count`와 `quality_grade`를 계산한다.
4. API는 일일 quota와 남은 credit을 확인한다.
5. API는 `human_meshes`와 `generation_jobs` row를 생성한다.
6. Provider Registry가 활성 provider version을 선택한다.
7. Pipeline은 `queued`, `validating`, `preprocessing`, `generating` 순서로 진행된다.

### 4.4 생성 완료

1. AI Provider webhook 또는 polling이 job 상태를 갱신한다.
2. 모델 output을 다운로드해 `models/{user_id}/{human_mesh_id}/mesh.glb`에 저장한다.
3. postprocessing 단계에서 모델 메타데이터와 GLB 정합성을 검증한다.
4. Preview render와 thumbnail을 생성해 `thumbnails/`에 저장한다.
5. `human_meshes.status`를 `completed`로 변경한다.
6. 사용자는 signed URL로 모델을 보고 다운로드한다.

## 5. Pipeline 상태

| 상태 | 담당 | 의미 |
| --- | --- | --- |
| `queued` | API | job은 생성됐지만 아직 처리 중은 아님 |
| `validating` | Pipeline | 이미지 품질과 입력 검증 |
| `preprocessing` | Pipeline | resize, crop, orientation 정리, provider 입력 URL 준비 |
| `generating` | AI Provider | Provider job 실행 중 |
| `postprocessing` | Pipeline | GLB 검증, 메타데이터 저장, 선택적 압축 |
| `thumbnailing` | Pipeline | Preview render와 thumbnail 생성 |
| `completed` | Pipeline | 사용자에게 노출 가능한 모델 준비 완료 |
| `failed` | Pipeline/provider | 실패 사유가 기록된 실패 상태 |
| `canceled` | 사용자/관리자/시스템 | 작업 취소 |

## 6. AI Provider 설계

### 인터페이스

```ts
export type ProviderKey =
  | 'replicate'
  | 'trellis'
  | 'hunyuan3d'
  | 'triposr'
  | 'self_hosted'

export interface GenerationInput {
  jobId: string
  userId: string
  frontImageUrl: string
  sideImageUrl?: string
  sideDirection?: 'left' | 'right'
  angle45ImageUrl?: string
  angle45Direction?: 'left' | 'right'
  qualityGrade: 'B' | 'A' | 'A+'
  outputFormat: 'glb'
}

export interface AIProvider {
  key: ProviderKey
  supports(input: GenerationInput): Promise<boolean>
  estimate(input: GenerationInput): Promise<{
    estimatedCost: number | null
    estimatedSeconds: number | null
  }>
  createJob(input: GenerationInput): Promise<{
    providerJobId: string
    raw: unknown
  }>
  getJob(providerJobId: string): Promise<{
    status: 'queued' | 'generating' | 'completed' | 'failed' | 'canceled'
    outputUrl?: string
    errorCode?: string
    errorMessage?: string
    raw: unknown
  }>
  cancelJob(providerJobId: string): Promise<void>
}
```

### Registry 규칙

| 규칙 | 구현 |
| --- | --- |
| 활성 Provider만 사용 | `ai_provider_versions where is_active = true`에서 선택 |
| 다각도 입력 지원 | `max_input_images >= input_image_count` 조건을 만족해야 함 |
| 우선순위 | `priority`가 낮은 Provider를 우선 선택 |
| 비용 | 예상 credit 비용이 사용자 잔액보다 크면 거절 |
| Failover | output 생성 전 provider 실패 시 `failover_from_job_id`를 가진 새 `generation_jobs` row 생성 |

## 7. API 설계

### 사용자 API

| 메서드 | 경로 | 목적 |
| --- | --- | --- |
| `GET` | `/api/profile` | 현재 사용자 profile과 사용량 조회 |
| `POST` | `/api/uploads/images` | front/side/angle45 업로드와 검증 |
| `POST` | `/api/generate` | Human Mesh 생성 job 생성 |
| `GET` | `/api/generation-jobs/[jobId]` | 생성 상태 polling |
| `GET` | `/api/meshes` | 현재 사용자 mesh 목록 |
| `GET` | `/api/meshes/[meshId]` | mesh 상세와 signed URL |
| `GET` | `/api/meshes/[meshId]/download` | 다운로드 signed URL |
| `GET` | `/api/gallery` | Featured mesh gallery |

### Webhook API

| 메서드 | 경로 | 목적 |
| --- | --- | --- |
| `POST` | `/api/webhooks/ai-provider` | Provider 공통 webhook |
| `POST` | `/api/webhooks/replicate` | 선택적 provider 전용 adapter endpoint |

### 관리자 API

| 메서드 | 경로 | 목적 |
| --- | --- | --- |
| `GET` | `/api/admin/models` | 모델과 실패 job 검색 |
| `POST` | `/api/admin/models/upload` | 관리자 GLB/GLTF 업로드 |
| `PATCH` | `/api/admin/models/[meshId]` | 모델 교체 또는 메타데이터 수정 |
| `DELETE` | `/api/admin/models/[meshId]` | 모델 soft delete |
| `GET` | `/api/admin/metrics` | 사용자 수, job 수, 실패율, provider 지표 |

## 8. Storage 설계

단일 private Supabase Storage bucket을 사용한다.

```text
avatars/
├── images/{user_id}/{human_mesh_id}/front.{ext}
├── images/{user_id}/{human_mesh_id}/side.{ext}
├── images/{user_id}/{human_mesh_id}/angle45.{ext}
├── models/{user_id}/{human_mesh_id}/mesh.glb
├── models/{user_id}/{human_mesh_id}/admin_uploaded.{glb|gltf}
├── thumbnails/{user_id}/{human_mesh_id}/thumbnail.jpg
├── thumbnails/{user_id}/{human_mesh_id}/preview.jpg
├── admin/sample_models/{sample_id}/mesh.{glb|gltf}
└── admin/sample_models/{sample_id}/thumbnail.jpg
```

사용자-facing 파일 접근은 signed URL로만 처리한다. DB에는 영구 public URL이 아니라 bucket과 object path를 저장한다.

## 9. 보안 모델

| 계층 | 규칙 |
| --- | --- |
| 인증 | public 조회를 제외한 모든 사용자 액션에는 Supabase Auth 필요 |
| 사용자 데이터 | RLS로 `auth.uid() = user_id` 강제 |
| 관리자 | 서버에서 `profiles.role = 'admin'` 확인 |
| Storage | private bucket만 사용하고 DB 소유권 확인 후 signed URL 발급 |
| Service role | 서버 Route Handler 또는 신뢰 가능한 background job에서만 사용 |
| Webhook | Provider signature 또는 shared secret 검증 후 상태 변경 |

## 10. Supabase 스키마

데이터베이스 스키마는 [supabase-schema.md](./supabase-schema.md)에 정의한다. 해당 문서는 SQL migration으로 옮기기 쉽도록 enum, column, foreign key, index, RLS policy, storage path, trigger 요구사항을 포함한다.

## 11. 구현 순서

| 순서 | 작업 |
| --- | --- |
| 1 | Supabase schema, RLS, trigger, storage bucket SQL migration 작성 |
| 2 | Supabase server/browser/admin client 추가 |
| 3 | 인증 페이지와 보호 route utility 구현 |
| 4 | 이미지 업로드 API와 validation schema 구현 |
| 5 | AI Provider interface와 초기 provider adapter 구현 |
| 6 | generate/status API 구현 |
| 7 | dashboard/result page와 GLB viewer 구현 |
| 8 | 관리자 업로드/교체/삭제 구현 |
| 9 | gallery와 thumbnail generation 구현 |
