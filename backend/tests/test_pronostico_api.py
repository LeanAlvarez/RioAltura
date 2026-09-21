from collections.abc import Iterator
from datetime import UTC, date, datetime

import pytest
from app.config.dominio import GAUGE_GOOGLE_AGUAS_ARRIBA, GAUGE_GOOGLE_COLON
from app.main import app
from app.models import Base
from app.repositories.db import get_engine
from app.repositories.pronosticos import PronosticoIn, upsert_pronosticos
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


def _cargar_pronostico_colon(engine: Engine) -> None:
    emitido = datetime(2026, 9, 19, 8, tzinfo=UTC)
    upsert_pronosticos(
        engine,
        [
            PronosticoIn(
                gauge_id=GAUGE_GOOGLE_COLON,
                emitido=emitido,
                fecha=date(2026, 9, 19),
                lead_dias=0,
                caudal_m3s=6_000.0,
            ),
            PronosticoIn(
                gauge_id=GAUGE_GOOGLE_COLON,
                emitido=emitido,
                fecha=date(2026, 9, 20),
                lead_dias=1,
                caudal_m3s=12_836.0,
            ),
        ],
    )


def test_pronostico_503_cuando_no_hay_datos(client: TestClient) -> None:
    response = client.get("/pronostico")

    assert response.status_code == 503
    assert "detail" in response.json()


def test_pronostico_devuelve_dias_y_aviso(client: TestClient, engine: Engine) -> None:
    _cargar_pronostico_colon(engine)

    response = client.get("/pronostico")

    assert response.status_code == 200
    body = response.json()
    assert body["gauge_id"] == GAUGE_GOOGLE_COLON
    assert len(body["dias"]) == 2
    dia_lead1 = next(d for d in body["dias"] if d["lead_dias"] == 1)
    assert dia_lead1["caudal_m3s"] == pytest.approx(12_836.0)
    assert dia_lead1["altura_est_m"] == pytest.approx(7.07, abs=0.05)
    assert dia_lead1["extrapolado"] is False
    assert body["aviso"]["nivel"] == "alerta_probable"
    assert body["aviso"]["primer_dia"] == "2026-09-20"


def test_historico_devuelve_lista(client: TestClient, engine: Engine) -> None:
    _cargar_pronostico_colon(engine)

    response = client.get("/pronostico/historico", params={"lead": 1, "desde": "2026-09-01"})

    assert response.status_code == 200
    body = response.json()
    assert body == [
        {
            "fecha": "2026-09-20",
            "caudal_m3s": pytest.approx(12_836.0),
            "altura_est_m": pytest.approx(7.07, abs=0.05),
            "extrapolado": False,
        }
    ]


def test_historico_422_con_parametros_faltantes(client: TestClient) -> None:
    response = client.get("/pronostico/historico")

    assert response.status_code == 422


def test_aguas_arriba_503_cuando_no_hay_datos(client: TestClient) -> None:
    response = client.get("/pronostico/aguas-arriba")

    assert response.status_code == 503


def test_aguas_arriba_no_incluye_aviso(client: TestClient, engine: Engine) -> None:
    upsert_pronosticos(
        engine,
        [
            PronosticoIn(
                gauge_id=GAUGE_GOOGLE_AGUAS_ARRIBA,
                emitido=datetime(2026, 9, 19, 8, tzinfo=UTC),
                fecha=date(2026, 9, 20),
                lead_dias=1,
                caudal_m3s=6_000.0,
            )
        ],
    )

    response = client.get("/pronostico/aguas-arriba")

    assert response.status_code == 200
    body = response.json()
    assert body["gauge_id"] == GAUGE_GOOGLE_AGUAS_ARRIBA
    assert "aviso" not in body
