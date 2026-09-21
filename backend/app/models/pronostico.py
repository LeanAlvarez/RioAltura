"""ORM model for stored Google Flood Forecasting issuances."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Pronostico(Base):
    """One forecast day (`lead_dias`) from a single Google gauge issuance.

    `lead_dias` is `fecha - date(emitido)`: it can be negative for
    hindcast/nowcast ranges, which are stored too (the API filters them out
    when building responses).
    """

    __tablename__ = "pronosticos"
    __table_args__ = (
        UniqueConstraint("gauge_id", "emitido", "fecha", name="uq_pronosticos_gauge_emitido_fecha"),
        # Speeds up "latest issuance for a gauge" (max(emitido) where gauge_id=...).
        Index("ix_pronosticos_gauge_emitido", "gauge_id", "emitido"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    gauge_id: Mapped[str] = mapped_column(String(64), nullable=False)
    emitido: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    fecha: Mapped[date] = mapped_column(Date, nullable=False)
    lead_dias: Mapped[int] = mapped_column(Integer, nullable=False)
    caudal_m3s: Mapped[float] = mapped_column(Float, nullable=False)
    creado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
