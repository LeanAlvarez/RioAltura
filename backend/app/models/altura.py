"""ORM model for real port gauge readings (INA / Prefectura)."""

from datetime import datetime
from typing import Literal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    Index,
    String,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

Fuente = Literal["ina", "prefectura"]

FUENTE_INA: Fuente = "ina"
FUENTE_PREFECTURA: Fuente = "prefectura"


class Altura(Base):
    """A single port gauge reading (metres over the local gauge zero)."""

    __tablename__ = "alturas"
    __table_args__ = (
        CheckConstraint("fuente IN ('ina', 'prefectura', 'caru')", name="ck_alturas_fuente"),
        UniqueConstraint("fecha_hora", "fuente", name="uq_alturas_fecha_hora_fuente"),
        Index("ix_alturas_fecha_hora", "fecha_hora"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    fecha_hora: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    altura_m: Mapped[float] = mapped_column(Float, nullable=False)
    fuente: Mapped[str] = mapped_column(String(16), nullable=False)
    # Cuarentena (spec 020). No se borra una lectura dudosa -- §9 dice que los
    # históricos son el insumo para recalibrar -- se marca, y todo lo que lee
    # alturas para mostrar o para avisar las excluye.
    sospechosa: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=false(), default=False
    )
    motivo_sospecha: Mapped[str | None] = mapped_column(String(32), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
