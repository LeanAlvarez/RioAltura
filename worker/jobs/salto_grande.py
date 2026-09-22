"""Client and parsers for the four Salto Grande dam (CTM) daily hydrology PDFs.

These are not an API: there is no contract, just a TCPDF-generated template
(spec 012). Treated as scraping (CLAUDE.md §6): timeout, retries with
backoff and an identifiable User-Agent come from `jobs.http`, and every
parser raises `FuenteError` (never an uncaught exception) when the page
structure it expects is not there.

Robustness (spec 012): the four PDFs are parsed independently. If one
changes format, its parser fails on its own and the caller (`actualizar_*`)
logs it and moves on to the next one -- it is never all-or-nothing. Values
outside a physically plausible range are dropped and logged rather than
stored (see the `*_MIN_PLAUSIBLE`/`*_MAX_PLAUSIBLE` constants below).

Out of scope, per spec: no height for Colón is ever derived from this data
(CLAUDE.md §5, §9) -- the discharge and level figures here are stored and
shown as upstream context only.
"""

import io
import logging
import re
from datetime import date, datetime

import httpx
import pdfplumber
from app.config.dominio import (
    SALTO_GRANDE_ESTACIONES_CASCADA,
    SALTO_GRANDE_SUBCUENCAS_LLUVIA,
    SALTO_GRANDE_URL_CAUDALES_NIVELES,
    SALTO_GRANDE_URL_COMUNICADO,
    SALTO_GRANDE_URL_PRECIPITACIONES,
    SALTO_GRANDE_URL_PRONOSTICOS_P,
)
from app.repositories.db import get_engine
from app.repositories.salto_grande import (
    CaudalCascadaIn,
    ComunicadoIn,
    LluviaIn,
    upsert_caudales_cascada,
    upsert_comunicado,
    upsert_lluvia,
)
from sqlalchemy import Engine

from jobs.http import FuenteError, build_client, get_with_retries

logger = logging.getLogger(__name__)

# Physically plausible ranges, used only to reject garbage from a changed
# page (spec 012, "validá rangos... se descarta y se registra") -- never to
# validate against domain thresholds, which live in `dominio.py` and are
# never touched here (CLAUDE.md §5, §9).
CAUDAL_MIN_PLAUSIBLE_M3S = 0.0
# The historic 1983 flood peaked near 46,000 m3/s; generous headroom above that.
CAUDAL_MAX_PLAUSIBLE_M3S = 60_000.0
NIVEL_EMBALSE_MIN_PLAUSIBLE_M = 20.0
NIVEL_EMBALSE_MAX_PLAUSIBLE_M = 40.0
LLUVIA_MIN_PLAUSIBLE_MM = 0.0
LLUVIA_MAX_PLAUSIBLE_MM = 500.0

TIPO_LLUVIA_OBSERVADA = "observada"
TIPO_LLUVIA_PRONOSTICO = "pronostico"

_SECCION_CAUDAL_DIARIO = "Caudales Medios Diarios Hora 07:00 (m3/s)"
_SECCION_CAUDAL_HORA = "Caudales Hora 07:00 (m3/s)"
_SECCION_EROGADO = "Salto Grande - Erogado Medio Diario (m3/s)"

_FECHA_RE = re.compile(r"\d{2}/\d{2}/\d{4}")
_FECHAS_LINEA_RE = re.compile(r"^(?:\d{2}/\d{2}/\d{4}\s*)+$")


def _extract_text(pdf_bytes: bytes, fuente: str) -> str:
    """First-page text of a PDF, raising `FuenteError` if it cannot be read."""
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            if not pdf.pages:
                raise FuenteError(f"{fuente}: PDF has no pages")
            texto = pdf.pages[0].extract_text()
    except FuenteError:
        raise
    except Exception as exc:  # pdfplumber/pdfminer can raise many error types
        raise FuenteError(f"{fuente}: could not read PDF: {exc}") from exc

    if not texto:
        raise FuenteError(f"{fuente}: PDF has no extractable text")
    return texto


def _fetch_pdf_bytes(client: httpx.Client, url: str, fuente: str) -> bytes:
    try:
        response = get_with_retries(client, url)
    except httpx.HTTPError as exc:
        raise FuenteError(f"{fuente}: request failed: {exc}") from exc
    return response.content


def _parse_fecha_ddmmyyyy(texto: str) -> date:
    return datetime.strptime(texto, "%d/%m/%Y").date()


def _validar_rango(
    valor: float, minimo: float, maximo: float, etiqueta: str, fuente: str
) -> float | None:
    if not minimo <= valor <= maximo:
        logger.warning("%s: discarding out-of-range value for %s: %s", fuente, etiqueta, valor)
        return None
    return valor


# --- Comunicado.pdf ---

_COMUNICADO_FECHA_RE = re.compile(r"COMUNICADO FECHA:\s*(\d{2}/\d{2}/\d{4})")
_COMUNICADO_APORTE_RE = re.compile(r"Aporte últimas 24hs \(m³/s\)\s*([\d.,]+)")
_COMUNICADO_EVACUADO_RE = re.compile(r"Evacuado a la hora \d{2}:\d{2} \(m³/s\)\s*([\d.,]+)")
_COMUNICADO_NIVEL_RE = re.compile(r"Nivel del embalse hora \d{2}:\d{2} \(m\)\s*([\d.,]+)")
_COMUNICADO_VERTEDERO_RE = re.compile(r"^Vertedero\s+(.+)$")
_COMUNICADO_PROYECCION_INICIO_RE = re.compile(r"^Hasta la hora")


def parse_comunicado(pdf_bytes: bytes) -> ComunicadoIn:
    """Parse the daily discharge/reservoir-level bulletin.

    Raises `FuenteError` if any of the mandatory fields (fecha, aporte,
    evacuado, nivel del embalse, vertedero, texto de proyección) cannot be
    found -- a structural change here is significant enough that a partial
    read is not trustworthy.
    """
    texto = _extract_text(pdf_bytes, "Comunicado")
    lineas = [linea.strip() for linea in texto.splitlines()]

    fecha_match = _COMUNICADO_FECHA_RE.search(texto)
    aporte_match = _COMUNICADO_APORTE_RE.search(texto)
    evacuado_match = _COMUNICADO_EVACUADO_RE.search(texto)
    nivel_match = _COMUNICADO_NIVEL_RE.search(texto)
    if not (fecha_match and aporte_match and evacuado_match and nivel_match):
        raise FuenteError("Comunicado: missing expected fields (fecha/aporte/evacuado/nivel)")

    vertedero_idx = next(
        (i for i, linea in enumerate(lineas) if _COMUNICADO_VERTEDERO_RE.match(linea)), None
    )
    proyeccion_idx = next(
        (i for i, linea in enumerate(lineas) if _COMUNICADO_PROYECCION_INICIO_RE.match(linea)),
        None,
    )
    if vertedero_idx is None or proyeccion_idx is None or proyeccion_idx >= vertedero_idx:
        raise FuenteError("Comunicado: could not locate vertedero/projection text")

    estado_vertedero = _COMUNICADO_VERTEDERO_RE.match(lineas[vertedero_idx]).group(1).strip()  # type: ignore[union-attr]
    texto_proyeccion = " ".join(lineas[proyeccion_idx:vertedero_idx]).strip()
    if not estado_vertedero or not texto_proyeccion:
        raise FuenteError("Comunicado: empty vertedero or projection text")

    try:
        aporte_m3s = float(aporte_match.group(1))
        evacuado_m3s = float(evacuado_match.group(1))
        nivel_embalse_m = float(nivel_match.group(1))
    except ValueError as exc:
        raise FuenteError(f"Comunicado: could not parse numeric fields: {exc}") from exc

    return ComunicadoIn(
        fecha=_parse_fecha_ddmmyyyy(fecha_match.group(1)),
        aporte_m3s=aporte_m3s,
        evacuado_m3s=evacuado_m3s,
        nivel_embalse_m=nivel_embalse_m,
        estado_vertedero=estado_vertedero,
        texto_proyeccion=texto_proyeccion,
    )


def fetch_comunicado(client: httpx.Client) -> ComunicadoIn:
    pdf_bytes = _fetch_pdf_bytes(client, SALTO_GRANDE_URL_COMUNICADO, "Comunicado")
    return parse_comunicado(pdf_bytes)


# --- CaudalesNiveles.pdf ---


def _encontrar_linea(lineas: list[str], objetivo: str, desde: int = 0) -> int | None:
    for i in range(desde, len(lineas)):
        if lineas[i] == objetivo:
            return i
    return None


def _parsear_seccion_caudal(
    lineas: list[str], inicio_marca: str, fin_marca: str | None
) -> list[CaudalCascadaIn]:
    """Rows for the known cascade stations between two section markers.

    Returns an empty list (logging a warning) instead of raising when the
    section itself is missing or empty -- a missing sub-table should not
    sink the whole PDF (spec 012: "no es todo o nada"); `parse_caudales_cascada`
    only raises if nothing at all could be parsed from the file.
    """
    inicio = _encontrar_linea(lineas, inicio_marca)
    if inicio is None:
        logger.warning("CaudalesNiveles: section %r not found", inicio_marca)
        return []

    fin = _encontrar_linea(lineas, fin_marca, inicio + 1) if fin_marca else None
    seccion = lineas[inicio + 1 : fin] if fin is not None else lineas[inicio + 1 :]
    if not seccion or not _FECHAS_LINEA_RE.match(seccion[0]):
        logger.warning("CaudalesNiveles: section %r has no date header", inicio_marca)
        return []

    fechas = [_parse_fecha_ddmmyyyy(tok) for tok in _FECHA_RE.findall(seccion[0])]

    filas: list[CaudalCascadaIn] = []
    for linea in seccion[1:]:
        for estacion in SALTO_GRANDE_ESTACIONES_CASCADA:
            if not linea.startswith(f"{estacion} "):
                continue
            valores = linea[len(estacion) :].split()
            if len(valores) != len(fechas):
                logger.warning(
                    "CaudalesNiveles: %s has %d values, expected %d",
                    estacion,
                    len(valores),
                    len(fechas),
                )
                break
            for fecha, valor_str in zip(fechas, valores, strict=True):
                try:
                    valor = float(valor_str)
                except ValueError:
                    logger.warning(
                        "CaudalesNiveles: unparseable value %r for %s", valor_str, estacion
                    )
                    continue
                valor_valido = _validar_rango(
                    valor,
                    CAUDAL_MIN_PLAUSIBLE_M3S,
                    CAUDAL_MAX_PLAUSIBLE_M3S,
                    estacion,
                    "CaudalesNiveles",
                )
                if valor_valido is not None:
                    filas.append(
                        CaudalCascadaIn(estacion=estacion, fecha=fecha, caudal_m3s=valor_valido)
                    )
            break
    return filas


def parse_caudales_cascada(pdf_bytes: bytes) -> list[CaudalCascadaIn]:
    """Discharge (m3/s) for every cascade station, from the two relevant sub-tables.

    Raises `FuenteError` only if neither sub-table could be parsed at all.
    """
    texto = _extract_text(pdf_bytes, "CaudalesNiveles")
    lineas = [linea.strip() for linea in texto.splitlines()]

    filas = _parsear_seccion_caudal(
        lineas, _SECCION_CAUDAL_DIARIO, _SECCION_CAUDAL_HORA
    ) + _parsear_seccion_caudal(lineas, _SECCION_CAUDAL_HORA, _SECCION_EROGADO)

    if not filas:
        raise FuenteError("CaudalesNiveles: no cascade discharge rows parsed")
    return filas


def fetch_caudales_cascada(client: httpx.Client) -> list[CaudalCascadaIn]:
    pdf_bytes = _fetch_pdf_bytes(client, SALTO_GRANDE_URL_CAUDALES_NIVELES, "CaudalesNiveles")
    return parse_caudales_cascada(pdf_bytes)


# --- Precipitaciones.pdf / PronosticosP.pdf ---


def _parsear_lluvia(texto: str, tipo: str, fuente: str) -> list[LluviaIn]:
    """One row per (subcuenca, fecha) whose line starts with a date.

    Column order is the fixed `SALTO_GRANDE_SUBCUENCAS_LLUVIA` order (both
    reports share it); a trailing "Total" row (PronosticosP.pdf) never
    matches the leading-date pattern, so it is skipped naturally.
    """
    filas: list[LluviaIn] = []
    n_subcuencas = len(SALTO_GRANDE_SUBCUENCAS_LLUVIA)

    for linea in (linea.strip() for linea in texto.splitlines()):
        match = re.match(r"^(\d{2}/\d{2}/\d{4})\s+(.+)$", linea)
        if not match:
            continue
        fecha_str, resto = match.groups()
        valores = resto.split()
        if len(valores) != n_subcuencas:
            logger.warning(
                "%s: row for %s has %d values, expected %d",
                fuente,
                fecha_str,
                len(valores),
                n_subcuencas,
            )
            continue
        fecha = _parse_fecha_ddmmyyyy(fecha_str)
        for subcuenca, valor_str in zip(SALTO_GRANDE_SUBCUENCAS_LLUVIA, valores, strict=True):
            try:
                valor = float(valor_str)
            except ValueError:
                logger.warning("%s: unparseable value %r for %s", fuente, valor_str, subcuenca)
                continue
            valor_valido = _validar_rango(
                valor, LLUVIA_MIN_PLAUSIBLE_MM, LLUVIA_MAX_PLAUSIBLE_MM, subcuenca, fuente
            )
            if valor_valido is not None:
                filas.append(
                    LluviaIn(subcuenca=subcuenca, fecha=fecha, tipo=tipo, lluvia_mm=valor_valido)
                )

    if not filas:
        raise FuenteError(f"{fuente}: no rainfall rows parsed")
    return filas


def parse_precipitaciones(pdf_bytes: bytes) -> list[LluviaIn]:
    """Observed rainfall (mm), last ~8 days, per subcuenca."""
    texto = _extract_text(pdf_bytes, "Precipitaciones")
    return _parsear_lluvia(texto, TIPO_LLUVIA_OBSERVADA, "Precipitaciones")


def fetch_precipitaciones(client: httpx.Client) -> list[LluviaIn]:
    pdf_bytes = _fetch_pdf_bytes(client, SALTO_GRANDE_URL_PRECIPITACIONES, "Precipitaciones")
    return parse_precipitaciones(pdf_bytes)


def parse_pronostico_precipitaciones(pdf_bytes: bytes) -> list[LluviaIn]:
    """Forecast rainfall (mm, GFS model), 7 days, per subcuenca."""
    texto = _extract_text(pdf_bytes, "PronosticosP")
    return _parsear_lluvia(texto, TIPO_LLUVIA_PRONOSTICO, "PronosticosP")


def fetch_pronostico_precipitaciones(client: httpx.Client) -> list[LluviaIn]:
    pdf_bytes = _fetch_pdf_bytes(client, SALTO_GRANDE_URL_PRONOSTICOS_P, "PronosticosP")
    return parse_pronostico_precipitaciones(pdf_bytes)


# --- Job orchestration ---

SALTO_GRANDE_INTERVAL_SECONDS = 24 * 3600
# Delay before the first run after startup (see ALTURAS_FIRST_RUN_DELAY_SECONDS
# for the same rationale): long enough that the worker process test never
# hits the real source.
SALTO_GRANDE_FIRST_RUN_DELAY_SECONDS = 150


def actualizar_salto_grande(engine: Engine, client: httpx.Client) -> dict[str, dict[str, object]]:
    """Fetch and store all four Salto Grande sources, independently of one another.

    Never raises: each source's failure is caught, logged, and recorded in
    the returned summary; the other three still run (spec 012, "no es todo
    o nada"). The scheduler always gets a clean return.
    """
    resumen: dict[str, dict[str, object]] = {}

    try:
        comunicado = fetch_comunicado(client)
    except FuenteError as exc:
        logger.warning("salto_grande: comunicado unavailable: %s", exc)
        resumen["comunicado"] = {"ok": False, "inserted": 0}
    else:
        inserted = upsert_comunicado(engine, [comunicado])
        logger.info("salto_grande: comunicado fecha=%s inserted=%d", comunicado.fecha, inserted)
        resumen["comunicado"] = {"ok": True, "inserted": inserted}

    try:
        caudales = fetch_caudales_cascada(client)
    except FuenteError as exc:
        logger.warning("salto_grande: caudales cascada unavailable: %s", exc)
        resumen["caudales_cascada"] = {"ok": False, "inserted": 0}
    else:
        inserted = upsert_caudales_cascada(engine, caudales)
        logger.info(
            "salto_grande: caudales cascada fetched=%d inserted=%d", len(caudales), inserted
        )
        resumen["caudales_cascada"] = {"ok": True, "inserted": inserted}

    for nombre, traer in (
        ("precipitaciones", lambda: fetch_precipitaciones(client)),
        ("pronosticos_precipitaciones", lambda: fetch_pronostico_precipitaciones(client)),
    ):
        try:
            filas = traer()
        except FuenteError as exc:
            logger.warning("salto_grande: %s unavailable: %s", nombre, exc)
            resumen[nombre] = {"ok": False, "inserted": 0}
            continue
        inserted = upsert_lluvia(engine, filas)
        logger.info("salto_grande: %s fetched=%d inserted=%d", nombre, len(filas), inserted)
        resumen[nombre] = {"ok": True, "inserted": inserted}

    return resumen


def job_actualizar_salto_grande() -> None:
    """Zero-arg entry point registered with the scheduler. Never raises."""
    try:
        engine = get_engine()
        with build_client() as client:
            actualizar_salto_grande(engine, client)
    except Exception:
        logger.exception("salto_grande job failed")
