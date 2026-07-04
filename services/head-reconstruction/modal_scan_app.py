"""Photogrammetry Scan Worker의 Modal 배포 (PRD v2.0).

- `scan_api` (CPU): FastAPI — job 생성/조회/취소/GLB 서빙. 상태는 Volume 영속.
- `reconstruct` (T4 GPU): COLMAP 재구성. spawn된 Function 입력이라 완료까지
  Modal이 컨테이너를 유지한다 (백그라운드 스레드 방식의 유휴 회수 유실 방지).

배포:  modal deploy modal_scan_app.py
스모크: modal run modal_scan_app.py
"""

import json

import modal

app = modal.App("meshselfie-scan")

volume = modal.Volume.from_name("meshselfie-scan-data", create_if_missing=True)

image = (
    modal.Image.from_registry("colmap/colmap:latest", add_python="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "fastapi>=0.115",
        "pydantic>=2.7",
        "requests>=2.32",
        "numpy>=1.26",
        "scipy>=1.13",
        "trimesh>=4.4",
        "pillow>=10.3",
        "fast-simplification>=0.1.7",
    )
    .add_local_dir("app", "/root/worker/app", ignore=["**/__pycache__"])
)


@app.function(
    image=image,
    gpu="T4",
    cpu=4.0,
    memory=16384,
    timeout=1800,
    volumes={"/data": volume},
)
def reconstruct(job_id: str, video_url: str | None, image_urls: list[str]) -> None:
    import sys
    from pathlib import Path

    sys.path.insert(0, "/root/worker")

    from app.jobs import JobCanceled, PipelineError
    from app.pipeline.photogrammetry import run_scan

    job_dir = Path("/data") / job_id
    status_path = job_dir / "status.json"

    def write_status(state: dict) -> None:
        status_path.write_text(json.dumps(state))
        volume.commit()

    write_status({"status": "generating"})

    try:
        run_scan(
            work_dir=job_dir,
            video_url=video_url,
            image_urls=image_urls,
            is_canceled=lambda: False,  # 취소는 FunctionCall.cancel()로 처리
        )
    except PipelineError as error:
        write_status(
            {"status": "failed", "error": {"code": error.code, "message": error.message}}
        )
        return
    except JobCanceled:
        write_status({"status": "canceled"})
        return
    except Exception as error:  # noqa: BLE001
        write_status(
            {
                "status": "failed",
                "error": {"code": "PIPELINE_FAILED", "message": f"재구성 실패: {error}"},
            }
        )
        return

    write_status({"status": "completed"})


@app.function(
    image=image,
    cpu=1.0,
    memory=2048,
    timeout=300,
    scaledown_window=300,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("meshselfie-head-recon")],
)
@modal.concurrent(max_inputs=20)
@modal.asgi_app()
def scan_api():
    import sys

    sys.path.insert(0, "/root/worker")

    from app.scan_main import app as fastapi_app

    return fastapi_app


@app.function(image=image, gpu="T4", timeout=300)
def smoke() -> str:
    """colmap/ffmpeg/GPU 가용성 확인."""
    import subprocess

    lines = []
    for cmd in (["colmap", "-h"], ["ffmpeg", "-version"], ["nvidia-smi", "-L"]):
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            output = (result.stdout or result.stderr).strip().splitlines()
            lines.append(f"$ {' '.join(cmd)} → {output[0] if output else '(no output)'}")
        except Exception as error:  # noqa: BLE001
            lines.append(f"$ {' '.join(cmd)} → ERROR: {error}")

    return "\n".join(lines)


@app.local_entrypoint()
def main() -> None:
    print(smoke.remote())
