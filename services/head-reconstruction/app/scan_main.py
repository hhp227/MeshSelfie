"""Photogrammetry Scan Worker API (PRD v2.0).

기존 /v1/jobs 계약과 동일한 상태 모델을 쓰되, 입력이 동영상 URL 또는
다중 사진 URL이다. FLAME worker(main.py)와 분리 배포된다(GPU 필요).

- POST /v1/jobs            {clientJobId, userId, input:{videoUrl?|imageUrls?}}
- GET  /v1/jobs/{id}
- POST /v1/jobs/{id}/cancel
- GET  /files/{id}/mesh.glb
- GET  /healthz
"""

from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import config
from app.jobs import Job, JobStore
from app.pipeline.photogrammetry import run_scan

app = FastAPI(title="MeshSelfie Photogrammetry Scan Worker", version="0.1.0")
store = JobStore(max_workers=config.max_workers)


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


def job_response(job: Job, base_url: str) -> dict:
    body: dict = {"id": job.id, "status": job.status}

    if job.status == "completed" and job.output_path:
        body["output"] = {"glbUrl": f"{base_url}/files/{job.id}/mesh.glb"}

    if job.status == "failed":
        body["error"] = {
            "code": job.error_code or "PIPELINE_FAILED",
            "message": job.error_message or "재구성에 실패했습니다.",
        }

    return body


@app.post("/v1/jobs", dependencies=[Depends(verify_bearer)])
def create_job(request: CreateScanRequest, http_request: Request) -> dict:
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

    job = store.create(client_job_id=request.clientJobId, user_id=request.userId)
    work_dir = config.data_dir / job.id
    video_url = request.input.videoUrl
    image_urls = request.input.imageUrls or []

    def run(current: Job) -> str:
        output = run_scan(
            work_dir=work_dir,
            video_url=video_url,
            image_urls=image_urls,
            is_canceled=lambda: current.cancel_requested,
        )
        return str(output)

    store.submit(job, run)
    return job_response(job, request_base_url(http_request))


@app.get("/v1/jobs/{job_id}", dependencies=[Depends(verify_bearer)])
def get_job(job_id: str, http_request: Request) -> dict:
    job = store.get(job_id)

    if job is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "JOB_NOT_FOUND", "message": "작업을 찾을 수 없습니다."},
        )

    return job_response(job, request_base_url(http_request))


@app.post("/v1/jobs/{job_id}/cancel", dependencies=[Depends(verify_bearer)])
def cancel_job(job_id: str, http_request: Request) -> dict:
    job = store.request_cancel(job_id)

    if job is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "JOB_NOT_FOUND", "message": "작업을 찾을 수 없습니다."},
        )

    return job_response(job, request_base_url(http_request))


@app.get("/files/{job_id}/mesh.glb")
def download_glb(job_id: str) -> FileResponse:
    job = store.get(job_id)

    if job is None or job.status != "completed" or not job.output_path:
        raise HTTPException(
            status_code=404,
            detail={"code": "FILE_NOT_FOUND", "message": "완료된 GLB가 없습니다."},
        )

    return FileResponse(job.output_path, media_type="model/gltf-binary", filename="mesh.glb")


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True, "model": "photogrammetry-colmap-v1"}
