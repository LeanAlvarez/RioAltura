"""Repository for the Telegram channel state, daily send cap and per-subscriber thresholds.

Dialect-agnostic (Postgres and SQLite), same convention as the other
repositories in this package.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime

from sqlalchemy import Engine, select
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.orm import Session

from app.models.telegram import TelegramEnvioDia, TelegramEstadoCanal, TelegramSuscripcion

__all__ = [
    "EstadoCanal",
    "Suscripcion",
    "obtener_estado_canal",
    "actualizar_estado_canal",
    "reservar_cupo_diario",
    "obtener_suscripcion",
    "listar_suscripciones",
    "fijar_umbral",
    "eliminar_suscripcion",
    "actualizar_estado_suscripcion",
]

_ID_CANAL = 1


def _as_utc(value: datetime | None) -> datetime | None:
    """Normalise a datetime read back from the database to timezone-aware UTC.

    SQLite drops timezone info on write, so values come back naive (treated
    as UTC, since that is what we always write). Postgres returns aware
    values. Same convention as `app.repositories.alturas`.
    """
    if value is None or value.tzinfo is not None:
        return value.astimezone(UTC) if value is not None else None
    return value.replace(tzinfo=UTC)


@dataclass(frozen=True)
class EstadoCanal:
    """The public channel's singleton publish state, read back from the database."""

    nivel_publicado: str | None
    nivel_candidato: str | None
    corridas_candidato: int
    publicado_en: datetime | None
    mensaje_id: int | None
    estado_diario_fecha: date | None
    ultimo_update_id: int | None


def _row_to_estado(row: TelegramEstadoCanal) -> EstadoCanal:
    return EstadoCanal(
        nivel_publicado=row.nivel_publicado,
        nivel_candidato=row.nivel_candidato,
        corridas_candidato=row.corridas_candidato,
        publicado_en=_as_utc(row.publicado_en),
        mensaje_id=row.mensaje_id,
        estado_diario_fecha=row.estado_diario_fecha,
        ultimo_update_id=row.ultimo_update_id,
    )


def obtener_estado_canal(engine: Engine) -> EstadoCanal:
    """Return the channel's singleton state row, creating it (all-empty) the first time."""
    with Session(engine) as session:
        row = session.get(TelegramEstadoCanal, _ID_CANAL)
        if row is None:
            row = TelegramEstadoCanal(id=_ID_CANAL, corridas_candidato=0)
            session.add(row)
            session.commit()
            session.refresh(row)
        return _row_to_estado(row)


def actualizar_estado_canal(engine: Engine, **campos: object) -> None:
    """Partially update the singleton state row (creating it first if missing).

    S2 (dedup) and A2's daily gate live here, persisted -- restarting the
    worker never loses them.
    """
    with Session(engine) as session:
        row = session.get(TelegramEstadoCanal, _ID_CANAL)
        if row is None:
            row = TelegramEstadoCanal(id=_ID_CANAL, corridas_candidato=0)
            session.add(row)
        for campo, valor in campos.items():
            setattr(row, campo, valor)
        session.commit()


def reservar_cupo_diario(engine: Engine, fecha: date, tope: int) -> bool:
    """Atomically reserve one send for `fecha` against the hard daily cap `tope` (S3).

    Returns True (and increments the counter) if the day is still under the
    cap; False if `fecha` already reached `tope` -- callers must not send in
    that case. The increment-and-check happens in a single statement so
    concurrent jobs can never both slip past the cap. `tope <= 0` always
    returns False (an empty day still has zero rows, so the ON CONFLICT
    guard below never even runs on the very first message).
    """
    if tope <= 0:
        return False

    insert = postgresql.insert if engine.dialect.name == "postgresql" else sqlite.insert
    stmt = insert(TelegramEnvioDia).values(fecha=fecha, contador=1)
    stmt = stmt.on_conflict_do_update(
        index_elements=["fecha"],
        set_={"contador": TelegramEnvioDia.contador + 1},
        where=TelegramEnvioDia.contador < tope,
    ).returning(TelegramEnvioDia.contador)

    with engine.begin() as conn:
        result = conn.execute(stmt)
        return result.first() is not None


@dataclass(frozen=True)
class Suscripcion:
    """One subscriber's own threshold and its antirebote/dedup bookkeeping."""

    chat_id: int
    umbral_m: float
    sobre_umbral: bool | None
    candidato_sobre_umbral: bool | None
    corridas_candidato: int


def _row_to_suscripcion(row: TelegramSuscripcion) -> Suscripcion:
    return Suscripcion(
        chat_id=row.chat_id,
        umbral_m=row.umbral_m,
        sobre_umbral=row.sobre_umbral,
        candidato_sobre_umbral=row.candidato_sobre_umbral,
        corridas_candidato=row.corridas_candidato,
    )


def obtener_suscripcion(engine: Engine, chat_id: int) -> Suscripcion | None:
    with Session(engine) as session:
        row = session.get(TelegramSuscripcion, chat_id)
        return _row_to_suscripcion(row) if row is not None else None


def listar_suscripciones(engine: Engine) -> list[Suscripcion]:
    with Session(engine) as session:
        rows = session.execute(select(TelegramSuscripcion)).scalars().all()
        return [_row_to_suscripcion(row) for row in rows]


def fijar_umbral(engine: Engine, chat_id: int, umbral_m: float) -> None:
    """Create or update a subscriber's threshold (B3: set it).

    Resets the antirebote/dedup bookkeeping: a changed threshold starts a
    fresh comparison against the river, not a continuation of the old one.
    """
    with Session(engine) as session:
        row = session.get(TelegramSuscripcion, chat_id)
        if row is None:
            row = TelegramSuscripcion(chat_id=chat_id, umbral_m=umbral_m)
            session.add(row)
        else:
            row.umbral_m = umbral_m
        row.sobre_umbral = None
        row.candidato_sobre_umbral = None
        row.corridas_candidato = 0
        session.commit()


def eliminar_suscripcion(engine: Engine, chat_id: int) -> bool:
    """Delete a subscriber's row entirely (B3: baja borra la fila).

    Returns whether a row actually existed to delete.
    """
    with Session(engine) as session:
        row = session.get(TelegramSuscripcion, chat_id)
        if row is None:
            return False
        session.delete(row)
        session.commit()
        return True


def actualizar_estado_suscripcion(
    engine: Engine,
    chat_id: int,
    *,
    sobre_umbral: bool | None,
    candidato_sobre_umbral: bool | None,
    corridas_candidato: int,
) -> None:
    """Update one subscriber's antirebote/dedup bookkeeping (S1/S2), by chat_id.

    A no-op if the subscriber unsubscribed in the meantime (row already
    gone) -- never recreates a deleted subscription.
    """
    with Session(engine) as session:
        row = session.get(TelegramSuscripcion, chat_id)
        if row is None:
            return
        row.sobre_umbral = sobre_umbral
        row.candidato_sobre_umbral = candidato_sobre_umbral
        row.corridas_candidato = corridas_candidato
        session.commit()
