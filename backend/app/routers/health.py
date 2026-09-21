from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import Engine

from app.repositories.db import get_engine
from app.services.health import check_db

router = APIRouter()


class HealthResponse(BaseModel):
    status: Literal["ok"]
    db: Literal["ok", "error"]


@router.get("/health", response_model=HealthResponse, tags=["health"])
def health(engine: Annotated[Engine, Depends(get_engine)]) -> HealthResponse:
    return HealthResponse(status="ok", db="ok" if check_db(engine) else "error")
