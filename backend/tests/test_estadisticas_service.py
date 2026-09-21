from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta

import pytest
from app.config import dominio
from app.models import Base
from app.repositories.alturas import AlturaIn, upsert_alturas
from app.repositories.pronosticos import PronosticoIn, upsert_pronosticos
from app.schemas.alturas import AlturaDiaria
from app.services.estadisticas import calcular_estadisticas, dias_en_alerta
from sqlalchemy import Engine, create_engine

_GAUGE = "hybas_colon"


@pytest.fixture
def engine() -> Iterator[Engine]:
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


def _altura(fecha: date, altura_m: float) -> AlturaIn:
    return AlturaIn(
        fecha_hora=datetime(fecha.year, fecha.month, fecha.day, 15, tzinfo=UTC),
        altura_m=altura_m,
        fuente="ina",
    )


# --- dias_en_alerta: función pura ---


def test_dias_en_alerta_vacio_sin_dias_sobre_el_umbral() -> None:
    dias = [AlturaDiaria(fecha=date(2026, 1, 1), altura_m=5.0)]
    assert dias_en_alerta(dias) == []


def test_dias_en_alerta_agrupa_rango_consecutivo() -> None:
    dias = [
        AlturaDiaria(fecha=date(2026, 5, 13), altura_m=7.20),
        AlturaDiaria(fecha=date(2026, 5, 14), altura_m=9.06),
        AlturaDiaria(fecha=date(2026, 5, 15), altura_m=7.50),
    ]
    rangos = dias_en_alerta(dias)
    assert len(rangos) == 1
    assert rangos[0].desde == date(2026, 5, 13)
    assert rangos[0].hasta == date(2026, 5, 15)
    assert rangos[0].max_m == pytest.approx(9.06)


def test_dias_en_alerta_separa_rachas_no_consecutivas() -> None:
    dias = [
        AlturaDiaria(fecha=date(2026, 5, 13), altura_m=7.20),
        AlturaDiaria(fecha=date(2026, 5, 14), altura_m=6.0),  # bajo el umbral
        AlturaDiaria(fecha=date(2026, 5, 20), altura_m=7.30),
    ]
    rangos = dias_en_alerta(dias)
    assert len(rangos) == 2
    assert rangos[0].desde == rangos[0].hasta == date(2026, 5, 13)
    assert rangos[1].desde == rangos[1].hasta == date(2026, 5, 20)


def test_dias_en_alerta_umbral_exacto_cuenta() -> None:
    assert dominio.ALERTA_M == 7.10
    dias = [AlturaDiaria(fecha=date(2026, 5, 13), altura_m=7.10)]
    assert len(dias_en_alerta(dias)) == 1


# --- calcular_estadisticas: orquestación sobre la base ---


def test_calcular_estadisticas_sin_datos_devuelve_estructura_vacia(engine: Engine) -> None:
    resultado = calcular_estadisticas(engine, _GAUGE, hoy=date(2026, 9, 21))

    assert resultado.percentil_hoy is None
    assert resultado.error_pronostico.muestras == 0
    assert resultado.error_pronostico.mae_m is None
    assert resultado.dias_en_alerta == []
    assert resultado.mismo_dia_otros_anios == []
    assert resultado.eventos == []


def test_calcular_estadisticas_percentil_hoy(engine: Engine) -> None:
    hoy = date(2026, 9, 21)
    upsert_alturas(
        engine,
        [
            _altura(hoy - timedelta(days=2), 3.0),
            _altura(hoy - timedelta(days=1), 5.0),
            _altura(hoy, 4.0),
        ],
    )

    resultado = calcular_estadisticas(engine, _GAUGE, hoy=hoy)

    assert resultado.percentil_hoy is not None
    assert resultado.percentil_hoy.altura_m == pytest.approx(4.0)
    # Un solo día (3.0) de los tres es menor a 4.0 => 1/3 = 33.3%.
    assert resultado.percentil_hoy.percentil == pytest.approx(33.3, abs=0.1)
    assert resultado.percentil_hoy.ventana_dias == 365


def test_calcular_estadisticas_error_pronostico_mae(engine: Engine) -> None:
    hoy = date(2026, 9, 21)
    fecha_pronosticada = date(2026, 9, 18)
    emitido = datetime(2026, 9, 15, 8, tzinfo=UTC)
    upsert_pronosticos(
        engine,
        [
            PronosticoIn(
                gauge_id=_GAUGE,
                emitido=emitido,
                fecha=fecha_pronosticada,
                lead_dias=3,
                caudal_m3s=12_836.0,  # altura_est_m ~= 7.07
            )
        ],
    )
    upsert_alturas(engine, [_altura(fecha_pronosticada, 8.07)])

    resultado = calcular_estadisticas(engine, _GAUGE, hoy=hoy)

    assert resultado.error_pronostico.lead_dias == 3
    assert resultado.error_pronostico.muestras == 1
    assert resultado.error_pronostico.mae_m == pytest.approx(1.0, abs=0.05)


def test_calcular_estadisticas_dias_en_alerta(engine: Engine) -> None:
    hoy = date(2026, 5, 15)
    upsert_alturas(
        engine,
        [
            _altura(date(2026, 5, 13), 7.20),
            _altura(date(2026, 5, 14), 9.06),
        ],
    )

    resultado = calcular_estadisticas(engine, _GAUGE, hoy=hoy)

    assert len(resultado.dias_en_alerta) == 1
    assert resultado.dias_en_alerta[0].max_m == pytest.approx(9.06)


def test_calcular_estadisticas_mismo_dia_otros_anios(engine: Engine) -> None:
    hoy = date(2026, 5, 14)
    upsert_alturas(
        engine,
        [
            _altura(date(2024, 5, 14), 9.06),
            _altura(date(2025, 5, 14), 7.60),
            _altura(hoy, 5.0),
        ],
    )

    resultado = calcular_estadisticas(engine, _GAUGE, hoy=hoy)

    por_anio = {m.anio: m.altura_m for m in resultado.mismo_dia_otros_anios}
    assert por_anio.keys() == {2024, 2025}
    assert por_anio[2024] == pytest.approx(9.06)
    assert por_anio[2025] == pytest.approx(7.60)


def test_calcular_estadisticas_eventos_busca_el_dia_mas_cercano_al_objetivo(
    engine: Engine,
) -> None:
    upsert_alturas(
        engine,
        [
            _altura(date(2024, 5, 13), 8.40),
            _altura(date(2024, 5, 14), 9.06),  # más cercano al objetivo 9.06
        ],
    )

    resultado = calcular_estadisticas(engine, _GAUGE, hoy=date(2026, 9, 21))

    evento_2024 = next(e for e in resultado.eventos if e.fecha.year == 2024)
    assert evento_2024.fecha == date(2024, 5, 14)
    assert evento_2024.altura_m == pytest.approx(9.06)
