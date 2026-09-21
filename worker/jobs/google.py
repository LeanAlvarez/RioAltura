"""Client for the Google Flood Forecasting API (gauge discharge forecasts).

API: https://floodforecasting.googleapis.com/v1/gauges:queryGaugeForecasts.

Per CLAUDE.md sections 6 and 8, the key (`FLOODS_API_KEY`) is read only by
the worker and must never reach a log, an exception message, or the
terminal. It travels as the `key` query parameter (per the API contract),
so this module actively redacts it wherever a URL or an underlying error
could otherwise expose it -- including from httpx's own request logging,
which by default logs the full request URL (key included) at INFO level.
"""

import argparse
import logging
import re
import time
from collections.abc import Callable, Sequence
from datetime import UTC, date, datetime, timedelta

import httpx
from app.config.dominio import GAUGE_GOOGLE_AGUAS_ARRIBA, GAUGE_GOOGLE_COLON
from app.logging_config import configure_logging
from app.repositories.db import get_engine
from app.repositories.pronosticos import PronosticoIn, upsert_pronosticos
from sqlalchemy import Engine

from jobs.http import FuenteError, build_client, get_with_retries
from jobs.settings import get_settings

logger = logging.getLogger(__name__)

GOOGLE_BASE_URL = "https://floodforecasting.googleapis.com/v1"
FORECASTS_URL = f"{GOOGLE_BASE_URL}/gauges:queryGaugeForecasts"

GAUGES: tuple[str, ...] = (GAUGE_GOOGLE_COLON, GAUGE_GOOGLE_AGUAS_ARRIBA)

# Default window size for the backfill, per spec (Google has no data before
# 2024-07-08).
_BACKFILL_WINDOW_DAYS_DEFAULT = 30
_BACKFILL_PAUSE_S = 0.5

_KEY_QUERY_RE = re.compile(r"([?&]key=)[^&\s]+")


def redact_url(text: str) -> str:
    """Redact the `key` query parameter from a URL or an error message containing one."""
    return _KEY_QUERY_RE.sub(r"\1***", text)


class _RedactApiKeyFilter(logging.Filter):
    """Scrubs the Google API key from every log record it sees.

    Installed directly on the loggers that could ever emit a raw request
    URL or the string form of an httpx exception -- including httpx's own
    logger, which logs `HTTP Request: GET <url>` at INFO by default. A
    logging Filter attached to a logger runs before the record propagates
    to any handler (ours, or a test's `caplog`), so by the time any handler
    sees the record it is already redacted.
    """

    def __init__(self, get_key: Callable[[], str]) -> None:
        super().__init__()
        self._get_key = get_key

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        redacted = redact_url(message)
        key = self._get_key()
        if key:
            redacted = redacted.replace(key, "***")
        if redacted != message:
            record.msg = redacted
            record.args = ()
        return True


# httpx/httpcore can log the raw request URL themselves; jobs.http logs GET
# failures; __name__ ("jobs.google") is this module's own logger.
_REDACTED_LOGGERS = ("httpx", "httpcore", "jobs.http", __name__)


def install_key_redaction() -> None:
    """Install the API-key redaction filter on every logger that could leak it.

    Idempotent: safe to call more than once (this module calls it once at
    import time; tests may call it again without effect).
    """
    key_filter = _RedactApiKeyFilter(lambda: get_settings().floods_api_key)
    for name in _REDACTED_LOGGERS:
        target_logger = logging.getLogger(name)
        if not any(isinstance(f, _RedactApiKeyFilter) for f in target_logger.filters):
            target_logger.addFilter(key_filter)


install_key_redaction()


def parse_forecasts(payload: dict) -> list[PronosticoIn]:
    """Parse a queryGaugeForecasts response into rows, one per (gauge, issuance, day).

    Response shape: `forecasts[gaugeId].forecasts[]`, each with `issuedTime`
    and `forecastRanges[]` (`value`, `forecastStartTime`). `lead_dias` is
    `date(forecastStartTime) - date(issuedTime)`; it can be negative
    (hindcast/nowcast ranges), which is stored too -- the API filters them
    out when building responses. Raises `FuenteError` if the payload does
    not have the expected shape.
    """
    forecasts_by_gauge = payload.get("forecasts")
    if not isinstance(forecasts_by_gauge, dict):
        raise FuenteError(f"unexpected Google payload shape: {payload!r}")

    rows: list[PronosticoIn] = []
    for gauge_id, gauge_payload in forecasts_by_gauge.items():
        entries = gauge_payload.get("forecasts") if isinstance(gauge_payload, dict) else None
        if not isinstance(entries, list):
            raise FuenteError(f"unexpected Google gauge payload shape: {gauge_payload!r}")

        for entry in entries:
            issued_time = datetime.fromisoformat(
                entry["issuedTime"].replace("Z", "+00:00")
            ).astimezone(UTC)
            for rango in entry.get("forecastRanges", []):
                inicio = datetime.fromisoformat(
                    rango["forecastStartTime"].replace("Z", "+00:00")
                ).astimezone(UTC)
                rows.append(
                    PronosticoIn(
                        gauge_id=gauge_id,
                        emitido=issued_time,
                        fecha=inicio.date(),
                        lead_dias=(inicio.date() - issued_time.date()).days,
                        caudal_m3s=float(rango["value"]),
                    )
                )
    return rows


def fetch_forecasts(
    client: httpx.Client,
    gauge_ids: Sequence[str],
    issued_start: date,
    issued_end: date,
) -> list[PronosticoIn]:
    """Fetch issuances for `gauge_ids` with issuedTime in [issued_start, issued_end]."""
    params = {
        "key": get_settings().floods_api_key,
        "gaugeIds": list(gauge_ids),
        "issuedTimeStart": issued_start.isoformat(),
        "issuedTimeEnd": issued_end.isoformat(),
    }
    try:
        response = get_with_retries(client, FORECASTS_URL, params=params)
    except httpx.HTTPError as exc:
        # `from None`: httpx embeds the full request URL (key included) in
        # some exception messages (e.g. HTTPStatusError). Chaining it as the
        # cause would let it leak through an uncaught traceback later; the
        # redacted message above is enough context.
        raise FuenteError(f"Google request failed: {redact_url(str(exc))}") from None

    try:
        payload = response.json()
    except ValueError as exc:
        raise FuenteError(f"Google response is not valid JSON: {exc}") from exc

    return parse_forecasts(payload)


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
    gauge_ids: Sequence[str] = GAUGES,
    sleep: Callable[[float], None] = time.sleep,
) -> int:
    """Backfill issuances from `desde` to `hasta` (default: today, UTC), in windows.

    Iterates windows of `window_days` days, fetching and upserting each one.
    Raises on the first failing window (windows already loaded stay
    loaded). Returns the total number of rows inserted.
    """
    hasta = hasta if hasta is not None else datetime.now(UTC).date()
    total_inserted = 0
    windows = _windows(desde, hasta, window_days)

    for i, (inicio, fin) in enumerate(windows):
        rows = fetch_forecasts(client, gauge_ids, inicio, fin)
        inserted = upsert_pronosticos(engine, rows)
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


PRONOSTICOS_INTERVAL_SECONDS = 6 * 3600
# Long enough that the worker process test (which starts the real process
# and only waits ~15s for the heartbeat before sending SIGTERM) never
# triggers a real call to Google.
PRONOSTICOS_FIRST_RUN_DELAY_SECONDS = 90

_ACTUALIZAR_WINDOW_DIAS = 3


def actualizar_pronosticos(
    engine: Engine, client: httpx.Client, now: datetime | None = None
) -> dict:
    """Fetch the last 3 days of issuances for both gauges and upsert them.

    Never raises: logs and returns a zeroed summary if Google is
    unavailable, so the scheduler keeps running.

    Returns a summary dict `{fetched, inserted}`.
    """
    now = now if now is not None else datetime.now(UTC)
    hasta = now.date()
    desde = hasta - timedelta(days=_ACTUALIZAR_WINDOW_DIAS)

    try:
        rows = fetch_forecasts(client, GAUGES, desde, hasta)
    except FuenteError as exc:
        logger.error("Google forecasts unavailable: %s", exc)
        return {"fetched": 0, "inserted": 0}

    inserted = upsert_pronosticos(engine, rows)
    logger.info("pronosticos: fetched %d, inserted %d", len(rows), inserted)
    return {"fetched": len(rows), "inserted": inserted}


def job_actualizar_pronosticos() -> None:
    """Zero-arg entry point registered with the scheduler. Never raises."""
    try:
        engine = get_engine()
        with build_client() as client:
            actualizar_pronosticos(engine, client)
    except Exception:
        logger.exception("pronosticos job failed")


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="jobs.google")
    subparsers = parser.add_subparsers(dest="command", required=True)

    backfill_parser = subparsers.add_parser(
        "backfill", help="Backfill historical Google forecast issuances"
    )
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
