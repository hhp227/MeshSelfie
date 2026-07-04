"""MediaPipe 멀티클래스 셀피 segmentation — hair mask 추출.

selfie_multiclass_256x256(Apache-2.0) 카테고리:
0 배경, 1 머리카락, 2 몸 피부, 3 얼굴 피부, 4 옷, 5 기타(액세서리)
"""

from pathlib import Path

import numpy as np
import requests
from PIL import Image
from scipy import ndimage

from app.config import config
from app.jobs import PipelineError

CATEGORY_HAIR = 1
CATEGORY_BODY_SKIN = 2
CATEGORY_FACE_SKIN = 3
CONFIDENCE_THRESHOLD = 0.5
# 가장 큰 머리카락 영역 대비 이 비율보다 작은 조각은 노이즈로 제거한다
MIN_COMPONENT_RATIO = 0.02


def segment_masks(image: Image.Image, categories: tuple[int, ...]) -> dict[int, np.ndarray]:
    """카테고리별 (H, W) bool 마스크를 반환한다 (0.5 신뢰도 임계)."""
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

    options = vision.ImageSegmenterOptions(
        base_options=mp_python.BaseOptions(
            model_asset_path=str(_ensure_segmenter_model())
        ),
        running_mode=vision.RunningMode.IMAGE,
        output_confidence_masks=True,
        output_category_mask=False,
    )

    with vision.ImageSegmenter.create_from_options(options) as segmenter:
        result = segmenter.segment(
            mp.Image(image_format=mp.ImageFormat.SRGB, data=frame)
        )

    masks: dict[int, np.ndarray] = {}
    for category in categories:
        confidence = np.asarray(result.confidence_masks[category].numpy_view())
        mask = confidence.squeeze() >= CONFIDENCE_THRESHOLD

        if mask.shape != frame.shape[:2]:
            mask_image = Image.fromarray(mask.astype(np.uint8) * 255)
            mask_image = mask_image.resize(
                (frame.shape[1], frame.shape[0]), Image.NEAREST
            )
            mask = np.asarray(mask_image) > 127

        masks[category] = mask

    return masks


def detect_hair_mask(image: Image.Image) -> np.ndarray:
    """(H, W) bool 머리카락 마스크. 머리카락이 없으면 전부 False일 수 있다."""
    mask = segment_masks(image, (CATEGORY_HAIR,))[CATEGORY_HAIR]
    return _clean_mask(mask)


def _clean_mask(mask: np.ndarray) -> np.ndarray:
    """구멍 메움 + 작은 노이즈 조각 제거."""
    if not mask.any():
        return mask

    closed = ndimage.binary_closing(mask, structure=np.ones((5, 5)))
    filled = ndimage.binary_fill_holes(closed)
    labels, count = ndimage.label(filled)

    if count <= 1:
        return filled

    sizes = ndimage.sum(filled, labels, range(1, count + 1))
    keep = np.nonzero(sizes >= sizes.max() * MIN_COMPONENT_RATIO)[0] + 1
    return np.isin(labels, keep)


def _ensure_segmenter_model() -> Path:
    path = config.selfie_segmenter_path

    if path.exists():
        return path

    path.parent.mkdir(parents=True, exist_ok=True)

    try:
        response = requests.get(config.selfie_segmenter_url, timeout=120)
        response.raise_for_status()
    except requests.RequestException as error:
        raise PipelineError(
            "SEGMENTER_MODEL_DOWNLOAD_FAILED",
            "머리카락 segmentation 모델을 내려받지 못했습니다. 네트워크를 확인해주세요.",
        ) from error

    temp_path = path.with_suffix(".tflite.tmp")
    temp_path.write_bytes(response.content)
    temp_path.replace(path)
    return path
