"""worker 환경 변수 설정.

Next.js 앱의 HEAD_RECONSTRUCTION_* 환경 변수와 짝을 이룬다.
- HEAD_RECON_API_KEY        ← 앱의 HEAD_RECONSTRUCTION_API_KEY와 동일한 값이어야 한다.
- HEAD_RECON_PUBLIC_BASE_URL ← 완료된 GLB URL의 기준 주소. 앱의
  HEAD_RECONSTRUCTION_OUTPUT_HOSTS allowlist에 이 host가 포함되어야 한다
  (worker API host 자체는 자동 신뢰된다 — lib/generation/finalize.ts 참고).
"""

import os
from pathlib import Path


class Config:
    api_key: str = os.environ.get("HEAD_RECON_API_KEY", "")
    host: str = os.environ.get("HEAD_RECON_HOST", "0.0.0.0")
    port: int = int(os.environ.get("HEAD_RECON_PORT", "8100"))
    # 비어 있으면 각 요청의 Host/X-Forwarded-Proto 헤더에서 자동 유도한다
    # (Modal 등 배포 URL을 미리 알 수 없는 환경 대응). GLB를 API와 다른
    # host에서 서빙할 때만 명시적으로 설정한다.
    public_base_url: str = os.environ.get("HEAD_RECON_PUBLIC_BASE_URL", "").rstrip("/")
    data_dir: Path = Path(os.environ.get("HEAD_RECON_DATA_DIR", "./data")).resolve()
    max_workers: int = int(os.environ.get("HEAD_RECON_MAX_WORKERS", "1"))
    model_name: str = os.environ.get("HEAD_RECON_MODEL_NAME", "hybrid-flame-head-v1")
    # 입력 이미지 다운로드 제한
    download_timeout_seconds: int = 30
    max_input_bytes: int = 10 * 1024 * 1024
    # MediaPipe FaceLandmarker 모델(.task, Apache-2.0). 없으면 최초 1회 자동 다운로드.
    face_landmarker_path: Path = Path(
        os.environ.get(
            "HEAD_RECON_FACE_LANDMARKER_PATH",
            str(Path(__file__).resolve().parent.parent / "models" / "face_landmarker.task"),
        )
    )
    face_landmarker_url: str = (
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
        "face_landmarker/float16/latest/face_landmarker.task"
    )
    # MediaPipe 멀티클래스 셀피 segmenter (hair/face-skin 등, Apache-2.0). 자동 다운로드.
    selfie_segmenter_path: Path = Path(
        os.environ.get(
            "HEAD_RECON_SELFIE_SEGMENTER_PATH",
            str(
                Path(__file__).resolve().parent.parent
                / "models" / "selfie_multiclass_256x256.tflite"
            ),
        )
    )
    selfie_segmenter_url: str = (
        "https://storage.googleapis.com/mediapipe-models/image_segmenter/"
        "selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite"
    )
    # FLAME 2023 Open 자산 (CC-BY-4.0). 존재하면 fitting 파이프라인을 사용하고,
    # 없으면 Milestone 0 relief 파이프라인으로 폴백한다.
    flame_model_path: Path = Path(
        os.environ.get(
            "HEAD_RECON_FLAME_MODEL_PATH",
            str(Path(__file__).resolve().parent.parent / "models" / "flame" / "flame2023_Open.pkl"),
        )
    )
    flame_embedding_path: Path = Path(
        os.environ.get(
            "HEAD_RECON_FLAME_EMBEDDING_PATH",
            str(
                Path(__file__).resolve().parent.parent
                / "models" / "flame" / "mediapipe_landmark_embedding.npz"
            ),
        )
    )
    flame_masks_path: Path = Path(
        os.environ.get(
            "HEAD_RECON_FLAME_MASKS_PATH",
            str(Path(__file__).resolve().parent.parent / "models" / "flame" / "FLAME_masks.pkl"),
        )
    )


config = Config()
