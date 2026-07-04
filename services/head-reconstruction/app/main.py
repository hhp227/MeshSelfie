"""Head Reconstruction Worker API.

Next.js 앱의 lib/ai/providers/head-reconstruction.ts 어댑터가 기대하는 계약을
구현한다 (docs/hybrid-head-reconstruction.md 5절):

- POST /v1/jobs            생성 (Bearer 인증)
- GET  /v1/jobs/{id}       상태 조회 (Bearer 인증)
- POST /v1/jobs/{id}/cancel 취소 (Bearer 인증)
- GET  /files/{id}/mesh.glb 완료 GLB 다운로드 (무인증 — 랜덤 job id가 capability 역할)
- GET  /healthz            헬스체크

실행: uvicorn app.main:app --host 0.0.0.0 --port 8100
"""

from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.config import config
from app.jobs import Job, JobStore
from app.pipeline import run_pipeline
from app.pipeline.inputs import ImageInput

app = FastAPI(title="MeshSelfie Head Reconstruction Worker", version="0.1.0")
store = JobStore(max_workers=config.max_workers)


class JobImage(BaseModel):
    role: str = Field(pattern="^(front|side|angle45)$")
    url: str
    direction: Optional[str] = None


class JobInput(BaseModel):
    images: list[JobImage]
    targetRegion: str = "head_neck"
    faceDetail: str = "high"
    hairDetail: str = "low"
    outputFormat: str = "glb"


class CreateJobRequest(BaseModel):
    clientJobId: str
    userId: str
    model: str = config.model_name
    input: JobInput


def verify_bearer(request: Request) -> None:
    if not config.api_key:
        raise HTTPException(
            status_code=500,
            detail={"code": "WORKER_NOT_CONFIGURED", "message": "HEAD_RECON_API_KEY가 설정되지 않았습니다."},
        )

    authorization = request.headers.get("authorization", "")

    if authorization != f"Bearer {config.api_key}":
        raise HTTPException(
            status_code=401,
            detail={"code": "UNAUTHORIZED", "message": "잘못된 API 키입니다."},
        )


def request_base_url(request: Request) -> str:
    """공개 base URL. 환경 변수가 없으면 요청 헤더에서 유도한다(프록시 대응)."""
    if config.public_base_url:
        return config.public_base_url

    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("host", request.url.netloc)
    return f"{proto}://{host}"


def job_response(job: Job, base_url: str) -> dict:
    body: dict = {"id": job.id, "status": job.status}

    if job.status == "completed" and job.output_path:
        output: dict = {"glbUrl": f"{base_url}/files/{job.id}/mesh.glb"}

        if (config.data_dir / job.id / "thumbnail.jpg").exists():
            output["thumbnailUrl"] = f"{base_url}/files/{job.id}/thumbnail.jpg"

        body["output"] = output

    if job.status == "failed":
        body["error"] = {
            "code": job.error_code or "PIPELINE_FAILED",
            "message": job.error_message or "생성에 실패했습니다.",
        }

    return body


@app.post("/v1/jobs", dependencies=[Depends(verify_bearer)])
def create_job(request: CreateJobRequest, http_request: Request) -> dict:
    if request.input.outputFormat != "glb":
        raise HTTPException(
            status_code=400,
            detail={"code": "UNSUPPORTED_OUTPUT_FORMAT", "message": "GLB 출력만 지원합니다."},
        )

    images = [
        ImageInput(role=image.role, url=image.url, direction=image.direction)
        for image in request.input.images
    ]

    if not any(image.role == "front" for image in images):
        raise HTTPException(
            status_code=400,
            detail={"code": "FRONT_IMAGE_REQUIRED", "message": "정면 이미지가 필요합니다."},
        )

    job = store.create(client_job_id=request.clientJobId, user_id=request.userId)
    work_dir = config.data_dir / job.id

    def run(current: Job) -> str:
        output = run_pipeline(
            images=images,
            work_dir=work_dir,
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


class ValidateImageItem(BaseModel):
    role: str = Field(pattern="^(front|side|angle45)$")
    url: str


class ValidateRequest(BaseModel):
    images: list[ValidateImageItem]


@app.post("/v1/validate", dependencies=[Depends(verify_bearer)])
def validate_images(request: ValidateRequest) -> dict:
    """이미지 품질 메트릭 계산. 정책 판정은 앱 쪽에서 수행한다."""
    import shutil
    import tempfile

    from PIL import Image as PILImage

    from app.pipeline.inputs import download_images
    from app.pipeline.validation import validate_image

    images = [ImageInput(role=item.role, url=item.url) for item in request.images]
    config.data_dir.mkdir(parents=True, exist_ok=True)
    work_dir = Path(tempfile.mkdtemp(prefix="validate-", dir=str(config.data_dir)))
    results: dict[str, dict] = {}

    try:
        downloaded = download_images(images, work_dir)

        for role, path in downloaded.items():
            try:
                image = PILImage.open(path).convert("RGB")
            except OSError:
                results[role] = {"error": "DECODE_FAILED"}
                continue

            results[role] = validate_image(image)
    except PipelineError as error:
        raise HTTPException(
            status_code=422,
            detail={"code": error.code, "message": error.message},
        ) from error
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

    return {"results": results}


@app.get("/files/{job_id}/mesh.glb")
def download_glb(job_id: str) -> FileResponse:
    job = store.get(job_id)

    if job is None or job.status != "completed" or not job.output_path:
        raise HTTPException(
            status_code=404,
            detail={"code": "FILE_NOT_FOUND", "message": "완료된 GLB가 없습니다."},
        )

    return FileResponse(job.output_path, media_type="model/gltf-binary", filename="mesh.glb")


@app.get("/files/{job_id}/thumbnail.jpg")
def download_thumbnail(job_id: str) -> FileResponse:
    job = store.get(job_id)
    thumbnail_path = config.data_dir / job_id / "thumbnail.jpg"

    if job is None or job.status != "completed" or not thumbnail_path.exists():
        raise HTTPException(
            status_code=404,
            detail={"code": "FILE_NOT_FOUND", "message": "썸네일이 없습니다."},
        )

    return FileResponse(thumbnail_path, media_type="image/jpeg", filename="thumbnail.jpg")


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True, "model": config.model_name}
