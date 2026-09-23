"""Hourly job: port gauge level from INA, falling back to Prefectura and then CARU."""

import logging
from datetime import UTC, datetime, timedelta

import httpx
from app.repositories.alturas import upsert_alturas
from app.repositories.db import get_engine
from sqlalchemy import Engine

from jobs import caru, ina, prefectura
from jobs.http import FuenteError, build_client

logger = logging.getLogger(__name__)

ALTURAS_INTERVAL_SECONDS = 3600
# Delay before the first run after startup. Long enough that short-lived
# processes (like the worker process test) never hit the real sources.
ALTURAS_FIRST_RUN_DELAY_SECONDS = 60

_INA_WINDOW_HORAS = 48
_STALE_AFTER_HORAS = 24


def _tiene_lectura_reciente(rows: list, now: datetime) -> bool:
    return any(row.fecha_hora >= now - timedelta(hours=_STALE_AFTER_HORAS) for row in rows)


def actualizar_alturas(engine: Engine, client: httpx.Client, now: datetime | None = None) -> dict:
    """Fetch the latest port gauge reading and upsert it.

    Chain: INA (last 48h) -> Prefectura (last 3 days) -> CARU (spec 009).
    Each link is used only if it actually returns a reading from the last
    24h; otherwise the run moves on to the next one. Stale-but-non-empty
    data is still upserted at every step, because old readings are valuable
    history even when they cannot answer "how is the river today".

    **Freshness is checked at every link, not only at INA.** Until spec 009
    the fallback trusted Prefectura as soon as it responded, so on
    2026-09-22 the job reported success with `fuente=prefectura` while every
    row it got was as old as INA's — and a third source would never have
    been reached.

    If no source has a recent reading, logs and returns without raising, so
    the scheduler keeps running. `fuente` is then the last source that
    contributed rows, or None if every one failed.
    """
    now = now if now is not None else datetime.now(UTC)

    total_inserted = 0
    ultima_fuente: str | None = None
    total_fetched = 0

    for nombre, traer in (
        ("ina", lambda: ina.fetch_alturas(client, now - timedelta(hours=_INA_WINDOW_HORAS), now)),
        ("prefectura", lambda: prefectura.fetch_alturas(client, dias=3)),
        ("caru", lambda: caru.fetch_alturas(client)),
    ):
        try:
            rows = traer()
        except FuenteError as exc:
            logger.warning("alturas: %s unavailable: %s", nombre, exc)
            continue

        if not rows:
            logger.warning("alturas: %s returned no rows", nombre)
            continue

        total_fetched += len(rows)
        total_inserted += upsert_alturas(engine, rows)
        ultima_fuente = nombre

        if _tiene_lectura_reciente(rows, now):
            logger.info(
                "alturas: fetched %d, inserted %d (fuente=%s)", len(rows), total_inserted, nombre
            )
            return {"fuente": nombre, "fetched": total_fetched, "inserted": total_inserted}

        logger.warning(
            "alturas: %s has no reading in the last %dh, trying next source",
            nombre,
            _STALE_AFTER_HORAS,
        )

    logger.error("alturas: no source had a recent reading")
    return {"fuente": ultima_fuente, "fetched": total_fetched, "inserted": total_inserted}


def job_actualizar_alturas() -> None:
    """Zero-arg entry point registered with the scheduler. Never raises."""
    try:
        engine = get_engine()
        with build_client() as client:
            actualizar_alturas(engine, client)
        # Spec 020: the quality pass runs right after ingesting, so a bad
        # reading is quarantined before anything reads it -- the forecast
        # anchor, the "Hoy" card or a Telegram alert. Imported here and not
        # at module level to keep the import graph one-way (jobs.calidad
        # already imports from the app layer, not from this module).
        from jobs.calidad import aplicar

        marcados = aplicar(engine)
        total = sum(marcados.values())
        if total:
            logger.warning("alturas: %s lectura(s) en cuarentena %s", total, marcados)
    except Exception:
        logger.exception("alturas job failed")
