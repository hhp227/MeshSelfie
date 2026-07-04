"""Milestone 3: hair mask 기반 low-detail hair shell.

정면 사진의 hair mask를 저해상도 그리드로 삼각화해 앞·뒤 두 장의 시트와
경계 봉합으로 이루어진 얇은 쉘 볼륨을 만든다.

- 깊이: head 메쉬의 정면 z-buffer(near/far)를 마스크 영역 밖까지 최근접
  전파해 사용한다. 앞면은 head 표면 + 오프셋이라 얼굴/두피 geometry를
  침범하지 않고, 머리 밖으로 흘러내린 긴 머리카락도 자연스러운 깊이를 받는다.
- 텍스처: hair bbox로 크롭한 정면 사진. 마스크 밖 픽셀은 머리카락 색으로
  전파해 경계 샘플링에서 피부/배경색이 새지 않게 한다.
"""

from typing import TYPE_CHECKING, Optional

import numpy as np
import trimesh
from PIL import Image
from scipy import ndimage

from app.pipeline.texture_bake import _fill_holes, _rasterize_zbuffer

if TYPE_CHECKING:
    from app.pipeline.side_view import SideBackProfile

HAIR_FRONT_OFFSET = 0.012  # head 표면에서 앞으로 띄우는 거리 (m)
HAIR_BACK_OFFSET = 0.012
HAIR_MIN_THICKNESS = 0.02
TARGET_GRID_CELLS = 88  # 마스크 bbox 장변 기준 셀 수 (low-detail)
MIN_HAIR_AREA_RATIO = 0.005  # 이미지 대비 최소 머리카락 면적
Z_SMOOTH_SIGMA_PX = 6.0  # 깊이맵 스무딩 (측면에서 본 쉘 형상을 둥글게)
MASK_SMOOTH_SIGMA_PX = 4.0  # 마스크 경계 계단 완화
LAPLACIAN_ITERATIONS = 4  # 쉘 정점 스무딩 반복
LAPLACIAN_LAMBDA = 0.5


def build_hair_shell(
    image: Image.Image,
    hair_mask: np.ndarray,
    projected_px: np.ndarray,  # (V, 2) head 정점의 정면 투영 픽셀
    posed_z: np.ndarray,  # (V,) head 정점의 정면 카메라 z
    head_faces: np.ndarray,
    cam_scale: float,
    cam_trans: np.ndarray,  # (2,)
    back_profile: "Optional[SideBackProfile]" = None,
) -> Optional[trimesh.Trimesh]:
    height, width = hair_mask.shape

    if hair_mask.mean() < MIN_HAIR_AREA_RATIO:
        return None

    # 얇은 앞머리 가닥(스파이크)은 이마 위에 떠 있는 리본 지오메트리가 되므로
    # 가로로 넓은 구조 요소의 opening으로 세로 가닥만 제거한다
    # (정사각 구조는 넓은 앞머리 덩어리까지 깎아서 곤란)
    hair_mask = ndimage.binary_opening(hair_mask, structure=np.ones((3, 13)), iterations=2)
    hair_mask = (
        ndimage.gaussian_filter(hair_mask.astype(np.float64), MASK_SMOOTH_SIGMA_PX) > 0.5
    )

    if not hair_mask.any():
        return None

    # --- head 깊이맵 (near/far) + 마스크 전체로 최근접 전파 ---
    z_near = _rasterize_zbuffer(projected_px, posed_z, head_faces, width, height)
    z_far = -_rasterize_zbuffer(projected_px, -posed_z, head_faces, width, height)
    head_cover = np.isfinite(z_near)

    if not head_cover.any():
        return None

    z_near_filled = ndimage.gaussian_filter(
        _nearest_fill(z_near, head_cover), sigma=Z_SMOOTH_SIGMA_PX
    )
    z_far_filled = ndimage.gaussian_filter(
        _nearest_fill(z_far, np.isfinite(z_far)), sigma=Z_SMOOTH_SIGMA_PX
    )

    # --- 저해상도 그리드 노드/셀 구성 ---
    rows_any = np.nonzero(hair_mask.any(axis=1))[0]
    cols_any = np.nonzero(hair_mask.any(axis=0))[0]
    y0, y1 = int(rows_any[0]), int(rows_any[-1])
    x0, x1 = int(cols_any[0]), int(cols_any[-1])
    step = max(2, int(np.ceil(max(x1 - x0, y1 - y0) / TARGET_GRID_CELLS)))

    grid_xs = np.arange(x0, min(x1 + step, width - 1) + 1, step)
    grid_ys = np.arange(y0, min(y1 + step, height - 1) + 1, step)
    num_x = len(grid_xs)
    num_y = len(grid_ys)

    if num_x < 2 or num_y < 2:
        return None

    node_used = np.zeros((num_y, num_x), dtype=bool)
    cells: list[tuple[int, int]] = []

    for row in range(num_y - 1):
        for col in range(num_x - 1):
            cy = min((grid_ys[row] + grid_ys[row + 1]) // 2, height - 1)
            cx = min((grid_xs[col] + grid_xs[col + 1]) // 2, width - 1)
            if hair_mask[cy, cx]:
                cells.append((row, col))
                node_used[row : row + 2, col : col + 2] = True

    if not cells:
        return None

    node_index = np.full((num_y, num_x), -1, dtype=np.int64)
    node_index[node_used] = np.arange(int(node_used.sum()))

    used_rows, used_cols = np.nonzero(node_used)
    node_px = np.stack(
        [grid_xs[used_cols], grid_ys[used_rows]], axis=1
    ).astype(np.float64)

    # --- 노드 깊이와 3D 좌표 (weak-perspective 역투영) ---
    iy = node_px[:, 1].astype(np.int64)
    ix = node_px[:, 0].astype(np.int64)
    plane_x = (node_px[:, 0] - cam_trans[0]) / cam_scale
    plane_y = -(node_px[:, 1] - cam_trans[1]) / cam_scale

    z_front = z_near_filled[iy, ix] + HAIR_FRONT_OFFSET
    z_back = z_far_filled[iy, ix] - HAIR_BACK_OFFSET

    # 측면 사진에서 추정한 높이별 후두부 hair 두께 반영
    if back_profile is not None:
        z_back = z_back - back_profile.extra_at(plane_y)

    z_back = np.minimum(z_back, z_front - HAIR_MIN_THICKNESS)

    front_verts = np.stack([plane_x, plane_y, z_front], axis=1)
    back_verts = np.stack([plane_x, plane_y, z_back], axis=1)

    # --- 셀 → 삼각형 2개 (앞시트), 뒤시트는 winding 반전 ---
    front_faces: list[list[int]] = []
    for row, col in cells:
        tl = node_index[row, col]
        tr = node_index[row, col + 1]
        bl = node_index[row + 1, col]
        br = node_index[row + 1, col + 1]
        # 이미지 y는 아래로 증가 → 언프로젝트 후 +z를 향하는 winding
        front_faces.append([tl, bl, br])
        front_faces.append([tl, br, tr])

    front_faces_np = np.asarray(front_faces, dtype=np.int64)

    # 그리드 계단을 없애는 Laplacian 스무딩 (front/back 동일 토폴로지에 각각 적용)
    front_verts = _laplacian_smooth(front_verts, front_faces_np)
    back_verts = _laplacian_smooth(back_verts, front_faces_np)
    num_nodes = front_verts.shape[0]
    back_faces_np = front_faces_np[:, [0, 2, 1]] + num_nodes

    # --- 텍스처: hair bbox 크롭 + 마스크 밖 픽셀 머리카락색 전파 ---
    # 옆면 quad용 어두운 단색 패치를 하단에 덧붙인다 — 옆면에 시트 UV를 그대로
    # 쓰면 늘어난 줄무늬로 보이기 때문.
    crop = np.asarray(image.convert("RGB"), dtype=np.float64)[y0 : y1 + 1, x0 : x1 + 1]
    crop_mask = hair_mask[y0 : y1 + 1, x0 : x1 + 1]
    crop_filled = _fill_holes(crop, crop_mask)

    dark_color = crop_filled[crop_mask].mean(axis=0) * 0.55 if crop_mask.any() else np.array([40.0, 35.0, 33.0])
    pad_rows = 16
    dark_strip = np.tile(dark_color, (pad_rows, crop_filled.shape[1], 1))
    canvas = np.concatenate([crop_filled, dark_strip], axis=0)
    texture = Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8))

    crop_w = max(x1 - x0, 1)
    canvas_h = crop_filled.shape[0] + pad_rows
    uv_single = np.stack(
        [
            (node_px[:, 0] - x0) / crop_w,
            1.0 - (node_px[:, 1] - y0) / (canvas_h - 1),
        ],
        axis=1,
    )
    uv_all = np.concatenate([uv_single, uv_single], axis=0)
    dark_uv = np.array([0.5, (pad_rows / 2) / (canvas_h - 1)])

    # --- 경계 봉합 (옆면 quad는 어두운 패치 UV를 갖는 전용 정점 사용) ---
    all_verts = np.concatenate([front_verts, back_verts], axis=0)
    side_faces: list[list[int]] = []
    side_verts: list[np.ndarray] = []
    side_uvs: list[np.ndarray] = []

    for a, b in _boundary_edges(front_faces_np):
        base = all_verts.shape[0] + len(side_verts)
        side_verts.extend(
            [front_verts[a], front_verts[b], back_verts[b], back_verts[a]]
        )
        side_uvs.extend([dark_uv] * 4)
        side_faces.append([base, base + 1, base + 2])
        side_faces.append([base, base + 2, base + 3])

    if side_verts:
        all_verts = np.concatenate([all_verts, np.asarray(side_verts)], axis=0)
        uv_all = np.concatenate([uv_all, np.asarray(side_uvs)], axis=0)

    all_faces = np.concatenate(
        [front_faces_np, back_faces_np, np.asarray(side_faces, dtype=np.int64)], axis=0
    )

    material = trimesh.visual.material.PBRMaterial(
        baseColorTexture=texture,
        metallicFactor=0.0,
        roughnessFactor=0.7,
        doubleSided=True,
    )
    visual = trimesh.visual.texture.TextureVisuals(uv=uv_all, material=material)
    return trimesh.Trimesh(vertices=all_verts, faces=all_faces, visual=visual, process=False)


def _boundary_edges(faces: np.ndarray) -> list[tuple[int, int]]:
    """한 삼각형에만 속한 edge(경계선) 목록."""
    edge_count: dict[tuple[int, int], tuple[int, int]] = {}

    for face in faces:
        for a, b in ((face[0], face[1]), (face[1], face[2]), (face[2], face[0])):
            key = (min(a, b), max(a, b))
            if key in edge_count:
                edge_count.pop(key)
            else:
                edge_count[key] = (int(a), int(b))

    return list(edge_count.values())


def _laplacian_smooth(
    vertices: np.ndarray,
    faces: np.ndarray,
    iterations: int = LAPLACIAN_ITERATIONS,
    lam: float = LAPLACIAN_LAMBDA,
) -> np.ndarray:
    """이웃 평균으로 정점을 끌어당기는 단순 Laplacian 스무딩 (sparse 행렬 기반)."""
    from scipy import sparse

    num_verts = vertices.shape[0]
    edges = np.concatenate(
        [faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]], axis=0
    )
    rows = np.concatenate([edges[:, 0], edges[:, 1]])
    cols = np.concatenate([edges[:, 1], edges[:, 0]])
    adjacency = sparse.coo_matrix(
        (np.ones(len(rows)), (rows, cols)), shape=(num_verts, num_verts)
    ).tocsr()
    adjacency.data[:] = 1.0  # 중복 edge 가중 제거
    degree = np.asarray(adjacency.sum(axis=1)).ravel()
    degree[degree == 0] = 1.0

    smoothed = vertices.copy()
    for _ in range(iterations):
        neighbor_mean = adjacency @ smoothed / degree[:, None]
        smoothed = smoothed + lam * (neighbor_mean - smoothed)

    return smoothed


def _nearest_fill(values: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """유효 픽셀의 값을 최근접 이웃으로 전 영역에 전파한다."""
    if valid.all():
        return values

    indices = ndimage.distance_transform_edt(
        ~valid, return_distances=False, return_indices=True
    )
    return values[tuple(indices)]
