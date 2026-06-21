# MeshSelfie

MeshSelfie는 얼굴 사진을 기반으로 고정밀 얼굴·목과 저해상도 hair shell을 결합한 Photorealistic Head Mesh GLB 생성을 목표로 하는 Next.js 기반 MVP 프로젝트입니다.

캐릭터형 아바타, VRM, 만화풍 모델이 아니라 실제 얼굴 구조와 텍스처를 최대한 보존한 실사형 3D Reconstruction 플랫폼을 지향합니다.

## 제품 범위

MVP는 정면 사진 1장을 필수로 받고, 측면 사진과 좌/우 45도 사진 중 하나를 선택 입력으로 받아 실사형 Human Mesh 생성 가설을 검증합니다.

| 입력 | 필수 여부 | 방향값 | 품질 등급 |
| --- | --- | --- | --- |
| `front` | 필수 | 없음 | 단독 입력 시 `B` |
| `side` | 선택 | `left` 또는 `right` | 정면과 함께 입력 시 `A` |
| `angle45` | 선택 | `left` 또는 `right` | 정면과 함께 입력 시 `A` |

`front + side + angle45` 조합은 `A+` 등급으로 계산합니다. 좌/우 45도 동시 업로드, VRM/리깅/애니메이션, 캐릭터형 변환, 결제 연동은 MVP 후순위입니다.

## 기술 스택

| 영역 | 스택 |
| --- | --- |
| Frontend | Next.js 16 App Router, React 19, TypeScript, TailwindCSS v4 |
| Backend | Next.js Route Handler |
| Auth | Supabase Auth |
| Database | Supabase PostgreSQL |
| Storage | Supabase Storage private bucket |
| AI | Provider abstraction, hybrid head reconstruction worker, Replicate TRELLIS fallback |
| 3D Viewer | Three.js GLTFLoader, OrbitControls |
| Deploy | Vercel 예정 |

## 로컬 실행

Node.js 20 이상이 필요합니다.

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

## 환경 변수

`.env.local`에 아래 값을 입력합니다. 실제 값은 커밋하지 않습니다.

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
REPLICATE_API_TOKEN=
# 선택. 미설정 시 코드의 고정 TRELLIS 버전을 사용합니다.
REPLICATE_MODEL_VERSION=
HEAD_RECONSTRUCTION_API_URL=
HEAD_RECONSTRUCTION_API_KEY=
HEAD_RECONSTRUCTION_MODEL_NAME=hybrid-flame-head-v1
HEAD_RECONSTRUCTION_OUTPUT_HOSTS=
```

Supabase는 새 API key 형식을 권장합니다.

| 변수 | 값 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_...` |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_...` |

## Supabase 설정

새 프로젝트 또는 새 환경에서 실행할 경우 먼저 SQL migration을 실행합니다.

```text
supabase/migrations/001_initial_schema.sql
```

Supabase SQL Editor에서 위 파일 전체를 실행하면 테이블, enum, index, trigger, RLS policy, `avatars` bucket 정책이 생성됩니다.

개발 중 이메일 인증을 생략하려면 Supabase Dashboard에서 설정합니다.

```text
Authentication > Providers > Email > Confirm email 비활성화
```

이미 생성된 미인증 사용자는 Dashboard의 `Authentication > Users`에서 삭제 후 다시 가입하거나, 이메일 확인 처리를 해야 로그인 세션이 발급됩니다.

## Storage 구조

Supabase Storage는 `avatars` 단일 private bucket을 사용합니다. DB에는 public URL이 아니라 bucket과 object path를 저장하고, 서버 API가 권한 확인 후 signed URL을 발급합니다.

```text
avatars/
├── images/{user_id}/uploads/{upload_group_id}/front.{jpg|jpeg|png}
├── images/{user_id}/uploads/{upload_group_id}/side.{jpg|jpeg|png}
├── images/{user_id}/uploads/{upload_group_id}/angle45.{jpg|jpeg|png}
├── models/{user_id}/{human_mesh_id}/mesh.glb
├── models/{user_id}/{human_mesh_id}/admin_uploaded.{glb|gltf}
├── thumbnails/{user_id}/{human_mesh_id}/thumbnail.jpg
├── thumbnails/{user_id}/{human_mesh_id}/preview.jpg
└── admin/sample_models/{sample_id}/mesh.{glb|gltf}
```

## 주요 문서

| 문서 | 내용 |
| --- | --- |
| `docs/meshselfie-prd.md` | MeshSelfie PRD v1.1 |
| `docs/technical-design.md` | PRD 기반 기술 설계 |
| `docs/supabase-schema.md` | Supabase DB 설계 |
| `docs/rls-policy-review.md` | RLS 정책 검토 |
| `docs/storage-structure.md` | Storage bucket/path 설계 |
| `docs/openapi.yaml` | API 명세 |
| `docs/nextjs-project-structure.md` | App Router 프로젝트 구조 |
| `docs/project-status.md` | 현재 진행 상태와 다음 작업 |
| `docs/hybrid-head-reconstruction.md` | 고정밀 얼굴·목 + low-detail hair shell worker 설계 |

## 현재 구현 상태

구현 완료:

- Landing, Login, Signup, Dashboard, Upload, Result, Profile, Admin 기본 화면
- Supabase browser/admin client 분리
- Supabase 이메일 로그인/회원가입 UI
- Supabase migration: enum, table, index, trigger, RLS policy, `avatars` bucket policy
- `GET /api/profile`
- `GET /api/avatars`
- `POST /api/uploads/images`
- `POST /api/generate`
- `GET /api/generation-jobs/[jobId]`
- `GET /api/meshes/[meshId]`
- `DELETE /api/meshes/[meshId]`
- `GET /api/meshes/[meshId]/download`
- `POST /api/admin/models/upload`
- AI Provider interface, registry, stub, Replicate TRELLIS 및 Hybrid Head worker adapter
- 업로드 화면에서 front/side/angle45 입력 후 생성 요청
- JPG/PNG 해상도 판독, 512px 미만 차단, 1024px 미만 경고
- Replicate 상태 polling, GLB 검증과 private Storage 저장
- 결과 화면 Three.js GLB Viewer, 회전·확대·축소, 다운로드
- 관리자 GLB/GLTF 업로드와 기존 모델 교체
- 대시보드에서 생성 중·실패·완료 모델 30일 soft delete
- 진행 중인 모델 삭제 시 generation job 및 Replicate prediction 취소

명세는 있으나 아직 미구현:

- `GET /api/gallery`
- `POST /api/webhooks/ai-provider`
- `POST /api/webhooks/replicate`
- `GET /api/admin/models`
- `PATCH /api/admin/models/[meshId]`
- `DELETE /api/admin/models/[meshId]`
- `GET /api/admin/metrics`
- Thumbnail/preview render 생성
- 이미지 품질 검증 Vision 로직
- Featured Gallery 노출
- soft delete 후 30일이 지난 모델의 Storage/DB purge job

## 현재 생성 방향

- 기본 목표: FLAME 계열 고정밀 얼굴·귀·턱·목 + 저해상도 hair shell
- Python GPU worker가 multi-view fitting, UV texture 합성, hair shell, GLB export를 담당한다.
- worker 환경 변수가 설정되면 `self_hosted` Provider가 우선 선택된다.
- TRELLIS는 E2E/fallback 비교용으로 유지하며 얼굴 동일성 품질의 기준 Provider로 사용하지 않는다.
- 상세 설계는 `docs/hybrid-head-reconstruction.md`를 참고한다.

## 기존 TRELLIS 확인 사항

Replicate 결제 반영 후 실제 이미지→GLB E2E는 성공했다. 테스트 결과물은 정상적으로 생성·저장·표시됐지만 얼굴 동일성과 geometry detail이 제품 기준에 미달했다.

- 완료 결과 예시: 약 1.1MB, 6,542 vertices, 10,898 triangles, 1024×1024 texture
- TRELLIS는 범용 3D asset 모델이며 얼굴 identity reconstruction 전용 모델이 아니다.
- TRELLIS 기본 GLB 설정은 triangle 95% simplification과 1K texture를 사용한다.
- 얼굴 품질 결정과 Hybrid Head 전환 근거는 `docs/project-status.md`와 `docs/hybrid-head-reconstruction.md`를 참고한다.

## 다음 작업 추천 순서

### 최우선: Hybrid Head Worker

1. 상업 사용 가능한 FLAME fitting 조합을 확정합니다.
2. Python GPU worker에서 정면 textured head GLB를 생성합니다.
3. 정면·45도·측면 shared-identity fitting을 추가합니다.
4. multi-view UV texture와 low-detail hair shell을 결합합니다.
5. `HEAD_RECONSTRUCTION_*` 환경 변수로 앱과 연결합니다.
6. TRELLIS 결과와 얼굴 유사도·silhouette·texture 품질을 비교합니다.

### 다음 세션에서 바로 시작할 작업

현재 저장소에는 worker를 호출하는 Next.js adapter까지만 구현되어 있고 실제 Python/GPU worker는 아직 없다. 다음 작업자는 아래 순서로 이어서 진행한다.

1. `services/head-reconstruction/`에 Python worker 프로젝트를 만든다.
2. 상업 서비스 전제에서는 DECA 공개 가중치를 사용하지 않는다.
3. FLAME 2023 Open과 호환되며 상업 사용 가능한 landmark, segmentation, face-parameter fitting 구성요소의 라이선스를 각각 확정한다.
4. 먼저 정면 1장으로 textured face·head·neck GLB를 반환하는 최소 worker를 완성한다.
5. worker API는 `docs/hybrid-head-reconstruction.md`의 `POST /v1/jobs`, `GET /v1/jobs/{id}`, `POST /v1/jobs/{id}/cancel` 계약을 구현한다.
6. 단일 이미지 E2E 후 shared-identity multi-view fitting, 2K~4K UV blending, low-detail hair shell 순서로 확장한다.
7. 배포는 초기 MVP 기준 Modal 또는 RunPod Serverless 같은 비동기 GPU 환경을 검토한다. 배포 대상 확정 전 특정 플랫폼 SDK에 종속시키지 않는다.
8. 배포 후 `.env.local`에 아래 값을 설정하면 Hybrid Head worker가 TRELLIS보다 우선 선택된다.

```env
HEAD_RECONSTRUCTION_API_URL=https://worker.example.com
HEAD_RECONSTRUCTION_API_KEY=
HEAD_RECONSTRUCTION_MODEL_NAME=hybrid-flame-head-v1
HEAD_RECONSTRUCTION_OUTPUT_HOSTS=worker-output.example.com
```

완료 기준은 정면·45도·측면 입력으로 얼굴·귀·턱·목의 동일성이 TRELLIS보다 명확히 개선되고, hair shell이 얼굴 geometry를 침범하지 않는 GLB가 Supabase Storage에 저장되는 것이다.

### 후속 구현

1. 얼굴 존재 여부, 다중 인물, 흐림, 가림, 선글라스, 마스크 이미지 품질 검증
2. 30일 경과 soft delete 모델의 Storage object와 DB row를 정리하는 purge job
3. 관리자 모델 검색·삭제와 Featured Gallery 관리
4. Thumbnail/preview render 생성과 Gallery API
5. Replicate webhook 또는 background worker를 통한 polling 의존도 축소
6. Supabase Email Confirm 운영 정책 확정과 필요 시 `@supabase/ssr` cookie session 전환

## 검증 명령

```bash
npm run lint
npm run build
```

현재 `npm run build`는 통과합니다. 이 개발 환경에서는 Next/Turbopack이 CSS 처리 중 로컬 포트 바인딩을 사용하므로 샌드박스 안에서는 실패할 수 있습니다. 일반 로컬 터미널에서는 그대로 실행하면 됩니다.
