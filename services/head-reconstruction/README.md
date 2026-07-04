# Head Reconstruction Worker

> **PRD v2.0 피벗 진행 중**: Photogrammetry(COLMAP) 중심 복원으로 전환한다
> (`docs/MeshSelfie_PRD_v2.0_Photogrammetry_Hybrid.md`). 아래 FLAME 파이프라인은
> 보존되며, 새 Scan Worker는 `modal_scan_app.py`/`app/scan_main.py` 참고.

## Scan Worker (v2.0, Photogrammetry)

- 입력: 동영상(10~20초, MP4/MOV) URL 또는 사진 20~80장 URL 목록
- 파이프라인: ffmpeg 프레임 추출(4fps, ≤72장) → COLMAP automatic_reconstructor
  (sparse + CUDA dense + Poisson) → 최대 컴포넌트 → 20만 면 간소화(정점색 보존)
  → vertex-color GLB
- 배포: `modal deploy modal_scan_app.py` (T4 GPU, colmap/colmap 이미지 기반)
- 스모크: `modal run modal_scan_app.py` (colmap/ffmpeg/GPU 확인)
- API: FLAME worker와 동일한 `/v1/jobs` 상태 모델, 입력만
  `{videoUrl | imageUrls[]}`

### 촬영 가이드 (품질의 90%는 캡처가 결정)

| 항목 | 권장 |
| --- | --- |
| 길이/해상도 | 10~20초, 1080p 이상 |
| 궤도 | 카메라가 얼굴 높이에서 좌→우(또는 반대)로 천천히 180°+ 반원 이동 |
| 피사체 | 완전 정지 — 표정 고정, 시선 한 곳 고정 (움직이면 재구성이 뭉개짐) |
| 조명 | 균일한 확산광(창가/실내등). 강한 그림자·역광 금지 |
| 구도 | 머리·목이 화면의 50% 이상 |
| 머리카락 | 가능하면 묶거나 정리 (photogrammetry의 최대 난제) |


MeshSelfie의 `self_hosted` Provider가 호출하는 Python worker. 설계 문서는
`docs/hybrid-head-reconstruction.md`, API 계약을 소비하는 어댑터는
`lib/ai/providers/head-reconstruction.ts`다.

## Milestone 로드맵

| 단계 | 내용 | GPU | 상태 |
| --- | --- | --- | --- |
| 0 | 정면 사진 → MediaPipe landmark → relief 메쉬. FLAME 자산이 없을 때의 폴백 | 불필요 (CPU) | 구현됨 (폴백) |
| 1 | 정면 landmark 기반 FLAME 2023 fitting | 불필요 (CPU) | 구현됨 (M2에 흡수) |
| 2 | multi-view shared-identity fitting + UV 아틀라스 multi-view 텍스처 베이크 | 불필요 (CPU) | 구현됨 |
| **3** | segmentation 기반 low-detail hair shell 결합 | 불필요 (CPU 총 ~45초) | **구현됨 (현재 기본)** |

### Milestone 3 hair shell 개요

- **segmentation**: MediaPipe selfie multiclass segmenter(Apache-2.0, 자동 다운로드)로
  정면 사진의 hair mask 추출. 구멍 메움·노이즈 조각 제거 후 사용.
- **지오메트리**: hair mask를 저해상도 그리드(~56셀)로 삼각화한 앞·뒤 시트 + 경계
  봉합 쉘. 깊이는 head 메쉬 정면 z-buffer(near/far)를 마스크 영역 밖까지 최근접
  전파해 부여 — 앞면은 head 표면 +12mm라 얼굴·두피를 침범하지 않고, 어깨 아래로
  흘러내린 긴 머리카락도 자연스러운 깊이를 받는다.
- **텍스처**: hair bbox 크롭 사진(마스크 밖 픽셀은 머리카락색 전파). 별도 material
  (doubleSided)로 GLB에 `head`/`hair` 두 지오메트리로 export.
- **두피 처리**: 사진에서 관측이 약한 두피 삼각형(FLAME_masks `scalp`)의 텍셀을
  머리카락 평균색으로 틴트해 "대머리" 느낌을 제거.
- **90° 측면 사진 활용** (`side_view.py`): landmark가 검출되지 않는 완전 측면
  사진도 segmentation은 동작하므로, face-skin 높이로 scale을 고정한 뒤
  위치(tx/ty)만 distance-transform 손실로 정합해(yaw ±90° 중 손실이 낮은 쪽 채택)
  높이별 "후두부 hair가 head 실루엣보다 더 나오는 두께"를 측정한다. 이 프로파일이
  hair shell 뒤 시트 깊이에 반영되어 측면·후면 볼륨이 생긴다. 정합 실패 시(손실
  임계 초과) 조용히 무시하고 기본 오프셋만 사용한다.
  주의: scale을 자유 최적화하면 모델을 축소해 mask 안에 숨기는 퇴화 해가 나온다
  — 반드시 고정할 것.
- **한계**: 쉘 형상은 여전히 low-detail 근사이며, 머리카락이 없는 사용자는 shell
  없이 head만 출력된다.

`models/flame/`에 FLAME 자산이 있으면 Milestone 2 파이프라인이 기본으로 동작하고,
없으면 Milestone 0 relief 메쉬로 폴백한다.

### Milestone 2 파이프라인 개요

- **입력**: front 필수, angle45/side 선택. 뷰별로 MediaPipe 105 landmark를 추출하며,
  검출 실패한 뷰는 자동 제외한다. **완전 측면(90°)은 MediaPipe가 대부분 검출하지
  못하므로** 실질적으로 front+angle45 조합이 fitting에 쓰인다.
- **fitting**: shape(300)·expression(100)·jaw·neck은 뷰 간 공유, global rotation과
  weak-perspective 카메라는 뷰별 최적화. 비정면 뷰는 yaw 다중 시작(0°, ±45°, ±82°)
  후 최적 초기값 채택. 뷰별 1단계 정렬 → 전체 joint 2단계 Adam.
- **텍스처**: xatlas(MIT)로 UV 아틀라스 언랩 → 텍셀별로 각 뷰에 투영해
  z-buffer 자기가림 검사 + 법선·시선 각도 가중으로 블렌딩(1024²) → 미관측 텍셀은
  이웃 색 전파로 채움(차트 gutter 겸용).
- **출력**: global rotation 제거한 정면 향 GLB (아틀라스 seam 분할로 ~6,700 정점 /
  9,976 삼각형, ~900KB).
- **한계**: 머리카락 volume 없음(두피는 피부색으로 채워짐 → M3 hair shell에서 해결),
  후두부 geometry는 FLAME 사전 분포 의존, 90° 측면 사진은 텍스처에 활용되지 못함
  (M3에서 silhouette 기반 활용 검토).

## 로컬 실행

WSL/Ubuntu 기준. venv 도구가 없으면(sudo 불가 환경 포함) `uv`를 사용한다:

```bash
# 방법 A: uv (sudo 불필요, 권장)
curl -LsSf https://astral.sh/uv/install.sh | sh
uv venv ~/.venvs/meshselfie-hr --python 3.12
VIRTUAL_ENV=~/.venvs/meshselfie-hr uv pip install -r services/head-reconstruction/requirements.txt
source ~/.venvs/meshselfie-hr/bin/activate

# 방법 B: 표준 venv (sudo apt install python3.12-venv 필요)
cd services/head-reconstruction
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

첫 실행 시 MediaPipe FaceLandmarker 모델(`face_landmarker.task`, Apache-2.0, 약 3.7MB)을
`models/`에 자동 다운로드한다. 오프라인 환경은 `HEAD_RECON_FACE_LANDMARKER_PATH`로
미리 받아둔 파일 경로를 지정한다.

파이프라인 검증·서버 실행:

```bash
cd services/head-reconstruction

# 1) API 서버 없이 파이프라인만 검증
python scripts/run_local.py --front ../../image/front.jpg --out ./out/mesh.glb

# 2) API 서버 실행
export HEAD_RECON_API_KEY=dev-local-key
uvicorn app.main:app --host 0.0.0.0 --port 8100
```

Next.js 앱 연결 (`.env.local`):

```env
HEAD_RECONSTRUCTION_API_URL=http://127.0.0.1:8100
HEAD_RECONSTRUCTION_API_KEY=dev-local-key
HEAD_RECONSTRUCTION_MODEL_NAME=hybrid-flame-head-v1
# 로컬 http://127.0.0.1은 finalize의 allowlist에서 개발용으로 자동 허용된다.
HEAD_RECONSTRUCTION_OUTPUT_HOSTS=
```

이 값이 설정되면 Provider Registry가 Replicate보다 worker를 우선 선택한다.
dev 서버 재시작 후 업로드→생성을 실행하면 worker가 호출된다.

## 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `HEAD_RECON_API_KEY` | (없음, 필수) | 앱의 `HEAD_RECONSTRUCTION_API_KEY`와 동일해야 함 |
| `HEAD_RECON_PORT` | `8100` | 리스닝 포트 |
| `HEAD_RECON_PUBLIC_BASE_URL` | `http://127.0.0.1:8100` | 완료 GLB URL 기준 주소. 배포 시 공개 HTTPS 주소로 설정 |
| `HEAD_RECON_DATA_DIR` | `./data` | job별 작업 파일 저장 경로 |
| `HEAD_RECON_MAX_WORKERS` | `1` | 동시 처리 job 수 |

## API 계약

`docs/hybrid-head-reconstruction.md` 5절과 동일. `/v1/*`는 `Authorization: Bearer` 필수.

- `POST /v1/jobs` → `{ "id", "status": "queued" }`
- `GET /v1/jobs/{id}` → 완료 시 `{ "output": { "glbUrl": "..." } }`, 실패 시 `{ "error": { "code", "message" } }`
- `POST /v1/jobs/{id}/cancel`
- `GET /files/{id}/mesh.glb` — 무인증(랜덤 job id가 capability), 앱 finalize가 다운로드
- `GET /healthz`

## MVP 제약

- job 상태는 인메모리: 프로세스 재시작 시 진행 중 job이 유실된다(앱 폴링이 404 → 실패 처리).
- `/files/*`는 무인증이므로 결과 GLB URL을 알면 누구나 다운로드 가능. MVP 이후
  서명 URL 또는 만료 정책을 추가한다.
- 원본/중간 파일은 `data/{job_id}/`에 남는다. retention 삭제 작업은 미구현.

## FLAME 자산 (새 환경 세팅 시)

`models/flame/`에 아래 3개 파일이 필요하다. <https://flame.is.tue.mpg.de>에서
무료 계정 생성 후 다운로드한다:

| 파일 | 출처 항목 |
| --- | --- |
| `flame2023_Open.pkl` | FLAME 2023 Open (for commercial use, CC-BY-4.0) |
| `mediapipe_landmark_embedding.npz` | FLAME Mediapipe Landmark Embedding |
| `FLAME_masks.pkl` | FLAME Vertex Masks |

주의:

- **CC-BY-4.0 저작자 표시 의무**: 서비스에 FLAME(MPI-IS) 출처를 표기해야 한다
  (랜딩 푸터에 표기함).
- **금지**: "FLAME texture space"는 non-commercial only. DECA/EMOCA/MICA 등
  비상업 라이선스 가중치도 사용하지 않는다(`docs/hybrid-head-reconstruction.md` 2절).
- CPU로도 동작하므로 GPU는 M2 이후 처리 시간 단축이 필요할 때 도입하면 된다.

## 배포 옵션과 예상 비용

Milestone 0은 CPU라 아무 컨테이너 호스트(Fly.io, Cloud Run, 저가 VPS)에서 돌지만,
Milestone 1부터 GPU가 필요하다. 특정 플랫폼 SDK에 종속되지 않도록 표준
Docker 이미지를 유지한다.

| 옵션 | 형태 | 예상 비용 | 비고 |
| --- | --- | --- | --- |
| **Modal (현재 배포됨)** | 서버리스 CPU 8코어 | CPU 초당 과금 → job(~1분)당 ~$0.01 수준, 월 무료 크레딧 | 콜드스타트 ~10초 |
| RunPod Serverless | 서버리스 GPU (Docker) | 초 단위 과금, T4/A4000 job당 ~$0.02–0.08 | GPU 필요해질 때 대안 |
| GPU VM 상시 운영 | Lambda/Vast/클라우드 | 월 $100~300+ | MVP 단계에는 과함 |

### Modal 배포 (운영 중)

`modal_app.py`로 배포한다. 파이프라인이 CPU 전용이라 GPU 없이 cpu=8로 실행.

```bash
# 최초 1회: 토큰 등록 + API 키 secret 생성
modal token set --token-id ak-... --token-secret as-...
modal secret create meshselfie-head-recon HEAD_RECON_API_KEY=<강한 랜덤 키>

# 배포/재배포 (코드·이미지 변경 시)
cd services/head-reconstruction
modal deploy modal_app.py
```

배포 URL: `https://hhp0227--meshselfie-head-recon-api.modal.run`

앱 연결(`.env.local`) — 이 값이 설정돼 있으면 로컬 worker 대신 Modal이 사용된다:

```env
HEAD_RECONSTRUCTION_API_URL=https://hhp0227--meshselfie-head-recon-api.modal.run
HEAD_RECONSTRUCTION_API_KEY=<modal secret과 동일한 키>
```

로컬 worker로 되돌리려면 URL을 `http://127.0.0.1:8100`, 키를 로컬 실행 시 키로 변경.

운영 메모:

- 이미지 apt에 `libegl1`, `libgles2` 필수 — 없으면 mediapipe가
  `libGLESv2.so.2` 오류로 실패한다(첫 배포에서 실측).
- `max_containers=1` + `scaledown_window=300`: 인메모리 job 저장소 제약 대응.
  유휴 5분 후 컨테이너 회수 시 진행 중 job은 유실된다(앱이 실패 처리).
- 공개 URL은 요청 Host 헤더에서 자동 유도되므로 별도 설정 불필요.

참고: 현재 Replicate TRELLIS/Hunyuan3D는 job당 ~$0.1 수준이므로, 자체 worker는
품질뿐 아니라 비용에서도 이점이 생길 수 있다.

배포 후 앱 `.env.local`:

```env
HEAD_RECONSTRUCTION_API_URL=https://<worker-host>
HEAD_RECONSTRUCTION_API_KEY=<강한 랜덤 키>
HEAD_RECONSTRUCTION_OUTPUT_HOSTS=<GLB를 서빙하는 host가 API host와 다를 경우만>
```
