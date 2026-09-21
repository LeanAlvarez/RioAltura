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
    # StaticPool + check_same_thread=False: TestClient runs the endpoint in a
    # worker thread, and an in-memory SQLite db is otherwise per-connection.
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


def test_ultima_404_cuando_no_hay_datos(client: TestClient) -> None:
    response = client.get("/alturas/ultima")

    assert response.status_code == 404
    assert response.json() == {"detail": "Sin datos de altura"}


def test_ultima_devuelve_tendencia_y_estado(client: TestClient, engine: Engine) -> None:
    upsert_alturas(
        engine,
        [
            AlturaIn(fecha_hora=datetime(2024, 5, 13, 12, tzinfo=UTC), altura_m=8.5, fuente="ina"),
            AlturaIn(fecha_hora=datetime(2024, 5, 14, 12, tzinfo=UTC), altura_m=9.06, fuente="ina"),
        ],
    )

    response = client.get("/alturas/ultima")

    assert response.status_code == 200
    body = response.json()
    assert body["altura_m"] == pytest.approx(9.06)
    assert body["fuente"] == "ina"
    assert body["tendencia_24h_m"] == pytest.approx(0.56)
    assert body["estado"] == "evacuacion"


def test_diario_devuelve_lista_agrupada(client: TestClient, engine: Engine) -> None:
    upsert_alturas(
        engine,
        [
            AlturaIn(fecha_hora=datetime(2024, 5, 14, 3, tzinfo=UTC), altura_m=9.0, fuente="ina"),
            AlturaIn(fecha_hora=datetime(2024, 5, 14, 15, tzinfo=UTC), altura_m=9.12, fuente="ina"),
        ],
    )

    response = client.get("/alturas", params={"desde": "2024-05-14", "hasta": "2024-05-14"})

    assert response.status_code == 200
    assert response.json() == [{"fecha": "2024-05-14", "altura_m": pytest.approx(9.06)}]


def test_diario_422_cuando_desde_es_posterior_a_hasta(client: TestClient) -> None:
    response = client.get("/alturas", params={"desde": "2024-05-15", "hasta": "2024-05-14"})

    assert response.status_code == 422


def test_diario_422_cuando_el_rango_supera_tres_anios(client: TestClient) -> None:
    response = client.get("/alturas", params={"desde": "2020-01-01", "hasta": "2024-01-02"})

    assert response.status_code == 422


def test_diario_422_cuando_faltan_parametros(client: TestClient) -> None:
    response = client.get("/alturas")

    assert response.status_code == 422
