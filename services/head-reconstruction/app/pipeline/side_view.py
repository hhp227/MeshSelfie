"""90° 측면 사진의 silhouette 활용.

측면 사진은 MediaPipe landmark가 검출되지 않아 fitting에 쓰지 못하지만,
segmentation(hair/face-skin)은 동작한다. 이 모듈은:

1. yaw ±90° 후보로 head 모델을 측면 사진에 정합한다
   (scale/translation을 Nelder-Mead로 최적화, distance transform 기반 손실).
2. 정합된 좌표계에서 높이(y)별로 "후두부 hair가 head 실루엣보다 얼마나 더
   뒤로 나오는지"를 측정해 미터 단위 프로파일로 반환한다.

이 프로파일은 hair shell 뒤 시트 깊이에 반영되어, 정면 실루엣만으로는 알 수
없는 머리카락 볼륨을 측면 사진에서 가져온다.
"""

from dataclasses import dataclass
from typing import Optional

import numpy as np
from PIL import Image
from scipy import ndimage, optimize

from app.pipeline.segmentation import (
    CATEGORY_FACE_SKIN,
    CATEGORY_HAIR,
    segment_masks,
)

MIN_FACE_AREA_RATIO = 0.005
MAX_REGISTRATION_LOSS = 8.0  # px 단위 평균 이탈 거리. 초과 시 정합 실패로 간주
MAX_BACK_EXTRA_M = 0.15
ROW_BUCKET_PX = 6
# 앞머리가 이마를 덮는 것을 감안한 face-skin 가시 비율 (scale 고정용).
# scale을 자유 최적화하면 모델을 축소해 mask 안에 숨기는 퇴화 해가 나온다.
VISIBLE_FACE_RATIO = 0.8


@dataclass
class SideBackProfile:
    """모델 y(미터) → 후두부 hair 추가 두께(미터)."""

    y_values: np.ndarray  # 오름차순
    extra_m: np.ndarray

    def extra_at(self, y: np.ndarray) -> np.ndarray:
        return np.interp(y, self.y_values, self.extra_m, left=0.0, right=0.0)


def analyze_side_view(
    image: Image.Image,
    neutral_like_verts_for_yaw,  # Callable[[float], np.ndarray] — yaw만 바꾼 posed 정점
    face_vertex_indices: Optional[np.ndarray],
) -> Optional[SideBackProfile]:
    """측면 사진을 정합해 후두부 hair 프로파일을 추정한다. 실패 시 None."""
    masks = segment_masks(image, (CATEGORY_HAIR, CATEGORY_FACE_SKIN))
    hair_mask = masks[CATEGORY_HAIR]
    face_mask = masks[CATEGORY_FACE_SKIN]

    if face_mask.mean() < MIN_FACE_AREA_RATIO or not hair_mask.any():
        return None

    head_mask = hair_mask | face_mask
    height, width = head_mask.shape

    # 머리 영역 밖 픽셀의 "머리까지 거리" (정합 손실용)
    outside_distance = ndimage.distance_transform_edt(~head_mask)

    face_rows, face_cols = np.nonzero(face_mask)
    face_centroid = np.array([face_cols.mean(), face_rows.mean()])
    face_height_px = float(face_rows.max() - face_rows.min())

    best: Optional[tuple[float, float, float, np.ndarray, np.ndarray]] = None  # loss, yaw, scale, trans, verts

    for yaw in (np.pi / 2, -np.pi / 2):
        verts = neutral_like_verts_for_yaw(yaw)  # (V, 3) 모델 좌표

        if face_vertex_indices is not None and face_vertex_indices.size > 0:
            face_verts = verts[face_vertex_indices]
        else:
            face_verts = verts

        model_xy = np.stack([verts[:, 0], -verts[:, 1]], axis=1)
        face_xy = np.stack([face_verts[:, 0], -face_verts[:, 1]], axis=1)

        # scale은 얼굴 높이 비로 고정한다 — 자유 최적화 시 축소 퇴화 해 발생
        face_model_height = float(face_xy[:, 1].max() - face_xy[:, 1].min())
        scale = face_height_px / max(face_model_height * VISIBLE_FACE_RATIO, 1e-6)
        trans0 = face_centroid - scale * face_xy.mean(axis=0)

        def loss(params: np.ndarray) -> float:
            tx, ty = params
            projected = model_xy * scale + np.array([tx, ty])
            ix = np.clip(np.round(projected[:, 0]).astype(np.int64), 0, width - 1)
            iy = np.clip(np.round(projected[:, 1]).astype(np.int64), 0, height - 1)
            # 이미지 밖으로 나간 정점은 클램프 거리만큼 추가 페널티
            out_penalty = (
                np.abs(projected[:, 0] - ix).mean() + np.abs(projected[:, 1] - iy).mean()
            )
            containment = outside_distance[iy, ix].mean()
            face_projected = face_xy * scale + np.array([tx, ty])
            face_align = float(
                np.linalg.norm(face_projected.mean(axis=0) - face_centroid)
            )
            return containment + out_penalty + 0.3 * face_align

        result = optimize.minimize(
            loss,
            x0=trans0,
            method="Nelder-Mead",
            options={"maxiter": 200, "xatol": 0.5, "fatol": 0.05},
        )

        if best is None or result.fun < best[0]:
            best = (float(result.fun), yaw, scale, result.x, verts)

    assert best is not None
    final_loss, yaw, scale, trans, verts = best

    if final_loss > MAX_REGISTRATION_LOSS:
        return None

    tx, ty = trans
    projected = np.stack([verts[:, 0], -verts[:, 1]], axis=1) * scale + np.array([tx, ty])

    # 코(얼굴) 방향 판정: face centroid가 head 중심보다 있는 쪽이 앞, 반대가 뒤
    head_center_x = projected[:, 0].mean()
    back_sign = -1.0 if face_centroid[0] > head_center_x else 1.0

    # 높이 버킷별: head 실루엣의 뒤 끝 vs hair mask의 뒤 끝
    y_samples: list[float] = []
    extra_samples: list[float] = []

    for row_start in range(0, height, ROW_BUCKET_PX):
        row_end = min(row_start + ROW_BUCKET_PX, height)
        in_bucket = (projected[:, 1] >= row_start) & (projected[:, 1] < row_end)
        hair_rows = hair_mask[row_start:row_end]

        if not in_bucket.any() or not hair_rows.any():
            continue

        bucket_x = projected[in_bucket, 0] * back_sign
        head_back_px = bucket_x.max()

        hair_cols = np.nonzero(hair_rows.any(axis=0))[0].astype(np.float64) * back_sign
        hair_back_px = hair_cols.max()

        extra_px = max(0.0, hair_back_px - head_back_px)
        row_center = (row_start + row_end) / 2
        y_model = -(row_center - ty) / scale
        y_samples.append(y_model)
        extra_samples.append(min(extra_px / scale, MAX_BACK_EXTRA_M))

    if len(y_samples) < 3:
        return None

    order = np.argsort(y_samples)
    y_values = np.asarray(y_samples, dtype=np.float64)[order]
    extra = np.asarray(extra_samples, dtype=np.float64)[order]
    extra = ndimage.gaussian_filter1d(extra, sigma=2.0)

    return SideBackProfile(y_values=y_values, extra_m=extra)
