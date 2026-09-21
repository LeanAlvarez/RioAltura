from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from app.main import app
from app.models import Base
from app.repositories.alturas import AlturaIn, upsert_alturas
from app.repositories.db import get_engine
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine
from sqlalchemy.pool import StaticPool


@pytest.fixture
def engine() -> Iterator[Engine]:
    eng = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def client(engine: Engine) -> Iterator[TestClient]:
    app.dependency_overrides[get_engine] = lambda: engine
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_estadisticas_sin_datos_devuelve_estructura_vacia(client: TestClient) -> None:
    response = client.get("/estadisticas")

    assert response.status_code == 200
    body = response.json()
    assert body["percentil_hoy"] is None
    assert body["error_pronostico"] == {"lead_dias": 3, "muestras": 0, "mae_m": None}
    assert body["dias_en_alerta"] == []
    assert body["mismo_dia_otros_anios"] == []
    assert body["eventos"] == []


def test_estadisticas_devuelve_percentil_y_dias_en_alerta(
    client: TestClient, engine: Engine
) -> None:
    upsert_alturas(
        engine,
        [
            AlturaIn(fecha_hora=datetime(2026, 5, 13, 15, tzinfo=UTC), altura_m=7.20, fuente="ina"),
            AlturaIn(fecha_hora=datetime(2026, 5, 14, 15, tzinfo=UTC), altura_m=9.06, fuente="ina"),
        ],
    )

    response = client.get("/estadisticas")

    assert response.status_code == 200
    body = response.json()
    assert len(body["dias_en_alerta"]) == 1
    assert body["dias_en_alerta"][0]["max_m"] == pytest.approx(9.06)
