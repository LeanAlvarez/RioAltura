"""Pydantic schemas for the /api/estadisticas endpoint."""

from datetime import date

from pydantic import BaseModel


class PercentilHoy(BaseModel):
    altura_m: float
    percentil: float
    ventana_dias: int


class ErrorPronostico(BaseModel):
    lead_dias: int
    muestras: int
    mae_m: float | None


class RangoAlerta(BaseModel):
    desde: date
    hasta: date
    max_m: float


class MismoDiaAnio(BaseModel):
    anio: int
    altura_m: float


class Evento(BaseModel):
    fecha: date
    altura_m: float
    etiqueta: str


class Estadisticas(BaseModel):
    # `None` cuando todavía no hay una altura real promediada para hoy.
    percentil_hoy: PercentilHoy | None
    error_pronostico: ErrorPronostico
    dias_en_alerta: list[RangoAlerta]
    mismo_dia_otros_anios: list[MismoDiaAnio]
    eventos: list[Evento]
