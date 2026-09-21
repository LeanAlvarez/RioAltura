"""ORM models. Import every model here so Base.metadata is complete for Alembic."""

from app.models.altura import FUENTE_INA, FUENTE_PREFECTURA, Altura, Fuente
from app.models.base import Base
from app.models.pronostico import Pronostico

__all__ = ["Base", "Altura", "Fuente", "FUENTE_INA", "FUENTE_PREFECTURA", "Pronostico"]
