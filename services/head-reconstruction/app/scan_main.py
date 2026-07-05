"""Photogrammetry Scan Worker API (PRD v2.0) — Modal 네이티브 구조.

재구성(5~20분)은 인메모리 백그라운드 스레드가 아니라 spawn된 Modal GPU
Function으로 실행한다. 백그라운드 스레드는 Modal 스케줄러에 보이지 않아
유휴 회수 때 job이 유실되지만(실측), spawn된 Function 입력은 완료까지
Modal이 추적·유지한다. 상태와 결과 GLB는 Volume(/data)에 영속화되어
API 컨테이너가 재시작돼도 조회·다운로드가 유지된다.

- POST /v1/jobs            {clientJobId, userId, input:{videoUrl?|imageUrls?}}
- GET  /v1/jobs/{id}
- POST /v1/jobs/{id}/cancel
- GET  /files/{id}/mesh.glb
- GET  /healthz
"""

import json
import uuid
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import config

DATA_ROOT = Path("/data")
MODAL_APP_NAME = "meshselfie-scan"
RECONSTRUCT_FUNCTION = "reconstruct"

app = FastAPI(title="MeshSelfie Photogrammetry Scan Worker", version="0.2.0")


class ScanInput(BaseModel):
    videoUrl: Optional[str] = None
    imageUrls: Optional[list[str]] = None
    outputFormat: str = "glb"


class CreateScanRequest(BaseModel):
    clientJobId: str
    userId: str
    model: str = "photogrammetry-colmap-v1"
    input: ScanInput


def verify_bearer(request: Request) -> None:
    if not config.api_key:
        raise HTTPException(
            status_code=500,
            detail={"code": "WORKER_NOT_CONFIGURED", "message": "HEAD_RECON_API_KEY가 설정되지 않았습니다."},
        )

    if request.headers.get("authorization") != f"Bearer {config.api_key}":
        raise HTTPException(
            status_code=401,
            detail={"code": "UNAUTHORIZED", "message": "잘못된 API 키입니다."},
        )


def request_base_url(request: Request) -> str:
    if config.public_base_url:
        return config.public_base_url

    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("host", request.url.netloc)
    return f"{proto}://{host}"


def _reload_volume() -> None:
    """다른 컨테이너(reconstruct)가 커밋한 최신 상태를 본다."""
    try:
        import modal

        modal.Volume.from_name("meshselfie-scan-data").reload()
    except Exception:  # noqa: BLE001 - reload 실패는 조회 지연일 뿐
        pass


def _job_dir(job_id: str) -> Path:
    return DATA_ROOT / job_id


def _read_status(job_id: str) -> Optional[dict]:
    status_path = _job_dir(job_id) / "status.json"

    if not status_path.exists():
        return None

    try:
        return json.loads(status_path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def job_response(job_id: str, state: dict, base_url: str) -> dict:
    body: dict = {"id": job_id, "status": state.get("status", "generating")}

    if body["status"] in ("queued", "generating"):
        if state.get("stage"):
            body["stage"] = state["stage"]
        if isinstance(state.get("progress"), int):
            body["progress"] = state["progress"]

    if body["status"] == "completed" and (_job_dir(job_id) / "mesh.glb").exists():
        body["output"] = {"glbUrl": f"{base_url}/files/{job_id}/mesh.glb"}

        if (_job_dir(job_id) / "thumbnail.jpg").exists():
            body["output"]["thumbnailUrl"] = f"{base_url}/files/{job_id}/thumbnail.jpg"

    if body["status"] == "failed":
        error = state.get("error") or {}
        body["error"] = {
            "code": error.get("code", "PIPELINE_FAILED"),
            "message": error.get("message", "재구성에 실패했습니다."),
        }

    return body


@app.post("/v1/jobs", dependencies=[Depends(verify_bearer)])
def create_job(request: CreateScanRequest, http_request: Request) -> dict:
    import modal

    if request.input.outputFormat != "glb":
        raise HTTPException(
            status_code=400,
            detail={"code": "UNSUPPORTED_OUTPUT_FORMAT", "message": "GLB 출력만 지원합니다."},
        )

    if not request.input.videoUrl and not request.input.imageUrls:
        raise HTTPException(
            status_code=400,
            detail={"code": "SCAN_INPUT_REQUIRED", "message": "동영상 또는 사진 입력이 필요합니다."},
        )

    job_id = uuid.uuid4().hex
    job_dir = _job_dir(job_id)
    job_dir.mkdir(parents=True, exist_ok=True)
    (job_dir / "status.json").write_text(json.dumps({"status": "queued"}))

    reconstruct = modal.Function.from_name(MODAL_APP_NAME, RECONSTRUCT_FUNCTION)
    call = reconstruct.spawn(
        job_id=job_id,
        video_url=request.input.videoUrl,
        image_urls=request.input.imageUrls or [],
    )
    (job_dir / "call_id").write_text(call.object_id)
    modal.Volume.from_name("meshselfie-scan-data").commit()

    return job_response(job_id, {"status": "queued"}, request_base_url(http_request))


@app.get("/v1/jobs/{job_id}", dependencies=[Depends(verify_bearer)])
def get_job(job_id: str, http_request: Request) -> dict:
    _reload_volume()
    state = _read_status(job_id)

    if state is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "JOB_NOT_FOUND", "message": "작업을 찾을 수 없습니다."},
        )

    return job_response(job_id, state, request_base_url(http_request))


@app.post("/v1/jobs/{job_id}/cancel", dependencies=[Depends(verify_bearer)])
def cancel_job(job_id: str, http_request: Request) -> dict:
    import modal

    _reload_volume()
    state = _read_status(job_id)

    if state is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "JOB_NOT_FOUND", "message": "작업을 찾을 수 없습니다."},
        )

    if state.get("status") in ("queued", "generating"):
        call_id_path = _job_dir(job_id) / "call_id"
        if call_id_path.exists():
            try:
                modal.FunctionCall.from_id(call_id_path.read_text().strip()).cancel()
            except Exception:  # noqa: BLE001 - 이미 종료된 call 취소 실패는 무시
                pass

        state = {"status": "canceled"}
        (_job_dir(job_id) / "status.json").write_text(json.dumps(state))
        modal.Volume.from_name("meshselfie-scan-data").commit()

    return job_response(job_id, state, request_base_url(http_request))


@app.get("/files/{job_id}/mesh.glb")
def download_glb(job_id: str) -> FileResponse:
    _reload_volume()
    mesh_path = _job_dir(job_id) / "mesh.glb"
    state = _read_status(job_id)

    if state is None or state.get("status") != "completed" or not mesh_path.exists():
        raise HTTPException(
            status_code=404,
            detail={"code": "FILE_NOT_FOUND", "message": "완료된 GLB가 없습니다."},
        )

    return FileResponse(str(mesh_path), media_type="model/gltf-binary", filename="mesh.glb")


@app.get("/files/{job_id}/thumbnail.jpg")
def download_thumbnail(job_id: str) -> FileResponse:
    _reload_volume()
    thumbnail_path = _job_dir(job_id) / "thumbnail.jpg"
    state = _read_status(job_id)

    if state is None or state.get("status") != "completed" or not thumbnail_path.exists():
        raise HTTPException(
            status_code=404,
            detail={"code": "FILE_NOT_FOUND", "message": "완료된 썸네일이 없습니다."},
        )

    return FileResponse(
        str(thumbnail_path), media_type="image/jpeg", filename="thumbnail.jpg"
    )


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True, "model": "photogrammetry-colmap-v1", "version": "0.3-stages-thumb"}
