"""Milestone 0: MediaPipe 얼굴 landmark 기반 relief 메쉬 생성 (FLAME 미보유 시 폴백).

정면 사진 1장에서 MediaPipe Face Landmarker(478 landmark, Apache-2.0)를 돌려
이미지 평면 Delaunay 삼각화로 얼굴 부조(relief) 메쉬를 만들고,
정면 사진 자체를 UV 텍스처로 입힌다.

FLAME 자산(models/flame/)이 있으면 파이프라인은 flame_fitting을 사용하고
이 모듈은 사용되지 않는다.
"""

from pathlib import Path

import numpy as np
import trimesh
from PIL import Image
from scipy.spatial import Delaunay

from app.jobs import PipelineError
from app.pipeline.landmarks import detect_face_landmarks

# MediaPipe z 값(대략 이미지 폭 기준 스케일)을 부조 깊이로 쓸 때의 증폭 배율.
# 1.0이면 landmark 원래 깊이 그대로라 밋밋해서 약간 과장한다.
DEPTH_SCALE = 1.6


def build_face_relief_mesh(front_image_path: Path) -> trimesh.Trimesh:
    try:
        image = Image.open(front_image_path).convert("RGB")
    except OSError as error:
        raise PipelineError(
            "INPUT_DECODE_FAILED", "정면 이미지를 디코딩할 수 없습니다."
        ) from error

    width, height = image.size
    landmarks = detect_face_landmarks(image)  # (478, 3) normalized

    xs = landmarks[:, 0] * width
    ys = landmarks[:, 1] * height
    zs = landmarks[:, 2] * width  # z는 대략 폭 기준 스케일

    # 이미지 평면(x, y) 기준 Delaunay 삼각화 → 얼굴 영역 부조 메쉬
    triangulation = Delaunay(np.stack([xs, ys], axis=1))
    faces = triangulation.simplices.copy()

    # 3D 정점: 중심 정렬, 최대 치수 기준 정규화, y축 뒤집기(이미지 y는 아래로 증가)
    center_x, center_y = xs.mean(), ys.mean()
    scale = max(xs.max() - xs.min(), ys.max() - ys.min())
    vertices = np.stack(
        [
            (xs - center_x) / scale,
            -(ys - center_y) / scale,
            -zs * DEPTH_SCALE / scale,
        ],
        axis=1,
    )

    # 앞면(+z)을 바라보도록 삼각형 winding 정리
    faces = _orient_faces_front(vertices, faces)

    # UV: 이미지 좌표 → OpenGL 관례(원점 좌하단). trimesh가 GLB 출력 시 변환한다.
    uv = np.stack([xs / width, 1.0 - ys / height], axis=1)

    material = trimesh.visual.material.PBRMaterial(
        baseColorTexture=image,
        metallicFactor=0.0,
        roughnessFactor=0.9,
    )
    visual = trimesh.visual.texture.TextureVisuals(uv=uv, material=material)

    return trimesh.Trimesh(vertices=vertices, faces=faces, visual=visual, process=False)


def _orient_faces_front(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """모든 삼각형의 법선이 +z(카메라 방향)를 향하도록 인덱스 순서를 맞춘다."""
    a = vertices[faces[:, 0]]
    b = vertices[faces[:, 1]]
    c = vertices[faces[:, 2]]
    normal_z = np.cross(b - a, c - a)[:, 2]
    flipped = faces.copy()
    flip_mask = normal_z < 0
    flipped[flip_mask] = flipped[flip_mask][:, [0, 2, 1]]
    return flipped
