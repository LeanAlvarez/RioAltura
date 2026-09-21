"""Scheduler wiring and clean shutdown on SIGTERM/SIGINT."""

import logging
import signal
from datetime import UTC, datetime

from apscheduler.schedulers.blocking import BlockingScheduler

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
