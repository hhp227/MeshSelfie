"""Milestone 2: multi-view shared-identity FLAME fitting.

- 검출 가능한 모든 뷰(front 필수, angle45/side 선택)에서 MediaPipe 105
  landmark를 추출하고, shape·expression·jaw는 뷰 간 공유, global rotation과
  weak-perspective 카메라는 뷰별로 최적화한다 (docs/hybrid-head-reconstruction.md 4절).
- 완전 측면(90°)은 MediaPipe가 얼굴을 검출하지 못하는 경우가 많아, 검출 실패한
  뷰는 경고 없이 제외한다(정면은 실패 시 에러).
- 텍스처는 texture_bake의 UV 아틀라스 + multi-view 가중 베이크를 사용한다.
"""

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Callable, Optional

import numpy as np
import torch
import trimesh
from PIL import Image

from scipy import ndimage

from app.config import config
from app.jobs import JobCanceled, PipelineError
from app.pipeline.flame_model import FlameModel, NUM_EXPR, NUM_SHAPE, _load_flame_pickle
from app.pipeline.hair_shell import build_hair_shell
from app.pipeline.landmarks import detect_face_landmarks
from app.pipeline.segmentation import (
    CATEGORY_BODY_SKIN,
    CATEGORY_FACE_SKIN,
    CATEGORY_HAIR,
    detect_hair_mask,
    segment_masks,
)
from app.pipeline.texture_bake import bake_multiview_texture, generate_uv_atlas

STAGE1_ITERS = 200
STAGE2_ITERS = 600
STAGE3_ITERS = 250  # landmark + silhouette 결합 단계
STAGE4_ITERS = 300  # photometric (음영 잔차) 단계
CANCEL_CHECK_EVERY = 50

# --- photometric 손실 설정 ---
W_PHOTO = 1.5
W_ALBEDO_SMOOTH = 2.0
W_ALBEDO_POSITIVE = 1.0
W_ANCHOR = 1e-2  # stage-3 결과 대비 shape/expression 드리프트 벌점
RASTER_REFRESH_EVERY = 60

# --- silhouette 손실 설정 ---
# MediaPipe 105 landmark embedding에는 턱 윤곽(face oval) 점이 하나도 없어
# (실측 확인) jaw snap이 턱선의 유일한 제약이다 — landmark와 충돌하지 않으므로
# 비교적 강하게 준다.
W_SIL_CONTAIN = 0.5  # 얼굴 정점이 보이는 머리(얼굴피부∪머리카락) 밖으로 나가는 벌점
W_SIL_JAW = 0.6  # 모델 얼굴 윤곽 ↔ 신뢰 가능한 face-skin 경계 스냅
JAW_SNAP_CAP_RATIO = 0.06  # face 대각선 대비 스냅 최대 거리(가림 영역 무시용)
CONTOUR_REFRESH_EVERY = 25  # 윤곽 후보 정점 재선택 주기
CONTOUR_ROW_BUCKET_PX = 6
# face 경계 중 신뢰 구간: 얼굴 하반부(턱·볼)만. 하반부에서는 머리카락이 턱 뒤에
# 있어 피부 경계가 곧 실루엣이지만, 상반부 경계는 앞머리 가림선이라 제외한다.
JAW_TRUST_Y_START = 0.55  # face bbox 세로 기준 시작 비율
MIN_FACE_MASK_RATIO = 0.005

# 정규화 가중치. landmark 손실이 ~1e-4 수준이므로 이보다 한참 작아야
# shape이 실제로 움직인다 — 1e-2로 두면 평균 두상에서 벗어나지 못해
# "누구를 넣어도 같은 머리에 텍스처만 바뀌는" 결과가 된다(실측으로 확인).
W_SHAPE_REG = 8e-4
W_EXPR_REG = 4e-3
W_NECK_REG = 1e-1
W_JAW_REG = 1e-2

# 비정면 뷰의 global yaw 초기 후보 (라디안). 1단계 손실이 가장 낮은 값을 채택한다.
YAW_CANDIDATES = (0.0, np.pi / 4, -np.pi / 4, np.pi / 2.2, -np.pi / 2.2)


@dataclass
class ViewObservation:
    role: str
    image: Image.Image
    width: int
    height: int
    target: torch.Tensor  # (105, 2) pixel landmarks


@dataclass
class SilhouetteField:
    """뷰별 silhouette 손실용 거리 필드 (픽셀 단위, torch float32)."""

    contain_dist: torch.Tensor  # (H,W) 얼굴피부∪머리카락 밖에서의 거리(안은 0)
    jaw_dist: Optional[torch.Tensor]  # (H,W) 신뢰 가능한 face 경계까지 unsigned 거리
    width: int
    height: int
    face_scale: float  # face-skin bbox 대각선(px) — 정규화 기준
    face_mask: Optional[np.ndarray] = None  # photometric 단계에서 재사용


def _prepare_silhouette_field(image: Image.Image) -> Optional[SilhouetteField]:
    try:
        masks = segment_masks(image, (CATEGORY_HAIR, CATEGORY_FACE_SKIN))
    except PipelineError:
        return None

    face = masks[CATEGORY_FACE_SKIN]
    hair = masks[CATEGORY_HAIR]

    if face.mean() < MIN_FACE_MASK_RATIO:
        return None

    face = ndimage.binary_fill_holes(
        ndimage.binary_closing(face, structure=np.ones((5, 5)))
    )
    visible = face | hair

    # containment: 보이는 머리 영역 밖 거리 (안쪽 0 → relu 불필요)
    contain_dist = ndimage.distance_transform_edt(~visible)

    # jaw snap: face 경계 중 얼굴 하반부(턱·볼)만 신뢰한다
    boundary = face & ~ndimage.binary_erosion(face)
    rows, cols = np.nonzero(face)
    y_start = rows.min() + JAW_TRUST_Y_START * (rows.max() - rows.min())
    trusted_rows = np.zeros_like(boundary)
    trusted_rows[int(y_start) :, :] = True
    reliable = boundary & trusted_rows

    jaw_dist: Optional[torch.Tensor] = None
    if reliable.sum() >= 30:
        jaw_dist = torch.tensor(
            ndimage.distance_transform_edt(~reliable), dtype=torch.float32
        )

    face_scale = float(
        np.hypot(rows.max() - rows.min(), cols.max() - cols.min())
    )

    return SilhouetteField(
        contain_dist=torch.tensor(contain_dist, dtype=torch.float32),
        jaw_dist=jaw_dist,
        width=face.shape[1],
        height=face.shape[0],
        face_scale=max(face_scale, 1.0),
        face_mask=face,
    )


def _sample_field(field: torch.Tensor, points_px: torch.Tensor) -> torch.Tensor:
    """(H,W) 필드를 (N,2) 픽셀 좌표에서 bilinear 샘플링 (좌표로 미분 가능)."""
    height, width = field.shape
    x = points_px[:, 0].clamp(0, width - 1 - 1e-4)
    y = points_px[:, 1].clamp(0, height - 1 - 1e-4)
    x0 = x.floor().long()
    y0 = y.floor().long()
    x1 = x0 + 1
    y1 = y0 + 1
    fx = x - x0.float()
    fy = y - y0.float()

    top = field[y0, x0] * (1 - fx) + field[y0, x1] * fx
    bottom = field[y1, x0] * (1 - fx) + field[y1, x1] * fx
    return top * (1 - fy) + bottom * fy


def _contour_candidates(projected_face: torch.Tensor) -> torch.Tensor:
    """행 버킷별 좌우 극점 = 현재 모델 얼굴의 이미지 윤곽 후보 (하반부만: 턱·볼).

    FLAME face 마스크는 정면 얼굴 패치라 극점이 곧 윤곽이다. 상반부(이마·관자놀이)는
    머리카락에 덮여 실루엣이 관측되지 않으므로 제외한다.
    """
    ys = projected_face[:, 1]
    center_y = ys.mean()
    lower = torch.nonzero(ys > center_y, as_tuple=False).squeeze(1)

    if lower.numel() == 0:
        return lower

    buckets = (ys[lower] / CONTOUR_ROW_BUCKET_PX).long()
    selected: list[int] = []

    for bucket in buckets.unique():
        members = lower[buckets == bucket]
        xs = projected_face[members, 0]
        selected.append(int(members[xs.argmin()]))
        selected.append(int(members[xs.argmax()]))

    return torch.tensor(sorted(set(selected)), dtype=torch.long)


def flame_assets_available() -> bool:
    return config.flame_model_path.exists() and config.flame_embedding_path.exists()


@lru_cache(maxsize=1)
def _load_model() -> FlameModel:
    return FlameModel(config.flame_model_path)


@lru_cache(maxsize=1)
def _load_embedding() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    data = np.load(config.flame_embedding_path)
    return (
        data["lmk_face_idx"].astype(np.int64),
        np.asarray(data["lmk_b_coords"], dtype=np.float64),
        data["landmark_indices"].astype(np.int64),
    )


def build_flame_head_mesh(
    view_paths: dict[str, Path],
    is_canceled: Callable[[], bool] = lambda: False,
) -> trimesh.Scene:
    observations = _collect_observations(view_paths)
    model = _load_model()
    lmk_face_idx, lmk_b_coords, _ = _load_embedding()

    def check_cancel(step: int) -> None:
        if step % CANCEL_CHECK_EVERY == 0 and is_canceled():
            raise JobCanceled()

    # --- 공유 파라미터 ---
    shape = torch.zeros(NUM_SHAPE, requires_grad=True)
    expression = torch.zeros(NUM_EXPR, requires_grad=True)
    jaw_pose = torch.zeros(3, requires_grad=True)
    neck_pose = torch.zeros(3, requires_grad=True)
    eye_pose = torch.zeros(2, 3)

    # --- 뷰별 파라미터 ---
    global_rots: list[torch.Tensor] = []
    cam_scales: list[torch.Tensor] = []
    cam_transes: list[torch.Tensor] = []

    def compose_pose(view_index: int) -> torch.Tensor:
        return torch.cat(
            [
                global_rots[view_index].unsqueeze(0),
                neck_pose.unsqueeze(0),
                jaw_pose.unsqueeze(0),
                eye_pose,
            ],
            dim=0,
        )

    def project(points: torch.Tensor, view_index: int) -> torch.Tensor:
        xy = torch.stack([points[:, 0], -points[:, 1]], dim=1)
        return cam_scales[view_index] * xy + cam_transes[view_index]

    def view_landmark_loss(view_index: int) -> torch.Tensor:
        obs = observations[view_index]
        verts = model.forward(shape, expression, compose_pose(view_index))
        pts = model.surface_points(verts, lmk_face_idx, lmk_b_coords)
        face_scale = obs.target.max(dim=0).values - obs.target.min(dim=0).values
        scale = float(face_scale.norm())
        return (((project(pts, view_index) - obs.target) / scale) ** 2).sum(dim=1).mean()

    # --- 1단계: 뷰별 카메라 + global rotation 정렬 (비정면은 yaw 다중 시작) ---
    for index, obs in enumerate(observations):
        yaws = (0.0,) if obs.role == "front" else YAW_CANDIDATES
        best: Optional[tuple[float, torch.Tensor, torch.Tensor, torch.Tensor]] = None

        for yaw in yaws:
            check_cancel(0)
            rot = torch.tensor([0.0, yaw, 0.0], requires_grad=True)
            scale_t, trans_t = _init_camera(model, obs.target, rot.detach())
            scale_t.requires_grad_(True)
            trans_t.requires_grad_(True)

            global_rots.append(rot)
            cam_scales.append(scale_t)
            cam_transes.append(trans_t)

            optimizer = torch.optim.Adam([rot, scale_t, trans_t], lr=0.05)
            for step in range(STAGE1_ITERS):
                check_cancel(step)
                optimizer.zero_grad()
                loss = view_landmark_loss(index)
                loss.backward()
                optimizer.step()

            final = float(view_landmark_loss(index).detach())
            candidate = (final, rot.detach(), scale_t.detach(), trans_t.detach())
            if best is None or final < best[0]:
                best = candidate

            global_rots.pop()
            cam_scales.pop()
            cam_transes.pop()

        assert best is not None
        global_rots.append(best[1].clone().requires_grad_(True))
        cam_scales.append(best[2].clone().requires_grad_(True))
        cam_transes.append(best[3].clone().requires_grad_(True))

    # --- 2단계: 전체 joint 최적화 (shape 공유) ---
    optimizer = torch.optim.Adam(
        [
            {"params": global_rots + cam_scales + cam_transes, "lr": 0.01},
            {"params": [shape, expression], "lr": 0.02},
            {"params": [neck_pose, jaw_pose], "lr": 0.005},
        ]
    )
    final_lmk_loss = float("inf")
    for step in range(STAGE2_ITERS):
        check_cancel(step)
        optimizer.zero_grad()
        lmk = sum(view_landmark_loss(i) for i in range(len(observations))) / len(
            observations
        )
        loss = (
            lmk
            + W_SHAPE_REG * (shape**2).mean()
            + W_EXPR_REG * (expression**2).mean()
            + W_NECK_REG * (neck_pose**2).sum()
            + W_JAW_REG * (jaw_pose**2).sum()
        )
        loss.backward()
        optimizer.step()
        final_lmk_loss = float(lmk.detach())

    check_cancel(0)

    # --- 3단계: landmark + silhouette 결합 (턱선·볼 윤곽 정밀화) ---
    face_indices = _face_vertex_indices()
    silhouette_fields: list[tuple[int, SilhouetteField]] = []

    if face_indices is not None:
        for index, obs in enumerate(observations):
            field = _prepare_silhouette_field(obs.image)
            if field is not None:
                silhouette_fields.append((index, field))

    jaw_residual_before: Optional[float] = None
    jaw_residual_after: Optional[float] = None

    if silhouette_fields:
        face_idx_tensor = torch.from_numpy(face_indices)

        def silhouette_loss(collect_residual: bool = False) -> torch.Tensor:
            nonlocal jaw_residual_after
            total = torch.zeros(())
            residuals: list[float] = []

            for view_index, field in silhouette_fields:
                verts = model.forward(shape, expression, compose_pose(view_index))
                face_px = project(verts[face_idx_tensor], view_index)

                # containment: 보이는 머리 영역 밖으로 나간 거리
                contain = _sample_field(field.contain_dist, face_px) / field.face_scale
                total = total + W_SIL_CONTAIN * (contain**2).mean()

                # jaw snap: 모델 윤곽 후보 ↔ 신뢰 가능한 face 경계
                if field.jaw_dist is not None:
                    contour_ids = contour_cache.get(view_index)
                    if contour_ids is not None and contour_ids.numel() > 0:
                        raw = _sample_field(field.jaw_dist, face_px[contour_ids])
                        cap = JAW_SNAP_CAP_RATIO * field.face_scale
                        dist = raw.clamp(max=cap) / field.face_scale
                        total = total + W_SIL_JAW * (dist**2).mean()
                        if collect_residual:
                            near = raw.detach()[raw.detach() < cap]
                            if near.numel() > 0:
                                residuals.append(float(near.mean()))

            if collect_residual and residuals:
                jaw_residual_after = sum(residuals) / len(residuals)

            return total

        contour_cache: dict[int, torch.Tensor] = {}

        def refresh_contours() -> None:
            with torch.no_grad():
                for view_index, _field in silhouette_fields:
                    verts = model.forward(shape, expression, compose_pose(view_index))
                    face_px = project(verts[face_idx_tensor], view_index)
                    contour_cache[view_index] = _contour_candidates(face_px)

        refresh_contours()

        with torch.no_grad():
            residuals = []
            for view_index, field in silhouette_fields:
                if field.jaw_dist is None:
                    continue
                verts = model.forward(shape, expression, compose_pose(view_index))
                face_px = project(verts[face_idx_tensor], view_index)
                ids = contour_cache[view_index]
                if ids.numel() > 0:
                    raw = _sample_field(field.jaw_dist, face_px[ids])
                    near = raw[raw < JAW_SNAP_CAP_RATIO * field.face_scale]
                    if near.numel() > 0:
                        residuals.append(float(near.mean()))
            if residuals:
                jaw_residual_before = sum(residuals) / len(residuals)

        optimizer = torch.optim.Adam(
            [
                {"params": global_rots + cam_scales + cam_transes, "lr": 0.005},
                {"params": [shape, expression], "lr": 0.01},
                {"params": [neck_pose, jaw_pose], "lr": 0.003},
            ]
        )
        for step in range(STAGE3_ITERS):
            check_cancel(step)
            if step % CONTOUR_REFRESH_EVERY == 0:
                refresh_contours()
            optimizer.zero_grad()
            lmk = sum(view_landmark_loss(i) for i in range(len(observations))) / len(
                observations
            )
            loss = (
                lmk
                + silhouette_loss(collect_residual=step == STAGE3_ITERS - 1)
                + W_SHAPE_REG * (shape**2).mean()
                + W_EXPR_REG * (expression**2).mean()
                + W_NECK_REG * (neck_pose**2).sum()
                + W_JAW_REG * (jaw_pose**2).sum()
            )
            loss.backward()
            optimizer.step()
            final_lmk_loss = float(lmk.detach())

    check_cancel(0)

    # --- 4단계: photometric — 음영 잔차로 shape/expression 미세조정 ---
    photo_residual_before: Optional[float] = None
    photo_residual_after: Optional[float] = None
    photometric_views = 0

    if silhouette_fields and face_indices is not None:
        from app.pipeline import photometric as pm

        # FLAME face 패치 서브셋 (photometric은 얼굴 피부에서만 계산)
        id_map = np.full(model.v_template.shape[0], -1, dtype=np.int64)
        id_map[face_indices] = np.arange(face_indices.size)
        keep = np.isin(model.faces, face_indices).all(axis=1)
        subset_faces_np = id_map[model.faces[keep]]
        subset_faces_t = torch.from_numpy(subset_faces_np)
        face_ids_t = torch.from_numpy(face_indices)

        photo_views: list[tuple[int, pm.PhotometricView]] = []
        for view_index, field in silhouette_fields:
            if field.face_mask is None:
                continue
            photo_views.append(
                (
                    view_index,
                    pm.build_photometric_view(
                        observations[view_index].image, field.face_mask, field.face_scale
                    ),
                )
            )

        if photo_views:
            photometric_views = len(photo_views)

            def refresh_rasters() -> None:
                with torch.no_grad():
                    for view_index, pview in photo_views:
                        verts = model.forward(shape, expression, compose_pose(view_index))
                        proj = project(verts, view_index).numpy()
                        pm.refresh_raster(pview, proj, subset_faces_np, face_indices)

            refresh_rasters()

            # albedo/SH 초기화 (첫 photometric 뷰 = 정면 기준)
            with torch.no_grad():
                first_index, first_view = photo_views[0]
                verts0 = model.forward(shape, expression, compose_pose(first_index))
                proj0 = project(verts0[face_ids_t], first_index).numpy()
            albedo0, sh0 = pm.init_albedo_and_sh(
                first_view, verts0[face_ids_t], subset_faces_t, proj0
            )
            albedo = albedo0.clone().requires_grad_(True)
            sh_coeffs = [sh0.clone().requires_grad_(True) for _ in photo_views]
            laplacian = pm.albedo_laplacian(subset_faces_np, face_indices.size)

            shape_anchor = shape.detach().clone()
            expr_anchor = expression.detach().clone()

            def photometric_term() -> torch.Tensor:
                total = torch.zeros(())
                for slot, (view_index, pview) in enumerate(photo_views):
                    if pview.pixel_tri is None or pview.pixel_tri.numel() == 0:
                        continue
                    verts = model.forward(shape, expression, compose_pose(view_index))
                    rendered, target = pm.render_pixels(
                        pview, verts[face_ids_t], subset_faces_t, albedo, sh_coeffs[slot]
                    )
                    total = total + torch.nn.functional.smooth_l1_loss(
                        rendered, target, beta=0.1
                    )
                return total / max(len(photo_views), 1)

            with torch.no_grad():
                photo_residual_before = float(photometric_term())

            optimizer = torch.optim.Adam(
                [
                    {"params": [shape, expression], "lr": 0.004},
                    {"params": [albedo], "lr": 0.02},
                    {"params": sh_coeffs, "lr": 0.02},
                ]
            )
            for step in range(STAGE4_ITERS):
                check_cancel(step)
                if step > 0 and step % RASTER_REFRESH_EVERY == 0:
                    refresh_rasters()
                if step % CONTOUR_REFRESH_EVERY == 0:
                    refresh_contours()
                optimizer.zero_grad()
                lmk = sum(view_landmark_loss(i) for i in range(len(observations))) / len(
                    observations
                )
                smooth_albedo = torch.sparse.mm(laplacian, albedo)
                loss = (
                    lmk
                    + silhouette_loss()
                    + W_PHOTO * photometric_term()
                    + W_ALBEDO_SMOOTH * ((albedo - smooth_albedo) ** 2).mean()
                    + W_ALBEDO_POSITIVE * torch.relu(-albedo).mean()
                    + W_ANCHOR * ((shape - shape_anchor) ** 2).mean()
                    + W_ANCHOR * ((expression - expr_anchor) ** 2).mean()
                    + W_SHAPE_REG * (shape**2).mean()
                    + W_EXPR_REG * (expression**2).mean()
                )
                loss.backward()
                optimizer.step()
                final_lmk_loss = float(lmk.detach())

            with torch.no_grad():
                refresh_rasters()
                photo_residual_after = float(photometric_term())

    check_cancel(0)

    # --- hair mask (정면 뷰) — 실패해도 head 생성은 계속한다 ---
    front_obs = observations[0]
    hair_mask: Optional[np.ndarray] = None
    hair_color: Optional[np.ndarray] = None
    try:
        mask = detect_hair_mask(front_obs.image)
        if mask.any():
            hair_mask = mask
            hair_color = np.asarray(front_obs.image, dtype=np.float64)[mask].mean(axis=0)
    except PipelineError:
        hair_mask = None

    # --- 결과 메쉬: UV 아틀라스 + multi-view 텍스처 베이크 ---
    with torch.no_grad():
        neutral_pose = compose_pose(0).clone()
        neutral_pose[0] = 0.0
        neutral_verts = model.forward(shape, expression, neutral_pose).numpy()

        atlas = generate_uv_atlas(neutral_verts, model.faces)

        bake_views = []
        for index, obs in enumerate(observations):
            posed = model.forward(shape, expression, compose_pose(index))
            projected = project(posed, index)

            # 유효 텍스처 소스 = 머리카락∪몸피부∪얼굴피부. 옷/초커/배경이
            # 목·턱 텍스처로 투영되는 것을 막는다 (실패 시 제한 없음).
            valid_mask = None
            try:
                view_masks = segment_masks(
                    obs.image, (CATEGORY_HAIR, CATEGORY_BODY_SKIN, CATEGORY_FACE_SKIN)
                )
                valid_mask = (
                    view_masks[CATEGORY_HAIR]
                    | view_masks[CATEGORY_BODY_SKIN]
                    | view_masks[CATEGORY_FACE_SKIN]
                )
                # 경계 픽셀은 옷/초커 색이 섞여 있으므로 살짝 침식해 배제
                valid_mask = ndimage.binary_erosion(valid_mask, iterations=3)
            except PipelineError:
                valid_mask = None

            bake_views.append(
                {
                    "role": obs.role,
                    "image": np.asarray(obs.image, dtype=np.float32),
                    "width": obs.width,
                    "height": obs.height,
                    "posed_verts": posed.numpy(),
                    "projected_px": projected.numpy(),
                    "valid_mask": valid_mask,
                }
            )

        # 90° 측면 사진이 fitting에 못 들어갔어도 silhouette로 후두부 hair 두께를 추정
        back_profile = None
        side_path = view_paths.get("side")
        if side_path is not None and "side" not in [obs.role for obs in observations]:
            back_profile = _analyze_side_profile(
                side_path, model, shape, expression, neck_pose, jaw_pose
            )

        # 정면 뷰 기준 hair shell → global rotation 제거(neutral) 공간으로 변환
        hair_mesh = None
        if hair_mask is not None:
            hair_mesh = build_hair_shell(
                image=front_obs.image,
                hair_mask=hair_mask,
                projected_px=bake_views[0]["projected_px"],
                posed_z=bake_views[0]["posed_verts"][:, 2],
                head_faces=model.faces,
                cam_scale=float(cam_scales[0]),
                cam_trans=cam_transes[0].numpy(),
                back_profile=back_profile,
            )

        if hair_mesh is not None:
            from app.pipeline.flame_model import _batch_rodrigues

            rot = _batch_rodrigues(global_rots[0].unsqueeze(0))[0].numpy()  # (3,3)
            root_joint = model.joints(shape, expression)[0].numpy()
            # v_posed = R (x - j0) + j0  →  x = Rᵀ (v_posed - j0) + j0
            hair_mesh.vertices = (hair_mesh.vertices - root_joint) @ rot + root_joint

    scalp_faces = _scalp_face_mask(model)
    texture = bake_multiview_texture(
        atlas,
        model.faces,
        bake_views,
        override_face_mask=scalp_faces if hair_color is not None else None,
        override_color=hair_color,
    )

    export_verts = neutral_verts[atlas.vmapping]
    material = trimesh.visual.material.PBRMaterial(
        baseColorTexture=texture,
        metallicFactor=0.0,
        roughnessFactor=0.85,
    )
    visual = trimesh.visual.texture.TextureVisuals(uv=atlas.uvs, material=material)
    head_mesh = trimesh.Trimesh(
        vertices=export_verts, faces=atlas.faces, visual=visual, process=False
    )

    scene = trimesh.Scene()
    scene.add_geometry(head_mesh, geom_name="head")
    if hair_mesh is not None:
        scene.add_geometry(hair_mesh, geom_name="hair")

    scene.metadata["flame_landmark_loss"] = final_lmk_loss
    scene.metadata["views_used"] = [obs.role for obs in observations]
    scene.metadata["hair_shell"] = hair_mesh is not None
    scene.metadata["side_profile_used"] = back_profile is not None
    # 개인화 정도 관측용: 0에 가까우면 평균 두상과 다르지 않다는 뜻
    scene.metadata["shape_norm"] = float(shape.detach().norm())
    scene.metadata["expression_norm"] = float(expression.detach().norm())
    scene.metadata["silhouette_views"] = len(silhouette_fields)
    scene.metadata["jaw_residual_px_before"] = jaw_residual_before
    scene.metadata["jaw_residual_px_after"] = jaw_residual_after
    scene.metadata["photometric_views"] = photometric_views
    scene.metadata["photo_residual_before"] = photo_residual_before
    scene.metadata["photo_residual_after"] = photo_residual_after
    return scene


def _analyze_side_profile(
    side_path: Path,
    model: FlameModel,
    shape: torch.Tensor,
    expression: torch.Tensor,
    neck_pose: torch.Tensor,
    jaw_pose: torch.Tensor,
):
    """측면 사진 silhouette 정합. 어떤 실패든 None으로 강등한다(선택 기능)."""
    from app.pipeline.side_view import analyze_side_view

    try:
        image = Image.open(side_path).convert("RGB")
    except OSError:
        return None

    def verts_for_yaw(yaw: float) -> np.ndarray:
        with torch.no_grad():
            pose = torch.zeros(5, 3)
            pose[0, 1] = yaw
            pose[1] = neck_pose.detach()
            pose[2] = jaw_pose.detach()
            return model.forward(shape.detach(), expression.detach(), pose).numpy()

    face_indices = None
    if config.flame_masks_path.exists():
        masks = _load_flame_pickle(config.flame_masks_path)
        face_indices = np.asarray(masks.get("face", []), dtype=np.int64)

    try:
        return analyze_side_view(image, verts_for_yaw, face_indices)
    except (PipelineError, ValueError):
        return None


@lru_cache(maxsize=1)
def _face_vertex_indices() -> Optional[np.ndarray]:
    """FLAME_masks의 정면 얼굴 패치 정점 인덱스 (silhouette 손실용)."""
    if not config.flame_masks_path.exists():
        return None

    masks = _load_flame_pickle(config.flame_masks_path)
    face = np.asarray(masks.get("face", []), dtype=np.int64)
    return face if face.size > 0 else None


def _scalp_face_mask(model: FlameModel) -> Optional[np.ndarray]:
    """FLAME_masks의 scalp 정점으로 '세 꼭짓점 모두 두피'인 삼각형 마스크를 만든다."""
    if not config.flame_masks_path.exists():
        return None

    masks = _load_flame_pickle(config.flame_masks_path)
    scalp = np.asarray(masks.get("scalp", []), dtype=np.int64)

    if scalp.size == 0:
        return None

    return np.isin(model.faces, scalp).all(axis=1)


def _collect_observations(view_paths: dict[str, Path]) -> list[ViewObservation]:
    """뷰별 landmark 검출. front는 필수, 나머지는 실패 시 제외한다."""
    observations: list[ViewObservation] = []

    for role in ("front", "angle45", "side"):
        path = view_paths.get(role)
        if path is None:
            continue

        try:
            image = Image.open(path).convert("RGB")
        except OSError as error:
            if role == "front":
                raise PipelineError(
                    "INPUT_DECODE_FAILED", "정면 이미지를 디코딩할 수 없습니다."
                ) from error
            continue

        try:
            detected = detect_face_landmarks(image)
        except PipelineError:
            if role == "front":
                raise
            # 측면/45도에서 얼굴 미검출은 흔하다(특히 90° 프로필). 해당 뷰만 제외.
            continue

        _, _, landmark_indices = _load_embedding()
        width, height = image.size
        target = torch.tensor(
            detected[landmark_indices, :2] * np.array([width, height]),
            dtype=torch.float32,
        )
        observations.append(
            ViewObservation(role=role, image=image, width=width, height=height, target=target)
        )

    if not observations:
        raise PipelineError("FACE_NOT_DETECTED", "얼굴이 인식된 사진이 없습니다.")

    return observations


def _init_camera(
    model: FlameModel, target: torch.Tensor, global_rot: torch.Tensor
) -> tuple[torch.Tensor, torch.Tensor]:
    """모델/타깃 landmark 분산 비율과 중심 정렬로 카메라 초기값을 잡는다."""
    lmk_face_idx, lmk_b_coords, _ = _load_embedding()
    with torch.no_grad():
        pose = torch.zeros(5, 3)
        pose[0] = global_rot
        verts = model.forward(torch.zeros(NUM_SHAPE), torch.zeros(NUM_EXPR), pose)
        pts = model.surface_points(verts, lmk_face_idx, lmk_b_coords)
        model_xy = torch.stack([pts[:, 0], -pts[:, 1]], dim=1)
        scale = (
            (target - target.mean(0)).norm(dim=1).mean()
            / (model_xy - model_xy.mean(0)).norm(dim=1).mean()
        )
        trans = target.mean(0) - scale * model_xy.mean(0)

    return scale.clone(), trans.clone()
