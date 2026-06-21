# Hybrid Head Reconstruction 설계

## 1. 결정

MeshSelfie의 기본 생성 방향을 범용 이미지→3D asset 생성에서 얼굴·두상 전용 복원으로 전환한다.

| 영역 | 목표 |
| --- | --- |
| 얼굴·귀·턱·목 | FLAME 계열 parametric head와 detail displacement를 사용한 고정밀 복원 |
| 피부 | 정면·45도·측면 사진을 투영·혼합한 2K~4K UV texture |
| 후두부 | 관측된 silhouette와 FLAME 기본 두상을 결합해 보완 |
| 머리카락 | segmentation 기반 저해상도 hair shell과 texture로 근사 |
| 출력 | 얼굴, 눈, 목, hair shell을 결합한 GLB 2.0 |

TRELLIS는 E2E와 fallback 실험용으로 유지하지만 목표 품질의 기본 Provider로 간주하지 않는다.

## 2. 라이선스 원칙

- DECA 공개 코드와 가중치는 비상업적 연구 용도이므로 상용 기본 Provider에 직접 포함하지 않는다.
- FLAME 2023 Open처럼 상업 사용 조건이 명확한 모델만 사용하고 저작자 표시 등 조건을 준수한다.
- fitting network, landmark detector, segmentation model, texture/albedo model 각각의 라이선스를 별도로 검토한다.
- 외부 managed API를 사용하더라도 기반 모델 라이선스 책임이 사라지지 않는다.

## 3. 입력 정책

| 항목 | 정책 |
| --- | --- |
| 해상도 | 가로·세로 최소 512px hard fail, 1024px 미만 warning, 2048px 이상 권장 |
| 필수 뷰 | 정면 1장 |
| 권장 뷰 | 정면 + 45도 + 측면, 장기적으로 좌·우 45도와 좌·우 측면 분리 |
| 촬영 | 동일 표정, 거리, 조명, 카메라 높이 유지 |
| 구도 | 머리와 목 중심, 팔과 상체 최소화, 단색 배경 권장 |
| 가림 | 머리카락이 귀·턱선·목을 가리지 않도록 정리 |

사진 개수 기반 `B/A/A+`는 입력 정보량 표시로만 사용한다. 실제 품질 판정에는 얼굴 크기, blur, landmark, 가림, silhouette reprojection error를 사용한다.

## 4. Worker 파이프라인

```text
입력 다운로드
→ 얼굴 검출·landmark·segmentation
→ 얼굴 crop/정렬/색상 정규화
→ view별 camera·pose·expression 추정
→ shared identity FLAME multi-view fitting
→ 얼굴 detail displacement 추정
→ multi-view UV texture projection/blending
→ hair mask 기반 low-detail hair shell 생성
→ 얼굴·눈·목·hair 결합
→ normals/tangents/material 생성
→ GLB 검증 및 결과 URL 반환
```

identity/shape parameter는 모든 뷰에서 공유하고 camera, pose, expression, lighting은 뷰별로 분리한다. 정면은 얼굴 identity와 texture, 45도는 광대·코·턱 깊이, 측면은 silhouette와 후두부 깊이에 높은 가중치를 둔다.

## 5. Worker API 계약

`HEAD_RECONSTRUCTION_API_URL`이 설정되면 Next.js Provider Registry는 worker를 Replicate보다 우선 선택한다.

### 생성

`POST /v1/jobs`

```json
{
  "clientJobId": "uuid",
  "userId": "uuid",
  "model": "hybrid-flame-head-v1",
  "input": {
    "images": [
      { "role": "front", "url": "https://..." },
      { "role": "angle45", "direction": "left", "url": "https://..." },
      { "role": "side", "direction": "left", "url": "https://..." }
    ],
    "targetRegion": "head_neck",
    "faceDetail": "high",
    "hairDetail": "low",
    "outputFormat": "glb"
  }
}
```

응답은 `{ "id": "worker-job-id", "status": "queued" }`이다.

### 상태

`GET /v1/jobs/{id}`

완료 응답은 `{ "id": "...", "status": "completed", "output": { "glbUrl": "https://..." } }`이다. 실패 시 `error.code`, `error.message`를 반환한다.

### 취소

`POST /v1/jobs/{id}/cancel`

## 6. 배포 구조

- Next.js는 인증, DB, signed input URL, job 상태와 결과 저장을 담당한다.
- Python GPU worker는 모델 추론과 GLB 생성을 담당한다.
- 긴 작업은 API 프로세스 내부에서 실행하지 않고 queue worker에서 처리한다.
- worker GLB 호스트는 `HEAD_RECONSTRUCTION_OUTPUT_HOSTS` allowlist에 등록한다.
- 원본 사진과 임시 fitting 결과는 작업 완료 후 정해진 retention에 따라 삭제한다.

## 7. 단계별 완료 기준

1. 고해상도 정면 사진에서 textured FLAME head GLB 생성
2. 정면·45도·측면 shared-identity fitting
3. 2K 이상 multi-view UV texture와 seam 보정
4. low-detail hair shell 결합
5. landmark, silhouette, identity similarity 기반 품질 점수 저장
6. 동일 입력으로 기존 TRELLIS 대비 블라인드 품질 비교
