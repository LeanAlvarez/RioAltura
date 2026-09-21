"""Integration tests against a real Postgres database.

Skipped unless TEST_DATABASE_URL is set. Runs migrations programmatically and
exercises the repository against the actual alturas table, then cleans up
after itself (it never drops tables).
"""

import os
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import Engine, create_engine, text

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL, reason="TEST_DATABASE_URL no está configurada"
)

# A fuente/fecha range only used by this test module, so cleanup is unambiguous.
_MARCA_FECHA_HORA = datetime(2099, 1, 1, tzinfo=UTC)


@pytest.fixture
def engine() -> Iterator[Engine]:
    from alembic import command
    from alembic.config import Config
    from app.config.settings import get_settings

    os.environ["DATABASE_URL"] = TEST_DATABASE_URL  # type: ignore[assignment]
    get_settings.cache_clear()

    alembic_cfg = Config("alembic.ini")
    command.upgrade(alembic_cfg, "head")

    eng = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    yield eng

    with eng.begin() as conn:
        conn.execute(
            text("DELETE FROM alturas WHERE fecha_hora >= :desde"),
            {"desde": _MARCA_FECHA_HORA},
        )
    eng.dispose()
    get_settings.cache_clear()


def test_tabla_alturas_existe_y_upsert_no_duplica(engine: Engine) -> None:
    from app.repositories.alturas import AlturaIn, list_alturas, upsert_alturas

    rows = [
        AlturaIn(fecha_hora=_MARCA_FECHA_HORA, altura_m=1.23, fuente="ina"),
        AlturaIn(fecha_hora=_MARCA_FECHA_HORA + timedelta(hours=1), altura_m=1.30, fuente="ina"),
    ]

    inserted = upsert_alturas(engine, rows)
    inserted_de_nuevo = upsert_alturas(engine, rows)

    assert inserted == 2
    assert inserted_de_nuevo == 0

    filas = list_alturas(engine, _MARCA_FECHA_HORA, _MARCA_FECHA_HORA + timedelta(days=1))
    assert len(filas) == 2


def test_constraint_unico_por_fecha_hora_y_fuente(engine: Engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO alturas (fecha_hora, altura_m, fuente) "
                "VALUES (:fecha_hora, 5.0, 'ina')"
            ),
            {"fecha_hora": _MARCA_FECHA_HORA + timedelta(hours=2)},
        )

    with pytest.raises(Exception):  # noqa: B017 - IntegrityError from the DB driver
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO alturas (fecha_hora, altura_m, fuente) "
                    "VALUES (:fecha_hora, 6.0, 'ina')"
                ),
                {"fecha_hora": _MARCA_FECHA_HORA + timedelta(hours=2)},
            )
