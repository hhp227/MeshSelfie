"""헤어 프리셋: fitted 두상에 적응하는 절차 생성 헤어 (게임 아바타 방식).

사진에서 hair mask 실루엣을 그대로 3D화하는 shell 방식 대신, 깨끗하게
모델링된 스타일 프리셋을 fitted 두상 치수에 맞춰 생성한다. 각도와 무관하게
일관된 품질을 내는 대신 사진 그대로의 헤어 재현은 포기한다(자동 분류로
가장 가까운 스타일 선택). 색은 사진의 hair mask에서 추출한다.

지오메트리는 두상 중심 원통 좌표계의 (방위각 θ × 세로 행) 그리드다:
- 캡: 두피 반경 프로파일 + 두께 오프셋 → 두개골을 감싸는 헬멧
- 커튼: 헤어라인 rim에서 아래로 늘어지는 옆·뒤 머리 (스타일별 길이)
- 앞머리(bangs): 이마 위 짧은 플랩 (mask에서 감지된 경우)
- 반경은 항상 두상 반경 + 여유(clearance) 이상 → 얼굴·두피 침범 불가

프리셋을 아티스트 제작 GLB로 교체하려면 build_hair_preset이 반환하는
trimesh를 같은 앵커(두상 중심·크기)로 스케일한 자산 로드로 바꾸면 된다.
"""

from dataclasses import dataclass
from typing import Optional

import numpy as np
import trimesh
from PIL import Image
from scipy import ndimage

THETA_SEGMENTS = 48
CAP_ROWS = 7
CURTAIN_ROWS = 12
CAP_THICKNESS_TOP = 0.016  # 정수리 두께 (m)
CAP_THICKNESS_RIM = 0.010
CLEARANCE = 0.008  # 두상 표면과의 최소 간격
TIP_TAPER = 0.80  # 커튼 끝단 안쪽 오므림
FRONT_SECTOR_DEG = 55.0  # 얼굴 개방 구간 (정면 기준 ±)
BANGS_SECTOR_DEG = 42.0
LAPLACIAN_ITERS = 2

# 스타일별 커튼 끝 높이 (기준점 대비)
STYLE_LONG = "long_straight"
STYLE_BOB = "bob"
STYLE_SHORT = "short"


@dataclass
class HeadAnchors:
    center_xz: np.ndarray  # (2,) 원통축 (x, z)
    top_y: float
    hairline_y: float  # 이마 헤어라인
    brow_y: float  # 눈썹 높이 (bangs 끝)
    ear_top_y: float
    nape_y: float  # 뒷머리 rim
    chin_y: float
    neck_bottom_y: float
    radius_grid: np.ndarray  # (THETA, YBINS) 두상 반경
    y_bins: np.ndarray  # (YBINS,) 각 bin 중심 y


def classify_hair_style(
    hair_mask: np.ndarray, face_mask: Optional[np.ndarray]
) -> tuple[str, bool]:
    """정면 hair/face mask에서 (스타일, 앞머리 여부)를 추정한다."""
    if not hair_mask.any():
        return STYLE_SHORT, False

    hair_rows = np.nonzero(hair_mask.any(axis=1))[0]

    if face_mask is None or not face_mask.any():
        return STYLE_BOB, True

    face_rows = np.nonzero(face_mask.any(axis=1))[0]
    face_cols = np.nonzero(face_mask.any(axis=0))[0]
    face_top, face_bottom = face_rows[0], face_rows[-1]
    face_height = max(face_bottom - face_top, 1)

    below_chin = (hair_rows[-1] - face_bottom) / face_height
    if below_chin > 0.8:
        style = STYLE_LONG
    elif below_chin > 0.15:
        style = STYLE_BOB
    else:
        style = STYLE_SHORT

    # 앞머리: 이마 밴드(얼굴 상단 1/4, 가운데 1/3 폭)의 hair 비율
    band_top = face_top
    band_bottom = face_top + face_height // 4
    third = (face_cols[-1] - face_cols[0]) // 3
    band = hair_mask[band_top:band_bottom, face_cols[0] + third : face_cols[-1] - third]
    bangs = band.size > 0 and band.mean() > 0.35

    return style, bangs


def extract_hair_color(image: Image.Image, hair_mask: np.ndarray) -> np.ndarray:
    pixels = np.asarray(image.convert("RGB"), dtype=np.float64)
    if hair_mask.any():
        return pixels[hair_mask].mean(axis=0)
    return np.array([50.0, 42.0, 38.0])


def build_hair_preset(
    head_verts: np.ndarray,  # (V,3) neutral 공간 fitted 두상
    flame_masks: dict,
    style: str,
    bangs: bool,
    hair_color: np.ndarray,
) -> Optional[trimesh.Trimesh]:
    anchors = _compute_anchors(head_verts, flame_masks)
    if anchors is None:
        return None

    verts, faces, uv = _build_grid_surface(anchors, style, bangs)
    verts = _laplacian_smooth(verts, faces, LAPLACIAN_ITERS)

    texture = _make_strand_texture(hair_color)
    material = trimesh.visual.material.PBRMaterial(
        baseColorTexture=texture,
        metallicFactor=0.0,
        roughnessFactor=0.6,
        doubleSided=True,
    )
    visual = trimesh.visual.texture.TextureVisuals(uv=uv, material=material)
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, visual=visual, process=False)
    mesh.metadata["hair_style"] = style
    mesh.metadata["bangs"] = bangs
    return mesh


# ---------------------------------------------------------------- anchors


def _compute_anchors(head_verts: np.ndarray, flame_masks: dict) -> Optional[HeadAnchors]:
    def mask_verts(name: str) -> Optional[np.ndarray]:
        ids = np.asarray(flame_masks.get(name, []), dtype=np.int64)
        return head_verts[ids] if ids.size > 0 else None

    scalp = mask_verts("scalp")
    forehead = mask_verts("forehead")
    face = mask_verts("face")
    left_ear = mask_verts("left_ear")
    right_ear = mask_verts("right_ear")
    neck = mask_verts("neck")

    if scalp is None or forehead is None or face is None:
        return None

    center_xz = np.array([scalp[:, 0].mean(), scalp[:, 2].mean()])
    top_y = float(head_verts[:, 1].max())
    hairline_y = float(forehead[:, 1].max())
    brow_y = float(forehead[:, 1].min())
    chin_y = float(face[:, 1].min())
    neck_bottom_y = float(neck[:, 1].min()) if neck is not None else chin_y - 0.08

    ears = [e for e in (left_ear, right_ear) if e is not None]
    ear_top_y = max(float(e[:, 1].max()) for e in ears) if ears else brow_y
    nape_y = float(scalp[:, 1].min())

    # 두상 반경 프로파일: θ × y-bin 그리드의 최대 반경 (빈 곳은 최근접 채움 후 스무딩)
    rel = head_verts[:, [0, 2]] - center_xz
    theta = np.arctan2(rel[:, 0], rel[:, 1])  # z+ 정면 기준
    radius = np.linalg.norm(rel, axis=1)
    ys = head_verts[:, 1]

    y_lo, y_hi = float(ys.min()), top_y
    ybin_count = 48
    y_bins = np.linspace(y_lo, y_hi, ybin_count)
    theta_idx = ((theta + np.pi) / (2 * np.pi) * THETA_SEGMENTS).astype(int) % THETA_SEGMENTS
    y_idx = np.clip(
        ((ys - y_lo) / max(y_hi - y_lo, 1e-6) * (ybin_count - 1)).astype(int),
        0,
        ybin_count - 1,
    )

    grid = np.zeros((THETA_SEGMENTS, ybin_count))
    np.maximum.at(grid, (theta_idx, y_idx), radius)

    filled = grid > 0
    if not filled.any():
        return None
    indices = ndimage.distance_transform_edt(
        ~filled, return_distances=False, return_indices=True
    )
    grid = grid[tuple(indices)]
    grid = ndimage.gaussian_filter(grid, sigma=(1.5, 1.5), mode=("wrap", "nearest"))

    return HeadAnchors(
        center_xz=center_xz,
        top_y=top_y,
        hairline_y=hairline_y,
        brow_y=brow_y,
        ear_top_y=ear_top_y,
        nape_y=nape_y,
        chin_y=chin_y,
        neck_bottom_y=neck_bottom_y,
        radius_grid=grid,
        y_bins=y_bins,
    )


def _head_radius(anchors: HeadAnchors, theta: float, y: float) -> float:
    """(θ, y)에서의 두상 반경 (그리드 보간)."""
    t_pos = (theta + np.pi) / (2 * np.pi) * THETA_SEGMENTS
    t0 = int(np.floor(t_pos)) % THETA_SEGMENTS
    t1 = (t0 + 1) % THETA_SEGMENTS
    ft = t_pos - np.floor(t_pos)

    y_bins = anchors.y_bins
    y_pos = np.interp(y, y_bins, np.arange(len(y_bins)))
    y0 = int(np.clip(np.floor(y_pos), 0, len(y_bins) - 1))
    y1 = int(np.clip(y0 + 1, 0, len(y_bins) - 1))
    fy = float(np.clip(y_pos - y0, 0.0, 1.0))

    g = anchors.radius_grid
    top = g[t0, y0] * (1 - ft) + g[t1, y0] * ft
    bottom = g[t0, y1] * (1 - ft) + g[t1, y1] * ft
    return float(top * (1 - fy) + bottom * fy)


# ---------------------------------------------------------------- surface


def _rim_y(anchors: HeadAnchors, theta: float) -> float:
    """방위각별 캡 하단(rim) 높이. 정면=헤어라인, 옆=귀 위, 뒤=목덜미."""
    a = abs(theta)  # 0=정면, π=뒤
    front = np.radians(FRONT_SECTOR_DEG)
    side = np.radians(115.0)

    if a <= front:
        return anchors.hairline_y
    if a <= side:
        f = (a - front) / (side - front)
        return anchors.hairline_y * (1 - f) + anchors.ear_top_y * f
    f = (a - side) / (np.pi - side)
    return anchors.ear_top_y * (1 - f) + anchors.nape_y * f


def _curtain_end_y(anchors: HeadAnchors, style: str) -> float:
    if style == STYLE_LONG:
        return anchors.neck_bottom_y - 0.06
    if style == STYLE_BOB:
        return anchors.chin_y - 0.01
    return anchors.nape_y - 0.02


def _build_grid_surface(
    anchors: HeadAnchors, style: str, bangs: bool
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    thetas = np.linspace(-np.pi, np.pi, THETA_SEGMENTS, endpoint=False)
    front_open = np.radians(FRONT_SECTOR_DEG)
    curtain_end = _curtain_end_y(anchors, style)

    verts: list[np.ndarray] = []
    uvs: list[np.ndarray] = []
    rows: list[list[int]] = []  # 행별 정점 인덱스 (커튼 없는 θ는 -1)
    total_rows = CAP_ROWS + CURTAIN_ROWS

    for row in range(total_rows):
        row_ids: list[int] = []
        for ti, theta in enumerate(thetas):
            rim = _rim_y(anchors, theta)

            if row < CAP_ROWS:
                f = row / max(CAP_ROWS - 1, 1)
                y = anchors.top_y + 0.004 + (rim - anchors.top_y - 0.004) * f
                thickness = CAP_THICKNESS_TOP * (1 - f) + CAP_THICKNESS_RIM * f
                radius = _head_radius(anchors, theta, y) + max(thickness, CLEARANCE)
            else:
                # 커튼: 정면 개방 구간은 생성하지 않는다
                if abs(theta) <= front_open:
                    row_ids.append(-1)
                    continue
                t = (row - CAP_ROWS + 1) / CURTAIN_ROWS
                y = rim + (curtain_end - rim) * t
                # 목/두상 실제 반경보다 항상 바깥 (y 그대로 조회 — 목도 그리드에 포함됨)
                base = _head_radius(anchors, theta, y) + CLEARANCE
                rim_radius = _head_radius(anchors, theta, rim) + CAP_THICKNESS_RIM
                flare = 1.0 + 0.05 * np.sin(np.pi * min(t * 1.2, 1.0))
                taper = 1.0 if t < 0.6 else 1.0 - (1.0 - TIP_TAPER) * (t - 0.6) / 0.4
                radius = max(rim_radius * flare * taper, base)

            position = np.array(
                [
                    anchors.center_xz[0] + radius * np.sin(theta),
                    y,
                    anchors.center_xz[1] + radius * np.cos(theta),
                ]
            )
            row_ids.append(len(verts))
            verts.append(position)
            uvs.append(np.array([(theta + np.pi) / (2 * np.pi), 1.0 - row / total_rows]))
        rows.append(row_ids)

    faces: list[list[int]] = []
    for row in range(total_rows - 1):
        for ti in range(THETA_SEGMENTS):
            tj = (ti + 1) % THETA_SEGMENTS
            a, b = rows[row][ti], rows[row][tj]
            c, d = rows[row + 1][ti], rows[row + 1][tj]
            if min(a, b, c, d) < 0:
                continue
            faces.append([a, c, d])
            faces.append([a, d, b])

    # 정수리 캡 (팬)
    apex = len(verts)
    verts.append(
        np.array(
            [
                anchors.center_xz[0],
                anchors.top_y + 0.004 + CAP_THICKNESS_TOP,
                anchors.center_xz[1],
            ]
        )
    )
    uvs.append(np.array([0.5, 1.0]))
    for ti in range(THETA_SEGMENTS):
        tj = (ti + 1) % THETA_SEGMENTS
        faces.append([apex, rows[0][ti], rows[0][tj]])

    # 앞머리 플랩
    if bangs:
        bang_thetas = np.linspace(
            -np.radians(BANGS_SECTOR_DEG), np.radians(BANGS_SECTOR_DEG), 12
        )
        bang_rows = 4
        ids = np.full((bang_rows, len(bang_thetas)), -1, dtype=np.int64)
        for r in range(bang_rows):
            f = r / (bang_rows - 1)
            y = anchors.hairline_y + (anchors.brow_y + 0.005 - anchors.hairline_y) * f
            for ci, theta in enumerate(bang_thetas):
                radius = _head_radius(anchors, theta, y) + CLEARANCE + 0.003
                ids[r, ci] = len(verts)
                verts.append(
                    np.array(
                        [
                            anchors.center_xz[0] + radius * np.sin(theta),
                            y,
                            anchors.center_xz[1] + radius * np.cos(theta),
                        ]
                    )
                )
                uvs.append(np.array([ci / (len(bang_thetas) - 1), 1.0 - 0.15 * f]))
        for r in range(bang_rows - 1):
            for ci in range(len(bang_thetas) - 1):
                a, b = ids[r, ci], ids[r, ci + 1]
                c, d = ids[r + 1, ci], ids[r + 1, ci + 1]
                faces.append([a, c, d])
                faces.append([a, d, b])

    return (
        np.asarray(verts),
        np.asarray(faces, dtype=np.int64),
        np.asarray(uvs),
    )


def _laplacian_smooth(verts: np.ndarray, faces: np.ndarray, iterations: int) -> np.ndarray:
    from scipy import sparse

    num = verts.shape[0]
    edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]], axis=0)
    rows = np.concatenate([edges[:, 0], edges[:, 1]])
    cols = np.concatenate([edges[:, 1], edges[:, 0]])
    adj = sparse.coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(num, num)).tocsr()
    adj.data[:] = 1.0
    degree = np.asarray(adj.sum(axis=1)).ravel()
    degree[degree == 0] = 1.0

    out = verts.copy()
    for _ in range(iterations):
        out = out + 0.5 * (adj @ out / degree[:, None] - out)
    return out


def _make_strand_texture(hair_color: np.ndarray, size: int = 256) -> Image.Image:
    """머리색 기반 세로 결(스트릭) 텍스처. u축이 θ, v축이 가닥 방향."""
    rng = np.random.default_rng(7)
    base = np.tile(hair_color, (size, size, 1))

    xs = np.arange(size)
    streaks = np.zeros(size)
    for freq, amp in ((9, 0.16), (23, 0.10), (57, 0.06)):
        streaks += amp * np.sin(xs / size * freq * 2 * np.pi + rng.uniform(0, 6.28))
    streaks += rng.normal(0, 0.03, size)

    shading = 1.0 + streaks[None, :, None]
    vertical = np.linspace(1.06, 0.86, size)[:, None, None]  # 뿌리 밝고 끝 어둡게
    out = np.clip(base * shading * vertical, 0, 255).astype(np.uint8)
    return Image.fromarray(out)
