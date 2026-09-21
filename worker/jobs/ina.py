"""Client for the INA (Instituto Nacional del Agua) port gauge series.

API: https://alerta.ina.gob.ar/a5. Series 80 is the Colón water level
(var_id=2), see `app.config.dominio`.
"""

import argparse
import logging
import time
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta

import httpx
from app.config.dominio import INA_SERIE_ALTURA_COLON
from app.logging_config import configure_logging
from app.repositories.alturas import AlturaIn, upsert_alturas
from app.repositories.db import get_engine
from sqlalchemy import Engine

from jobs.http import FuenteError, build_client, get_with_retries

logger = logging.getLogger(__name__)

INA_BASE_URL = "https://alerta.ina.gob.ar/a5"

_TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"

# Default window size for the backfill, per spec.
_BACKFILL_WINDOW_DAYS_DEFAULT = 90
_BACKFILL_PAUSE_S = 0.5


def observaciones_url(serie_id: int) -> str:
    return f"{INA_BASE_URL}/obs/puntual/series/{serie_id}/observaciones"


def parse_observaciones(payload: list[dict]) -> list[AlturaIn]:
    """Parse the INA observaciones payload into readings.

    Entries with a null `valor` are skipped (no reading yet for that
    timestamp). A payload that is not a list (e.g. the INA error shape
    `{"message": ..., "error": ...}`) raises `FuenteError`.
    """
    if not isinstance(payload, list):
        raise FuenteError(f"unexpected INA payload shape: {payload!r}")

    rows: list[AlturaIn] = []
    for entry in payload:
        valor = entry.get("valor")
        if valor is None:
            continue
        fecha_hora = datetime.fromisoformat(entry["timestart"].replace("Z", "+00:00")).astimezone(
            UTC
        )
        rows.append(AlturaIn(fecha_hora=fecha_hora, altura_m=float(valor), fuente="ina"))
    return rows


def fetch_alturas(
    client: httpx.Client,
    desde: datetime,
    hasta: datetime,
    serie_id: int = INA_SERIE_ALTURA_COLON,
) -> list[AlturaIn]:
    """Fetch readings for `serie_id` in [desde, hasta] (both UTC-aware)."""
    params = {
        "timestart": desde.astimezone(UTC).strftime(_TIMESTAMP_FORMAT),
        "timeend": hasta.astimezone(UTC).strftime(_TIMESTAMP_FORMAT),
    }
    try:
        response = get_with_retries(client, observaciones_url(serie_id), params=params)
    except httpx.HTTPError as exc:
        raise FuenteError(f"INA request failed: {exc}") from exc

    try:
        payload = response.json()
    except ValueError as exc:
        raise FuenteError(f"INA response is not valid JSON: {exc}") from exc

    return parse_observaciones(payload)


def _windows(desde: date, hasta: date, window_days: int) -> list[tuple[date, date]]:
    """Split [desde, hasta] into consecutive, non-overlapping windows.

    Each window covers up to `window_days` days; windows abut (the next
    window starts the day after the previous one ends).
    """
    windows: list[tuple[date, date]] = []
    inicio = desde
    while inicio <= hasta:
        fin = min(inicio + timedelta(days=window_days - 1), hasta)
        windows.append((inicio, fin))
        inicio = fin + timedelta(days=1)
    return windows


def backfill(
    engine: Engine,
    client: httpx.Client,
    desde: date,
    hasta: date | None = None,
    window_days: int = _BACKFILL_WINDOW_DAYS_DEFAULT,
    sleep: Callable[[float], None] = time.sleep,
) -> int:
    """Backfill readings from `desde` to `hasta` (default: today, UTC).

    Iterates windows of `window_days` days, fetching and upserting each one.
    Raises on the first failing window (windows already loaded stay loaded).
    Returns the total number of rows inserted.
    """
    hasta = hasta if hasta is not None else datetime.now(UTC).date()
    total_inserted = 0
    windows = _windows(desde, hasta, window_days)

    for i, (inicio, fin) in enumerate(windows):
        desde_dt = datetime(inicio.year, inicio.month, inicio.day, tzinfo=UTC)
        hasta_dt = datetime(fin.year, fin.month, fin.day, 23, 59, 59, tzinfo=UTC)
        rows = fetch_alturas(client, desde_dt, hasta_dt)
        inserted = upsert_alturas(engine, rows)
        total_inserted += inserted
        logger.info(
            "window %s..%s: fetched %d, inserted %d",
            inicio.isoformat(),
            fin.isoformat(),
            len(rows),
            inserted,
        )
        if i < len(windows) - 1:
            sleep(_BACKFILL_PAUSE_S)

    return total_inserted


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="jobs.ina")
    subparsers = parser.add_subparsers(dest="command", required=True)

    backfill_parser = subparsers.add_parser("backfill", help="Backfill historical INA readings")
    backfill_parser.add_argument("--desde", required=True, type=date.fromisoformat)
    backfill_parser.add_argument("--hasta", type=date.fromisoformat, default=None)
    backfill_parser.add_argument("--ventana-dias", type=int, default=_BACKFILL_WINDOW_DAYS_DEFAULT)

    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)
    configure_logging("INFO")

    if args.command == "backfill":
        engine = get_engine()
        with build_client() as client:
            inserted = backfill(engine, client, args.desde, args.hasta, args.ventana_dias)
        logger.info("backfill finished: %d rows inserted", inserted)


if __name__ == "__main__":
    main()
