from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from app.config import dominio
from app.config.dominio import GAUGE_GOOGLE_AGUAS_ARRIBA, GAUGE_GOOGLE_COLON
from app.main import app
from app.models import Base
from app.repositories.alturas import AlturaIn, upsert_alturas
from app.repositories.db import get_engine
from app.repositories.pronosticos import PronosticoIn, upsert_pronosticos
from app.services.alturas import hoy_buenos_aires
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine
from sqlalchemy.pool import StaticPool

# `hoy` se calcula en cada corrida (no se hardcodea una fecha) porque C3
# (spec 007) filtra el pronóstico por `fecha >= hoy`, y el endpoint usa el
# reloj real (no acepta una fecha de referencia por parámetro).
_HOY = hoy_buenos_aires()
_MANIANA = _HOY + timedelta(days=1)
_CAUDAL_HOY = 6_000.0


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
    emitido = datetime.combine(_HOY, datetime.min.time(), tzinfo=UTC) - timedelta(hours=4)
    upsert_pronosticos(
        engine,
        [
            PronosticoIn(
                gauge_id=GAUGE_GOOGLE_COLON,
                emitido=emitido,
                fecha=_HOY,
                lead_dias=0,
                caudal_m3s=_CAUDAL_HOY,
            ),
            PronosticoIn(
                gauge_id=GAUGE_GOOGLE_COLON,
                emitido=emitido,
                fecha=_MANIANA,
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
    assert body["aviso"]["primer_dia"] == _MANIANA.isoformat()


def test_pronostico_c3_el_primer_dia_de_la_lista_es_hoy(client: TestClient, engine: Engine) -> None:
    # La última emisión de Google incluye un día pasado (lead_dias == -1):
    # no debe aparecer en la respuesta.
    ayer = _HOY - timedelta(days=1)
    upsert_pronosticos(
        engine,
        [
            PronosticoIn(
                gauge_id=GAUGE_GOOGLE_COLON,
                emitido=datetime.combine(ayer, datetime.min.time(), tzinfo=UTC),
                fecha=ayer,
                lead_dias=-1,
                caudal_m3s=6_000.0,
            ),
        ],
    )
    _cargar_pronostico_colon(engine)

    response = client.get("/pronostico")

    assert response.status_code == 200
    body = response.json()
    fechas = [dia["fecha"] for dia in body["dias"]]
    assert fechas[0] == _HOY.isoformat()
    assert ayer.isoformat() not in fechas


def test_pronostico_ancla_cuando_hay_altura_real_de_hoy(client: TestClient, engine: Engine) -> None:
    _cargar_pronostico_colon(engine)
    upsert_alturas(
        engine,
        [
            AlturaIn(
                fecha_hora=datetime.combine(_HOY, datetime.min.time(), tzinfo=UTC)
                + timedelta(hours=15),
                altura_m=4.29,
                fuente="ina",
            )
        ],
    )

    response = client.get("/pronostico")

    assert response.status_code == 200
    body = response.json()
    altura_est_hoy = round(dominio.altura_estimada(_CAUDAL_HOY), 2)
    sesgo_esperado = round(4.29 - altura_est_hoy, 2)
    assert body["anclaje"]["aplicado"] is True
    assert body["anclaje"]["sesgo_m"] == pytest.approx(sesgo_esperado, abs=0.01)
    assert body["anclaje"]["altura_real_m"] == pytest.approx(4.29)
    assert body["anclaje"]["fecha_referencia"] == _HOY.isoformat()
    dia_hoy = next(d for d in body["dias"] if d["fecha"] == _HOY.isoformat())
    assert dia_hoy["altura_anclada_m"] == pytest.approx(4.29, abs=0.01)
    # El aviso no cambia por anclar: sigue calculado sobre el caudal.
    assert body["aviso"]["nivel"] == "alerta_probable"


def test_pronostico_sin_altura_real_no_ancla_y_dice_el_motivo(
    client: TestClient, engine: Engine
) -> None:
    _cargar_pronostico_colon(engine)

    response = client.get("/pronostico")

    assert response.status_code == 200
    body = response.json()
    assert body["anclaje"]["aplicado"] is False
    assert body["anclaje"]["sesgo_m"] is None
    assert body["anclaje"]["motivo"]
    dia_hoy = next(d for d in body["dias"] if d["fecha"] == _HOY.isoformat())
    assert dia_hoy["altura_anclada_m"] == pytest.approx(dia_hoy["altura_est_m"])


def test_historico_devuelve_lista(client: TestClient, engine: Engine) -> None:
    _cargar_pronostico_colon(engine)

    response = client.get(
        "/pronostico/historico",
        params={"lead": 1, "desde": (_HOY - timedelta(days=365)).isoformat()},
    )

    assert response.status_code == 200
    body = response.json()
    assert body == [
        {
            "fecha": _MANIANA.isoformat(),
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
                emitido=datetime.combine(_HOY, datetime.min.time(), tzinfo=UTC),
                fecha=_MANIANA,
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
