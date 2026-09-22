"""ORM models for the Telegram channel and per-subscriber thresholds (spec 011).

Three tables, all written and read only by the worker:

- `TelegramEstadoCanal`: singleton row (id=1) tracking the public channel's
  last published aviso level, its A1/S1/S2 bookkeeping, A2's once-a-day
  gate, and the `getUpdates` offset for the bot command poller.
- `TelegramEnvioDia`: one row per local calendar day, a hard send counter
  (S3).
- `TelegramSuscripcion`: one row per subscriber (`chat_id`, the only
  personal data kept), their own threshold and its own S1/S2 bookkeeping.
"""

from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Float, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class TelegramEstadoCanal(Base):
    """Singleton row (id=1) with the public channel's publish state."""

    __tablename__ = "telegram_estado_canal"

    id: Mapped[int] = mapped_column(primary_key=True)
    # S2 (dedup, persisted): last aviso level actually published (A1/A3).
    nivel_publicado: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # S1 (antirebote): level being observed but not yet confirmed, and how
    # many consecutive runs it has been observed for.
    nivel_candidato: Mapped[str | None] = mapped_column(String(32), nullable=True)
    corridas_candidato: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    publicado_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    mensaje_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # A2: local date (America/Argentina/Buenos_Aires) the daily status was
    # last sent, so it only goes out once a day.
    estado_diario_fecha: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Offset for the bot command poller (`getUpdates`), so a worker restart
    # never reprocesses updates already handled.
    ultimo_update_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    actualizado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class TelegramEnvioDia(Base):
    """Hard daily send counter (S3): one row per local calendar day."""

    __tablename__ = "telegram_envios_dia"

    fecha: Mapped[date] = mapped_column(Date, primary_key=True)
    contador: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class TelegramSuscripcion(Base):
    """One subscriber's own threshold (spec 011, nivel 2).

    `chat_id` is the only personal data kept -- it arrives from Telegram,
    never from a form POST to our API. `sobre_umbral` is the last state we
    actually notified this chat about (S2); `candidato_sobre_umbral` and
    `corridas_candidato` back its own antirebote (S1), the same mechanism
    as the channel's.
    """

    __tablename__ = "telegram_suscripciones"

    chat_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    umbral_m: Mapped[float] = mapped_column(Float, nullable=False)
    sobre_umbral: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    candidato_sobre_umbral: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    corridas_candidato: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    creado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
