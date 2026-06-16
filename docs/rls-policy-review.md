# MeshSelfie RLS 정책 리뷰

## 1. 결론

현재 `001_initial_schema.sql`의 RLS 방향은 MVP에 적합하다. 일반 사용자는 자신의 데이터 조회 중심으로 제한하고, 생성/상태 변경/모델 경로 변경/크레딧 변경은 Next.js 서버 API 또는 관리자 권한으로 처리한다.

## 2. 정책 요약

| 테이블 | 일반 사용자 | 관리자 | 서버 API |
| --- | --- | --- | --- |
| `profiles` | 본인 조회 | 전체 조회/수정 | service role로 생성/수정 |
| `source_images` | 본인 조회 | 전체 조회/생성/수정 | 업로드 API에서 생성 |
| `human_meshes` | 본인 조회, featured 조회 | 전체 조회/생성/수정 | 생성/상태/삭제 처리 |
| `generation_jobs` | 본인 조회 | 전체 조회/생성/수정 | 생성/상태 변경 |
| `ai_provider_versions` | 접근 불가 | 전체 관리 | provider 선택 |
| `admin_model_uploads` | 접근 불가 | 조회/생성 | 감사 로그 기록 |
| `credit_ledger` | 본인 조회 | 조회/생성 | credit 차감/환불 |
| `usage_events` | 본인 조회/생성 | 전체 조회 | 이벤트 기록 |

## 3. 주요 판단

### 사용자 insert 제한

`source_images`, `human_meshes`, `generation_jobs`는 일반 사용자가 직접 insert하지 못하게 했다. 이유는 다음과 같다.

| 이유 | 설명 |
| --- | --- |
| 파일 경로 위조 방지 | 사용자가 다른 사용자의 object path를 DB에 직접 넣는 것을 방지 |
| 상태 위조 방지 | `completed`, `model_object_path` 등을 임의로 설정하는 것을 방지 |
| credit 우회 방지 | 생성 job을 직접 만들어 credit 차감을 우회하는 것을 방지 |
| provider payload 보호 | provider 입력/출력 metadata를 server-side에서만 저장 |

업로드와 생성은 반드시 Next.js Route Handler가 service role로 처리한다.

### Featured Mesh 조회

`human_meshes`는 `is_featured = true`인 row를 모든 사용자가 조회할 수 있다. 단, 실제 파일 URL은 signed URL 또는 proxy API를 통해 발급해야 한다.

### Storage RLS

Storage policy는 `avatars` bucket에서 다음 경로를 전제로 한다.

```text
images/{user_id}/{human_mesh_id}/front.{ext}
images/{user_id}/{human_mesh_id}/side.{ext}
images/{user_id}/{human_mesh_id}/angle45.{ext}
models/{user_id}/{human_mesh_id}/mesh.glb
thumbnails/{user_id}/{human_mesh_id}/thumbnail.jpg
```

일반 사용자는 자기 `images/{user_id}/...` 경로에만 직접 업로드할 수 있다. 모델과 썸네일은 서버가 service role로 저장한다.

## 4. 남은 구현 주의사항

| 항목 | 주의사항 |
| --- | --- |
| API field-level authorization | RLS는 row-level만 보장하므로 API에서 수정 가능한 필드를 제한해야 한다. |
| Admin check | 관리자 API는 `profiles.role = 'admin'`을 서버에서 먼저 확인해야 한다. |
| Signed URL | DB 조회 권한과 파일 signed URL 발급 권한을 반드시 함께 확인해야 한다. |
| Service role | 브라우저 번들에 절대 노출하지 않는다. |
| Soft delete | 일반 조회 API는 `status != 'deleted'`와 `soft_deleted_at is null` 조건을 기본 적용한다. |
