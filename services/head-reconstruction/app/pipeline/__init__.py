"""생성 파이프라인 오케스트레이터.

Milestone 2 (현재): 검출 가능한 모든 뷰로 shared-identity FLAME fitting을 하고
  UV 아틀라스에 multi-view 텍스처를 베이크한다.
  FLAME 자산(models/flame/)이 없으면 Milestone 0 relief 메쉬로 폴백한다.
Milestone 3 (예정): segmentation 기반 low-detail hair shell 결합.

docs/hybrid-head-reconstruction.md의 파이프라인 설계를 따르며,
각 단계 사이에 취소 여부를 확인한다.
"""

from pathlib import Path
from typing import Callable

from app.jobs import JobCanceled
from app.pipeline.face_mesh import build_face_relief_mesh
from app.pipeline.glb_export import export_glb
from app.pipeline.inputs import ImageInput, download_images


def run_pipeline(
    images: list[ImageInput],
    work_dir: Path,
    is_canceled: Callable[[], bool],
) -> Path:
    """입력 이미지들로 GLB를 생성하고 파일 경로를 반환한다."""

    def check_canceled() -> None:
        if is_canceled():
            raise JobCanceled()

    check_canceled()
    downloaded = download_images(images, work_dir)

    check_canceled()
    # torch import 비용이 있어 FLAME 경로는 지연 로드한다.
    from app.pipeline.flame_fitting import build_flame_head_mesh, flame_assets_available

    if flame_assets_available():
        # Milestone 2: 검출 가능한 모든 뷰(front 필수)로 multi-view fitting + 텍스처 베이크
        mesh = build_flame_head_mesh(downloaded, is_canceled=is_canceled)
    else:
        # Milestone 0 폴백: FLAME 자산이 없는 환경(E2E 배관 검증용)
        mesh = build_face_relief_mesh(downloaded["front"])

    check_canceled()
    output_path = work_dir / "mesh.glb"
    export_glb(mesh, output_path)

    # 썸네일은 best-effort — 실패해도 GLB 생성은 성공으로 처리한다
    try:
        from app.pipeline.thumbnail import render_thumbnail

        render_thumbnail(mesh, work_dir / "thumbnail.jpg")
    except Exception:  # noqa: BLE001
        pass

    return output_path
