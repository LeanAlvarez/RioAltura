import logging
from datetime import UTC, datetime

from apscheduler.triggers.interval import IntervalTrigger
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
from jobs.salto_grande import (
    SALTO_GRANDE_FIRST_RUN_DELAY_SECONDS,
    SALTO_GRANDE_INTERVAL_SECONDS,
    job_actualizar_salto_grande,
)
from jobs.scheduler import build_scheduler
from jobs.telegram_avisos import (
    TELEGRAM_AVISOS_FIRST_RUN_DELAY_SECONDS,
    TELEGRAM_AVISOS_INTERVAL_SECONDS,
    job_publicar_avisos_telegram,
)
from jobs.telegram_comandos import (
    TELEGRAM_COMANDOS_FIRST_RUN_DELAY_SECONDS,
    TELEGRAM_COMANDOS_INTERVAL_SECONDS,
    job_procesar_comandos_telegram,
)


def test_registra_el_job_heartbeat_cada_minuto() -> None:
    scheduler = build_scheduler()

    job = scheduler.get_job("heartbeat")

    assert job is not None
    assert isinstance(job.trigger, IntervalTrigger)
    assert job.trigger.interval.total_seconds() == HEARTBEAT_INTERVAL_SECONDS == 60
    assert job.func is heartbeat


def test_registra_el_job_alturas_cada_hora() -> None:
    scheduler = build_scheduler()

    job = scheduler.get_job("alturas")

    assert job is not None
    assert isinstance(job.trigger, IntervalTrigger)
    assert job.trigger.interval.total_seconds() == ALTURAS_INTERVAL_SECONDS == 3600
    assert job.func is job_actualizar_alturas
    # Never runs immediately: the worker process test must not touch real sources.
    delay = (job.next_run_time - datetime.now(UTC)).total_seconds()
    assert 0 < delay <= ALTURAS_FIRST_RUN_DELAY_SECONDS == 60


def test_registra_el_job_pronosticos_cada_6_horas() -> None:
    scheduler = build_scheduler()

    job = scheduler.get_job("pronosticos")

    assert job is not None
    assert isinstance(job.trigger, IntervalTrigger)
    assert job.trigger.interval.total_seconds() == PRONOSTICOS_INTERVAL_SECONDS == 6 * 3600
    assert job.func is job_actualizar_pronosticos
    # Never runs immediately: the worker process test must not touch Google.
    delay = (job.next_run_time - datetime.now(UTC)).total_seconds()
    assert 0 < delay <= PRONOSTICOS_FIRST_RUN_DELAY_SECONDS == 90


def test_registra_el_job_salto_grande_cada_dia() -> None:
    scheduler = build_scheduler()

    job = scheduler.get_job("salto_grande")

    assert job is not None
    assert isinstance(job.trigger, IntervalTrigger)
    assert job.trigger.interval.total_seconds() == SALTO_GRANDE_INTERVAL_SECONDS == 24 * 3600
    assert job.func is job_actualizar_salto_grande
    # Never runs immediately: the worker process test must not touch the real source.
    delay = (job.next_run_time - datetime.now(UTC)).total_seconds()
    assert 0 < delay <= SALTO_GRANDE_FIRST_RUN_DELAY_SECONDS == 150


def test_registra_el_job_telegram_avisos_cada_hora() -> None:
    scheduler = build_scheduler()

    job = scheduler.get_job("telegram_avisos")

    assert job is not None
    assert isinstance(job.trigger, IntervalTrigger)
    assert job.trigger.interval.total_seconds() == TELEGRAM_AVISOS_INTERVAL_SECONDS == 3600
    assert job.func is job_publicar_avisos_telegram
    delay = (job.next_run_time - datetime.now(UTC)).total_seconds()
    assert 0 < delay <= TELEGRAM_AVISOS_FIRST_RUN_DELAY_SECONDS == 120


def test_registra_el_job_telegram_comandos_cada_20s() -> None:
    scheduler = build_scheduler()

    job = scheduler.get_job("telegram_comandos")

    assert job is not None
    assert isinstance(job.trigger, IntervalTrigger)
    assert job.trigger.interval.total_seconds() == TELEGRAM_COMANDOS_INTERVAL_SECONDS == 20
    assert job.func is job_procesar_comandos_telegram
    delay = (job.next_run_time - datetime.now(UTC)).total_seconds()
    assert 0 < delay <= TELEGRAM_COMANDOS_FIRST_RUN_DELAY_SECONDS == 30


def test_heartbeat_solo_loguea(caplog) -> None:
    with caplog.at_level(logging.INFO, logger="jobs.heartbeat"):
        heartbeat()

    assert [r.getMessage() for r in caplog.records] == ["heartbeat"]
