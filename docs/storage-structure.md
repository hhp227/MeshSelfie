# MeshSelfie Supabase Storage 구조

## 1. Bucket

| Bucket | 공개 여부 | 용도 |
| --- | --- | --- |
| `avatars` | private | 원본 이미지, 생성 모델, 썸네일, 관리자 샘플 모델 저장 |

## 2. Object Path

```text
avatars/
├── images/
│   └── {user_id}/
│       └── uploads/
│           └── {upload_group_id}/
│           ├── front.{jpg|jpeg|png}
│           ├── side.{jpg|jpeg|png}
│           └── angle45.{jpg|jpeg|png}
├── models/
│   └── {user_id}/
│       └── {human_mesh_id}/
│           ├── mesh.glb
│           └── admin_uploaded.{glb|gltf}
├── thumbnails/
│   └── {user_id}/
│       └── {human_mesh_id}/
│           ├── thumbnail.jpg
│           └── preview.jpg
└── admin/
    └── sample_models/
        └── {sample_id}/
            ├── mesh.{glb|gltf}
            └── thumbnail.jpg
```

## 3. 업로드 주체

| 경로 | 업로드 주체 | 설명 |
| --- | --- | --- |
| `images/{user_id}/uploads/{upload_group_id}/...` | 서버 API | 생성 전 원본 이미지 업로드 |
| `models/{user_id}/...` | 서버 API | AI 생성 완료 또는 관리자 교체 |
| `thumbnails/{user_id}/...` | 서버 API | thumbnailing 단계 |
| `admin/sample_models/...` | 관리자 API | Gallery 샘플 모델 |

## 4. 접근 방식

| 파일 | 접근 방식 |
| --- | --- |
| 원본 이미지 | 소유자 또는 관리자에게만 signed URL |
| GLB 모델 | 완료된 모델 소유자 또는 관리자에게만 signed URL |
| 썸네일 | Dashboard/Gallery/Admin API에서 signed URL 또는 proxy URL |
| 샘플 모델 | Gallery API에서 노출 대상만 signed URL |

## 5. 삭제 정책

1. 삭제 요청 시 DB row를 soft delete한다.
2. `purge_after = now() + interval '30 days'`를 기록한다.
3. purge job이 관련 object를 삭제한다.
4. 삭제 대상은 원본 이미지, GLB/GLTF, 썸네일, preview render다.
