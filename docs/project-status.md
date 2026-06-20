# MeshSelfie 프로젝트 진행 상태

## 1. 현재 기준

| 항목 | 내용 |
| --- | --- |
| 작성일 | 2026-06-20 |
| 앱 프레임워크 | Next.js 16.2.9 App Router |
| React | 19.2.4 |
| TypeScript | 사용 |
| Supabase SDK | `@supabase/supabase-js` 2.108.2 |
| 현재 목표 | Replicate 결제 설정 후 실제 이미지→GLB E2E 검증 |

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
- `DELETE /api/meshes/[meshId]`
- `GET /api/meshes/[meshId]/download`
- `POST /api/admin/models/upload`

### 공통 라이브러리

- `lib/env.ts`
- `lib/api.ts`
- `lib/auth.ts`
- `lib/admin.ts`
- `lib/admin-models.ts`
- `lib/profiles.ts`
- `lib/uploads.ts`
- `lib/supabase/browser.ts`
- `lib/supabase/session.ts`
- `lib/supabase/admin.ts`
- `lib/ai/interface.ts`
- `lib/ai/registry.ts`
- `lib/ai/providers/replicate.ts`
- `lib/ai/providers/stub.ts`
- `components/viewer/glb-viewer.tsx`

## 6. 현재 동작 방식

1. 사용자가 로그인한다.
   - 보호 페이지는 클라이언트 세션을 확인하고 세션이 없으면 `/login?next=...`로 이동한다.
   - 로그인 성공 시 `next` 경로가 있으면 원래 페이지로 복귀한다.
   - `GET /api/profile`과 생성 API는 `profiles` row가 누락된 경우 서버에서 자동 생성한다.
2. `/upload`에서 `front` 필수, `side`, `angle45` 선택 이미지를 업로드한다.
3. `POST /api/uploads/images`가 Storage `avatars` bucket에 원본 이미지를 저장하고 `source_images` row를 생성한다.
4. `POST /api/generate`가 `human_meshes`, `generation_jobs` row를 생성한다.
5. `REPLICATE_API_TOKEN`이 있으면 Replicate TRELLIS prediction을 생성하고, 없으면 개발용 stub을 사용한다.
6. `/result/[id]`는 모델과 job 상태를 polling하며 Replicate 상태도 함께 동기화한다.
7. Replicate가 성공하면 GLB를 검증해 private Storage에 저장하고 모델 상태를 `completed`로 전환한다.
8. 모델이 `completed`이고 `model_object_path`가 있으면 조회·다운로드 signed URL을 발급한다.
9. 관리자는 `/admin`에서 기존 사용자 mesh를 GLB/GLTF로 교체하거나 독립 샘플 모델을 등록한다.
10. 완료된 모델은 결과 페이지의 Three.js Viewer에서 회전, 확대, 축소해 확인한다.
11. 대시보드에서 생성 중, 실패, 완료를 포함한 모든 모델을 삭제할 수 있다. 삭제 모델은 즉시 목록에서 숨기고 30일 후 purge 대상으로 기록한다.

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

Supabase 필수 변수와 Replicate 실제 연동 변수:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
REPLICATE_API_TOKEN=
# 선택. 미설정 시 adapter 기본 고정 버전을 사용한다.
REPLICATE_MODEL_VERSION=
```

`REPLICATE_API_TOKEN`이 비어 있으면 로컬 개발용 stub provider로 동작한다.

### Replicate 3D 생성 차단 원인

2026-06-20에 Replicate API와 Supabase의 최근 `generation_jobs`를 확인했다.

- 최근 실제 생성 요청 2건은 prediction 생성 전에 Replicate HTTP `402 Payment Required`로 실패했다.
- 두 작업 모두 `provider_prediction_id`가 없으며 Replicate 계정의 prediction 목록도 비어 있었다.
- 현재 adapter의 고정 버전은 Replicate의 최신 `firtoz/trellis` 버전과 일치한다.
- `images`, `generate_model`, `output.model_file` 입출력 계약도 현재 모델 스키마와 일치한다.
- 따라서 현재 차단 원인은 코드나 이미지 업로드가 아니라 Replicate 계정의 크레딧 또는 결제 설정이다.

해결 순서:

1. `REPLICATE_API_TOKEN`을 발급한 동일 Replicate 계정에서 Billing 결제 수단 또는 크레딧을 설정한다.
2. 서버를 재시작한 뒤 실제 얼굴 정면 이미지로 새 생성 요청을 실행한다.
3. Supabase `generation_jobs.provider_prediction_id` 생성과 Replicate prediction 상태를 확인한다.
4. 완료 후 `models/{user_id}/{human_mesh_id}/mesh.glb` 저장과 결과 Viewer 렌더링을 확인한다.

Provider가 `402`, 인증 실패, rate limit을 반환하면 이제 생성 API와 결과 화면에 각각 조치 가능한 오류 코드와 메시지를 저장·표시한다. Provider 작업 생성 전 실패하므로 앱 크레딧은 차감되지 않는다.

## 8. 검증 상태

마지막 확인:

```bash
npx eslint app/api/generate/route.ts components/result/result-client.tsx components/viewer/glb-viewer.tsx
npm run build
```

결과: 성공. 샌드박스 내부 빌드는 Turbopack의 포트 바인딩 제한으로 실패했으며 동일 빌드를 제한 밖에서 실행해 성공했다.

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

다음 작업은 **Replicate 결제 설정 후 실제 생성 E2E 검증**이다. 코드의 생성 계약과 Viewer 구현은 완료됐지만 현재 Replicate 계정이 HTTP 402를 반환해 실제 GLB가 없는 상태다.

### 현재 Replicate 연동 상태

- 모델: `firtoz/trellis`
- 기본 고정 버전: `e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c`
- 입력: `front`, `side`, `angle45` signed URL을 순서대로 `images` 배열에 전달
- 출력 옵션: `generate_model=true`, GLB 생성
- provider 선택: `REPLICATE_API_TOKEN`이 있으면 Replicate, 없으면 개발용 stub
- 상태 처리: `GET /api/generation-jobs/[jobId]` polling 시 Replicate 상태 조회
- 완료 처리: output URL 확인 후 GLB 검증, Storage 저장, DB 완료 전환

### 완료된 Viewer

- Three.js `GLTFLoader`로 private signed URL의 GLB 로드
- `OrbitControls`로 마우스·터치 회전과 확대/축소 지원
- 모델 bounding box 기반 카메라 자동 맞춤과 기본 조명 설정
- loading/error 상태와 signed URL 재발급 재시도 제공
- unmount 시 geometry, material, texture, renderer, WebGL context 해제
- 다운로드 대체 액션 유지

### 다음 완료 기준

- Replicate Billing 설정 후 prediction ID가 생성된다.
- 실제 얼굴 이미지로 생성된 GLB가 Supabase Storage에 저장된다.
- 데스크톱과 모바일 브라우저에서 실제 결과 GLB의 회전·확대·축소를 확인한다.

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

완료:

- `lib/ai/providers/replicate.ts` 추가
- `firtoz/trellis` 모델과 버전 고정, 환경 변수 override 지원
- private Storage 이미지를 10분 signed URL로 변환
- 1~3장 입력을 Replicate `images` 배열로 전달
- prediction 생성, 조회, 취소 계약 구현
- Replicate 상태를 내부 상태로 normalize
- 기존 클라이언트 흐름에 맞춰 polling 방식 채택
- output GLB URL 수신 시 `postprocessing` 전환
- `REPLICATE_API_TOKEN` 미설정 시 stub fallback 유지
- `npm run build` 성공

### 4. Generation 완료 처리

완료:

- Result Page polling에서 generation status API 호출
- Replicate output URL을 `postprocessing` 상태에 보존해 중단 후 재시도 가능
- Replicate delivery HTTPS URL allowlist 적용
- GLB 50MB 제한과 GLB v2 magic/version/length 검증
- `models/{user_id}/{human_mesh_id}/mesh.glb` 고정 경로에 멱등 저장
- `human_meshes` model metadata와 `completed_at` 저장
- `generation_jobs`, `human_meshes`를 `completed`로 전환
- 완료 usage event 기록
- 다운로드/검증/Storage/DB 실패 코드를 구분해 저장

### 5. 3D Viewer 구현

완료:

- Three.js와 타입 패키지 추가
- GLB 로드와 bounding box 기반 카메라 framing
- 회전, 확대, 축소 지원
- loading/error state와 signed URL 재발급
- WebGL 및 GLB 리소스 정리
- 프로덕션 빌드와 변경 파일 lint 성공

남은 확인:

- Replicate 결제 설정 후 실제 생성 GLB 브라우저 E2E
- 모바일 실제 기기 조작 확인

### 5.1 사용자 모델 삭제

완료:

- 대시보드의 모든 모델 행에 삭제 액션 추가
- 사용자 확인 후 `DELETE /api/meshes/{meshId}` 호출
- 소유권 검증과 중복 삭제 방지
- `status=deleted`, `soft_deleted_at`, `purge_after=30일 후` 기록
- 삭제된 Featured 상태 해제
- 진행 중인 generation job을 `canceled`로 전환
- Replicate prediction이 있으면 Provider 취소 요청
- Provider 취소 실패와 모델 soft delete를 분리해 사용자 삭제는 유지
- generation 완료 처리와 삭제가 경합해도 삭제 모델이 다시 완료 상태가 되지 않도록 guard 추가
- 삭제 후 대시보드 목록과 모델 수 즉시 갱신

남은 작업:

- 30일이 지난 모델의 Storage object와 DB row를 영구 삭제하는 purge job
- 휴지통/복원 기능이 필요할 경우 별도 API와 UI 추가

### 6. 이미지 품질 검증

- 얼굴 존재 여부
- 얼굴 크기
- 다중 인물 여부
- 흐림/가림/선글라스/마스크 감지

### 7. 관리자 기능

완료:

- 서버 API 관리자 role 검사
- 관리자 GLB/GLTF 파일 검증과 private Storage 업로드
- 기존 사용자 Human Mesh 관리자 모델 교체
- 독립 샘플 모델 Storage 등록
- `admin_model_uploads` 감사 로그와 usage event 기록
- 관리자 계정 Dashboard 업로드 화면 링크

남은 작업:

- 관리자 모델 검색과 선택 UI
- 모델 삭제/soft delete
- Featured Gallery 지정

## 11. 커밋 전 확인

스테이징 전후에 아래를 확인한다.

```bash
git status --short
npm run build
```

`.env.local`은 반드시 unstaged/ignored 상태여야 한다.
