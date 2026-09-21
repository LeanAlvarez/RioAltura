"""Spawns the real worker process and checks it stops cleanly on SIGTERM."""

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

WORKER_DIR = Path(__file__).resolve().parents[1]


def _wait_for(log: Path, needle: str, proc: subprocess.Popen[bytes], timeout: float) -> str:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        text = log.read_text(errors="replace")
        if needle in text:
            return text
        if proc.poll() is not None:
            break
        time.sleep(0.1)
    raise AssertionError(
        f"'{needle}' not seen in worker output within {timeout}s:\n{log.read_text()}"
    )


def test_arranca_loguea_heartbeat_y_termina_limpio_con_sigterm(tmp_path: Path) -> None:
    log = tmp_path / "worker.log"
    env = {**os.environ, "LOG_LEVEL": "INFO", "PYTHONUNBUFFERED": "1"}
    with log.open("wb") as sink:
        proc = subprocess.Popen(
            [sys.executable, "-m", "jobs"],
            cwd=WORKER_DIR,
            env=env,
            stdout=sink,
            stderr=subprocess.STDOUT,
        )
    try:
        _wait_for(log, "worker started", proc, timeout=15)
        _wait_for(log, "jobs.heartbeat: heartbeat", proc, timeout=15)

        proc.send_signal(signal.SIGTERM)
        output = _wait_for(log, "worker stopped", proc, timeout=15)

        assert proc.wait(timeout=15) == 0
        assert "received SIGTERM" in output
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
