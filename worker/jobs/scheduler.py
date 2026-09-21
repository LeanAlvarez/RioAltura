"""Scheduler wiring and clean shutdown on SIGTERM/SIGINT."""

import logging
import signal
from datetime import UTC, datetime, timedelta

from apscheduler.schedulers.blocking import BlockingScheduler

from jobs.alturas import (
    ALTURAS_FIRST_RUN_DELAY_SECONDS,
    ALTURAS_INTERVAL_SECONDS,
    job_actualizar_alturas,
)
from jobs.google import (
    PRONOSTICOS_FIRST_RUN_DELAY_SECONDS,
    PRONOSTICOS_INTERVAL_SECONDS,
    job_actualizar_pronosticos,
)
from jobs.heartbeat import HEARTBEAT_INTERVAL_SECONDS, heartbeat

logger = logging.getLogger(__name__)


def build_scheduler() -> BlockingScheduler:
    scheduler = BlockingScheduler(timezone="UTC")
    scheduler.add_job(
        heartbeat,
        "interval",
        seconds=HEARTBEAT_INTERVAL_SECONDS,
        id="heartbeat",
        # Run once right at startup so a fresh process logs immediately.
        next_run_time=datetime.now(UTC),
    )
    scheduler.add_job(
        job_actualizar_alturas,
        "interval",
        seconds=ALTURAS_INTERVAL_SECONDS,
        id="alturas",
        # First run shortly after startup, not immediately: the sources are
        # external and a fresh process should not hit them before it is
        # healthy. Failures are caught and logged inside the job.
        next_run_time=datetime.now(UTC) + timedelta(seconds=ALTURAS_FIRST_RUN_DELAY_SECONDS),
    )
    scheduler.add_job(
        job_actualizar_pronosticos,
        "interval",
        seconds=PRONOSTICOS_INTERVAL_SECONDS,
        id="pronosticos",
        # Same rationale as "alturas": never touch Google right at startup.
        next_run_time=datetime.now(UTC) + timedelta(seconds=PRONOSTICOS_FIRST_RUN_DELAY_SECONDS),
    )
    return scheduler


def install_signal_handlers(scheduler: BlockingScheduler) -> None:
    def _stop(signum: int, _frame: object) -> None:
        logger.info("received %s, shutting down", signal.Signals(signum).name)
        scheduler.shutdown(wait=False)

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)


def run(scheduler: BlockingScheduler) -> None:
    install_signal_handlers(scheduler)
    logger.info("worker started, jobs: %s", [job.id for job in scheduler.get_jobs()])
    scheduler.start()
    logger.info("worker stopped")
