"""Real port gauge readings: latest reading and daily history."""

from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Engine

from app.repositories.db import get_engine
from app.schemas.alturas import AlturaDiaria, UltimaAltura
from app.services.alturas import listar_diario, obtener_ultima

router = APIRouter(prefix="/alturas", tags=["alturas"])

_RANGO_MAXIMO_DIAS = 3 * 365 + 1


@router.get("/ultima", response_model=UltimaAltura)
def ultima(engine: Annotated[Engine, Depends(get_engine)]) -> UltimaAltura:
    resultado = obtener_ultima(engine)
    if resultado is None:
        raise HTTPException(status_code=404, detail="Sin datos de altura")
    return resultado


@router.get("", response_model=list[AlturaDiaria])
@router.get("/", response_model=list[AlturaDiaria], include_in_schema=False)
def diario(
    engine: Annotated[Engine, Depends(get_engine)],
    desde: Annotated[date, Query()],
    hasta: Annotated[date, Query()],
) -> list[AlturaDiaria]:
    if desde > hasta:
        raise HTTPException(status_code=422, detail="El rango es inválido: desde > hasta")
    if (hasta - desde) > timedelta(days=_RANGO_MAXIMO_DIAS):
        raise HTTPException(status_code=422, detail="El rango máximo es de 3 años")
    return listar_diario(engine, desde, hasta)
