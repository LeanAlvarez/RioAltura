"""Domain logic for stored Google forecasts: level conversion and historical series."""

from datetime import date, datetime

from sqlalchemy import Engine

from app.config import dominio
from app.repositories.pronosticos import PronosticoRow, list_por_lead, list_ultima_emision
from app.schemas.pronostico import Anclaje, DiaPronostico, HistoricoDia
from app.services.alturas import altura_en, hoy_buenos_aires

__all__ = ["dia_desde_row", "obtener_dias", "anclar_pronostico", "listar_historico"]

_SIN_DIA_HOY = "No hay un día de pronóstico para hoy"
_SIN_ALTURA_REAL = "No hay altura real disponible para hoy"


def dia_desde_row(row: PronosticoRow) -> DiaPronostico:
    """Convert a stored forecast day into its API representation.

    The estimated level always comes with the `RANGO_ESTIMACION_M` band
    (never as an exact number), and flags whether the forecast discharge is
    above the calibrated range of the rating curve. `altura_anclada_*`
    start out identical to the unanchored values (see `anclar_pronostico`
    for when/how they get shifted).
    """
    altura_est_m = round(dominio.altura_estimada(row.caudal_m3s), 2)
    altura_min_m = round(altura_est_m - dominio.RANGO_ESTIMACION_M, 2)
    altura_max_m = round(altura_est_m + dominio.RANGO_ESTIMACION_M, 2)
    return DiaPronostico(
        fecha=row.fecha,
        lead_dias=row.lead_dias,
        caudal_m3s=row.caudal_m3s,
        altura_est_m=altura_est_m,
        altura_min_m=altura_min_m,
        altura_max_m=altura_max_m,
        altura_anclada_m=altura_est_m,
        altura_anclada_min_m=altura_min_m,
        altura_anclada_max_m=altura_max_m,
        extrapolado=dominio.es_extrapolado(row.caudal_m3s),
    )


def obtener_dias(
    engine: Engine, gauge_id: str, hoy: date | None = None
) -> tuple[datetime, list[DiaPronostico]] | None:
    """Latest issuance for `gauge_id`: `(emitido, dias)`, only `fecha >= hoy`, by fecha.

    `hoy` defaults to today in America/Argentina/Buenos_Aires. Filtering by
    `fecha` (instead of the old `lead_dias >= 0`) is spec 007 criterion C3:
    the most recent Google issuance is usually from the day before, so its
    `lead_dias == 0` day is actually yesterday, not today.

    Returns None if there is no stored issuance at all for this gauge.
    """
    if hoy is None:
        hoy = hoy_buenos_aires()

    rows = list_ultima_emision(engine, gauge_id)
    if not rows:
        return None

    emitido = rows[0].emitido
    dias = sorted(
        (dia_desde_row(row) for row in rows if row.fecha >= hoy), key=lambda dia: dia.fecha
    )
    return emitido, dias


def anclar_pronostico(
    engine: Engine, dias: list[DiaPronostico], hoy: date | None = None
) -> tuple[list[DiaPronostico], Anclaje]:
    """Anchor `dias`' estimated levels to today's real reading (spec 007, C2).

    Presentation-only correction on top of `dia.altura_est_m`/`altura_min_m`/
    `altura_max_m` (see `dominio.aplicar_anclaje`): never touches
    `caudal_m3s`, so the aviso (computed from discharge) is unaffected.

    Not anchored (original `dias`, `Anclaje(aplicado=False, ...)` with a
    `motivo`) when there is no forecast day for `hoy`, or no real reading
    for `hoy`.
    """
    if hoy is None:
        hoy = hoy_buenos_aires()

    dia_hoy = next((dia for dia in dias if dia.fecha == hoy), None)
    if dia_hoy is None:
        return dias, Anclaje(
            aplicado=False,
            sesgo_m=None,
            altura_real_m=None,
            fecha_referencia=None,
            motivo=_SIN_DIA_HOY,
        )

    altura_real_m = altura_en(engine, hoy)
    if altura_real_m is None:
        return dias, Anclaje(
            aplicado=False,
            sesgo_m=None,
            altura_real_m=None,
            fecha_referencia=None,
            motivo=_SIN_ALTURA_REAL,
        )

    sesgo_m = round(altura_real_m - dia_hoy.altura_est_m, 2)
    dias_anclados = [
        dia.model_copy(
            update={
                "altura_anclada_m": round(
                    dominio.aplicar_anclaje(dia.altura_est_m, sesgo_m, (dia.fecha - hoy).days), 2
                ),
                "altura_anclada_min_m": round(
                    dominio.aplicar_anclaje(dia.altura_min_m, sesgo_m, (dia.fecha - hoy).days), 2
                ),
                "altura_anclada_max_m": round(
                    dominio.aplicar_anclaje(dia.altura_max_m, sesgo_m, (dia.fecha - hoy).days), 2
                ),
            }
        )
        for dia in dias
    ]
    anclaje = Anclaje(
        aplicado=True,
        sesgo_m=sesgo_m,
        altura_real_m=altura_real_m,
        fecha_referencia=hoy,
        motivo=None,
    )
    return dias_anclados, anclaje


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
