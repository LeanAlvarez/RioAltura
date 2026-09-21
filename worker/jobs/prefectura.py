"""Client for the Prefectura Naval Argentina historical water level page.

Used only as a backup for the port gauge: this is HTML scraping (last
resort per CLAUDE.md section 6), not a documented API.
"""

import logging
import re
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import httpx
from app.config.dominio import PREFECTURA_PUERTO_COLON
from app.repositories.alturas import AlturaIn

from jobs.http import FuenteError, get_with_retries

logger = logging.getLogger(__name__)

PREFECTURA_URL = "https://contenidosweb.prefecturanaval.gob.ar/alturas/"

BUENOS_AIRES = ZoneInfo("America/Argentina/Buenos_Aires")

_TABLE_RE = re.compile(r'<table[^>]*class="[^"]*\bfpTable\b[^"]*"[^>]*>(.*?)</table>', re.S)
_ROW_RE = re.compile(
    r"""
    (\d{4}-\d{2}-\d{2})            # date, e.g. 2026-09-21
    .*?
    fa-clock-o[^>]*>\s*</i>\s*     # clock icon before the time
    (\d{2}:\d{2})                  # time, e.g. 00:00
    .*?
    </td>\s*<td>\s*
    ([\d.]+)\s*Mts                 # value, e.g. 4.29 or 4
    """,
    re.S | re.X,
)


def parse_historico(html: str) -> list[AlturaIn]:
    """Parse the Prefectura historico table into readings, sorted ascending.

    Row timestamps are local (America/Argentina/Buenos_Aires, no explicit
    offset on the page) and are converted to UTC. Raises `FuenteError` if
    the table is missing or has no parseable rows.
    """
    table_match = _TABLE_RE.search(html)
    if table_match is None:
        raise FuenteError("Prefectura historico table not found in HTML")

    rows: list[AlturaIn] = []
    for match in _ROW_RE.finditer(table_match.group(1)):
        fecha_str, hora_str, valor_str = match.groups()
        local_dt = datetime.strptime(f"{fecha_str} {hora_str}", "%Y-%m-%d %H:%M").replace(
            tzinfo=BUENOS_AIRES
        )
        rows.append(
            AlturaIn(
                fecha_hora=local_dt.astimezone(UTC),
                altura_m=float(valor_str),
                fuente="prefectura",
            )
        )

    if not rows:
        raise FuenteError("Prefectura historico table has no rows")

    rows.sort(key=lambda row: row.fecha_hora)
    return rows


def fetch_alturas(client: httpx.Client, dias: int = 3) -> list[AlturaIn]:
    """Fetch the last `dias` days of readings for the Colón port."""
    params = {"page": "historico", "tiempo": dias, "id": PREFECTURA_PUERTO_COLON}
    try:
        response = get_with_retries(client, PREFECTURA_URL, params=params)
    except httpx.HTTPError as exc:
        raise FuenteError(f"Prefectura request failed: {exc}") from exc

    return parse_historico(response.text)
