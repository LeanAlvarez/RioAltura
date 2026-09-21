from collections.abc import Iterator
from datetime import UTC, date, datetime

import pytest
from app.models import Base
from app.repositories.pronosticos import PronosticoIn, PronosticoRow, upsert_pronosticos
from app.services.pronosticos import dia_desde_row, listar_historico, obtener_dias
from sqlalchemy import Engine, create_engine


@pytest.fixture
def engine() -> Iterator[Engine]:
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


def test_dia_desde_row_convierte_altura_con_rango() -> None:
    row = PronosticoRow(
        gauge_id="hybas_colon",
        emitido=datetime(2026, 9, 19, 8, tzinfo=UTC),
        fecha=date(2026, 9, 20),
        lead_dias=1,
        caudal_m3s=12_836.0,
    )

    dia = dia_desde_row(row)

    assert dia.altura_est_m == pytest.approx(7.07, abs=0.05)
    assert dia.altura_min_m == pytest.approx(dia.altura_est_m - 1.0)
    assert dia.altura_max_m == pytest.approx(dia.altura_est_m + 1.0)
    assert dia.extrapolado is False


@pytest.mark.parametrize(("caudal", "esperado"), [(15_000, False), (15_000.1, True)])
def test_dia_desde_row_extrapolado_en_el_borde(caudal: float, esperado: bool) -> None:
    row = PronosticoRow(
        gauge_id="hybas_colon",
        emitido=datetime(2026, 9, 19, 8, tzinfo=UTC),
        fecha=date(2026, 9, 20),
        lead_dias=1,
        caudal_m3s=caudal,
    )

    assert dia_desde_row(row).extrapolado is esperado


def test_obtener_dias_sin_datos_devuelve_none(engine: Engine) -> None:
    assert obtener_dias(engine, "hybas_colon") is None


def test_obtener_dias_filtra_lead_negativos_y_ordena_por_fecha(engine: Engine) -> None:
    emitido = datetime(2026, 9, 19, 8, tzinfo=UTC)
    upsert_pronosticos(
        engine,
        [
            PronosticoIn(
                gauge_id="hybas_colon",
                emitido=emitido,
                fecha=date(2026, 9, 18),
                lead_dias=-1,
                caudal_m3s=5_000.0,
            ),
            PronosticoIn(
                gauge_id="hybas_colon",
                emitido=emitido,
                fecha=date(2026, 9, 20),
                lead_dias=1,
                caudal_m3s=5_100.0,
            ),
            PronosticoIn(
                gauge_id="hybas_colon",
                emitido=emitido,
                fecha=date(2026, 9, 19),
                lead_dias=0,
                caudal_m3s=5_050.0,
            ),
        ],
    )

    resultado = obtener_dias(engine, "hybas_colon")

    assert resultado is not None
    emitido_resultado, dias = resultado
    assert emitido_resultado == emitido
    assert [d.lead_dias for d in dias] == [0, 1]
    assert [d.fecha for d in dias] == [date(2026, 9, 19), date(2026, 9, 20)]


def test_listar_historico_dedup_por_fecha_usa_emision_mas_reciente(engine: Engine) -> None:
    upsert_pronosticos(
        engine,
        [
            PronosticoIn(
                gauge_id="hybas_colon",
                emitido=datetime(2026, 9, 17, 8, tzinfo=UTC),
                fecha=date(2026, 9, 20),
                lead_dias=3,
                caudal_m3s=6_000.0,
            ),
            PronosticoIn(
                gauge_id="hybas_colon",
                emitido=datetime(2026, 9, 18, 8, tzinfo=UTC),
                fecha=date(2026, 9, 20),
                lead_dias=2,
                caudal_m3s=6_500.0,
            ),
        ],
    )

    historico = listar_historico(engine, "hybas_colon", 3, date(2026, 9, 1))

    assert len(historico) == 1
    assert historico[0].caudal_m3s == pytest.approx(6_000.0)
    assert historico[0].fecha == date(2026, 9, 20)


def test_listar_historico_vacio_sin_datos(engine: Engine) -> None:
    assert listar_historico(engine, "hybas_colon", 3, date(2026, 9, 1)) == []
