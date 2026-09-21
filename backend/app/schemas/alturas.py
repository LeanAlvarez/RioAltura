"""Pydantic schemas for the /api/alturas endpoints."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

Fuente = Literal["ina", "prefectura"]
Estado = Literal["normal", "evacuacion_en_seco", "alerta", "evacuacion"]

ESTADOS: tuple[Estado, ...] = ("normal", "evacuacion_en_seco", "alerta", "evacuacion")


class UltimaAltura(BaseModel):
    fecha_hora: datetime
    altura_m: float
    fuente: Fuente
    tendencia_24h_m: float | None
    estado: Estado


class AlturaDiaria(BaseModel):
    fecha: date
    altura_m: float
