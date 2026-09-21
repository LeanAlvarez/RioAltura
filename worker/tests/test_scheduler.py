import logging

from apscheduler.triggers.interval import IntervalTrigger
from jobs.heartbeat import HEARTBEAT_INTERVAL_SECONDS, heartbeat
from jobs.scheduler import build_scheduler


def test_registra_el_job_heartbeat_cada_minuto() -> None:
    scheduler = build_scheduler()

    job = scheduler.get_job("heartbeat")

    assert job is not None
    assert isinstance(job.trigger, IntervalTrigger)
    assert job.trigger.interval.total_seconds() == HEARTBEAT_INTERVAL_SECONDS == 60
    assert job.func is heartbeat


def test_heartbeat_solo_loguea(caplog) -> None:
    with caplog.at_level(logging.INFO, logger="jobs.heartbeat"):
        heartbeat()

    assert [r.getMessage() for r in caplog.records] == ["heartbeat"]
