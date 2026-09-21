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
    # Anclaje del pronóstico a la altura real (spec 007, C2): traslada la
    # banda estimada hacia la altura real de hoy, con el sesgo decayendo
    # linealmente hasta el día `HORIZONTE_ANCLAJE_DIAS`. Cuando no se pudo
    # anclar (ver `Pronostico.anclaje`), estos campos son iguales a
    # `altura_est_m`/`altura_min_m`/`altura_max_m`.
    altura_anclada_m: float
    altura_anclada_min_m: float
    altura_anclada_max_m: float


class AvisoPronostico(BaseModel):
    nivel: NivelAviso
    umbral_m3s: float | None
    primer_dia: date | None
    caudal_max_m3s: float | None


class Anclaje(BaseModel):
    aplicado: bool
    sesgo_m: float | None
    altura_real_m: float | None
    fecha_referencia: date | None
    motivo: str | None


class Pronostico(BaseModel):
    emitido: datetime
    gauge_id: str
    dias: list[DiaPronostico]
    aviso: AvisoPronostico
    anclaje: Anclaje


class PronosticoAguasArriba(BaseModel):
    emitido: datetime
    gauge_id: str
    dias: list[DiaPronostico]


class HistoricoDia(BaseModel):
    fecha: date
    caudal_m3s: float
    altura_est_m: float
    extrapolado: bool
