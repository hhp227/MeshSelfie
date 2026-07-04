"""GLB 썸네일 소프트웨어 렌더러.

GPU/EGL 의존 없이 numpy 삼각형 래스터라이저로 head+hair 씬을 렌더한다.
살짝 튼(3/4) 정면 구도의 orthographic 카메라 + 단순 Lambert 셰이딩.
Dashboard/홈 카드용이라 512px JPEG면 충분하다.
"""

from pathlib import Path

import numpy as np
import trimesh
from PIL import Image

THUMB_SIZE = 512
YAW_RAD = np.radians(14.0)  # 살짝 3/4 각도가 정면보다 입체감이 좋다
MARGIN_RATIO = 0.06
BACKGROUND = np.array([244.0, 244.0, 245.0])
AMBIENT = 0.55
DIFFUSE = 0.45
JPEG_QUALITY = 88


def render_thumbnail(
    scene: "trimesh.Scene | trimesh.Trimesh",
    output_path: Path,
    size: int = THUMB_SIZE,
) -> None:
    geometries = (
        list(scene.geometry.values())
        if isinstance(scene, trimesh.Scene)
        else [scene]
    )

    rotation = np.array(
        [
            [np.cos(YAW_RAD), 0.0, np.sin(YAW_RAD)],
            [0.0, 1.0, 0.0],
            [-np.sin(YAW_RAD), 0.0, np.cos(YAW_RAD)],
        ]
    )

    prepared = []
    all_xy = []
    for geom in geometries:
        verts = np.asarray(geom.vertices, dtype=np.float64) @ rotation.T
        uv = np.asarray(geom.visual.uv, dtype=np.float64)
        texture = np.asarray(
            geom.visual.material.baseColorTexture.convert("RGB"), dtype=np.float64
        )
        prepared.append((verts, np.asarray(geom.faces, dtype=np.int64), uv, texture))
        all_xy.append(verts[:, :2])

    xy = np.concatenate(all_xy)
    center = (xy.min(axis=0) + xy.max(axis=0)) / 2
    extent = float((xy.max(axis=0) - xy.min(axis=0)).max())
    scale = size * (1.0 - 2 * MARGIN_RATIO) / max(extent, 1e-6)

    color_buffer = np.tile(BACKGROUND, (size, size, 1))
    z_buffer = np.full((size, size), -np.inf)

    for verts, faces, uv, texture in prepared:
        px = (verts[:, 0] - center[0]) * scale + size / 2
        py = size / 2 - (verts[:, 1] - center[1]) * scale
        points = np.stack([px, py], axis=1)
        _rasterize_shaded(
            points, verts[:, 2] * scale, verts, faces, uv, texture, color_buffer, z_buffer
        )

    image = Image.fromarray(np.clip(color_buffer, 0, 255).astype(np.uint8))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, format="JPEG", quality=JPEG_QUALITY)


def _rasterize_shaded(
    points: np.ndarray,  # (V, 2) 화면 px
    depths: np.ndarray,  # (V,) 클수록 카메라에 가까움
    verts3d: np.ndarray,  # (V, 3) 회전된 모델 좌표 (법선용)
    faces: np.ndarray,
    uv: np.ndarray,
    texture: np.ndarray,
    color_buffer: np.ndarray,
    z_buffer: np.ndarray,
) -> None:
    size = color_buffer.shape[0]
    tex_h, tex_w = texture.shape[:2]

    tri3d = verts3d[faces]
    normals = np.cross(tri3d[:, 1] - tri3d[:, 0], tri3d[:, 2] - tri3d[:, 0])
    lengths = np.linalg.norm(normals, axis=1)
    lengths[lengths == 0] = 1.0
    # doubleSided(hair) 지원을 위해 절댓값 사용 — 뒷면도 같은 밝기로 셰이딩
    shade = AMBIENT + DIFFUSE * np.abs(normals[:, 2] / lengths)

    for tri_index, face in enumerate(faces):
        a, b, c = points[face]
        min_x = max(int(np.floor(min(a[0], b[0], c[0]))), 0)
        max_x = min(int(np.ceil(max(a[0], b[0], c[0]))), size - 1)
        min_y = max(int(np.floor(min(a[1], b[1], c[1]))), 0)
        max_y = min(int(np.ceil(max(a[1], b[1], c[1]))), size - 1)
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

        za, zb, zc = depths[face]
        z = w0 * za + w1 * zb + w2 * zc
        rows = ys[inside]
        cols = xs[inside]
        z_in = z[inside]
        closer = z_in > z_buffer[rows, cols]
        if not closer.any():
            continue

        rows = rows[closer]
        cols = cols[closer]
        w0_in = w0[inside][closer]
        w1_in = w1[inside][closer]
        w2_in = w2[inside][closer]

        uva, uvb, uvc = uv[face]
        u = w0_in * uva[0] + w1_in * uvb[0] + w2_in * uvc[0]
        v = w0_in * uva[1] + w1_in * uvb[1] + w2_in * uvc[1]
        tx = np.clip((u * (tex_w - 1)).astype(np.int64), 0, tex_w - 1)
        ty = np.clip(((1.0 - v) * (tex_h - 1)).astype(np.int64), 0, tex_h - 1)

        color_buffer[rows, cols] = texture[ty, tx] * shade[tri_index]
        z_buffer[rows, cols] = z_in[closer]
