"""Photogrammetry Scan Worker의 Modal 배포 (PRD v2.0, GPU).

COLMAP dense(patch-match stereo)가 CUDA 전용이라 T4 GPU에서 실행한다.

배포:
    modal deploy modal_scan_app.py
스모크 테스트 (colmap/ffmpeg/GPU 확인):
    modal run modal_scan_app.py
"""

import modal

app = modal.App("meshselfie-scan")

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
    .env({"HEAD_RECON_DATA_DIR": "/tmp/scan-data"})
    .add_local_dir("app", "/root/worker/app", ignore=["**/__pycache__"])
)


@app.function(
    image=image,
    gpu="T4",
    cpu=4.0,
    memory=16384,
    timeout=1800,
    scaledown_window=300,
    max_containers=1,
    secrets=[modal.Secret.from_name("meshselfie-head-recon")],
)
@modal.concurrent(max_inputs=10)
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
