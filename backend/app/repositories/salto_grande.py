"""Repositories for the Salto Grande dam data (spec 012). Dialect-agnostic (Postgres/SQLite)."""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date

from sqlalchemy import Engine, func, select
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.orm import Session

from app.models import SaltoGrandeCaudalCascada, SaltoGrandeComunicado, SaltoGrandeLluvia

# --- Comunicado ---


@dataclass(frozen=True)
class ComunicadoIn:
    fecha: date
    aporte_m3s: float
    evacuado_m3s: float
    nivel_embalse_m: float
    estado_vertedero: str
    texto_proyeccion: str


@dataclass(frozen=True)
class ComunicadoRow(ComunicadoIn):
    pass


def upsert_comunicado(engine: Engine, rows: Iterable[ComunicadoIn]) -> int:
    """Insert daily bulletins, ignoring ones that already exist for `fecha`.

    Returns the number of rows actually inserted.
    """
    values = [
        {
            "fecha": row.fecha,
            "aporte_m3s": row.aporte_m3s,
            "evacuado_m3s": row.evacuado_m3s,
            "nivel_embalse_m": row.nivel_embalse_m,
            "estado_vertedero": row.estado_vertedero,
            "texto_proyeccion": row.texto_proyeccion,
        }
        for row in rows
    ]
    if not values:
        return 0

    insert = postgresql.insert if engine.dialect.name == "postgresql" else sqlite.insert
    stmt = insert(SaltoGrandeComunicado).values(values)
    stmt = stmt.on_conflict_do_nothing(index_elements=["fecha"])
    stmt = stmt.returning(SaltoGrandeComunicado.id)

    with engine.begin() as conn:
        result = conn.execute(stmt)
        return len(result.fetchall())


def list_ultimos_comunicados(engine: Engine, limite: int = 2) -> list[ComunicadoRow]:
    """The `limite` most recent bulletins, most recent first."""
    stmt = select(SaltoGrandeComunicado).order_by(SaltoGrandeComunicado.fecha.desc()).limit(limite)
    with Session(engine) as session:
        rows = session.execute(stmt).scalars().all()
    return [
        ComunicadoRow(
            fecha=row.fecha,
            aporte_m3s=row.aporte_m3s,
            evacuado_m3s=row.evacuado_m3s,
            nivel_embalse_m=row.nivel_embalse_m,
            estado_vertedero=row.estado_vertedero,
            texto_proyeccion=row.texto_proyeccion,
        )
        for row in rows
    ]


# --- Caudal cascada ---


@dataclass(frozen=True)
class CaudalCascadaIn:
    estacion: str
    fecha: date
    caudal_m3s: float


@dataclass(frozen=True)
class CaudalCascadaRow(CaudalCascadaIn):
    pass


def upsert_caudales_cascada(engine: Engine, rows: Iterable[CaudalCascadaIn]) -> int:
    """Insert cascade discharge rows, ignoring ones that already exist for (estacion, fecha)."""
    values = [
        {"estacion": row.estacion, "fecha": row.fecha, "caudal_m3s": row.caudal_m3s} for row in rows
    ]
    if not values:
        return 0

    insert = postgresql.insert if engine.dialect.name == "postgresql" else sqlite.insert
    stmt = insert(SaltoGrandeCaudalCascada).values(values)
    stmt = stmt.on_conflict_do_nothing(index_elements=["estacion", "fecha"])
    stmt = stmt.returning(SaltoGrandeCaudalCascada.id)

    with engine.begin() as conn:
        result = conn.execute(stmt)
        return len(result.fetchall())


def list_ultimos_caudales_cascada(engine: Engine) -> list[CaudalCascadaRow]:
    """Every station's discharge for the most recent `fecha` stored (the latest report)."""
    ultima_fecha = select(func.max(SaltoGrandeCaudalCascada.fecha)).scalar_subquery()
    stmt = (
        select(SaltoGrandeCaudalCascada)
        .where(SaltoGrandeCaudalCascada.fecha == ultima_fecha)
        .order_by(SaltoGrandeCaudalCascada.estacion.asc())
    )
    with Session(engine) as session:
        rows = session.execute(stmt).scalars().all()
    return [
        CaudalCascadaRow(estacion=row.estacion, fecha=row.fecha, caudal_m3s=row.caudal_m3s)
        for row in rows
    ]


# --- Lluvia ---


@dataclass(frozen=True)
class LluviaIn:
    subcuenca: str
    fecha: date
    tipo: str
    lluvia_mm: float


@dataclass(frozen=True)
class LluviaRow(LluviaIn):
    pass


def upsert_lluvia(engine: Engine, rows: Iterable[LluviaIn]) -> int:
    """Insert rainfall rows, ignoring ones that already exist for (subcuenca, fecha, tipo)."""
    values = [
        {
            "subcuenca": row.subcuenca,
            "fecha": row.fecha,
            "tipo": row.tipo,
            "lluvia_mm": row.lluvia_mm,
        }
        for row in rows
    ]
    if not values:
        return 0

    insert = postgresql.insert if engine.dialect.name == "postgresql" else sqlite.insert
    stmt = insert(SaltoGrandeLluvia).values(values)
    stmt = stmt.on_conflict_do_nothing(index_elements=["subcuenca", "fecha", "tipo"])
    stmt = stmt.returning(SaltoGrandeLluvia.id)

    with engine.begin() as conn:
        result = conn.execute(stmt)
        return len(result.fetchall())


def list_lluvia(engine: Engine, tipo: str, desde: date) -> list[LluviaRow]:
    """Rainfall rows of `tipo` with `fecha >= desde`, ordered by fecha then subcuenca."""
    stmt = (
        select(SaltoGrandeLluvia)
        .where(SaltoGrandeLluvia.tipo == tipo, SaltoGrandeLluvia.fecha >= desde)
        .order_by(SaltoGrandeLluvia.fecha.asc(), SaltoGrandeLluvia.subcuenca.asc())
    )
    with Session(engine) as session:
        rows = session.execute(stmt).scalars().all()
    return [
        LluviaRow(subcuenca=row.subcuenca, fecha=row.fecha, tipo=row.tipo, lluvia_mm=row.lluvia_mm)
        for row in rows
    ]
