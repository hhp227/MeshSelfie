"""Signed URL 입력 이미지 다운로드."""

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import requests

from app.config import config
from app.jobs import PipelineError


@dataclass
class ImageInput:
    role: str  # front | side | angle45
    url: str
    direction: Optional[str] = None  # left | right


def download_images(images: list[ImageInput], work_dir: Path) -> dict[str, Path]:
    """역할(role)별로 이미지를 내려받아 로컬 경로 맵을 반환한다."""
    work_dir.mkdir(parents=True, exist_ok=True)
    downloaded: dict[str, Path] = {}

    for image in images:
        target = work_dir / f"input_{image.role}.img"

        try:
            response = requests.get(
                image.url,
                timeout=config.download_timeout_seconds,
                stream=True,
            )
            response.raise_for_status()
        except requests.RequestException as error:
            raise PipelineError(
                "INPUT_DOWNLOAD_FAILED",
                f"{image.role} 이미지를 내려받지 못했습니다.",
            ) from error

        size = 0
        with target.open("wb") as file:
            for chunk in response.iter_content(chunk_size=64 * 1024):
                size += len(chunk)
                if size > config.max_input_bytes:
                    raise PipelineError(
                        "INPUT_TOO_LARGE",
                        f"{image.role} 이미지가 허용 크기를 초과했습니다.",
                    )
                file.write(chunk)

        downloaded[image.role] = target

    if "front" not in downloaded:
        raise PipelineError("FRONT_IMAGE_REQUIRED", "정면 이미지가 필요합니다.")

    return downloaded
