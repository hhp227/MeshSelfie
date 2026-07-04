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

from app.config import config
from app.jobs import JobCanceled, PipelineError
from app.pipeline.flame_model import FlameModel, NUM_EXPR, NUM_SHAPE, _load_flame_pickle
from app.pipeline.hair_shell import build_hair_shell
from app.pipeline.landmarks import detect_face_landmarks
from app.pipeline.segmentation import detect_hair_mask
from app.pipeline.texture_bake import bake_multiview_texture, generate_uv_atlas

STAGE1_ITERS = 200
STAGE2_ITERS = 600
CANCEL_CHECK_EVERY = 50

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
            bake_views.append(
                {
                    "role": obs.role,
                    "image": np.asarray(obs.image, dtype=np.float32),
                    "width": obs.width,
                    "height": obs.height,
                    "posed_verts": posed.numpy(),
                    "projected_px": projected.numpy(),
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
