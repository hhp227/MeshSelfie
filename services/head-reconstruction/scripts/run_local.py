"""API 서버 없이 파이프라인만 로컬 이미지로 실행하는 검증 스크립트.

사용 예:
    python scripts/run_local.py --front ../../image/front.jpg --out ./out/mesh.glb
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.pipeline.face_mesh import build_face_relief_mesh  # noqa: E402
from app.pipeline.glb_export import export_glb  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="파이프라인 로컬 실행 (FLAME 우선, 폴백 relief)")
    parser.add_argument("--front", required=True, help="정면 사진 경로 (JPG/PNG)")
    parser.add_argument("--side", help="측면 사진 경로 (선택)")
    parser.add_argument("--angle45", help="45도 사진 경로 (선택)")
    parser.add_argument("--out", default="./out/mesh.glb", help="출력 GLB 경로")
    parser.add_argument(
        "--relief", action="store_true", help="FLAME 자산이 있어도 Milestone 0 relief 강제"
    )
    args = parser.parse_args()

    front = Path(args.front)
    if not front.exists():
        raise SystemExit(f"입력 파일이 없습니다: {front}")

    views = {"front": front}
    for role, value in (("side", args.side), ("angle45", args.angle45)):
        if value:
            path = Path(value)
            if not path.exists():
                raise SystemExit(f"입력 파일이 없습니다: {path}")
            views[role] = path

    from app.pipeline.flame_fitting import build_flame_head_mesh, flame_assets_available

    if not args.relief and flame_assets_available():
        print("FLAME multi-view fitting 파이프라인 (Milestone 2)")
        mesh = build_flame_head_mesh(views)
        loss = mesh.metadata.get("flame_landmark_loss")
        if loss is not None:
            print(f"landmark loss (정규화 MSE): {loss:.6f}")
        print(f"사용된 뷰: {mesh.metadata.get('views_used')}")
        print(f"hair shell: {mesh.metadata.get('hair_shell')}, 측면 프로파일: {mesh.metadata.get('side_profile_used')}")
    else:
        print("relief 파이프라인 (Milestone 0)")
        mesh = build_face_relief_mesh(front)

    output = Path(args.out)
    export_glb(mesh, output)

    print(f"완료: {output} ({output.stat().st_size:,} bytes)")

    import trimesh

    if isinstance(mesh, trimesh.Scene):
        for name, geom in mesh.geometry.items():
            print(f"- {name}: 정점 {len(geom.vertices):,}개, 삼각형 {len(geom.faces):,}개")
    else:
        print(f"정점 {len(mesh.vertices):,}개, 삼각형 {len(mesh.faces):,}개")


if __name__ == "__main__":
    main()
