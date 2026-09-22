"""Pydantic schemas for the /api/salto-grande endpoint (spec 012)."""

from datetime import date

from pydantic import BaseModel


class ComunicadoSaltoGrande(BaseModel):
    fecha: date
    aporte_m3s: float
    evacuado_m3s: float
    nivel_embalse_m: float
    estado_vertedero: str
    # Texto de proyección de CTM tal cual, para citarlo como propio de ellos
    # (CLAUDE.md §7): nunca se deriva una altura de Colón a partir de él.
    texto_proyeccion: str


class CaudalCascada(BaseModel):
    estacion: str
    fecha: date
    caudal_m3s: float


class LluviaSubcuenca(BaseModel):
    subcuenca: str
    fecha: date
    lluvia_mm: float


class SaltoGrande(BaseModel):
    comunicado: ComunicadoSaltoGrande | None
    comunicado_anterior: ComunicadoSaltoGrande | None
    caudales_cascada: list[CaudalCascada]
    lluvia_observada: list[LluviaSubcuenca]
    lluvia_pronostico: list[LluviaSubcuenca]
