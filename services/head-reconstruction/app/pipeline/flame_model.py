"""FLAME 2023 Open 모델 레이어 (PyTorch, 자체 구현).

flame2023_Open.pkl(CC-BY-4.0) 구조:
- v_template (5023, 3), f (9976, 3)
- shapedirs (5023, 3, 400) — 앞 300 shape / 뒤 100 expression
- posedirs (5023, 3, 36) — root 제외 4개 joint의 (R - I) 9성분씩
- J_regressor (5, 5023), weights (5023, 5), kintree_table (2, 5)
- joint 순서: [global, neck, jaw, left_eye, right_eye]

smplx 등 외부 구현은 라이선스가 연구용이라 쓰지 않고, 표준 LBS 수식을
직접 구현한다. chumpy 의존 pkl은 스텁 모듈로 언피클한다.
"""

import pickle
import sys
import types
from pathlib import Path

import numpy as np
import torch

from app.jobs import PipelineError

NUM_SHAPE = 300
NUM_EXPR = 100


def _load_flame_pickle(path: Path) -> dict:
    """chumpy 없이 FLAME pkl을 로드한다(구형 chumpy 배열은 ndarray 서브클래스로 복원됨)."""
    stub = types.ModuleType("chumpy")

    class Ch(np.ndarray):
        pass

    stub.Ch = Ch
    ch_module = types.ModuleType("chumpy.ch")
    ch_module.Ch = Ch
    sys.modules.setdefault("chumpy", stub)
    sys.modules.setdefault("chumpy.ch", ch_module)

    try:
        with path.open("rb") as file:
            return pickle.load(file, encoding="latin1")
    except (OSError, pickle.UnpicklingError) as error:
        raise PipelineError(
            "FLAME_MODEL_LOAD_FAILED",
            "FLAME 모델 파일을 읽을 수 없습니다. models/flame 배치를 확인해주세요.",
        ) from error


def _to_tensor(value, dtype=torch.float32) -> torch.Tensor:
    array = np.asarray(value, dtype=np.float64)
    return torch.tensor(array, dtype=dtype)


class FlameModel:
    """shape/expression/pose → (5023, 3) 정점을 반환하는 미분 가능 FLAME 레이어."""

    def __init__(self, model_path: Path):
        data = _load_flame_pickle(model_path)

        self.faces = np.asarray(data["f"], dtype=np.int64)
        self.v_template = _to_tensor(data["v_template"])
        shapedirs = _to_tensor(data["shapedirs"])
        self.shapedirs = shapedirs[:, :, :NUM_SHAPE]
        self.exprdirs = shapedirs[:, :, NUM_SHAPE : NUM_SHAPE + NUM_EXPR]
        # (5023, 3, 36) → (5023*3, 36) 행렬곱 형태로 준비
        self.posedirs = _to_tensor(data["posedirs"]).reshape(-1, 36)

        j_regressor = data["J_regressor"]
        if hasattr(j_regressor, "toarray"):
            j_regressor = j_regressor.toarray()
        self.j_regressor = _to_tensor(j_regressor)  # (5, 5023)

        self.lbs_weights = _to_tensor(data["weights"])  # (5023, 5)
        kintree = np.asarray(data["kintree_table"], dtype=np.int64)
        parents = kintree[0].copy()
        parents[0] = -1
        self.parents = parents  # (5,)
        self.num_joints = len(parents)

    def forward(
        self,
        shape: torch.Tensor,  # (300,)
        expression: torch.Tensor,  # (100,)
        pose: torch.Tensor,  # (5, 3) axis-angle: [global, neck, jaw, eyeL, eyeR]
    ) -> torch.Tensor:
        v_shaped = (
            self.v_template
            + torch.einsum("vds,s->vd", self.shapedirs, shape)
            + torch.einsum("vde,e->vd", self.exprdirs, expression)
        )

        joints = self.j_regressor @ v_shaped  # (5, 3)
        rot_mats = _batch_rodrigues(pose)  # (5, 3, 3)

        # pose blendshape: root 제외 joint들의 (R - I)
        identity = torch.eye(3, dtype=rot_mats.dtype)
        pose_feature = (rot_mats[1:] - identity).reshape(-1)  # (36,)
        v_posed = v_shaped + (self.posedirs @ pose_feature).reshape(-1, 3)

        # 관절 체인 글로벌 변환 후 rest pose 기준 상대 변환으로 보정: A = T · translate(-J)
        transforms = _rigid_transform_chain(rot_mats, joints, self.parents)
        translate = torch.eye(4).repeat(self.num_joints, 1, 1)
        translate[:, :3, 3] = -joints
        rel_transforms = torch.bmm(transforms, translate)

        # LBS 스키닝
        vertex_transforms = torch.einsum(
            "vj,jab->vab", self.lbs_weights, rel_transforms
        )
        v_homo = torch.cat([v_posed, torch.ones(v_posed.shape[0], 1)], dim=1)
        v_out = torch.einsum("vab,vb->va", vertex_transforms, v_homo)
        return v_out[:, :3]

    def joints(self, shape: torch.Tensor, expression: torch.Tensor) -> torch.Tensor:
        """shape/expression이 반영된 (5, 3) joint 위치 (pose 불변)."""
        v_shaped = (
            self.v_template
            + torch.einsum("vds,s->vd", self.shapedirs, shape)
            + torch.einsum("vde,e->vd", self.exprdirs, expression)
        )
        return self.j_regressor @ v_shaped

    def surface_points(
        self,
        vertices: torch.Tensor,
        face_indices: np.ndarray,
        bary_coords: np.ndarray,
    ) -> torch.Tensor:
        """삼각형 인덱스 + barycentric 좌표로 표면 위 점들을 계산한다 (landmark용)."""
        tri = self.faces[face_indices]  # (L, 3)
        corners = vertices[torch.from_numpy(tri)]  # (L, 3, 3)
        bary = torch.from_numpy(np.asarray(bary_coords, dtype=np.float32))  # (L, 3)
        return torch.einsum("lcb,lc->lb", corners, bary)


def _batch_rodrigues(axis_angle: torch.Tensor) -> torch.Tensor:
    """(J, 3) axis-angle → (J, 3, 3) 회전행렬."""
    angle = torch.linalg.norm(axis_angle + 1e-8, dim=1, keepdim=True)  # (J, 1)
    axis = axis_angle / angle
    cos = torch.cos(angle).unsqueeze(-1)
    sin = torch.sin(angle).unsqueeze(-1)

    zeros = torch.zeros_like(axis[:, 0])
    k = torch.stack(
        [
            zeros, -axis[:, 2], axis[:, 1],
            axis[:, 2], zeros, -axis[:, 0],
            -axis[:, 1], axis[:, 0], zeros,
        ],
        dim=1,
    ).reshape(-1, 3, 3)

    identity = torch.eye(3, dtype=axis_angle.dtype).expand_as(k)
    return identity + sin * k + (1.0 - cos) * torch.bmm(k, k)


def _rigid_transform_chain(
    rot_mats: torch.Tensor, joints: torch.Tensor, parents: np.ndarray
) -> torch.Tensor:
    """관절 로컬 회전을 부모 체인을 따라 누적한 (J, 4, 4) 글로벌 변환."""
    num_joints = len(parents)
    transforms: list[torch.Tensor] = []

    for j in range(num_joints):
        local = torch.eye(4)
        local = local.clone()
        local[:3, :3] = rot_mats[j]
        parent = parents[j]
        if parent < 0:
            local[:3, 3] = joints[j]
            transforms.append(local)
        else:
            local[:3, 3] = joints[j] - joints[parent]
            transforms.append(transforms[parent] @ local)

    return torch.stack(transforms, dim=0)
