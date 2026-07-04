"""Modal 서버리스 배포 래퍼.

배포:
    modal secret create meshselfie-head-recon HEAD_RECON_API_KEY=<강한 랜덤 키>
    modal deploy modal_app.py
    # 출력된 https://...modal.run URL을 앱 .env.local의 HEAD_RECONSTRUCTION_API_URL로 설정

설계 메모:
- 파이프라인은 CPU 전용(torch CPU)이라 GPU 없이 cpu=8로 실행한다.
- worker의 job 저장소가 인메모리이므로 max_containers=1로 모든 요청을 한
  컨테이너에 고정하고, scaledown_window(5분) 안에 폴링이 이어지는 동안
  컨테이너가 유지된다. 컨테이너가 회수되면 진행 중 job은 유실되고 앱 폴링이
  404를 받아 해당 generation job은 실패 처리된다(허용된 MVP 제약,
  README "MVP 제약" 참고).
- 공개 URL은 worker가 요청 Host 헤더에서 자동 유도하므로 미리 설정할 필요 없다.
"""

import modal

app = modal.App("meshselfie-head-recon")

image = (
    modal.Image.debian_slim(python_version="3.12")
    # libegl1/libgles2: mediapipe가 소프트웨어 GL 컨텍스트 초기화에 요구
    .apt_install("libgl1", "libglib2.0-0", "libegl1", "libgles2")
    .pip_install(
        "fastapi>=0.115",
        "pydantic>=2.7",
        "requests>=2.32",
        "numpy>=1.26",
        "scipy>=1.13",
        "pillow>=10.3",
        "trimesh>=4.4",
        "mediapipe>=0.10.14",
        "xatlas>=0.0.9",
    )
    .pip_install("torch>=2.4", index_url="https://download.pytorch.org/whl/cpu")
    .env({"HEAD_RECON_DATA_DIR": "/tmp/head-recon-data"})
    .add_local_dir("models", "/root/worker/models", ignore=["**/__pycache__", "*.tmp"])
    .add_local_dir("app", "/root/worker/app", ignore=["**/__pycache__"])
)


@app.function(
    image=image,
    cpu=8.0,
    memory=8192,
    timeout=900,
    scaledown_window=300,
    max_containers=1,
    secrets=[modal.Secret.from_name("meshselfie-head-recon")],
)
@modal.concurrent(max_inputs=20)
@modal.asgi_app()
def api():
    import sys

    sys.path.insert(0, "/root/worker")

    from app.main import app as fastapi_app

    return fastapi_app
