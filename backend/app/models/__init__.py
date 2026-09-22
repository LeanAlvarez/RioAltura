"""ORM models. Import every model here so Base.metadata is complete for Alembic."""

from app.models.altura import FUENTE_INA, FUENTE_PREFECTURA, Altura, Fuente
from app.models.base import Base
from app.models.pronostico import Pronostico
from app.models.salto_grande import (
    TIPO_LLUVIA_OBSERVADA,
    TIPO_LLUVIA_PRONOSTICO,
    SaltoGrandeCaudalCascada,
    SaltoGrandeComunicado,
    SaltoGrandeLluvia,
    TipoLluvia,
)

__all__ = [
    "Base",
    "Altura",
    "Fuente",
    "FUENTE_INA",
    "FUENTE_PREFECTURA",
    "Pronostico",
    "SaltoGrandeComunicado",
    "SaltoGrandeCaudalCascada",
    "SaltoGrandeLluvia",
    "TipoLluvia",
    "TIPO_LLUVIA_OBSERVADA",
    "TIPO_LLUVIA_PRONOSTICO",
]
