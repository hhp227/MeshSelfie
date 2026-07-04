"""GLB 2.0 내보내기와 자체 검증.

앱의 lib/generation/finalize.ts가 GLB v2 magic/version/length를 검증하므로,
worker에서도 업로드 전에 같은 검증을 미리 수행해 불량 출력을 조기에 잡는다.
"""

import struct
from pathlib import Path

import trimesh

from app.jobs import PipelineError

GLB_MAGIC = 0x46546C67  # 'glTF'


def export_glb(mesh: "trimesh.Trimesh | trimesh.Scene", output_path: Path) -> None:
    try:
        glb_bytes = mesh.export(file_type="glb")
    except Exception as error:  # noqa: BLE001 - trimesh 내부 오류 방어
        raise PipelineError("GLB_EXPORT_FAILED", "GLB 파일 생성에 실패했습니다.") from error

    if not isinstance(glb_bytes, bytes):
        raise PipelineError("GLB_EXPORT_FAILED", "GLB 직렬화 결과가 올바르지 않습니다.")

    _validate_glb(glb_bytes)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(glb_bytes)


def _validate_glb(data: bytes) -> None:
    if len(data) < 12:
        raise PipelineError("INVALID_GLB_OUTPUT", "GLB 헤더가 없습니다.")

    magic, version, length = struct.unpack_from("<III", data, 0)

    if magic != GLB_MAGIC or version != 2 or length != len(data):
        raise PipelineError(
            "INVALID_GLB_OUTPUT", "GLB v2 헤더 또는 파일 길이가 올바르지 않습니다."
        )
