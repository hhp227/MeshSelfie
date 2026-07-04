# MeshSelfie 프로젝트 진행 상태

> **2026-07-05 방향 전환**: 3D 결과물 품질 판단에 따라 FLAME 기반 AI 생성에서
> **Photogrammetry 중심 복원 + AI 후처리**(`docs/MeshSelfie_PRD_v2.0_Photogrammetry_Hybrid.md`)
> 로 피벗한다. 입력이 사진 1~3장 → 동영상 10~20초 또는 사진 20~80장으로 바뀐다.
> FLAME 파이프라인(M0~M4 + silhouette + photometric + hair preset)은 코드로
> 보존되며, v2.0의 "AI Enhancement" 단계에서 부품으로 재활용을 검토한다.

## 1. 현재 기준

| 항목 | 내용 |
| --- | --- |
| 작성일 | 2026-06-20 |
| 앱 프레임워크 | Next.js 16.2.9 App Router |
| React | 19.2.4 |
| TypeScript | 사용 |
| Supabase SDK | `@supabase/supabase-js` 2.108.2 |
| 현재 목표 | Replicate 결제 설정 후 실제 이미지→GLB E2E 검증 |

> 2026-06-21 품질 검증 후 현재 목표를 Hybrid Head Reconstruction worker 구현으로 변경했다.

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

## 12. 2026-06-21 품질 방향 전환

실제 `firtoz/trellis` E2E는 성공했지만 얼굴 동일성과 mesh detail이 제품 기준에 미달했다.

- 테스트 결과 GLB: 약 1.1MB, 6,542 vertices, 10,898 triangles, 1024×1024 texture
- TRELLIS 기본 GLB 추출은 `mesh_simplify=0.95`로 triangle의 95%를 제거한다.
- TRELLIS는 범용 3D asset 모델이며 얼굴 identity reconstruction 전용 모델이 아니다.
- 다중 이미지 conditioning도 전문 multi-view face fitting을 대체하지 못한다.
- 기존 `A/A+` 등급은 사진 개수일 뿐 실제 결과 품질 보장이 아니다.

결정:

1. 얼굴·귀·턱·목은 FLAME 계열 shared-identity multi-view fitting으로 복원한다.
2. 피부는 2K~4K multi-view UV texture로 합성한다.
3. 머리카락은 segmentation 기반 low-detail hair shell로 처리한다.
4. DECA 공개 가중치는 비상업 라이선스이므로 상용 기본 Provider에 포함하지 않는다.
5. Python GPU worker를 `self_hosted` Provider로 연결하고 TRELLIS는 fallback/비교용으로 유지한다.

이번 기반 구현:

- `HEAD_RECONSTRUCTION_*` 환경 변수와 우선 Provider 선택
- 비동기 worker 생성/조회/취소 adapter
- worker 결과 GLB host allowlist
- JPG/PNG 실제 해상도 판독
- 512px 미만 hard fail, 1024px 미만 warning 및 DB width/height 저장
- 업로드 화면의 고정밀 두상 촬영 가이드

상세 설계: `docs/hybrid-head-reconstruction.md`

## 13. 2026-07-04 진행

### Replicate provider 선택 스위치

- `REPLICATE_MODEL_FAMILY=trellis|hunyuan3d`로 Replicate 모델을 선택한다(기본 trellis).
- `lib/ai/providers/hunyuan3d.ts` 추가: `tencent/hunyuan3d-2mv`, front/side/angle45를
  방향에 따라 `front_image`/`left_image`/`right_image`에 매핑, `target_face_num=40000`.
- TRELLIS 파라미터 보정: `texture_size=2048`, `mesh_simplify=0.8`, sampling steps 25.
- 두 모델 모두 범용 image-to-3D라 얼굴 동일성의 근본 해법은 아니며 비교/완화책이다.

### Hybrid Head Worker Milestone 0 스캐폴드

- `services/head-reconstruction/`에 FastAPI worker 생성. `docs/hybrid-head-reconstruction.md`
  5절의 `POST /v1/jobs`, `GET /v1/jobs/{id}`, `POST /v1/jobs/{id}/cancel` 계약 구현.
- Milestone 0 파이프라인(CPU 전용): 정면 사진 → MediaPipe FaceLandmarker(Tasks API,
  478 landmark) → Delaunay relief 메쉬 → 정면 사진 UV 텍스처 → GLB. 품질 목표가
  아니라 앱↔worker E2E 검증용. mediapipe 0.10.35에서 구형 `solutions` API가 제거되어
  Tasks API 기반으로 구현했고, `.task` 모델은 최초 실행 시 자동 다운로드된다.
- 런타임 검증 완료(uv venv + 실제 `image/front.jpg`): `run_local.py`로 478 정점/918
  삼각형/461KB GLB 생성, GLB v2 헤더·텍스처 임베드 확인, API 서버 기동 후
  401 인증 거부 → job 생성 → 폴링 완료 → GLB 다운로드 → 취소까지 계약 전체 검증.
- Milestone 1(FLAME fitting) 준비물: FLAME 2023 등록·다운로드(무료, 라이선스 확인 필요),
  GPU 환경(Modal/RunPod 서버리스 권장, job당 $0.02~0.08 추정).

### 랜딩 페이지 개편

- 히어로 캐로우셀, 커뮤니티 갤러리 그리드(placeholder), 이용 3단계, 품질 등급,
  FAQ, CTA/푸터 구성. 갤러리 실데이터 연동은 썸네일 생성·Gallery API 구현 이후.

### Hybrid Head Worker Milestone 1 — FLAME fitting 구현·검증 완료

- 사용자가 FLAME 2023 Open(CC-BY-4.0)·Mediapipe Landmark Embedding·Vertex Masks를
  다운로드해 `services/head-reconstruction/models/flame/`에 배치함.
- `flame_model.py`: flame2023_Open.pkl 로더(chumpy 스텁) + shape 300/expression 100
  blendshape + 5-joint LBS를 PyTorch로 자체 구현(연구용 라이선스인 smplx 등 미사용).
  단위 검증: zero-pose == template(2e-8), gradient 흐름, 회전 정상.
- `flame_fitting.py`: MediaPipe 105 landmark ↔ FLAME 표면 embedding 기반
  weak-perspective 카메라 + shape/expression/neck/jaw 2단계 Adam 최적화(CPU ~23초,
  정규화 landmark MSE ~1.2e-4). 정면 사진 투영 per-vertex UV 텍스처, global rotation
  제거 후 GLB 출력(5,023 정점/9,976 삼각형, ~660KB).
- 파이프라인: FLAME 자산 존재 시 M1 fitting, 없으면 M0 relief 폴백. torch는 CPU 인덱스로
  requirements.txt에 추가.
- 실제 `image/front.jpg` 검증: 점군 프리뷰에서 눈·코·입 텍스처 정렬과 완전한 두상·목
  형상 확인. 앱 경유 E2E(업로드→생성→폴링→Storage 저장→signed URL 다운로드)도
  661KB FLAME GLB로 재검증 완료.
- CC-BY-4.0 저작자 표시를 랜딩 푸터에 추가.
- M1 한계(다음 작업): 텍스처가 정면 단일 투영(측면·후두부 늘어짐 → M2 multi-view UV
  합성), 머리카락 volume 없음(→ M3 hair shell), 후두부 geometry는 FLAME 사전 분포 의존.

### Hybrid Head Worker Milestone 2 — multi-view fitting + UV 베이크 구현·검증 완료

- `flame_fitting.py`를 multi-view로 확장: shape/expression/jaw/neck 공유, 뷰별
  global rotation + weak-perspective 카메라. 비정면 뷰는 yaw 다중 시작(0°, ±45°, ±82°).
  검출 실패 뷰는 자동 제외(90° 측면은 MediaPipe가 검출하지 못함 — 실측 확인).
- `texture_bake.py` 신규: xatlas(MIT) UV 아틀라스 + 소프트웨어 래스터라이저로
  텍셀별 z-buffer 자기가림 검사, 법선·시선 가중 multi-view 블렌딩(1024²),
  미관측 텍셀 이웃 전파 채움. smplx 등 연구용 라이선스 코드 미사용 원칙 유지.
- 실측(image/ 3장): front+angle45 사용(side 자동 제외), 46초 CPU, landmark MSE
  3.4e-4, 915KB GLB(~6.7k 정점). 45도 사진이 측면 볼 텍스처를 실제로 채우는 것을
  프리뷰로 확인. 두피가 피부색으로 채워지는 것은 의도된 동작(머리카락은 M3).
- 앱 경유 E2E 재검증 완료(업로드→생성→폴링→Storage 915KB 저장→signed URL 검증).
- 뷰어(`components/viewer/glb-viewer.tsx`)에 표시 모드 토글 추가: 텍스처(원본
  머티리얼)/와이어프레임/스무스(클레이 셰이딩, normal 자동 계산). 모드 전환 시
  원본 머티리얼 복원 후 폐기로 텍스처 누수 방지. lint(react-hooks/refs 수정)·build 통과.

### Hybrid Head Worker Milestone 3 — hair shell 구현·검증 완료

- `segmentation.py` 신규: MediaPipe selfie multiclass segmenter(Apache-2.0, 자동
  다운로드)로 hair mask 추출 + 구멍 메움/노이즈 제거. 실측에서 긴 머리·앞머리까지
  정확히 분리됨.
- `hair_shell.py` 신규: mask 그리드 삼각화 앞·뒤 시트 + 경계 봉합 쉘. 깊이는 head
  z-buffer(near/far)의 최근접 전파(distance transform) — 앞면 = head 표면 +12mm로
  얼굴 침범 방지, 긴 머리도 자연스러운 깊이. hair는 별도 doubleSided material로
  `head`/`hair` 2-지오메트리 GLB(trimesh.Scene) export. 정면 뷰 posed 공간에서 만들어
  global rotation 역변환으로 neutral 공간에 정렬.
- 두피 텍셀(FLAME_masks `scalp`, 관측 가중치<0.3)을 머리카락 평균색으로 틴트
  (`texture_bake.py` override 인자).
- 실측: hair 1,886 정점/3,768 삼각형, 전체 1.1MB GLB, CPU ~40초. 프리뷰에서
  정면 헤어 실루엣(양옆 긴 머리+앞머리)과 측면 두피 틴트 확인.
- 앱 경유 E2E 검증: Storage 저장 GLB에 head/hair 지오메트리 포함 확인. 테스트 계정
  크레딧은 service role로 3회 충전해 사용.
- 뷰어 스무스/와이어프레임 머티리얼을 DoubleSide로 변경(얇은 hair 시트 뒷면 표시).
- 남은 개선 후보: 옆/뒤에서 본 hair shell 볼륨(현재 정면 실루엣 기반 평면),
  90° 측면 사진의 silhouette 활용, GPU 배포(Modal/RunPod)로 처리 시간 단축.

### Hybrid Head Worker M3+ — 측면 silhouette 활용·hair 볼륨 개선

- `side_view.py` 신규: 90° 측면 사진(landmark 미검출)을 segmentation(hair/face-skin)
  으로 정합. face-skin 높이 기반 scale **고정** + 위치만 Nelder-Mead 최적화
  (distance transform 손실, yaw ±90° 후보 중 선택). scale 자유 최적화 시 모델이
  mask 안으로 축소되는 퇴화 해 발생 — 실측으로 확인 후 고정 방식 채택
  (정합 손실 1.4 vs 반대 yaw 29로 방향 판별 명확).
- 정합 좌표계에서 높이별 "후두부 hair 초과 두께" 프로파일을 추정해 hair shell
  뒤 시트 깊이에 반영. 깊이맵 gaussian 스무딩(σ=6px) 추가로 측면 형상 개선.
- 실측: hair z 최소 -0.163 → **-0.219** (후두부 뒤로 ~5.6cm 볼륨 추가, 측면 사진
  실루엣과 일치). 파이프라인 총 ~55초 CPU. 앱 경유 E2E로 Storage 저장까지 검증.
- GPU 배포(Modal/RunPod)는 계정·결제 필요로 미착수 — worker README의 배포 옵션
  표 참고. Dockerfile은 준비되어 있음.

### 메인 페이지를 서비스 홈으로 전환

- 기존 랜딩 콘텐츠(히어로 캐로우셀, 3단계, 갤러리, 품질 등급, FAQ)를 `/landing`
  라우트로 이동. 랜딩의 보조 CTA는 "서비스 홈으로"(`/`)로 변경.
- `/`는 서비스 홈(`components/home/home-client.tsx`): 로그인 사용자에게 인사말·
  크레딧 요약·"새 3D 모델 생성" CTA, 내 모델 SNS형 카드 그리드(상태/품질 배지,
  클릭 시 결과 페이지), 커뮤니티 갤러리(placeholder), FLAME 표기 푸터를 보여준다.
  비로그인 방문자는 클라이언트 세션 확인 후 `/landing`으로 replace.
- 로그인 성공 기본 이동을 `/dashboard` → `/`(서비스 홈)로 변경, AppNav에 "홈" 링크
  추가(로고도 `/`로). 대시보드는 "전체 관리" 용도로 유지.
- 썸네일 미구현 상태라 내 모델 카드는 그라디언트 placeholder를 사용 — 썸네일
  생성 구현 시 `thumbnailUrl`로 교체 예정.

### 썸네일 생성 구현·검증 완료

- worker `thumbnail.py` 신규: GPU/EGL 없이 numpy 소프트웨어 래스터라이저로
  head+hair 씬을 512px JPEG 렌더(14° 3/4 구도, Lambert 셰이딩, ~2초).
  파이프라인에서 best-effort로 생성, `/files/{id}/thumbnail.jpg` 서빙 및
  `output.thumbnailUrl` 반환.
- 앱 연동: `ProviderJobStatus.thumbnailUrl` → generation-jobs 라우트가
  output_payload에 보존 → `finalize.ts::storeThumbnail`이 다운로드(신뢰 host 검증,
  JPEG magic, 5MB 상한) 후 `thumbnails/{user}/{mesh}/thumbnail.jpg` 업로드 및
  `human_meshes` thumbnail 필드 갱신. 썸네일 실패는 생성 완료를 막지 않음.
- `GET /api/avatars`가 `thumbnail_object_path` 기반 signed URL(5분)을
  `createSignedUrls` 배치로 발급. 홈 카드가 썸네일 있으면 실제 이미지, 없으면
  기존 placeholder 렌더.
- E2E 검증: worker 썸네일 34,785B → Storage 저장 → 목록 API signed URL →
  다운로드 JPEG magic 확인. TRELLIS/Hunyuan(Replicate) 경로는 provider가 썸네일을
  주지 않으므로 placeholder 유지(추후 클라이언트 캡처 방식 검토 가능).
- 과거 완료 mesh들은 소급 생성되지 않음 — 새 생성부터 썸네일이 붙는다.

### Modal 서버리스 배포 완료

- `services/head-reconstruction/modal_app.py`: CPU 8코어/8GB, `max_containers=1`
  + `scaledown_window=300`(인메모리 job 저장소 대응), `@modal.concurrent`(폴링 병행),
  FLAME 자산·코드 mount, API 키는 Modal Secret(`meshselfie-head-recon`).
- worker가 공개 URL을 요청 Host/X-Forwarded-Proto 헤더에서 자동 유도하도록 개선
  (배포 URL 선지정 불필요, 로컬 동작 동일).
- 시행착오: 첫 배포에서 mediapipe가 `libGLESv2.so.2` 미존재로 실패 →
  apt `libegl1`, `libgles2` 추가 후 정상.
- 배포 URL `https://hhp0227--meshselfie-head-recon-api.modal.run`. 앱 `.env.local`을
  Modal로 전환하고 E2E 검증: 생성 79초(콜드스타트 포함)에 완료, head+hair GLB
  1.12MB Storage 저장, 썸네일 signed URL 정상. 비용은 job당 ~$0.01 수준(무료 크레딧 내).
- 로컬 worker(8100)는 개발용으로 유지 — `.env.local` URL 교체로 전환.

### Vercel 프로덕션 배포 완료

- 프로덕션 URL: **https://meshselfie.vercel.app** (프로젝트 `meshselfie`,
  계정 hong227-2018/hhp227). 배포는 `npx vercel deploy --prod --yes`.
- 환경 변수 6종(Supabase 3, Replicate 1, HEAD_RECONSTRUCTION 2)을 Vercel
  production 환경에 등록 — 생성 요청은 Modal worker로 간다.
- 시행착오 2건: ① `vercel link`가 FastAPI worker까지 포함한 멀티서비스
  `vercel.json`을 자동 생성 → Next.js 단일 앱(`{"framework":"nextjs"}`)으로 교체.
  ② `.vercelignore`의 `supabase/` 패턴이 `lib/supabase/`까지 매칭돼 빌드 실패 →
  루트 앵커(`/supabase/`)로 수정. 두 파일 모두 주석으로 이유 기록.
- 프로덕션 E2E 검증: 로그인 → 업로드 → 생성(Modal) → 48초 완료 → Storage 저장
  → 썸네일 signed URL까지 전 구간 통과.
- 전체 아키텍처가 클라우드화됨: Vercel(Next.js) + Modal(3D worker) +
  Supabase(Auth/DB/Storage). 로컬 의존 없음.

### 이미지 품질 검증 구현 (PRD 2.4 부분)

- worker `validation.py` + `POST /v1/validate`: FaceLandmarker(최대 5명) 얼굴 수·
  bbox·크기 비율 + 512px 정규화 Laplacian 블러 점수. worker는 원시 메트릭만 주고
  역할별 정책·한국어 메시지는 앱이 결정(`lib/generation/image-validation.ts`).
- 업로드 라우트: Storage 업로드 → signed URL로 worker 검증 → 하드 실패(정면 얼굴
  없음/다중 인물) 시 업로드 객체 삭제 + 400, 통과 시 `validation_status`(passed/
  warning)·`face_bbox`·`blur_score`·`validation_warnings` 저장. worker 미설정·호출
  실패(콜드스타트 타임아웃 포함) 시 pending으로 강등하고 업로드는 계속(best-effort).
- 90° 측면은 얼굴 미검출이 정상이므로 side/angle45의 얼굴 0명은 경고만.
- generate 라우트: `validation_status='failed'` 이미지 사용 차단(방어적).
- 실측: 정면 얼굴없음→400, 다중 인물(sample2)→400(웜 4.6초), 정상 3장→
  front passed/side warning/angle45 passed. 블러 점수 분리도(선명 270~680 vs
  블러 1.7) 확인, 경고 임계 40.
- 미구현 잔여(PRD 2.4): 가림/선글라스/마스크 감지 — 별도 분류기 필요.

### 품질 개선: 두상 개인화 + hair 스무딩

- **문제(사용자 리포트)**: head가 늘 같은 메쉬(평균 두상)에 텍스처만 바뀜, hair 계단.
- **원인**: shape 정규화(1e-2)가 landmark 손실(~3e-4)을 압도해 shape이 0 근처에
  묶임 — fitted bbox가 template와 수 mm 이내로 동일함을 실측으로 확인.
- **수정**: `W_SHAPE_REG` 1e-2→8e-4, `W_EXPR_REG` 5e-2→4e-3. landmark 오차 31%
  감소(3.4e-4→2.4e-4), clay 렌더에서 턱·볼 라인 변화 확인. `shape_norm`을
  scene metadata로 노출해 개인화 정도 관측 가능.
- **hair**: 마스크 gaussian 스무딩(σ=4), 그리드 56→88셀, sparse Laplacian 정점
  스무딩(4회, λ=0.5) — clay 렌더에서 계단 제거 확인. Modal 재배포 + E2E 통과.
- **서비스 품질까지 남은 로드맵**(landmark-only fitting의 한계):
  1. ~~silhouette 손실~~ → 구현 완료 (아래 절)
  2. photometric(텍스처/음영) 손실 — DECA류 접근을 상업 안전 구성으로 자체 구현.
     shape 디테일(광대·코 형상)의 실질적 개선은 여기서 나옴. GPU 필요.
  3. 귀 landmark — MediaPipe embedding 105점에는 귀가 없어 귀 형상은 사전 분포
     의존. 귀 검출기 추가 검토.

### Silhouette 손실 구현 (턱선·볼 윤곽 정밀화)

- **핵심 발견**: MediaPipe 105 landmark embedding에는 얼굴 윤곽(face oval) 점이
  **0개** — 턱선은 지금까지 아무 제약 없이 FLAME 사전 분포로만 결정됐다.
  silhouette 손실이 턱의 유일한 제약이므로 landmark와 충돌 없이 강하게 적용 가능.
- stage-3(250 iter) 추가: landmark + ① containment(얼굴 정점이 얼굴피부∪머리카락
  밖으로 나가는 거리 벌점) + ② jaw snap(모델 얼굴의 행별 좌우 극점 윤곽 ↔
  face-skin 경계 unsigned distance field, cap 6%로 가림 영역 무시).
  거리 필드는 EDT로 사전 계산하고 torch bilinear 샘플링으로 미분 연결.
- **가림 처리 시행착오**: "머리카락 인접 경계 제외" 휴리스틱은 턱선까지 84%를
  버림(오버레이로 확인 — 턱에서는 머리카락이 턱 뒤라 피부 경계가 곧 실루엣).
  → 위치 기반(face bbox 세로 55% 이하 하반부만 신뢰)으로 교체. 앞머리 가림선
  (상반부)만 배제된다.
- 실측(front+angle45): jaw 잔차(스냅 대상 평균) 8.7px → **5.7px(-35%)**,
  shape norm 5.7→8.4(개인화 증가), clay 렌더에서 평균 두상의 둥근 턱이
  피사체의 V라인으로 변형됨을 확인. landmark 오차는 2.7→3.9e-4로 소폭 상승
  (턱·볼을 실루엣에 맞추는 대가, 텍스처는 동일 카메라 투영이라 정렬 유지).
- 파이프라인 ~120초 CPU(stage-3 추가분 +30초). Modal 재배포·E2E 통과.

### Photometric fitting 구현 (stage-4)

- `photometric.py` 신규 + fitting stage-4(300 iter): 픽셀→삼각형 래스터는 주기
  갱신(비미분), 정점→법선→SH(2차 9계수) 조명→픽셀색 경로가 미분 가능한
  DECA류 analysis-by-synthesis. 실루엣 경계 기울기는 없지만 silhouette 손실이
  별도로 담당.
- 상업 안전 구성: 비상업 texture space(DECA/FLAME tex/AlbedoMM) 대신
  **per-vertex albedo + Laplacian 스무딩** + 뷰별 SH. albedo는 정면 사진 샘플로
  초기화, SH는 ambient로 시작.
- FLAME face 패치(~3.5k 삼각형)만 face 대각선 220px 해상도로 렌더 → CPU 유지
  (전체 파이프라인 ~90초, GPU 불필요 판명 — 당초 GPU 필요 예상을 수정).
- 드리프트 방지: landmark+silhouette 손실 유지 + stage-3 결과 앵커
  (shape/expression 편차 벌점). 카메라·포즈는 고정(텍스처 정렬 보존).
- 실측: photometric 잔차 0.038→**0.012(-69%)**, clay 렌더에서 콧대·볼 볼륨·
  입술 윤곽 뚜렷해짐, 심각한 왜곡 없음. landmark 오차 3.9→4.6e-4(허용 범위).
- Modal 재배포·E2E 통과. 로드맵 잔여: ③ 귀 형상(귀 검출기), 표정 중립화 옵션,
  albedo 텍스처 활용(현재는 fitting 장치로만 사용).
