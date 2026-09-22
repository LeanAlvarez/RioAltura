from collections.abc import Iterator
from datetime import date

import pytest
from app.main import app
from app.models import Base
from app.repositories.db import get_engine
from app.repositories.salto_grande import ComunicadoIn, upsert_comunicado
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine
from sqlalchemy.pool import StaticPool


@pytest.fixture
def engine() -> Iterator[Engine]:
    eng = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
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


def test_salto_grande_503_cuando_no_hay_datos(client: TestClient) -> None:
    response = client.get("/salto-grande")

    assert response.status_code == 503
    assert "detail" in response.json()


def test_salto_grande_devuelve_el_ultimo_comunicado(client: TestClient, engine: Engine) -> None:
    upsert_comunicado(
        engine,
        [
            ComunicadoIn(
                fecha=date(2026, 9, 22),
                aporte_m3s=7553.0,
                evacuado_m3s=7821.0,
                nivel_embalse_m=34.81,
                estado_vertedero="Cerrado",
                texto_proyeccion="Hasta la hora 15:00 de mañana...",
            )
        ],
    )

    response = client.get("/salto-grande")

    assert response.status_code == 200
    body = response.json()
    assert body["comunicado"]["fecha"] == "2026-09-22"
    assert body["comunicado"]["evacuado_m3s"] == pytest.approx(7821.0)
    assert body["comunicado"]["estado_vertedero"] == "Cerrado"
    assert body["comunicado_anterior"] is None
    assert body["caudales_cascada"] == []
    assert body["lluvia_observada"] == []
    assert body["lluvia_pronostico"] == []
