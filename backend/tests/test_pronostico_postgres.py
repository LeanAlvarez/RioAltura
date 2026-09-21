"""Integration tests against a real Postgres database.

Skipped unless TEST_DATABASE_URL is set. Runs migrations programmatically and
exercises the repository against the actual pronosticos table, then cleans
up after itself (it never drops tables).
"""

import os
from collections.abc import Iterator
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import Engine, create_engine, text

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL, reason="TEST_DATABASE_URL no está configurada"
)

# A gauge_id only used by this test module, so cleanup is unambiguous.
_MARCA_GAUGE_ID = "hybas_test_0003"


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
            text("DELETE FROM pronosticos WHERE gauge_id = :gauge_id"),
            {"gauge_id": _MARCA_GAUGE_ID},
        )
    eng.dispose()
    get_settings.cache_clear()


def test_tabla_pronosticos_existe_y_upsert_no_duplica(engine: Engine) -> None:
    from app.repositories.pronosticos import PronosticoIn, list_ultima_emision, upsert_pronosticos

    emitido = datetime(2099, 1, 1, tzinfo=UTC)
    rows = [
        PronosticoIn(
            gauge_id=_MARCA_GAUGE_ID,
            emitido=emitido,
            fecha=date(2099, 1, 1),
            lead_dias=0,
            caudal_m3s=1_000.0,
        ),
        PronosticoIn(
            gauge_id=_MARCA_GAUGE_ID,
            emitido=emitido,
            fecha=date(2099, 1, 2),
            lead_dias=1,
            caudal_m3s=1_100.0,
        ),
    ]

    inserted = upsert_pronosticos(engine, rows)
    inserted_de_nuevo = upsert_pronosticos(engine, rows)

    assert inserted == 2
    assert inserted_de_nuevo == 0

    filas = list_ultima_emision(engine, _MARCA_GAUGE_ID)
    assert len(filas) == 2


def test_constraint_unico_por_gauge_emitido_fecha(engine: Engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO pronosticos (gauge_id, emitido, fecha, lead_dias, caudal_m3s) "
                "VALUES (:gauge_id, :emitido, :fecha, 0, 500.0)"
            ),
            {
                "gauge_id": _MARCA_GAUGE_ID,
                "emitido": datetime(2099, 1, 1, tzinfo=UTC),
                "fecha": date(2099, 1, 3),
            },
        )

    with pytest.raises(Exception):  # noqa: B017 - IntegrityError from the DB driver
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO pronosticos (gauge_id, emitido, fecha, lead_dias, caudal_m3s) "
                    "VALUES (:gauge_id, :emitido, :fecha, 0, 600.0)"
                ),
                {
                    "gauge_id": _MARCA_GAUGE_ID,
                    "emitido": datetime(2099, 1, 1, tzinfo=UTC),
                    "fecha": date(2099, 1, 3),
                },
            )
