"""Salto Grande dam (CTM) daily hydrology data (spec 012).

Only reads what the worker already stored (see `worker/jobs/salto_grande.py`);
never calls CTM from the request path.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import Engine

from app.repositories.db import get_engine
from app.schemas.salto_grande import SaltoGrande
from app.services.salto_grande import hay_datos, obtener_salto_grande

router = APIRouter(prefix="/salto-grande", tags=["salto-grande"])

_SIN_DATOS = "Todavía no hay datos de Salto Grande cargados"


@router.get("", response_model=SaltoGrande)
@router.get("/", response_model=SaltoGrande, include_in_schema=False)
def salto_grande(engine: Annotated[Engine, Depends(get_engine)]) -> SaltoGrande:
    resultado = obtener_salto_grande(engine)
    if not hay_datos(resultado):
        raise HTTPException(status_code=503, detail=_SIN_DATOS)
    return resultado
