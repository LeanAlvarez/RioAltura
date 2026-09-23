"""Repository for port gauge readings. Dialect-agnostic: works on Postgres and SQLite."""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import Engine, select, update
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.orm import Session

from app.models import Altura


@dataclass(frozen=True)
class AlturaIn:
    """A reading to be upserted. fecha_hora must be timezone-aware (UTC)."""

    fecha_hora: datetime
    altura_m: float
    fuente: str


@dataclass(frozen=True)
class AlturaRow:
    """A reading read back from the database. fecha_hora is always UTC."""

    fecha_hora: datetime
    altura_m: float
    fuente: str


def _as_utc(value: datetime) -> datetime:
    """Normalise a datetime read back from the database to timezone-aware UTC.

    SQLite drops timezone info on write, so values come back naive (treated as
    UTC, since that is what we always write). Postgres returns aware values.
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _row_to_altura(row: Altura) -> AlturaRow:
    return AlturaRow(fecha_hora=_as_utc(row.fecha_hora), altura_m=row.altura_m, fuente=row.fuente)


def upsert_alturas(engine: Engine, rows: Iterable[AlturaIn]) -> int:
    """Insert readings, ignoring ones that already exist for (fecha_hora, fuente).

    Returns the number of rows actually inserted.
    """
    values = [
        {"fecha_hora": row.fecha_hora, "altura_m": row.altura_m, "fuente": row.fuente}
        for row in rows
    ]
    if not values:
        return 0

    insert = postgresql.insert if engine.dialect.name == "postgresql" else sqlite.insert
    stmt = insert(Altura).values(values)
    stmt = stmt.on_conflict_do_nothing(index_elements=["fecha_hora", "fuente"])
    # RETURNING + counting the rows back is more portable than trusting
    # cursor.rowcount, which some drivers report as -1 for a multi-row INSERT.
    stmt = stmt.returning(Altura.id)

    with engine.begin() as conn:
        result = conn.execute(stmt)
        return len(result.fetchall())


# Spec 020 D1: TODA lectura que alimenta la pantalla o un aviso excluye las
# filas en cuarentena. No se borran (§9), se filtran.
_NO_SOSPECHOSA = Altura.sospechosa.is_(False)


def get_ultima(engine: Engine) -> AlturaRow | None:
    """Return the most recent reading (ties broken in favour of 'ina')."""
    stmt = (
        select(Altura)
        .where(_NO_SOSPECHOSA)
        .order_by(Altura.fecha_hora.desc(), (Altura.fuente != "ina").asc())
        .limit(1)
    )
    with Session(engine) as session:
        row = session.execute(stmt).scalars().first()
    return _row_to_altura(row) if row is not None else None


def get_primera(engine: Engine) -> AlturaRow | None:
    """Return the oldest stored reading (ties broken in favour of 'ina')."""
    stmt = (
        select(Altura)
        .where(_NO_SOSPECHOSA)
        .order_by(Altura.fecha_hora.asc(), (Altura.fuente != "ina").asc())
        .limit(1)
    )
    with Session(engine) as session:
        row = session.execute(stmt).scalars().first()
    return _row_to_altura(row) if row is not None else None


def get_reading_in_window(engine: Engine, desde: datetime, hasta: datetime) -> AlturaRow | None:
    """Return the most recent reading with fecha_hora in [desde, hasta] (inclusive)."""
    stmt = (
        select(Altura)
        .where(Altura.fecha_hora >= desde, Altura.fecha_hora <= hasta, _NO_SOSPECHOSA)
        .order_by(Altura.fecha_hora.desc())
        .limit(1)
    )
    with Session(engine) as session:
        row = session.execute(stmt).scalars().first()
    return _row_to_altura(row) if row is not None else None


def list_alturas(engine: Engine, desde: datetime, hasta: datetime) -> list[AlturaRow]:
    """Return readings with fecha_hora in [desde, hasta], ordered by fecha_hora."""
    stmt = (
        select(Altura)
        .where(Altura.fecha_hora >= desde, Altura.fecha_hora <= hasta, _NO_SOSPECHOSA)
        .order_by(Altura.fecha_hora.asc())
    )
    with Session(engine) as session:
        rows = session.execute(stmt).scalars().all()
    return [_row_to_altura(row) for row in rows]


def marcar_sospechosas(
    engine: Engine,
    ids: Iterable[int],
    motivo: str,
) -> int:
    """Quarantine readings by id (spec 020). Returns how many were marked.

    Never deletes: §9 keeps the history as the input for recalibration.
    Idempotent -- re-running marks nothing new.
    """
    lista = list(ids)
    if not lista:
        return 0
    with Session(engine) as session:
        resultado = session.execute(
            update(Altura)
            .where(Altura.id.in_(lista), Altura.sospechosa.is_(False))
            .values(sospechosa=True, motivo_sospecha=motivo)
        )
        session.commit()
    return resultado.rowcount or 0


def listar_para_calidad(engine: Engine) -> list[tuple[int, datetime, float, str, bool]]:
    """Every stored reading, quarantined ones included, for the quality pass."""
    stmt = select(
        Altura.id, Altura.fecha_hora, Altura.altura_m, Altura.fuente, Altura.sospechosa
    ).order_by(Altura.fecha_hora.asc())
    with Session(engine) as session:
        return [tuple(row) for row in session.execute(stmt).all()]
