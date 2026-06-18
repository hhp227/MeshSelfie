# MeshSelfie 프로젝트 진행 상태

## 1. 현재 기준

| 항목 | 내용 |
| --- | --- |
| 작성일 | 2026-06-18 |
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
- `lib/profiles.ts`
- `lib/uploads.ts`
- `lib/supabase/browser.ts`
- `lib/supabase/session.ts`
- `lib/supabase/admin.ts`
- `lib/ai/interface.ts`
- `lib/ai/registry.ts`
- `lib/ai/providers/stub.ts`

## 6. 현재 동작 방식

1. 사용자가 로그인한다.
   - 보호 페이지는 클라이언트 세션을 확인하고 세션이 없으면 `/login?next=...`로 이동한다.
   - 로그인 성공 시 `next` 경로가 있으면 원래 페이지로 복귀한다.
   - `GET /api/profile`과 생성 API는 `profiles` row가 누락된 경우 서버에서 자동 생성한다.
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

개발 서버:

```bash
npm run dev
```

업로드 E2E 검증 시에는 stale `.next/dev/lock` 제거 후 권한 상승 실행으로 `http://127.0.0.1:3002`에 Next dev server를 띄웠다. 이후 화면 확인을 위해 `npm run dev`를 다시 실행했을 때 3000 포트가 사용 중으로 감지되어 Next가 `http://localhost:3001`을 사용했다. 새 터미널/새 세션에서는 다시 실행해야 하며, 실행 로그의 `Local:` URL을 기준으로 접속한다. `npm run build`는 서버 실행 명령이 아니라 빌드 검증 명령이다.

라우트 기준:

- `/`는 랜딩 페이지다.
- 로그인 화면은 `/login`이다.
- dev server가 3001로 뜬 경우 로그인 URL은 `http://localhost:3001/login`이다.

## 9. 다음에 이어서 할 작업

다음 작업은 **Replicate Provider 실제 연동**이다. 인증 흐름 안정화와 업로드 E2E 검증은 완료했으므로, stub provider를 실제 provider adapter로 확장한다.

### 목표

`lib/ai/providers/replicate.ts`를 추가하고 실제 Replicate prediction 생성/상태 조회 계약을 구현한다.

- `REPLICATE_API_TOKEN` 서버 환경 변수 사용
- 모델명/버전과 입력 파라미터 확정
- front/side/angle45 Storage object를 provider가 접근 가능한 signed URL로 변환
- `createJob`에서 Replicate prediction 생성
- `getJob`에서 provider status를 내부 job status로 normalize
- webhook 또는 polling 방식 중 MVP 처리 방식 확정

### 체크리스트

1. `docs/technical-design.md`의 AI Provider interface와 현재 `lib/ai/interface.ts` 차이를 확인한다.
2. Replicate 모델 후보와 입력 스키마를 확정한다.
3. `lib/ai/providers/replicate.ts`를 추가한다.
4. `lib/ai/registry.ts`에서 환경 변수 기준으로 stub/replicate 선택을 분리한다.
5. `POST /api/generate`가 signed URL 기반 provider input을 전달하도록 조정한다.
6. provider output URL 저장과 완료 처리 설계를 `Generation 완료 처리` 작업으로 넘길 경계를 정한다.
7. `npm run build`를 통과시킨다.

### 완료 기준

- Replicate adapter가 실제 prediction 생성 요청을 수행한다.
- provider status 조회 함수가 내부 상태로 normalize된다.
- token 미설정 시 stub 또는 명확한 서버 오류로 처리된다.
- 다음 단계인 GLB 다운로드/Storage 저장 작업 범위가 명확해진다.

## 10. 다음 작업 추천 순서

### 1. 인증 흐름 안정화

완료:

- 보호 페이지 `/dashboard`, `/upload`, `/profile`, `/admin`에 세션 가드 적용
- 로그인 후 `next` 경로 복귀 처리
- `profiles` row 누락 시 서버 API에서 자동 생성
- 클라이언트 access token retry 로직 공통화

남은 확인:

- Supabase Email Confirm 설정 확정
- 실제 브라우저에서 `/dashboard` 세션 유지 재검증
- 필요하면 이후 `@supabase/ssr` 기반 cookie session 구조로 전환

### 2. 업로드 E2E 검증

완료:

- 테스트 계정: `meshselfie-e2e-1781773909068@example.com`
- 실행 URL: `http://127.0.0.1:3002`
- 인증: Supabase Admin API로 email confirmed 테스트 사용자 생성 후 anon client로 로그인 성공
- `GET /api/profile`: 200, role=`user`, 초기 `remainingCredits=3`
- validation 실패 케이스:
  - 정면 사진 누락: 400 `FRONT_IMAGE_REQUIRED`
  - `text/plain` 파일: 400 `IMAGE_VALIDATION_FAILED`
  - 10MB 초과 PNG: 400 `IMAGE_VALIDATION_FAILED`
- 업로드/생성 성공 케이스:
  - front 1장: `input_image_count=1`, `quality_grade=B`, `status=generating`
  - front+side 2장: `input_image_count=2`, `quality_grade=A`, `status=generating`
  - front+side+angle45 3장: `input_image_count=3`, `quality_grade=A+`, `status=generating`
- Storage 확인:
  - 모든 업로드 object가 `avatars/images/{user_id}/uploads/{upload_group_id}/...` 경로에 존재함
- `generation_jobs` 확인:
  - provider=`replicate`
  - model_name=`stub-photorealistic-human-mesh`
  - provider_prediction_id=`stub_{jobId}`
  - status=`generating`
- 결과 상세/polling 확인:
  - 대표 mesh `10651b68-640c-4c91-9924-8fa5ed11ea43`
  - 대표 job `b9465076-721b-48a5-aa3b-4f173fad5bf4`
  - `GET /api/meshes/[meshId]`: 200, latest job status=`generating`
  - `GET /api/generation-jobs/[jobId]`: 200, progress=`5`
- credit 차감 확인:
  - 3회 생성 후 `remainingCredits=0`, `usedCredits=3`, `meshCount=3`

주의:

- E2E 테스트 데이터는 원격 Supabase 프로젝트에 남아 있다.
- 테스트 이미지는 1x1 PNG이므로 실제 얼굴 품질 검증을 대체하지 않는다. Vision 기반 이미지 품질 검증은 별도 작업이다.

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

## 11. 커밋 전 확인

스테이징 전후에 아래를 확인한다.

```bash
git status --short
npm run build
```

`.env.local`은 반드시 unstaged/ignored 상태여야 한다.
