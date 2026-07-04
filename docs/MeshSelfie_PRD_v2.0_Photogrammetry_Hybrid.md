# MeshSelfie PRD v2.0 (Photogrammetry + AI Hybrid)

## 1. 서비스 개요

MeshSelfie는 **Photogrammetry를 기본 복원 엔진**으로 사용하고, **AI를
후처리 엔진**으로 사용하는 실사형 3D 얼굴 복원 플랫폼이다.

### 핵심 변경

-   AI 중심 생성 → Photogrammetry 중심 복원
-   입력: 10\~20초 동영상 또는 20\~80장 사진(권장 40장)
-   AI는 Mesh 정리, Texture 향상, GLB 최적화 담당

## 2. 생성 파이프라인

``` text
Upload
→ Quality Validation
→ Frame Extraction
→ Camera Calibration
→ Sparse Reconstruction
→ Dense Reconstruction
→ Mesh Generation
→ Texture Baking
→ AI Mesh Cleanup
→ AI Texture Enhancement
→ GLB Optimization
→ Thumbnail
→ Storage
```

## 3. 입력 정책

  항목       내용
  ---------- -------------------------------------------
  동영상     10\~20초
  사진       20\~80장 (권장 40장)
  지원       JPG, PNG, MP4, MOV
  자동검사   Blur, Exposure, Duplicate, Face Detection

## 4. 품질 등급

  입력        등급
  ----------- ------
  15장 이하   B
  20\~40장    A
  40\~80장    S
  80장 이상   S+

## 5. 아키텍처

### Reconstruction

-   COLMAP
-   OpenMVG (선택)
-   OpenMVS
-   AliceVision

### AI Enhancement

-   Mesh Cleanup
-   Texture Enhancement
-   Hole Filling
-   Mesh Optimization

## 6. DB 추가

-   scan_sessions
-   camera_frames
-   reconstruction_jobs

## 7. Storage

``` text
videos/
frames/
sparse/
dense/
meshes/
textures/
glb/
thumbnails/
```

## 8. API

-   POST /api/upload/video
-   POST /api/upload/photos
-   GET /api/scan-status

## 9. UX

-   실시간 촬영 가이드
-   자동 프레임 추출
-   Scan Quality Score
-   진행률 표시
    -   Sparse
    -   Dense
    -   Mesh
    -   Texture
    -   AI
    -   Complete

## 10. 차별점

기존:

    사진 1장 → AI → 3D

MeshSelfie:

    영상/다중사진 → Photogrammetry → AI Enhancement → Photorealistic GLB

## 향후 권장

기존 PRD를 기반으로 약 3,000줄 규모의 PRD v2.0으로 전체 기능, DB, API,
Worker, GPU 아키텍처를 재설계하는 것을 권장한다.
