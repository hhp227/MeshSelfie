"""vertex-color GLB 렌더 (photogrammetry 결과 검증용).

thumbnail.py의 래스터라이저를 재사용하되 텍스처 대신 barycentric 보간된
정점 색상 × Lambert 셰이딩으로 픽셀을 칠한다.

사용:
    python scripts/render_vertex_color.py --glb mesh.glb --out-dir ./renders
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

SIZE = 512
MARGIN = 0.06
BACKGROUND = np.array([244.0, 244.0, 245.0])
AMBIENT = 0.55
DIFFUSE = 0.45


def render(mesh: trimesh.Trimesh, yaw_deg: float, pitch_deg: float = 0.0) -> Image.Image:
    yaw = np.radians(yaw_deg)
    pitch = np.radians(pitch_deg)
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
    faces = np.asarray(mesh.faces)

    colors = np.asarray(mesh.visual.vertex_colors, dtype=np.float64)[:, :3]

    xy = verts[:, :2]
    center = (xy.min(axis=0) + xy.max(axis=0)) / 2
    extent = float((xy.max(axis=0) - xy.min(axis=0)).max())
    scale = SIZE * (1 - 2 * MARGIN) / max(extent, 1e-9)

    px = (verts[:, 0] - center[0]) * scale + SIZE / 2
    py = SIZE / 2 - (verts[:, 1] - center[1]) * scale
    depth = verts[:, 2] * scale
    points = np.stack([px, py], axis=1)

    tri = verts[faces]
    normals = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    lengths = np.linalg.norm(normals, axis=1)
    lengths[lengths == 0] = 1.0
    shade = AMBIENT + DIFFUSE * np.abs(normals[:, 2] / lengths)

    color_buffer = np.tile(BACKGROUND, (SIZE, SIZE, 1))
    z_buffer = np.full((SIZE, SIZE), -np.inf)

    for tri_index, face in enumerate(faces):
        a, b, c = points[face]
        min_x = max(int(np.floor(min(a[0], b[0], c[0]))), 0)
        max_x = min(int(np.ceil(max(a[0], b[0], c[0]))), SIZE - 1)
        min_y = max(int(np.floor(min(a[1], b[1], c[1]))), 0)
        max_y = min(int(np.ceil(max(a[1], b[1], c[1]))), SIZE - 1)
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

        za, zb, zc = depth[face]
        z = w0 * za + w1 * zb + w2 * zc
        rows, cols, z_in = ys[inside], xs[inside], z[inside]
        closer = z_in > z_buffer[rows, cols]
        if not closer.any():
            continue

        rows, cols = rows[closer], cols[closer]
        w0_in, w1_in, w2_in = w0[inside][closer], w1[inside][closer], w2[inside][closer]
        ca, cb, cc = colors[face]
        pixel = (
            np.outer(w0_in, ca) + np.outer(w1_in, cb) + np.outer(w2_in, cc)
        ) * shade[tri_index]
        color_buffer[rows, cols] = pixel
        z_buffer[rows, cols] = z_in[closer]

    return Image.fromarray(np.clip(color_buffer, 0, 255).astype(np.uint8))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--glb", required=True)
    parser.add_argument("--out-dir", default="./renders")
    args = parser.parse_args()

    loaded = trimesh.load(args.glb, force="mesh")
    print(f"정점 {len(loaded.vertices):,} / 삼각형 {len(loaded.faces):,}")
    print(f"visual: {loaded.visual.kind}")

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    for name, yaw, pitch in [
        ("front", 15, 0),
        ("side", 75, 0),
        ("top", 15, 35),
        ("back", 165, 0),
    ]:
        image = render(loaded, yaw, pitch)
        image.save(out / f"scan-{name}.jpg", quality=90)
        print(f"saved: scan-{name}.jpg")


if __name__ == "__main__":
    main()
