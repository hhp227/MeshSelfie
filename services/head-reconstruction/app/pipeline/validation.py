"""이미지 품질 검증 메트릭 (PRD 2.4 부분 구현).

worker는 원시 메트릭(얼굴 수, bbox, 크기 비율, 블러 점수)만 계산하고,
역할(front/side/angle45)별 통과·경고·실패 정책과 한국어 메시지는
앱(Next.js) 쪽에서 결정한다.

- 얼굴 검출: MediaPipe FaceLandmarker(num_faces=5). 90° 측면은 검출되지
  않는 경우가 많으므로 얼굴 0개를 여기서 실패로 취급하지 않는다.
- 블러: 512px 리사이즈 그레이스케일의 Laplacian 분산. 값이 클수록 선명.
"""

import numpy as np
from PIL import Image
from scipy import ndimage

from app.jobs import PipelineError
from app.pipeline.landmarks import ensure_landmarker_model

MAX_DETECT_FACES = 5
BLUR_RESIZE_MAX = 512


def validate_image(image: Image.Image) -> dict:
    faces = _detect_faces(image)
    blur_score = _blur_score(image)

    primary = faces[0] if faces else None

    return {
        "faceCount": len(faces),
        "faceBbox": primary,  # {xMin,yMin,xMax,yMax} 상대좌표(0~1) 또는 None
        "faceHeightRatio": (primary["yMax"] - primary["yMin"]) if primary else None,
        "blurScore": blur_score,
    }


def _detect_faces(image: Image.Image) -> list[dict]:
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
        num_faces=MAX_DETECT_FACES,
    )

    with vision.FaceLandmarker.create_from_options(options) as landmarker:
        result = landmarker.detect(
            mp.Image(image_format=mp.ImageFormat.SRGB, data=frame)
        )

    faces = []
    for landmarks in result.face_landmarks:
        xs = [lm.x for lm in landmarks]
        ys = [lm.y for lm in landmarks]
        faces.append(
            {
                "xMin": float(min(xs)),
                "yMin": float(min(ys)),
                "xMax": float(max(xs)),
                "yMax": float(max(ys)),
            }
        )

    # 큰 얼굴(주 인물)을 앞에 둔다
    faces.sort(key=lambda f: (f["xMax"] - f["xMin"]) * (f["yMax"] - f["yMin"]), reverse=True)
    return faces


def _blur_score(image: Image.Image) -> float:
    gray = image.convert("L")
    width, height = gray.size
    scale = BLUR_RESIZE_MAX / max(width, height)

    if scale < 1.0:
        gray = gray.resize((max(int(width * scale), 1), max(int(height * scale), 1)))

    values = np.asarray(gray, dtype=np.float64)
    laplacian = ndimage.laplace(values)
    return float(laplacian.var())
