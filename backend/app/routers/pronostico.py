"""Google forecast for Colón and upstream: forecast days, estimated level and aviso.

Only reads what the worker already stored (see `worker/jobs/google.py`);
never calls Google from the request path.
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Engine

from app.config.dominio import GAUGE_GOOGLE_AGUAS_ARRIBA, GAUGE_GOOGLE_COLON
from app.repositories.db import get_engine
from app.schemas.pronostico import HistoricoDia, Pronostico, PronosticoAguasArriba
from app.services.avisos import calcular_aviso
from app.services.pronosticos import anclar_pronostico, listar_historico, obtener_dias

router = APIRouter(prefix="/pronostico", tags=["pronostico"])

_SIN_PRONOSTICO = "Todavía no hay un pronóstico de Google cargado"


@router.get("", response_model=Pronostico)
@router.get("/", response_model=Pronostico, include_in_schema=False)
def pronostico(engine: Annotated[Engine, Depends(get_engine)]) -> Pronostico:
    resultado = obtener_dias(engine, GAUGE_GOOGLE_COLON)
    if resultado is None:
        raise HTTPException(status_code=503, detail=_SIN_PRONOSTICO)
    emitido, dias = resultado
    # El aviso se calcula siempre sobre el caudal pronosticado, nunca sobre
    # la altura anclada (CLAUDE.md §5): anclar no lo modifica.
    aviso = calcular_aviso(dias)
    dias_anclados, anclaje = anclar_pronostico(engine, dias)
    return Pronostico(
        emitido=emitido,
        gauge_id=GAUGE_GOOGLE_COLON,
        dias=dias_anclados,
        aviso=aviso,
        anclaje=anclaje,
    )


@router.get("/historico", response_model=list[HistoricoDia])
def historico(
    engine: Annotated[Engine, Depends(get_engine)],
    lead: Annotated[int, Query(ge=0, le=7)],
    desde: Annotated[date, Query()],
) -> list[HistoricoDia]:
    return listar_historico(engine, GAUGE_GOOGLE_COLON, lead, desde)


@router.get("/aguas-arriba", response_model=PronosticoAguasArriba)
def aguas_arriba(engine: Annotated[Engine, Depends(get_engine)]) -> PronosticoAguasArriba:
    resultado = obtener_dias(engine, GAUGE_GOOGLE_AGUAS_ARRIBA)
    if resultado is None:
        raise HTTPException(status_code=503, detail=_SIN_PRONOSTICO)
    emitido, dias = resultado
    return PronosticoAguasArriba(emitido=emitido, gauge_id=GAUGE_GOOGLE_AGUAS_ARRIBA, dias=dias)
