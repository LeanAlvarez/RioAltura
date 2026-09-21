"""Domain logic for port gauge readings: estado, tendencia and daily aggregation."""

from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import Engine

from app.config import dominio
from app.repositories.alturas import AlturaRow, get_reading_in_window, get_ultima, list_alturas
from app.schemas.alturas import ESTADOS, AlturaDiaria, Estado, UltimaAltura

__all__ = [
    "ESTADOS",
    "Estado",
    "calcular_estado",
    "calcular_tendencia_24h",
    "obtener_ultima",
    "promediar_por_dia",
    "listar_diario",
]

BUENOS_AIRES = ZoneInfo("America/Argentina/Buenos_Aires")

# The "previous" reading used for tendencia_24h_m is the most recent one whose
# fecha_hora falls within this window before the latest reading.
_VENTANA_TENDENCIA_MIN_HORAS = 20
_VENTANA_TENDENCIA_MAX_HORAS = 36


def calcular_estado(altura_m: float) -> Estado:
    """Map a port gauge reading (m) to its local alert level."""
    if altura_m >= dominio.EVACUACION_M:
        return "evacuacion"
    if altura_m >= dominio.ALERTA_M:
        return "alerta"
    if altura_m >= dominio.EVACUACION_EN_SECO_M:
        return "evacuacion_en_seco"
    return "normal"


def calcular_tendencia_24h(ultima: AlturaRow, previa: AlturaRow | None) -> float | None:
    """Difference between the latest reading and the one ~24h before it, or None."""
    if previa is None:
        return None
    return round(ultima.altura_m - previa.altura_m, 2)


def obtener_ultima(engine: Engine) -> UltimaAltura | None:
    """Return the latest reading with its tendencia and estado, or None if there is none."""
    ultima = get_ultima(engine)
    if ultima is None:
        return None
    previa = get_reading_in_window(
        engine,
        ultima.fecha_hora - timedelta(hours=_VENTANA_TENDENCIA_MAX_HORAS),
        ultima.fecha_hora - timedelta(hours=_VENTANA_TENDENCIA_MIN_HORAS),
    )
    return UltimaAltura(
        fecha_hora=ultima.fecha_hora,
        altura_m=ultima.altura_m,
        fuente=ultima.fuente,
        tendencia_24h_m=calcular_tendencia_24h(ultima, previa),
        estado=calcular_estado(ultima.altura_m),
    )


def promediar_por_dia(rows: Iterable[AlturaRow], tz: ZoneInfo = BUENOS_AIRES) -> list[AlturaDiaria]:
    """Average readings per local day, preferring INA over Prefectura for each day.

    A day uses only its 'ina' rows if there are any; otherwise it uses its
    'prefectura' rows. The result is sorted by fecha ascending.
    """
    por_dia: dict[date, dict[str, list[float]]] = {}
    for row in rows:
        fecha_local = row.fecha_hora.astimezone(tz).date()
        dia = por_dia.setdefault(fecha_local, {"ina": [], "prefectura": []})
        dia[row.fuente].append(row.altura_m)

    resultado: list[AlturaDiaria] = []
    for fecha_local in sorted(por_dia):
        valores = por_dia[fecha_local]
        usados = valores["ina"] if valores["ina"] else valores["prefectura"]
        if not usados:
            continue
        resultado.append(
            AlturaDiaria(fecha=fecha_local, altura_m=round(sum(usados) / len(usados), 2))
        )
    return resultado


def listar_diario(engine: Engine, desde: date, hasta: date) -> list[AlturaDiaria]:
    """Daily average readings for the local date range [desde, hasta] (inclusive)."""
    inicio_local = datetime(desde.year, desde.month, desde.day, tzinfo=BUENOS_AIRES)
    fin_exclusivo_local = datetime(
        hasta.year, hasta.month, hasta.day, tzinfo=BUENOS_AIRES
    ) + timedelta(days=1)

    desde_utc = inicio_local.astimezone(UTC)
    hasta_utc = fin_exclusivo_local.astimezone(UTC) - timedelta(microseconds=1)

    rows = list_alturas(engine, desde_utc, hasta_utc)
    return promediar_por_dia(rows)
