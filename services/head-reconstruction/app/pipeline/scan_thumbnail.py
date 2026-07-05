"""스캔 결과 vertex-color GLB의 썸네일 렌더 (PRD §2 Thumbnail 단계).

삼각형 래스터(scripts/render_vertex_color.py)는 20만 면에서 분 단위가 걸려
워커용으로는 정점 스플랫(2×2px, z-버퍼) + Lambert 셰이딩을 쓴다 —
COLMAP dense 메쉬는 정점이 촘촘해 512px 썸네일에서는 차이가 없다.
"""

import io

import numpy as np
import trimesh

SIZE = 512
MARGIN = 0.08
YAW_DEG = 15.0
PITCH_DEG = 8.0
BACKGROUND = np.array([244.0, 244.0, 245.0])
AMBIENT = 0.55
DIFFUSE = 0.45
FALLBACK_COLOR = np.array([176.0, 176.0, 180.0])


def render_scan_thumbnail(mesh: trimesh.Trimesh) -> bytes:
    """yaw 15°·pitch 8° 시점의 512px JPEG 바이트를 반환한다."""
    from PIL import Image

    yaw = np.radians(YAW_DEG)
    pitch = np.radians(PITCH_DEG)
    rot_yaw = np.array(
        [
            [np.cos(yaw), 0, np.sin(yaw)],
            [0, 1, 0],
            [-np.sin(yaw), 0, np.cos(yaw)],
        ]
    )
    rot_pitch = np.array(
        [
            [1, 0, 0],
            [0, np.cos(pitch), -np.sin(pitch)],
            [0, np.sin(pitch), np.cos(pitch)],
        ]
    )
    verts = np.asarray(mesh.vertices, dtype=np.float64) @ (rot_pitch @ rot_yaw).T

    if mesh.visual.kind == "vertex" and mesh.visual.vertex_colors is not None:
        colors = np.asarray(mesh.visual.vertex_colors, dtype=np.float64)[:, :3]
    else:
        colors = np.tile(FALLBACK_COLOR, (len(verts), 1))

    normals = np.asarray(mesh.vertex_normals, dtype=np.float64)
    normals = normals @ (rot_pitch @ rot_yaw).T
    shade = AMBIENT + DIFFUSE * np.abs(normals[:, 2])
    shaded = np.clip(colors * shade[:, None], 0, 255)

    # 스플랫 커버리지는 포아송 통계를 따른다 — 정점이 적으면 저해상도로
    # 렌더해 빈 픽셀 확률을 낮추고 마지막에 업스케일한다
    size = SIZE // 2 if len(verts) >= 60_000 else SIZE // 4
    xy = verts[:, :2]
    center = (xy.min(axis=0) + xy.max(axis=0)) / 2
    extent = float((xy.max(axis=0) - xy.min(axis=0)).max())
    scale = size * (1 - 2 * MARGIN) / max(extent, 1e-9)

    px = ((verts[:, 0] - center[0]) * scale + size / 2).astype(int)
    py = (size / 2 - (verts[:, 1] - center[1]) * scale).astype(int)
    depth = verts[:, 2]

    color_buffer = np.tile(BACKGROUND, (size, size, 1))
    z_buffer = np.full((size, size), -np.inf)

    # 뒤→앞 정렬 후 3×3 스플랫 (마지막에 그린 것이 앞) — 저밀도 메쉬 구멍 방지
    order = np.argsort(depth)
    px, py, depth, shaded = px[order], py[order], depth[order], shaded[order]

    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            cols = np.clip(px + dx, 0, size - 1)
            rows = np.clip(py + dy, 0, size - 1)
            closer = depth >= z_buffer[rows, cols]
            color_buffer[rows[closer], cols[closer]] = shaded[closer]
            z_buffer[rows[closer], cols[closer]] = depth[closer]

    image = Image.fromarray(color_buffer.astype(np.uint8))
    image = image.resize((SIZE, SIZE), Image.LANCZOS)

    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=90)
    return buffer.getvalue()
