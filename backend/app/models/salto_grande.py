"""ORM models for the Salto Grande dam (CTM) daily hydrology bulletins (spec 012).

Three independent tables, one per PDF source that feeds them (see
`worker/jobs/salto_grande.py`): the daily discharge/reservoir communiqué,
cascade discharge per upstream station, and rainfall per subcuenca.
"""

from datetime import date, datetime
from typing import Literal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Float,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

TipoLluvia = Literal["observada", "pronostico"]

TIPO_LLUVIA_OBSERVADA: TipoLluvia = "observada"
TIPO_LLUVIA_PRONOSTICO: TipoLluvia = "pronostico"


class SaltoGrandeComunicado(Base):
    """One daily CTM bulletin: discharge, reservoir level, vertedero, projection text."""

    __tablename__ = "salto_grande_comunicado"
    __table_args__ = (UniqueConstraint("fecha", name="uq_salto_grande_comunicado_fecha"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    fecha: Mapped[date] = mapped_column(Date, nullable=False)
    aporte_m3s: Mapped[float] = mapped_column(Float, nullable=False)
    evacuado_m3s: Mapped[float] = mapped_column(Float, nullable=False)
    nivel_embalse_m: Mapped[float] = mapped_column(Float, nullable=False)
    estado_vertedero: Mapped[str] = mapped_column(String(64), nullable=False)
    # Texto de proyección de CTM, citado tal cual (CLAUDE.md §7): nunca se
    # deriva una altura de Colón a partir de él (CLAUDE.md §5, §9).
    texto_proyeccion: Mapped[str] = mapped_column(Text, nullable=False)
    creado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class SaltoGrandeCaudalCascada(Base):
    """Daily discharge (m3/s) for one upstream cascade station."""

    __tablename__ = "salto_grande_caudal_cascada"
    __table_args__ = (
        UniqueConstraint("estacion", "fecha", name="uq_salto_grande_caudal_cascada_estacion_fecha"),
        Index("ix_salto_grande_caudal_cascada_fecha", "fecha"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    estacion: Mapped[str] = mapped_column(String(64), nullable=False)
    fecha: Mapped[date] = mapped_column(Date, nullable=False)
    caudal_m3s: Mapped[float] = mapped_column(Float, nullable=False)
    creado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class SaltoGrandeLluvia(Base):
    """Observed or forecast rainfall (mm) for one subcuenca and date.

    `tipo` distinguishes `Precipitaciones.pdf` (observada) from
    `PronosticosP.pdf` (pronostico, GFS model): same shape, same columns,
    different source.
    """

    __tablename__ = "salto_grande_lluvia"
    __table_args__ = (
        CheckConstraint("tipo IN ('observada', 'pronostico')", name="ck_salto_grande_lluvia_tipo"),
        UniqueConstraint(
            "subcuenca", "fecha", "tipo", name="uq_salto_grande_lluvia_subcuenca_fecha_tipo"
        ),
        Index("ix_salto_grande_lluvia_tipo_fecha", "tipo", "fecha"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    subcuenca: Mapped[str] = mapped_column(String(64), nullable=False)
    fecha: Mapped[date] = mapped_column(Date, nullable=False)
    tipo: Mapped[str] = mapped_column(String(16), nullable=False)
    lluvia_mm: Mapped[float] = mapped_column(Float, nullable=False)
    creado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
