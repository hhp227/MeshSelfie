"""PRD v2.0: Photogrammetry 기본 복원 엔진 (COLMAP).

입력(동영상 또는 다중 사진) → 프레임 추출 → COLMAP automatic_reconstructor
(SfM sparse + CUDA dense + Poisson meshing) → 최대 연결 컴포넌트 추출 →
쿼드릭 간소화(정점색 보존) → vertex-color GLB.

- dense 단계(patch-match stereo)는 CUDA 전용이라 GPU 컨테이너에서 실행한다.
- AI Enhancement(메쉬 정리 고도화, 텍스처 향상)는 후속 단계에서 이 출력에
  연결한다 (PRD v2.0 §2).
"""

import shutil
import subprocess
from pathlib import Path
from typing import Callable, Optional

import numpy as np
import requests
import trimesh

from app.jobs import JobCanceled, PipelineError

FRAME_FPS = 4
MAX_FRAMES = 72
MIN_FRAMES = 15
MAX_VIDEO_BYTES = 300 * 1024 * 1024
MAX_IMAGE_BYTES = 15 * 1024 * 1024
FRAME_MAX_WIDTH = 1600
TARGET_FACES = 200_000
COLMAP_TIMEOUT_S = 1500
DOWNLOAD_TIMEOUT_S = 120


def run_scan(
    work_dir: Path,
    video_url: Optional[str],
    image_urls: list[str],
    is_canceled: Callable[[], bool],
) -> Path:
    def check_canceled() -> None:
        if is_canceled():
            raise JobCanceled()

    work_dir.mkdir(parents=True, exist_ok=True)
    frames_dir = work_dir / "frames"
    frames_dir.mkdir(exist_ok=True)

    check_canceled()

    if video_url:
        video_path = _download(video_url, work_dir / "input_video", MAX_VIDEO_BYTES)
        _extract_frames(video_path, frames_dir)
    elif image_urls:
        for index, url in enumerate(image_urls[:MAX_FRAMES]):
            _download(url, frames_dir / f"photo_{index:04d}.jpg", MAX_IMAGE_BYTES)
    else:
        raise PipelineError("SCAN_INPUT_REQUIRED", "동영상 또는 사진 입력이 필요합니다.")

    frame_count = len(list(frames_dir.iterdir()))
    if frame_count < MIN_FRAMES:
        raise PipelineError(
            "NOT_ENOUGH_FRAMES",
            f"재구성에는 최소 {MIN_FRAMES}장이 필요합니다 (현재 {frame_count}장). "
            "더 긴 영상이나 더 많은 사진을 업로드해주세요.",
        )

    check_canceled()
    workspace = work_dir / "colmap"
    workspace.mkdir(exist_ok=True)
    _run_colmap(frames_dir, workspace)

    check_canceled()
    mesh = _load_reconstructed_mesh(workspace)
    mesh = _postprocess_mesh(mesh)

    output_path = work_dir / "mesh.glb"
    glb_bytes = mesh.export(file_type="glb")
    output_path.write_bytes(glb_bytes)
    return output_path


def _download(url: str, target: Path, max_bytes: int) -> Path:
    try:
        response = requests.get(url, stream=True, timeout=DOWNLOAD_TIMEOUT_S)
        response.raise_for_status()
    except requests.RequestException as error:
        raise PipelineError(
            "SCAN_INPUT_DOWNLOAD_FAILED", "입력 파일을 내려받지 못했습니다."
        ) from error

    size = 0
    with target.open("wb") as file:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            size += len(chunk)
            if size > max_bytes:
                raise PipelineError(
                    "SCAN_INPUT_TOO_LARGE", "입력 파일이 허용 크기를 초과했습니다."
                )
            file.write(chunk)

    return target


def _extract_frames(video_path: Path, frames_dir: Path) -> None:
    """ffmpeg로 프레임 추출 (fps 제한 + 다운스케일 + 총량 제한)."""
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(video_path),
        "-vf",
        f"fps={FRAME_FPS},scale='min({FRAME_MAX_WIDTH},iw)':-2",
        "-frames:v",
        str(MAX_FRAMES),
        "-q:v",
        "2",
        str(frames_dir / "frame_%04d.jpg"),
    ]

    try:
        subprocess.run(command, check=True, capture_output=True, timeout=300)
    except subprocess.CalledProcessError as error:
        raise PipelineError(
            "FRAME_EXTRACTION_FAILED",
            "동영상에서 프레임을 추출하지 못했습니다. MP4/MOV 형식을 확인해주세요.",
        ) from error
    except subprocess.TimeoutExpired as error:
        raise PipelineError(
            "FRAME_EXTRACTION_TIMEOUT", "동영상 처리 시간이 초과됐습니다."
        ) from error


def _run_colmap(frames_dir: Path, workspace: Path) -> None:
    """COLMAP automatic_reconstructor: sparse + dense + poisson meshing."""
    command = [
        "colmap",
        "automatic_reconstructor",
        "--workspace_path",
        str(workspace),
        "--image_path",
        str(frames_dir),
        "--dense",
        "1",
        "--quality",
        "medium",
        "--single_camera",
        "1",
        "--use_gpu",
        "1",
    ]

    try:
        result = subprocess.run(
            command, capture_output=True, timeout=COLMAP_TIMEOUT_S, text=True
        )
    except subprocess.TimeoutExpired as error:
        raise PipelineError(
            "RECONSTRUCTION_TIMEOUT", "3D 재구성 시간이 초과됐습니다."
        ) from error

    if result.returncode != 0:
        raise PipelineError(
            "RECONSTRUCTION_FAILED",
            "3D 재구성에 실패했습니다. 프레임 간 겹침이 충분한지 확인해주세요.",
        )


def _load_reconstructed_mesh(workspace: Path) -> trimesh.Trimesh:
    candidates = sorted(workspace.glob("dense/*/meshed-poisson.ply"))
    if not candidates:
        candidates = sorted(workspace.glob("dense/*/fused.ply"))

    if not candidates:
        raise PipelineError(
            "RECONSTRUCTION_EMPTY",
            "재구성 결과가 비어 있습니다. 조명이 균일하고 겹침이 많은 입력을 사용해주세요.",
        )

    loaded = trimesh.load(str(candidates[0]))

    if isinstance(loaded, trimesh.points.PointCloud) or len(loaded.faces) == 0:
        raise PipelineError(
            "RECONSTRUCTION_NO_MESH", "메쉬 생성에 실패했습니다 (점군만 생성됨)."
        )

    return loaded


def _postprocess_mesh(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """최대 컴포넌트 추출 → 간소화(정점색 최근접 이전) → 정규화."""
    components = mesh.split(only_watertight=False)
    if len(components) > 1:
        mesh = max(components, key=lambda m: len(m.faces))

    original_vertices = np.asarray(mesh.vertices)
    original_colors = None
    if mesh.visual.kind == "vertex" and mesh.visual.vertex_colors is not None:
        original_colors = np.asarray(mesh.visual.vertex_colors)

    if len(mesh.faces) > TARGET_FACES:
        try:
            import fast_simplification

            points, faces = fast_simplification.simplify(
                np.asarray(mesh.vertices, dtype=np.float32),
                np.asarray(mesh.faces, dtype=np.int64),
                target_count=TARGET_FACES,
            )
            simplified = trimesh.Trimesh(vertices=points, faces=faces, process=False)

            if original_colors is not None:
                from scipy.spatial import cKDTree

                _, nearest = cKDTree(original_vertices).query(points)
                simplified.visual = trimesh.visual.ColorVisuals(
                    simplified, vertex_colors=original_colors[nearest]
                )

            mesh = simplified
        except ImportError:
            pass  # 간소화 실패는 치명적이지 않다 — 원본 크기로 진행

    return mesh
