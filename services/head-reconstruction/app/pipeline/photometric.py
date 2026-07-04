"""Photometric fitting (stage-4) 헬퍼.

DECA류 analysis-by-synthesis를 상업 안전 구성으로 축소 구현한다:

- 래스터화(픽셀→삼각형·barycentric)는 비미분으로 주기 계산하고, 그 사이에서
  정점 위치 → 정점 법선 → SH(2차, 9계수) 조명 → 픽셀 색으로 이어지는 경로가
  미분 가능하다. 실루엣 경계 기울기는 없지만 그건 silhouette 손실이 담당한다.
- albedo는 학습된 texture space(비상업) 대신 per-vertex 자유 변수 + Laplacian
  스무딩으로 둔다. 조명(SH)과 분리되면서 음영 잔차가 geometry(법선)로 흐른다.
- 얼굴 패치(FLAME face 마스크) 삼각형만 저해상도로 렌더해 CPU에서도 동작한다.
"""

from dataclasses import dataclass
from typing import Optional

import numpy as np
import torch
from PIL import Image
from scipy import ndimage, sparse

from app.pipeline.texture_bake import _rasterize_barycentric

TARGET_FACE_DIAG_PX = 220.0  # 다운스케일 후 face bbox 대각선 목표
SH_BASIS_COUNT = 9


@dataclass
class PhotometricView:
    """뷰별 고정 데이터 (다운스케일 좌표계)."""

    photo: torch.Tensor  # (H,W,3) float 0..1
    fit_mask: np.ndarray  # (H,W) bool — face-skin ∩ 이미지
    scale: float  # 원본 px → 다운스케일 px 배율
    width: int
    height: int
    # 래스터 결과 (refresh_raster로 갱신)
    pixel_tri: Optional[torch.Tensor] = None  # (P,) 픽셀별 서브셋 삼각형 idx
    pixel_bary: Optional[torch.Tensor] = None  # (P,3)
    pixel_colors: Optional[torch.Tensor] = None  # (P,3) 사진 색


def build_photometric_view(
    image: Image.Image, face_mask: np.ndarray, face_scale_px: float
) -> PhotometricView:
    scale = min(1.0, TARGET_FACE_DIAG_PX / max(face_scale_px, 1.0))
    width = max(int(image.size[0] * scale), 8)
    height = max(int(image.size[1] * scale), 8)

    photo = np.asarray(
        image.resize((width, height), Image.BILINEAR), dtype=np.float32
    ) / 255.0

    mask_image = Image.fromarray(face_mask.astype(np.uint8) * 255)
    fit_mask = (
        np.asarray(mask_image.resize((width, height), Image.NEAREST)) > 127
    )
    # 경계 픽셀은 배경/머리카락이 섞여 잔차가 오염되므로 살짝 침식
    fit_mask = ndimage.binary_erosion(fit_mask, iterations=2)

    return PhotometricView(
        photo=torch.tensor(photo),
        fit_mask=fit_mask,
        scale=scale,
        width=width,
        height=height,
    )


def refresh_raster(
    view: PhotometricView,
    projected_full_px: np.ndarray,  # (V,2) 원본 좌표계 투영
    subset_faces: np.ndarray,  # (F,3) 서브셋 정점 인덱스 기준
    subset_vertex_ids: np.ndarray,  # (Vs,) 원본 정점 인덱스
) -> None:
    """현재 자세 기준으로 픽셀→삼각형 할당을 다시 계산한다 (비미분)."""
    points = projected_full_px[subset_vertex_ids] * view.scale
    tri_map, bary_map = _rasterize_barycentric(
        points, subset_faces, view.width, view.height
    )

    covered = (tri_map >= 0) & view.fit_mask
    rows, cols = np.nonzero(covered)

    view.pixel_tri = torch.from_numpy(tri_map[rows, cols])
    view.pixel_bary = torch.tensor(bary_map[rows, cols], dtype=torch.float32)
    view.pixel_colors = view.photo[rows, cols]


def vertex_normals(verts: torch.Tensor, faces: torch.Tensor) -> torch.Tensor:
    """(Vs,3) 미분 가능 정점 법선 (face normal의 면적 가중 합)."""
    corners = verts[faces]  # (F,3,3)
    face_normals = torch.cross(
        corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0], dim=1
    )
    normals = torch.zeros_like(verts)
    normals = normals.index_add(0, faces[:, 0], face_normals)
    normals = normals.index_add(0, faces[:, 1], face_normals)
    normals = normals.index_add(0, faces[:, 2], face_normals)
    return torch.nn.functional.normalize(normals, dim=1, eps=1e-8)


def sh_basis(normals: torch.Tensor) -> torch.Tensor:
    """(N,3) 법선 → (N,9) 실수 SH 기저 (상수는 학습되는 계수에 흡수)."""
    x, y, z = normals[:, 0], normals[:, 1], normals[:, 2]
    return torch.stack(
        [
            torch.ones_like(x),
            y,
            z,
            x,
            x * y,
            y * z,
            3.0 * z * z - 1.0,
            x * z,
            x * x - y * y,
        ],
        dim=1,
    )


def render_pixels(
    view: PhotometricView,
    subset_verts: torch.Tensor,  # (Vs,3) 뷰 포즈 공간
    subset_faces: torch.Tensor,  # (F,3)
    albedo: torch.Tensor,  # (Vs,3)
    sh_coeffs: torch.Tensor,  # (9,3)
) -> tuple[torch.Tensor, torch.Tensor]:
    """마스크 픽셀의 (렌더 색, 사진 색)을 반환한다. 래스터 할당은 고정."""
    assert view.pixel_tri is not None

    normals = vertex_normals(subset_verts, subset_faces)
    tri = subset_faces[view.pixel_tri]  # (P,3)
    bary = view.pixel_bary  # (P,3)

    pixel_normal = torch.nn.functional.normalize(
        torch.einsum("pcd,pc->pd", normals[tri], bary), dim=1, eps=1e-8
    )
    pixel_albedo = torch.einsum("pcd,pc->pd", albedo[tri], bary)
    irradiance = sh_basis(pixel_normal) @ sh_coeffs  # (P,3)

    return pixel_albedo * irradiance, view.pixel_colors


def albedo_laplacian(subset_faces: np.ndarray, num_verts: int) -> torch.Tensor:
    """albedo 스무딩용 (Vs,Vs) sparse 이웃 평균 행렬 → dense는 작아서 허용."""
    edges = np.concatenate(
        [subset_faces[:, [0, 1]], subset_faces[:, [1, 2]], subset_faces[:, [2, 0]]],
        axis=0,
    )
    rows = np.concatenate([edges[:, 0], edges[:, 1]])
    cols = np.concatenate([edges[:, 1], edges[:, 0]])
    adjacency = sparse.coo_matrix(
        (np.ones(len(rows)), (rows, cols)), shape=(num_verts, num_verts)
    ).tocsr()
    adjacency.data[:] = 1.0
    degree = np.asarray(adjacency.sum(axis=1)).ravel()
    degree[degree == 0] = 1.0
    mean_matrix = sparse.diags(1.0 / degree) @ adjacency

    coo = mean_matrix.tocoo()
    indices = torch.tensor(np.stack([coo.row, coo.col]), dtype=torch.long)
    values = torch.tensor(coo.data, dtype=torch.float32)
    return torch.sparse_coo_tensor(indices, values, (num_verts, num_verts)).coalesce()


def init_albedo_and_sh(
    view: PhotometricView,
    subset_verts: torch.Tensor,
    subset_faces: torch.Tensor,
    projected_subset_px: np.ndarray,  # (Vs,2) 원본 좌표계
) -> tuple[torch.Tensor, torch.Tensor]:
    """정면 사진에서 albedo를 샘플하고 SH는 무지향(ambient=1)로 초기화한다."""
    points = projected_subset_px * view.scale
    x = np.clip(points[:, 0], 0, view.width - 1)
    y = np.clip(points[:, 1], 0, view.height - 1)
    photo = view.photo.numpy()
    albedo0 = photo[y.astype(np.int64), x.astype(np.int64)].astype(np.float32)

    sh0 = torch.zeros(SH_BASIS_COUNT, 3)
    sh0[0] = 1.0  # ambient — albedo가 사진색이므로 항등 렌더에서 시작
    return torch.tensor(albedo0), sh0
