"""Pydantic schemas for the /api/pronostico endpoints."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

NivelAviso = Literal["sin_aviso", "atencion", "alerta_probable"]

NIVELES_AVISO: tuple[NivelAviso, ...] = ("sin_aviso", "atencion", "alerta_probable")


class DiaPronostico(BaseModel):
    fecha: date
    lead_dias: int
    caudal_m3s: float
    altura_est_m: float
    altura_min_m: float
    altura_max_m: float
    extrapolado: bool


class AvisoPronostico(BaseModel):
    nivel: NivelAviso
    umbral_m3s: float | None
    primer_dia: date | None
    caudal_max_m3s: float | None


class Pronostico(BaseModel):
    emitido: datetime
    gauge_id: str
    dias: list[DiaPronostico]
    aviso: AvisoPronostico


class PronosticoAguasArriba(BaseModel):
    emitido: datetime
    gauge_id: str
    dias: list[DiaPronostico]


class HistoricoDia(BaseModel):
    fecha: date
    caudal_m3s: float
    altura_est_m: float
    extrapolado: bool
