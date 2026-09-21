"""Repository for Google forecast issuances. Dialect-agnostic (Postgres and SQLite)."""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime

from sqlalchemy import Engine, func, select
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.orm import Session

from app.models import Pronostico


@dataclass(frozen=True)
class PronosticoIn:
    """A forecast day to be upserted. `emitido` must be timezone-aware (UTC)."""

    gauge_id: str
    emitido: datetime
    fecha: date
    lead_dias: int
    caudal_m3s: float


@dataclass(frozen=True)
class PronosticoRow:
    """A forecast day read back from the database. `emitido` is always UTC."""

    gauge_id: str
    emitido: datetime
    fecha: date
    lead_dias: int
    caudal_m3s: float


def _as_utc(value: datetime) -> datetime:
    """Normalise a datetime read back from the database to timezone-aware UTC.

    SQLite drops timezone info on write, so values come back naive (treated
    as UTC, since that is what we always write). Postgres returns aware
    values.
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _row_to_pronostico(row: Pronostico) -> PronosticoRow:
    return PronosticoRow(
        gauge_id=row.gauge_id,
        emitido=_as_utc(row.emitido),
        fecha=row.fecha,
        lead_dias=row.lead_dias,
        caudal_m3s=row.caudal_m3s,
    )


def upsert_pronosticos(engine: Engine, rows: Iterable[PronosticoIn]) -> int:
    """Insert forecast days, ignoring ones that already exist for (gauge_id, emitido, fecha).

    Returns the number of rows actually inserted.
    """
    values = [
        {
            "gauge_id": row.gauge_id,
            "emitido": row.emitido,
            "fecha": row.fecha,
            "lead_dias": row.lead_dias,
            "caudal_m3s": row.caudal_m3s,
        }
        for row in rows
    ]
    if not values:
        return 0

    insert = postgresql.insert if engine.dialect.name == "postgresql" else sqlite.insert
    stmt = insert(Pronostico).values(values)
    stmt = stmt.on_conflict_do_nothing(index_elements=["gauge_id", "emitido", "fecha"])
    # RETURNING + counting the rows back is more portable than trusting
    # cursor.rowcount, which some drivers report as -1 for a multi-row INSERT.
    stmt = stmt.returning(Pronostico.id)

    with engine.begin() as conn:
        result = conn.execute(stmt)
        return len(result.fetchall())


def get_ultima_emision(engine: Engine, gauge_id: str) -> datetime | None:
    """Return the timestamp of the most recent issuance for `gauge_id`, or None."""
    stmt = select(func.max(Pronostico.emitido)).where(Pronostico.gauge_id == gauge_id)
    with Session(engine) as session:
        value = session.execute(stmt).scalar_one_or_none()
    return _as_utc(value) if value is not None else None


def list_ultima_emision(engine: Engine, gauge_id: str) -> list[PronosticoRow]:
    """Every forecast day of the most recent issuance for `gauge_id` (fecha ascending).

    Empty list if there is no stored issuance. The comparison against the
    latest `emitido` runs inside the database (a correlated subquery),
    rather than round-tripping the value through Python, since SQLite loses
    timezone info on write and a naive/aware equality comparison would be
    unreliable.
    """
    ultima_emision = (
        select(func.max(Pronostico.emitido))
        .where(Pronostico.gauge_id == gauge_id)
        .scalar_subquery()
    )
    stmt = (
        select(Pronostico)
        .where(Pronostico.gauge_id == gauge_id, Pronostico.emitido == ultima_emision)
        .order_by(Pronostico.fecha.asc())
    )
    with Session(engine) as session:
        rows = session.execute(stmt).scalars().all()
    return [_row_to_pronostico(row) for row in rows]


def list_por_lead(
    engine: Engine, gauge_id: str, lead_dias: int, desde: date
) -> list[PronosticoRow]:
    """Every forecast day for `gauge_id` with the given `lead_dias`, fecha >= `desde`.

    Ordered by fecha ascending, then by emitido descending: when more than
    one issuance produced a row for the same fecha (e.g. two issuances the
    same day), the freshest one comes first for that fecha.
    """
    stmt = (
        select(Pronostico)
        .where(
            Pronostico.gauge_id == gauge_id,
            Pronostico.lead_dias == lead_dias,
            Pronostico.fecha >= desde,
        )
        .order_by(Pronostico.fecha.asc(), Pronostico.emitido.desc())
    )
    with Session(engine) as session:
        rows = session.execute(stmt).scalars().all()
    return [_row_to_pronostico(row) for row in rows]
