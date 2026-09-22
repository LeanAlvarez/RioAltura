"""CARU: third fallback source for the Colón port gauge level (spec 009).

CARU is the binational commission for the Uruguay river — the same body the
app cites as an official authority in its own disclaimer — so as a source it
is more legitimate than scraping Prefectura. It publishes every 12 hours
(00:00 and 12:00 local), which is why it sits third in the chain and not
first: less frequent than INA's hourly series, but available when the other
two are not.

Scraped from plain HTTP on a bare IP, with no domain and no TLS. Treated like
Prefectura (CLAUDE.md §6, "último recurso"): the parser never assumes the page
structure holds. If the markup changes, `fetch_alturas` raises `FuenteError`
and the caller keeps the last known reading with its date visible — it never
invents a value.
"""

import logging
import re
from datetime import UTC, datetime
from html import unescape
from zoneinfo import ZoneInfo

import httpx
from app.config.dominio import CARU_ESTACION_COLON, CARU_URL_ESTACION
from app.repositories.alturas import AlturaIn

from jobs.http import FuenteError, get_with_retries

logger = logging.getLogger(__name__)

BUENOS_AIRES = ZoneInfo("America/Argentina/Buenos_Aires")

FUENTE = "caru"

# Physically possible range for the Colón gauge, used to reject garbage from a
# changed page rather than storing it. The record is 10 m (marca MOP, informe
# INA-CARU 2019) and the river never dries out, so anything outside this is a
# parsing error, not a reading.
ALTURA_MIN_PLAUSIBLE_M = -1.0
ALTURA_MAX_PLAUSIBLE_M = 20.0

_FILA_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S | re.I)
_CELDA_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S | re.I)
_TAG_RE = re.compile(r"<[^>]+>")
# "22/09/2026 - 00:00"
_FECHA_RE = re.compile(r"(\d{2})/(\d{2})/(\d{4})\s*-\s*(\d{1,2}):(\d{2})")


def _texto(celda: str) -> str:
    return unescape(_TAG_RE.sub(" ", celda)).strip()


def _parse_fecha(texto: str) -> datetime | None:
    """`DD/MM/AAAA - HH:MM` in Buenos Aires time -> aware UTC datetime."""
    match = _FECHA_RE.search(texto)
    if match is None:
        return None
    dia, mes, anio, hora, minuto = (int(g) for g in match.groups())
    try:
        local = datetime(anio, mes, dia, hora, minuto, tzinfo=BUENOS_AIRES)
    except ValueError:
        return None
    return local.astimezone(UTC)


def _parse_altura(texto: str) -> float | None:
    """CARU publishes the level with a dot (`4.29`); the UI uses a comma."""
    limpio = texto.replace(",", ".").strip()
    try:
        valor = float(limpio)
    except ValueError:
        return None
    if not ALTURA_MIN_PLAUSIBLE_M <= valor <= ALTURA_MAX_PLAUSIBLE_M:
        # A changed page can put anything in this column. Dropping the row and
        # saying so is always better than storing a wrong river level.
        logger.warning("CARU: discarding out-of-range level %.2f m", valor)
        return None
    return valor


def parse_alturas(html: str) -> list[AlturaIn]:
    """Parse the per-station page into readings, newest first in the page.

    Rows that do not look like a reading are skipped silently: the page also
    carries layout and header rows. Raises `FuenteError` only when NO row
    parsed, which is the signal that the structure changed.
    """
    filas: list[AlturaIn] = []
    for fila_html in _FILA_RE.findall(html):
        celdas = [_texto(c) for c in _CELDA_RE.findall(fila_html)]
        if len(celdas) < 3:
            continue
        fecha_hora = _parse_fecha(celdas[1])
        altura_m = _parse_altura(celdas[2])
        if fecha_hora is None or altura_m is None:
            continue
        filas.append(AlturaIn(fecha_hora=fecha_hora, altura_m=altura_m, fuente=FUENTE))

    if not filas:
        raise FuenteError("CARU: no readings parsed (page structure may have changed)")
    return filas


def fetch_alturas(client: httpx.Client, estacion: int = CARU_ESTACION_COLON) -> list[AlturaIn]:
    """Fetch the last readings for `estacion` (12 = Colón).

    The per-station page is used instead of the full table: 12.5 KB against
    38 KB, three clean columns, and seven days of history, so a missed run
    catches up on its own.
    """
    url = CARU_URL_ESTACION.format(estacion=estacion)
    try:
        response = get_with_retries(client, url)
    except httpx.HTTPError as exc:
        raise FuenteError(f"CARU request failed: {exc}") from exc

    return parse_alturas(response.text)
