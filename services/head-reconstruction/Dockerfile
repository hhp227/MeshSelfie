# Milestone 0: CPU 전용 이미지. FLAME fitting 도입 시 CUDA base로 교체한다.
FROM python:3.12-slim

# mediapipe/opencv 런타임 의존성
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/worker

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV HEAD_RECON_PORT=8100 \
    HEAD_RECON_DATA_DIR=/srv/worker/data

EXPOSE 8100

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
