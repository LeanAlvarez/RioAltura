"""Aggregate statistics over stored readings and forecasts (spec 007).

Everything here is computed from what is already in Postgres; never calls an
external API from the request path (CLAUDE.md section 3).
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import Engine

from app.config.dominio import GAUGE_GOOGLE_COLON
from app.repositories.db import get_engine
from app.schemas.estadisticas import Estadisticas
from app.services.estadisticas import calcular_estadisticas

router = APIRouter(prefix="/estadisticas", tags=["estadisticas"])


@router.get("", response_model=Estadisticas)
@router.get("/", response_model=Estadisticas, include_in_schema=False)
def estadisticas(engine: Annotated[Engine, Depends(get_engine)]) -> Estadisticas:
    return calcular_estadisticas(engine, GAUGE_GOOGLE_COLON)
