"""Domain logic for stored Google forecasts: level conversion and historical series."""

from datetime import date, datetime

from sqlalchemy import Engine

from app.config import dominio
from app.repositories.pronosticos import PronosticoRow, list_por_lead, list_ultima_emision
from app.schemas.pronostico import DiaPronostico, HistoricoDia

__all__ = ["dia_desde_row", "obtener_dias", "listar_historico"]


def dia_desde_row(row: PronosticoRow) -> DiaPronostico:
    """Convert a stored forecast day into its API representation.

    The estimated level always comes with the `RANGO_ESTIMACION_M` band
    (never as an exact number), and flags whether the forecast discharge is
    above the calibrated range of the rating curve.
    """
    altura_est_m = dominio.altura_estimada(row.caudal_m3s)
    return DiaPronostico(
        fecha=row.fecha,
        lead_dias=row.lead_dias,
        caudal_m3s=row.caudal_m3s,
        altura_est_m=round(altura_est_m, 2),
        altura_min_m=round(altura_est_m - dominio.RANGO_ESTIMACION_M, 2),
        altura_max_m=round(altura_est_m + dominio.RANGO_ESTIMACION_M, 2),
        extrapolado=dominio.es_extrapolado(row.caudal_m3s),
    )


def obtener_dias(engine: Engine, gauge_id: str) -> tuple[datetime, list[DiaPronostico]] | None:
    """Latest issuance for `gauge_id`: `(emitido, dias)`, only `lead_dias >= 0`, by fecha.

    Returns None if there is no stored issuance at all for this gauge.
    """
    rows = list_ultima_emision(engine, gauge_id)
    if not rows:
        return None

    emitido = rows[0].emitido
    dias = sorted(
        (dia_desde_row(row) for row in rows if row.lead_dias >= 0), key=lambda dia: dia.fecha
    )
    return emitido, dias


def listar_historico(
    engine: Engine, gauge_id: str, lead_dias: int, desde: date
) -> list[HistoricoDia]:
    """One row per calendar day since `desde`, using the freshest issuance for that lead.

    When more than one issuance produced a forecast for the same fecha and
    lead (e.g. two issuances the same day), the one from the most recent
    `emitido` wins.
    """
    rows = list_por_lead(engine, gauge_id, lead_dias, desde)  # fecha asc, emitido desc

    vistas: set[date] = set()
    resultado: list[HistoricoDia] = []
    for row in rows:
        if row.fecha in vistas:
            continue
        vistas.add(row.fecha)
        altura_est_m = dominio.altura_estimada(row.caudal_m3s)
        resultado.append(
            HistoricoDia(
                fecha=row.fecha,
                caudal_m3s=row.caudal_m3s,
                altura_est_m=round(altura_est_m, 2),
                extrapolado=dominio.es_extrapolado(row.caudal_m3s),
            )
        )
    return resultado
