"""One background download at a time, with progress the UI can watch.

Fetching a month of 1-minute candles is nine requests paced to the plan's
rate limit, so it takes about a minute. Doing that inside the request that asked
for it left the UI with a spinner and nothing to say; worse, a browser or proxy
timeout would abandon a download that was still spending credits.

So a download runs on its own thread and reports as it goes. Only one runs at a
time - the rate limiter would serialise them anyway, and two downloads competing
for the same credits is never what anyone wants.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class Job:
    kind: str                 # "import" | "download" | "update"
    symbol: str               # symbol id, or the provider ticker for an import
    label: str                # what to show while it runs
    state: str = "running"    # running | done | error
    message: str = ""
    pages_done: int = 0
    pages_total: int = 0
    bars: int = 0             # candles kept
    padded: int = 0           # candles dropped as out-of-hours padding
    credits: int = 0
    # When the rate limiter expects to release the next request. Kept apart from
    # `message` so the progress text stays factual and the pause can count down.
    waiting_until: float | None = None
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    error: str | None = None
    result: dict[str, Any] | None = None

    def payload(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "symbol": self.symbol,
            "label": self.label,
            "state": self.state,
            "message": self.message,
            "pagesDone": self.pages_done,
            "pagesTotal": self.pages_total,
            "bars": self.bars,
            "padded": self.padded,
            "credits": self.credits,
            "waitingSeconds": (
                max(0, round(self.waiting_until - time.time()))
                if self.waiting_until and self.state == "running"
                else 0
            ),
            "startedAt": int(self.started_at),
            "finishedAt": int(self.finished_at) if self.finished_at else None,
            "elapsedSeconds": round((self.finished_at or time.time()) - self.started_at, 1),
            "error": self.error,
            "result": self.result,
        }


class JobRunner:
    """Holds the running job, and the last finished one so its result survives."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._job: Job | None = None
        self._thread: threading.Thread | None = None

    @property
    def busy(self) -> bool:
        with self._lock:
            return self._job is not None and self._job.state == "running"

    def current(self) -> dict[str, Any] | None:
        with self._lock:
            return self._job.payload() if self._job else None

    def start(self, kind: str, symbol: str, label: str, work: Callable[[Job], dict]) -> dict:
        """Run `work` on a thread. It receives the Job and updates it as it goes."""
        with self._lock:
            if self._job is not None and self._job.state == "running":
                raise RuntimeError(
                    f"already downloading {self._job.symbol}; wait for it to finish"
                )
            job = Job(kind=kind, symbol=symbol, label=label)
            self._job = job

        def run() -> None:
            try:
                job.result = work(job)
                job.state = "done"
                job.message = job.message or "Finished"
            except Exception as exc:  # noqa: BLE001 - reported through the job, never fatal
                job.state = "error"
                job.error = str(exc)
                job.message = "Failed"
            finally:
                job.finished_at = time.time()

        self._thread = threading.Thread(target=run, name=f"job-{kind}", daemon=True)
        self._thread.start()
        return job.payload()

    def clear(self) -> None:
        """Forget a finished job, so the UI stops showing its result."""
        with self._lock:
            if self._job is not None and self._job.state != "running":
                self._job = None


jobs = JobRunner()
