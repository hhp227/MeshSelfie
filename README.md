# MeshSelfie

MeshSelfie는 셀카 또는 얼굴 사진을 기반으로 Photorealistic Human Mesh GLB 모델 생성을 목표로 하는 Next.js 기반 MVP 프로젝트입니다.

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
| AI | Provider abstraction, Replicate/TRELLIS/Hunyuan3D/TripoSR 확장 예정 |
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
- `GET /api/meshes/[meshId]/download`
- AI Provider interface, registry, stub provider
- 업로드 화면에서 front/side/angle45 입력 후 생성 요청
- 결과 화면에서 상태 polling과 다운로드 버튼

명세는 있으나 아직 미구현:

- `GET /api/gallery`
- `POST /api/webhooks/ai-provider`
- `POST /api/webhooks/replicate`
- `GET /api/admin/models`
- `POST /api/admin/models/upload`
- `PATCH /api/admin/models/[meshId]`
- `DELETE /api/admin/models/[meshId]`
- `GET /api/admin/metrics`
- 실제 Replicate/TRELLIS/Hunyuan3D Provider 호출
- GLB 파일 다운로드 후 Supabase Storage 저장
- Thumbnail/preview render 생성
- 실제 GLB 3D viewer 렌더링
- 이미지 품질 검증 Vision 로직
- 관리자 모델 업로드/교체 API
- Featured Gallery 노출

## 다음 작업 추천 순서

1. Supabase Email Confirm 설정과 profile row 자동 생성 여부를 포함한 인증 흐름 안정화
2. 실제 이미지로 업로드 E2E 검증, `source_images` row와 Storage path 확인
3. Replicate Provider adapter 추가와 provider 모델 버전/입력 파라미터 확정
4. Provider output URL 수신, GLB 다운로드, `models/{user_id}/{human_mesh_id}/mesh.glb` 저장, 완료 상태 처리
5. GLB 3D viewer 구현
6. 얼굴 존재 여부, 다중 인물, 흐림, 가림, 선글라스, 마스크 등 이미지 품질 검증 구현
7. 관리자 모델 업로드/교체/삭제와 Featured Gallery 구현

## 검증 명령

```bash
npm run build
```

현재 `npm run build`는 통과합니다. 이 개발 환경에서는 Next/Turbopack이 CSS 처리 중 로컬 포트 바인딩을 사용하므로 샌드박스 안에서는 실패할 수 있습니다. 일반 로컬 터미널에서는 그대로 실행하면 됩니다.
