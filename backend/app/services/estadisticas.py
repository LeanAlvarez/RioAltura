"""Domain logic for /estadisticas: aggregates computed entirely from stored data.

Never calls external APIs from the request path (CLAUDE.md section 3): every
number here comes from what the worker already saved to Postgres (alturas
reales y pronósticos de Google).
"""

from datetime import date, timedelta

from sqlalchemy import Engine

from app.config import dominio
from app.schemas.alturas import AlturaDiaria
from app.schemas.estadisticas import (
    ErrorPronostico,
    Estadisticas,
    Evento,
    MismoDiaAnio,
    PercentilHoy,
    RangoAlerta,
)
from app.services.alturas import altura_en, hoy_buenos_aires, listar_diario, primera_fecha
from app.services.pronosticos import listar_historico

__all__ = ["calcular_estadisticas"]

# Ventana de días usada para calcular en qué percentil cae la altura de hoy
# frente al historial reciente (T6 de la spec 007).
_VENTANA_PERCENTIL_DIAS = 365

# Lead fijo (días de anticipación) usado para medir qué tan acertado es el
# pronóstico de Google: el pedido de la spec 007 es específicamente a 3 días.
_LEAD_ERROR_PRONOSTICO = 3

# Escenarios de referencia del mapa (ver CLAUDE.md sección 5): etiqueta, año,
# mes y altura objetivo (m). El día exacto no está fijado en CLAUDE.md, así
# que se busca en los datos reales el día de ese mes más cercano a la altura
# objetivo, en vez de inventar una fecha.
_EVENTOS_REFERENCIA: tuple[tuple[str, int, int, float], ...] = (
    ("Máximo diario registrado (INA)", 2024, 5, 9.06),
    ("Crecida de referencia", 2025, 6, 7.6),
    ("Costanera inundada", 2026, 7, 4.44),
)


def _percentil_hoy(engine: Engine, hoy: date) -> PercentilHoy | None:
    altura_hoy = altura_en(engine, hoy)
    if altura_hoy is None:
        return None

    desde = hoy - timedelta(days=_VENTANA_PERCENTIL_DIAS - 1)
    ventana = listar_diario(engine, desde, hoy)
    menores = sum(1 for dia in ventana if dia.altura_m < altura_hoy)
    percentil = round(100 * menores / len(ventana), 1)
    return PercentilHoy(
        altura_m=altura_hoy, percentil=percentil, ventana_dias=_VENTANA_PERCENTIL_DIAS
    )


def _error_pronostico(engine: Engine, gauge_id: str) -> ErrorPronostico:
    historico = listar_historico(engine, gauge_id, _LEAD_ERROR_PRONOSTICO, date.min)
    if not historico:
        return ErrorPronostico(lead_dias=_LEAD_ERROR_PRONOSTICO, muestras=0, mae_m=None)

    desde = min(dia.fecha for dia in historico)
    hasta = max(dia.fecha for dia in historico)
    reales = {dia.fecha: dia.altura_m for dia in listar_diario(engine, desde, hasta)}

    errores = [
        abs(dia.altura_est_m - reales[dia.fecha]) for dia in historico if dia.fecha in reales
    ]
    if not errores:
        return ErrorPronostico(lead_dias=_LEAD_ERROR_PRONOSTICO, muestras=0, mae_m=None)
    return ErrorPronostico(
        lead_dias=_LEAD_ERROR_PRONOSTICO,
        muestras=len(errores),
        mae_m=round(sum(errores) / len(errores), 2),
    )


def _cerrar_racha(racha: list[AlturaDiaria]) -> RangoAlerta:
    return RangoAlerta(
        desde=racha[0].fecha, hasta=racha[-1].fecha, max_m=max(dia.altura_m for dia in racha)
    )


def dias_en_alerta(dias: list[AlturaDiaria]) -> list[RangoAlerta]:
    """Consecutive-date ranges (by calendar day) with `altura_m >= ALERTA_M`.

    `dias` must be sorted by fecha ascending (as `listar_diario` returns it).
    """
    rangos: list[RangoAlerta] = []
    racha: list[AlturaDiaria] = []
    for dia in dias:
        if dia.altura_m >= dominio.ALERTA_M:
            if racha and (dia.fecha - racha[-1].fecha).days > 1:
                rangos.append(_cerrar_racha(racha))
                racha = []
            racha.append(dia)
        elif racha:
            rangos.append(_cerrar_racha(racha))
            racha = []
    if racha:
        rangos.append(_cerrar_racha(racha))
    return rangos


def _mismo_dia_otros_anios(engine: Engine, hoy: date) -> list[MismoDiaAnio]:
    inicio = primera_fecha(engine)
    if inicio is None:
        return []

    resultado: list[MismoDiaAnio] = []
    for anio in range(inicio.year, hoy.year):
        try:
            fecha = date(anio, hoy.month, hoy.day)
        except ValueError:
            continue  # 29 de febrero en un año no bisiesto
        altura = altura_en(engine, fecha)
        if altura is not None:
            resultado.append(MismoDiaAnio(anio=anio, altura_m=altura))
    return resultado


def _evento_del_mes(
    engine: Engine, etiqueta: str, anio: int, mes: int, objetivo_m: float
) -> Evento | None:
    desde = date(anio, mes, 1)
    hasta_exclusivo = date(anio + 1, 1, 1) if mes == 12 else date(anio, mes + 1, 1)
    dias = listar_diario(engine, desde, hasta_exclusivo - timedelta(days=1))
    if not dias:
        return None
    mejor = min(dias, key=lambda dia: abs(dia.altura_m - objetivo_m))
    return Evento(fecha=mejor.fecha, altura_m=mejor.altura_m, etiqueta=etiqueta)


def _eventos(engine: Engine) -> list[Evento]:
    candidatos = (
        _evento_del_mes(engine, etiqueta, anio, mes, objetivo)
        for etiqueta, anio, mes, objetivo in _EVENTOS_REFERENCIA
    )
    return [evento for evento in candidatos if evento is not None]


def calcular_estadisticas(engine: Engine, gauge_id: str, hoy: date | None = None) -> Estadisticas:
    """Aggregate statistics for /estadisticas, computed entirely from stored data."""
    if hoy is None:
        hoy = hoy_buenos_aires()

    inicio = primera_fecha(engine)
    serie_completa = listar_diario(engine, inicio, hoy) if inicio is not None else []

    return Estadisticas(
        percentil_hoy=_percentil_hoy(engine, hoy),
        error_pronostico=_error_pronostico(engine, gauge_id),
        dias_en_alerta=dias_en_alerta(serie_completa),
        mismo_dia_otros_anios=_mismo_dia_otros_anios(engine, hoy),
        eventos=_eventos(engine),
    )
