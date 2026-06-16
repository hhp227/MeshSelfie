# MeshSelfie 프로젝트 진행 상태

## 1. 현재 기준

| 항목 | 내용 |
| --- | --- |
| 작성일 | 2026-06-16 |
| 앱 프레임워크 | Next.js 16.2.9 App Router |
| React | 19.2.4 |
| TypeScript | 사용 |
| Supabase SDK | `@supabase/supabase-js` 2.108.2 |
| 현재 목표 | MVP 기본 흐름 구축 |

## 2. 제품 방향

MeshSelfie는 캐릭터형 아바타 생성 서비스가 아니다. 목표 결과물은 사용자의 얼굴 사진을 기반으로 한 Photorealistic Human Mesh GLB 모델이다.

입력 정책은 다음과 같다.

| 입력 | 필수 여부 | 방향값 |
| --- | --- | --- |
| `front` | 필수 | 없음 |
| `side` | 선택 | `left` 또는 `right` |
| `angle45` | 선택 | `left` 또는 `right` |

품질 등급은 입력 사진 수를 기준으로 MVP에서 우선 계산한다.

| 입력 수 | 등급 |
| --- | --- |
| 1장 | `B` |
| 2장 | `A` |
| 3장 | `A+` |

## 3. 완료된 문서

| 파일 | 설명 |
| --- | --- |
| `docs/meshselfie-prd.md` | PRD v1.1 |
| `docs/technical-design.md` | 기술 설계 |
| `docs/supabase-schema.md` | DB 설계 |
| `docs/rls-policy-review.md` | RLS 검토 |
| `docs/storage-structure.md` | Storage 구조 |
| `docs/openapi.yaml` | OpenAPI 명세 |
| `docs/nextjs-project-structure.md` | Next.js 구조 설계 |

## 4. 완료된 DB 작업

`supabase/migrations/001_initial_schema.sql` 작성 완료.

포함 내용:

- enum 정의
- `profiles`
- `source_images`
- `human_meshes`
- `ai_provider_versions`
- `generation_jobs`
- `admin_model_uploads`
- `credit_ledger`
- `usage_events`
- trigger/function
- index
- RLS policy
- Supabase Storage `avatars` bucket 및 storage policy

사용자는 Supabase SQL Editor에서 migration을 실행했고 테이블 생성까지 확인했다.

## 5. 완료된 앱 작업

### 화면

- `/`
- `/login`
- `/signup`
- `/dashboard`
- `/upload`
- `/result/[id]`
- `/profile`
- `/admin`

### API

- `GET /api/profile`
- `GET /api/avatars`
- `POST /api/uploads/images`
- `POST /api/generate`
- `GET /api/generation-jobs/[jobId]`
- `GET /api/meshes/[meshId]`
- `GET /api/meshes/[meshId]/download`

### 공통 라이브러리

- `lib/env.ts`
- `lib/api.ts`
- `lib/auth.ts`
- `lib/uploads.ts`
- `lib/supabase/browser.ts`
- `lib/supabase/admin.ts`
- `lib/ai/interface.ts`
- `lib/ai/registry.ts`
- `lib/ai/providers/stub.ts`

## 6. 현재 동작 방식

1. 사용자가 로그인한다.
2. `/upload`에서 `front` 필수, `side`, `angle45` 선택 이미지를 업로드한다.
3. `POST /api/uploads/images`가 Storage `avatars` bucket에 원본 이미지를 저장하고 `source_images` row를 생성한다.
4. `POST /api/generate`가 `human_meshes`, `generation_jobs` row를 생성한다.
5. 현재 AI Provider는 개발용 stub이므로 실제 GLB 파일은 생성하지 않는다.
6. `/result/[id]`는 모델과 job 상태를 polling한다.
7. 모델이 `completed`이고 `model_object_path`가 있으면 다운로드 signed URL을 발급한다.

## 7. 현재 주의사항

### Supabase Auth

Supabase에서 Email Confirm이 켜져 있으면 회원가입 후 바로 로그인되지 않는다. 이 경우 로그인 시 `Email not confirmed`가 발생한다.

개발 중에는 아래 설정을 권장한다.

```text
Authentication > Providers > Email > Confirm email 비활성화
```

이미 생성된 미인증 사용자는 삭제 후 다시 가입하거나 Dashboard에서 confirm 처리해야 한다.

### 환경 변수

`.env.local`은 Git에 포함하지 않는다.

필수 변수:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
REPLICATE_API_TOKEN=
```

## 8. 검증 상태

마지막 확인:

```bash
npm run build
```

결과: 성공.

## 9. 다음 작업 추천 순서

### 1. 인증 흐름 안정화

- Supabase Email Confirm 설정 확정
- 로그인 후 profile row 자동 생성 여부 확인
- `/dashboard`에서 세션 누락 문제 재검증
- 필요하면 `@supabase/ssr` 기반 cookie session 구조로 전환

### 2. 업로드 E2E 검증

- 실제 이미지 업로드
- `source_images` row 생성 확인
- Storage path 확인
- 파일 크기/MIME validation 확인

### 3. Replicate Provider 실제 연동

- `lib/ai/providers/replicate.ts` 추가
- 모델 버전/입력 파라미터 확정
- Provider create job 호출
- webhook 또는 polling 설계

### 4. Generation 완료 처리

- Provider output URL 수신
- GLB 다운로드
- `models/{user_id}/{human_mesh_id}/mesh.glb` 저장
- `human_meshes.status = completed`
- `generation_jobs.status = completed`

### 5. 3D Viewer 구현

- GLB 렌더링 라이브러리 선택
- 회전, 확대, 축소 지원
- loading/error state 구현

### 6. 이미지 품질 검증

- 얼굴 존재 여부
- 얼굴 크기
- 다중 인물 여부
- 흐림/가림/선글라스/마스크 감지

### 7. 관리자 기능

- 관리자 role 확인 middleware/helper
- 관리자 모델 업로드 API
- 모델 교체/삭제
- Featured Gallery 지정

## 10. 커밋 전 확인

스테이징 전후에 아래를 확인한다.

```bash
git status --short
npm run build
```

`.env.local`은 반드시 unstaged/ignored 상태여야 한다.
