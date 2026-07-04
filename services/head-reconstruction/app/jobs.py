"""인메모리 job 저장소와 백그라운드 실행기.

MVP 제약: 프로세스가 재시작되면 진행 중이던 job 정보가 사라진다.
그 경우 앱의 상태 폴링이 404를 받아 해당 generation job은 실패 처리된다.
스케일아웃(다중 워커 컨테이너)이 필요해지면 Redis 등 외부 저장소로 교체한다.
"""

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Optional


class JobCanceled(Exception):
    """사용자 요청으로 job이 취소되었을 때 파이프라인 내부에서 발생시킨다."""


class PipelineError(Exception):
    """오류 코드와 사용자 노출 가능 메시지를 함께 담는 파이프라인 오류."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class Job:
    id: str
    client_job_id: str
    user_id: str
    status: str = "queued"  # queued | generating | completed | failed | canceled
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    output_path: Optional[str] = None
    cancel_requested: bool = False
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class JobStore:
    def __init__(self, max_workers: int):
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=max_workers)

    def create(self, client_job_id: str, user_id: str) -> Job:
        job = Job(id=uuid.uuid4().hex, client_job_id=client_job_id, user_id=user_id)
        with self._lock:
            self._jobs[job.id] = job
        return job

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def request_cancel(self, job_id: str) -> Optional[Job]:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            job.cancel_requested = True
            if job.status in ("queued", "generating"):
                job.status = "canceled"
            return job

    def submit(self, job: Job, run: Callable[[Job], str]) -> None:
        """run(job)은 완료된 GLB 파일 경로를 반환해야 한다."""

        def _execute() -> None:
            with self._lock:
                if job.cancel_requested:
                    job.status = "canceled"
                    return
                job.status = "generating"

            try:
                output_path = run(job)
            except JobCanceled:
                with self._lock:
                    job.status = "canceled"
            except PipelineError as error:
                with self._lock:
                    job.status = "failed"
                    job.error_code = error.code
                    job.error_message = error.message
            except Exception as error:  # noqa: BLE001 - 마지막 방어선
                with self._lock:
                    job.status = "failed"
                    job.error_code = "PIPELINE_FAILED"
                    job.error_message = f"Unexpected pipeline failure: {error}"
            else:
                with self._lock:
                    # 실행 도중 취소 요청이 들어왔다면 취소 상태를 유지한다.
                    if job.cancel_requested:
                        job.status = "canceled"
                    else:
                        job.output_path = output_path
                        job.status = "completed"

        self._executor.submit(_execute)
