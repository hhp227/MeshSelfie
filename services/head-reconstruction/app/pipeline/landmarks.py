"""MediaPipe FaceLandmarker 검출 (relief 메쉬와 FLAME fitting이 공유)."""

from pathlib import Path

import numpy as np
import requests
from PIL import Image

from app.config import config
from app.jobs import PipelineError


def detect_face_landmarks(image: Image.Image) -> np.ndarray:
    """(478, 3) 정규화 landmark 배열을 반환한다. x,y는 [0,1], z는 폭 기준 상대값."""
    try:
        import mediapipe as mp
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision
    except ImportError as error:
        raise PipelineError(
            "DEPENDENCY_MISSING",
            "mediapipe가 설치되지 않았습니다. requirements.txt를 설치해주세요.",
        ) from error

    frame = np.ascontiguousarray(np.asarray(image.convert("RGB")))

    options = vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(
            model_asset_path=str(ensure_landmarker_model())
        ),
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,
    )

    with vision.FaceLandmarker.create_from_options(options) as landmarker:
        result = landmarker.detect(
            mp.Image(image_format=mp.ImageFormat.SRGB, data=frame)
        )

    if not result.face_landmarks:
        raise PipelineError(
            "FACE_NOT_DETECTED",
            "얼굴이 인식되지 않았습니다. 얼굴이 잘 보이는 정면 사진을 업로드해주세요.",
        )

    landmarks = result.face_landmarks[0]
    return np.array([[lm.x, lm.y, lm.z] for lm in landmarks], dtype=np.float64)


def ensure_landmarker_model() -> Path:
    """FaceLandmarker .task 모델을 확보한다(없으면 1회 다운로드 후 캐시)."""
    path = config.face_landmarker_path

    if path.exists():
        return path

    path.parent.mkdir(parents=True, exist_ok=True)

    try:
        response = requests.get(config.face_landmarker_url, timeout=60)
        response.raise_for_status()
    except requests.RequestException as error:
        raise PipelineError(
            "LANDMARKER_MODEL_DOWNLOAD_FAILED",
            "얼굴 landmark 모델을 내려받지 못했습니다. 네트워크를 확인해주세요.",
        ) from error

    # 부분 다운로드가 캐시로 남지 않도록 임시 파일에 쓴 뒤 원자적으로 교체한다.
    temp_path = path.with_suffix(".task.tmp")
    temp_path.write_bytes(response.content)
    temp_path.replace(path)
    return path
