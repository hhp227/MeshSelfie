"""Milestone 2: UV 아틀라스 생성과 multi-view 텍스처 베이크.

- xatlas(MIT)로 FLAME 메쉬를 UV 차트로 언랩한다(정점이 seam에서 분할됨).
- 각 텍셀을 소유 삼각형의 barycentric으로 보간해 뷰별 사진에 투영하고,
  z-buffer 가시성(자기 가림: 코가 뺨을 가리는 경우 등)과 법선-시선 각도
  가중치로 뷰들을 블렌딩한다. weak-perspective에서는 투영이 선형이라
  "3D 보간 후 투영"과 "투영 후 보간"이 동일하므로 후자를 사용한다.
- 어떤 뷰에서도 보이지 않는 텍셀(후두부 등)은 이웃 색 전파로 채운다.
  이 전파가 차트 가장자리 gutter 역할도 겸해 mipmap seam을 줄인다.
"""

from dataclasses import dataclass

import numpy as np
from PIL import Image

from app.jobs import PipelineError

TEX_SIZE = 1024
ZBUFFER_EPS = 0.006  # 모델 단위(m). 자기 가림 판정 여유
HOLE_FILL_ITERS = 64


@dataclass
class UVAtlas:
    vmapping: np.ndarray  # (Vn,) 원본 정점 인덱스
    faces: np.ndarray  # (F, 3) 아틀라스 정점 기준
    uvs: np.ndarray  # (Vn, 2) [0,1], OpenGL 관례(v 위쪽)


def generate_uv_atlas(vertices: np.ndarray, faces: np.ndarray) -> UVAtlas:
    try:
        import xatlas
    except ImportError as error:
        raise PipelineError(
            "DEPENDENCY_MISSING",
            "xatlas가 설치되지 않았습니다. requirements.txt를 설치해주세요.",
        ) from error

    vmapping, new_faces, uvs = xatlas.parametrize(
        np.ascontiguousarray(vertices, dtype=np.float32),
        np.ascontiguousarray(faces, dtype=np.uint32),
    )
    return UVAtlas(
        vmapping=vmapping.astype(np.int64),
        faces=new_faces.astype(np.int64),
        uvs=np.asarray(uvs, dtype=np.float64),
    )


def bake_multiview_texture(
    atlas: UVAtlas,
    orig_faces: np.ndarray,
    views: list[dict],
    tex_size: int = TEX_SIZE,
    override_face_mask: np.ndarray | None = None,
    override_color: np.ndarray | None = None,
) -> Image.Image:
    """뷰 리스트를 블렌딩한 (tex_size, tex_size) RGB 텍스처를 만든다.

    views 원소: {role, image(H,W,3 float32), width, height,
                 posed_verts(V,3), projected_px(V,2)}

    override_face_mask(F,)가 주어지면 해당 삼각형의 관측이 약한 텍셀을
    override_color(3,)로 덮는다 — 사진에서 거의 보이지 않는 두피를 피부색
    전파 대신 머리카락 평균색으로 칠하는 용도.
    """
    # 1) UV 공간 래스터라이즈: 텍셀 → (삼각형, barycentric)
    uv_px = np.stack(
        [
            atlas.uvs[:, 0] * (tex_size - 1),
            (1.0 - atlas.uvs[:, 1]) * (tex_size - 1),  # 행 0 = v=1(위)
        ],
        axis=1,
    )
    tri_map, bary_map = _rasterize_barycentric(uv_px, atlas.faces, tex_size, tex_size)
    texel_mask = tri_map >= 0
    texel_tri = tri_map[texel_mask]  # (T,)
    texel_bary = bary_map[texel_mask]  # (T, 3)

    accum_color = np.zeros((texel_tri.shape[0], 3), dtype=np.float64)
    accum_weight = np.zeros(texel_tri.shape[0], dtype=np.float64)

    for view in views:
        posed_atlas = view["posed_verts"][atlas.vmapping]  # (Vn, 3)
        px_atlas = view["projected_px"][atlas.vmapping]  # (Vn, 2)

        # 텍셀별 투영 좌표/깊이 (barycentric 보간)
        corners_px = px_atlas[atlas.faces[texel_tri]]  # (T, 3, 2)
        texel_px = np.einsum("tck,tc->tk", corners_px, texel_bary)
        corners_z = posed_atlas[atlas.faces[texel_tri], 2]  # (T, 3)
        texel_z = np.einsum("tc,tc->t", corners_z, texel_bary)

        # 삼각형 법선의 카메라 방향(+z) 성분 → 시선 각도 가중치
        tri_verts = posed_atlas[atlas.faces]  # (F, 3, 3)
        normals = np.cross(
            tri_verts[:, 1] - tri_verts[:, 0], tri_verts[:, 2] - tri_verts[:, 0]
        )
        lengths = np.linalg.norm(normals, axis=1)
        lengths[lengths == 0] = 1.0
        normal_z = normals[:, 2] / lengths  # (F,)
        texel_facing = np.clip(normal_z[texel_tri], 0.0, None) ** 2

        # z-buffer 가시성 (사진 해상도 기준)
        zbuffer = _rasterize_zbuffer(
            px_atlas, posed_atlas[:, 2], atlas.faces, view["width"], view["height"]
        )
        ix = np.clip(np.round(texel_px[:, 0]).astype(np.int64), 0, view["width"] - 1)
        iy = np.clip(np.round(texel_px[:, 1]).astype(np.int64), 0, view["height"] - 1)
        visible = texel_z >= zbuffer[iy, ix] - ZBUFFER_EPS

        inside = (
            (texel_px[:, 0] >= 0)
            & (texel_px[:, 0] <= view["width"] - 1)
            & (texel_px[:, 1] >= 0)
            & (texel_px[:, 1] <= view["height"] - 1)
        )

        weight = texel_facing * visible.astype(np.float64) * inside.astype(np.float64)
        color = _sample_bilinear(view["image"], texel_px)

        accum_color += color * weight[:, None]
        accum_weight += weight

    # 2) 블렌딩 결과를 텍스처로 전개
    texture = np.zeros((tex_size, tex_size, 3), dtype=np.float64)
    filled = np.zeros((tex_size, tex_size), dtype=bool)

    covered = accum_weight > 1e-6
    texel_rows, texel_cols = np.nonzero(texel_mask)
    texture[texel_rows[covered], texel_cols[covered]] = (
        accum_color[covered] / accum_weight[covered, None]
    )
    filled[texel_rows[covered], texel_cols[covered]] = True

    # 2.5) 관측이 약한 override 영역(두피 등)을 지정 색으로 덮음
    if override_face_mask is not None and override_color is not None:
        weak = override_face_mask[texel_tri] & (accum_weight < 0.3)
        texture[texel_rows[weak], texel_cols[weak]] = override_color
        filled[texel_rows[weak], texel_cols[weak]] = True

    # 3) 미관측 텍셀(후두부 등) + 차트 바깥 gutter를 이웃 전파로 채움
    texture = _fill_holes(texture, filled)

    return Image.fromarray(np.clip(texture, 0, 255).astype(np.uint8))


def _rasterize_barycentric(
    points_px: np.ndarray, faces: np.ndarray, width: int, height: int
) -> tuple[np.ndarray, np.ndarray]:
    """UV 픽셀 공간 삼각형을 래스터라이즈해 텍셀별 (삼각형 idx, barycentric)을 만든다."""
    tri_map = np.full((height, width), -1, dtype=np.int64)
    bary_map = np.zeros((height, width, 3), dtype=np.float64)

    for tri_index, face in enumerate(faces):
        a, b, c = points_px[face]
        min_x = max(int(np.floor(min(a[0], b[0], c[0]))), 0)
        max_x = min(int(np.ceil(max(a[0], b[0], c[0]))), width - 1)
        min_y = max(int(np.floor(min(a[1], b[1], c[1]))), 0)
        max_y = min(int(np.ceil(max(a[1], b[1], c[1]))), height - 1)
        if min_x > max_x or min_y > max_y:
            continue

        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-12:
            continue

        ys, xs = np.mgrid[min_y : max_y + 1, min_x : max_x + 1]
        w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den
        w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
        w2 = 1.0 - w0 - w1
        inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        if not inside.any():
            continue

        rows = ys[inside]
        cols = xs[inside]
        tri_map[rows, cols] = tri_index
        bary_map[rows, cols, 0] = w0[inside]
        bary_map[rows, cols, 1] = w1[inside]
        bary_map[rows, cols, 2] = w2[inside]

    return tri_map, bary_map


def _rasterize_zbuffer(
    points_px: np.ndarray,
    depths: np.ndarray,
    faces: np.ndarray,
    width: int,
    height: int,
) -> np.ndarray:
    """이미지 공간 z-buffer. 카메라를 향한 +z가 클수록 가깝다(최댓값 유지)."""
    zbuffer = np.full((height, width), -np.inf, dtype=np.float64)

    for face in faces:
        a, b, c = points_px[face]
        za, zb, zc = depths[face]
        min_x = max(int(np.floor(min(a[0], b[0], c[0]))), 0)
        max_x = min(int(np.ceil(max(a[0], b[0], c[0]))), width - 1)
        min_y = max(int(np.floor(min(a[1], b[1], c[1]))), 0)
        max_y = min(int(np.ceil(max(a[1], b[1], c[1]))), height - 1)
        if min_x > max_x or min_y > max_y:
            continue

        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-12:
            continue

        ys, xs = np.mgrid[min_y : max_y + 1, min_x : max_x + 1]
        w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den
        w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
        w2 = 1.0 - w0 - w1
        inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        if not inside.any():
            continue

        z = w0 * za + w1 * zb + w2 * zc
        rows = ys[inside]
        cols = xs[inside]
        current = zbuffer[rows, cols]
        z_inside = z[inside]
        update = z_inside > current
        zbuffer[rows[update], cols[update]] = z_inside[update]

    return zbuffer


def _sample_bilinear(image: np.ndarray, points_px: np.ndarray) -> np.ndarray:
    """(H,W,3) float 이미지에서 (N,2) 픽셀 좌표를 bilinear 샘플링한다."""
    height, width = image.shape[:2]
    x = np.clip(points_px[:, 0], 0, width - 1)
    y = np.clip(points_px[:, 1], 0, height - 1)
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    x1 = np.minimum(x0 + 1, width - 1)
    y1 = np.minimum(y0 + 1, height - 1)
    fx = (x - x0)[:, None]
    fy = (y - y0)[:, None]

    top = image[y0, x0] * (1 - fx) + image[y0, x1] * fx
    bottom = image[y1, x0] * (1 - fx) + image[y1, x1] * fx
    return top * (1 - fy) + bottom * fy


def _fill_holes(texture: np.ndarray, filled: np.ndarray) -> np.ndarray:
    """채워진 텍셀의 색을 8-이웃 평균으로 반복 전파해 빈 텍셀을 메운다."""
    result = texture.copy()
    mask = filled.copy()

    for _ in range(HOLE_FILL_ITERS):
        if mask.all():
            break

        neighbor_sum = np.zeros_like(result)
        neighbor_count = np.zeros(mask.shape, dtype=np.float64)

        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                shifted_color = np.roll(result, (dy, dx), axis=(0, 1))
                shifted_mask = np.roll(mask, (dy, dx), axis=(0, 1))
                neighbor_sum += shifted_color * shifted_mask[:, :, None]
                neighbor_count += shifted_mask

        growable = (~mask) & (neighbor_count > 0)
        result[growable] = neighbor_sum[growable] / neighbor_count[growable, None]
        mask = mask | growable

    if not mask.all() and mask.any():
        result[~mask] = result[mask].mean(axis=0)

    return result
