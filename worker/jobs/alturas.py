"""Hourly job: fetch the real port gauge level from INA, fall back to Prefectura."""

import logging
from datetime import UTC, datetime, timedelta

import httpx
from app.repositories.alturas import upsert_alturas
from app.repositories.db import get_engine
from sqlalchemy import Engine

from jobs import ina, prefectura
from jobs.http import FuenteError, build_client

logger = logging.getLogger(__name__)

ALTURAS_INTERVAL_SECONDS = 3600
# Delay before the first run after startup. Long enough that short-lived
# processes (like the worker process test) never hit the real sources.
ALTURAS_FIRST_RUN_DELAY_SECONDS = 60

_INA_WINDOW_HORAS = 48
_STALE_AFTER_HORAS = 24


def actualizar_alturas(engine: Engine, client: httpx.Client, now: datetime | None = None) -> dict:
    """Fetch the latest port gauge reading and upsert it.

    Tries INA first (last 48h). Falls back to Prefectura (last 3 days) when
    INA fails, or when none of the INA readings are recent enough (within
    the last 24h) -- but any stale-but-non-empty INA data is upserted too,
    since it is still useful history. If Prefectura also fails, logs an
    error and returns without raising, so the scheduler keeps running.

    Returns a summary dict `{fuente, fetched, inserted}` (fuente is None
    when both sources failed).
    """
    now = now if now is not None else datetime.now(UTC)

    ina_rows = []
    ina_reason: str | None = None
    try:
        ina_rows = ina.fetch_alturas(client, now - timedelta(hours=_INA_WINDOW_HORAS), now)
    except FuenteError as exc:
        ina_reason = str(exc)

    tiene_lectura_reciente = any(
        row.fecha_hora >= now - timedelta(hours=_STALE_AFTER_HORAS) for row in ina_rows
    )

    if ina_reason is None and tiene_lectura_reciente:
        inserted = upsert_alturas(engine, ina_rows)
        logger.info("alturas: fetched %d, inserted %d (fuente=ina)", len(ina_rows), inserted)
        return {"fuente": "ina", "fetched": len(ina_rows), "inserted": inserted}

    # INA failed outright, or returned only stale readings: upsert whatever
    # we got from INA (history is valuable) before falling back.
    ina_inserted = 0
    if ina_rows:
        ina_inserted = upsert_alturas(engine, ina_rows)

    reason = ina_reason if ina_reason is not None else "no reading in the last 24h"
    logger.warning("INA unavailable or stale, falling back to Prefectura: %s", reason)

    try:
        prefectura_rows = prefectura.fetch_alturas(client, dias=3)
    except FuenteError as exc:
        logger.error("Prefectura also failed: %s", exc)
        return {"fuente": None, "fetched": len(ina_rows), "inserted": ina_inserted}

    prefectura_inserted = upsert_alturas(engine, prefectura_rows)
    logger.info(
        "alturas: fetched %d, inserted %d (fuente=prefectura)",
        len(prefectura_rows),
        prefectura_inserted,
    )
    return {
        "fuente": "prefectura",
        "fetched": len(prefectura_rows),
        "inserted": ina_inserted + prefectura_inserted,
    }


def job_actualizar_alturas() -> None:
    """Zero-arg entry point registered with the scheduler. Never raises."""
    try:
        engine = get_engine()
        with build_client() as client:
            actualizar_alturas(engine, client)
    except Exception:
        logger.exception("alturas job failed")
