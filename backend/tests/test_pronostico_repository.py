from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta

import pytest
from app.models import Base
from app.repositories.pronosticos import (
    PronosticoIn,
    get_ultima_emision,
    list_por_lead,
    list_ultima_emision,
    upsert_pronosticos,
)
from sqlalchemy import Engine, create_engine


@pytest.fixture
def engine() -> Iterator[Engine]:
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


def _dia(
    gauge_id: str = "hybas_colon",
    emitido: datetime = datetime(2026, 9, 19, 8, tzinfo=UTC),
    fecha: date = date(2026, 9, 20),
    lead_dias: int = 1,
    caudal_m3s: float = 9_000.0,
) -> PronosticoIn:
    return PronosticoIn(
        gauge_id=gauge_id, emitido=emitido, fecha=fecha, lead_dias=lead_dias, caudal_m3s=caudal_m3s
    )


def test_upsert_inserta_filas_nuevas(engine: Engine) -> None:
    rows = [_dia(fecha=date(2026, 9, 20)), _dia(fecha=date(2026, 9, 21), lead_dias=2)]

    inserted = upsert_pronosticos(engine, rows)

    assert inserted == 2
    assert len(list_ultima_emision(engine, "hybas_colon")) == 2


def test_reupsert_mismas_filas_no_duplica(engine: Engine) -> None:
    rows = [_dia()]
    upsert_pronosticos(engine, rows)

    inserted_segunda_vez = upsert_pronosticos(engine, rows)

    assert inserted_segunda_vez == 0
    assert len(list_ultima_emision(engine, "hybas_colon")) == 1


def test_misma_fecha_distinta_emision_son_dos_filas(engine: Engine) -> None:
    rows = [
        _dia(emitido=datetime(2026, 9, 19, 8, tzinfo=UTC), fecha=date(2026, 9, 20)),
        _dia(emitido=datetime(2026, 9, 19, 20, tzinfo=UTC), fecha=date(2026, 9, 20)),
    ]

    inserted = upsert_pronosticos(engine, rows)

    assert inserted == 2


def test_upsert_con_iterable_vacio_no_toca_la_base(engine: Engine) -> None:
    assert upsert_pronosticos(engine, []) == 0


def test_get_ultima_emision_devuelve_la_mas_reciente(engine: Engine) -> None:
    upsert_pronosticos(
        engine,
        [
            _dia(emitido=datetime(2026, 9, 18, 8, tzinfo=UTC), fecha=date(2026, 9, 19)),
            _dia(emitido=datetime(2026, 9, 19, 8, tzinfo=UTC), fecha=date(2026, 9, 20)),
        ],
    )

    ultima = get_ultima_emision(engine, "hybas_colon")

    assert ultima == datetime(2026, 9, 19, 8, tzinfo=UTC)


def test_get_ultima_emision_con_base_vacia_devuelve_none(engine: Engine) -> None:
    assert get_ultima_emision(engine, "hybas_colon") is None


def test_list_ultima_emision_con_dos_emisiones_mismo_dia_usa_la_mas_reciente(
    engine: Engine,
) -> None:
    upsert_pronosticos(
        engine,
        [
            _dia(
                emitido=datetime(2026, 9, 19, 8, tzinfo=UTC),
                fecha=date(2026, 9, 20),
                lead_dias=1,
                caudal_m3s=6_000.0,
            ),
            _dia(
                emitido=datetime(2026, 9, 19, 20, tzinfo=UTC),
                fecha=date(2026, 9, 20),
                lead_dias=1,
                caudal_m3s=12_836.0,
            ),
        ],
    )

    filas = list_ultima_emision(engine, "hybas_colon")

    assert len(filas) == 1
    assert filas[0].emitido == datetime(2026, 9, 19, 20, tzinfo=UTC)
    assert filas[0].caudal_m3s == pytest.approx(12_836.0)


def test_list_ultima_emision_con_base_vacia_devuelve_lista_vacia(engine: Engine) -> None:
    assert list_ultima_emision(engine, "hybas_colon") == []


def test_list_ultima_emision_no_mezcla_gauges(engine: Engine) -> None:
    upsert_pronosticos(
        engine,
        [
            _dia(gauge_id="hybas_colon", emitido=datetime(2026, 9, 19, 8, tzinfo=UTC)),
            _dia(gauge_id="hybas_arriba", emitido=datetime(2026, 9, 20, 8, tzinfo=UTC)),
        ],
    )

    filas = list_ultima_emision(engine, "hybas_colon")

    assert len(filas) == 1
    assert filas[0].gauge_id == "hybas_colon"


def test_list_por_lead_dedup_por_fecha_usa_emision_mas_reciente(engine: Engine) -> None:
    upsert_pronosticos(
        engine,
        [
            _dia(
                emitido=datetime(2026, 9, 19, 8, tzinfo=UTC),
                fecha=date(2026, 9, 22),
                lead_dias=3,
                caudal_m3s=7_000.0,
            ),
            _dia(
                emitido=datetime(2026, 9, 20, 8, tzinfo=UTC),
                fecha=date(2026, 9, 22),
                lead_dias=2,
                caudal_m3s=7_500.0,
            ),
        ],
    )

    filas = list_por_lead(engine, "hybas_colon", 3, date(2026, 9, 1))

    assert len(filas) == 1
    assert filas[0].caudal_m3s == pytest.approx(7_000.0)


def test_list_por_lead_filtra_por_desde(engine: Engine) -> None:
    upsert_pronosticos(
        engine,
        [
            _dia(fecha=date(2026, 9, 1), lead_dias=1),
            _dia(fecha=date(2026, 9, 10), lead_dias=1),
        ],
    )

    filas = list_por_lead(engine, "hybas_colon", 1, date(2026, 9, 5))

    assert [f.fecha for f in filas] == [date(2026, 9, 10)]


def test_filas_devueltas_tienen_timezone_utc(engine: Engine) -> None:
    upsert_pronosticos(engine, [_dia()])

    filas = list_ultima_emision(engine, "hybas_colon")

    assert filas[0].emitido.tzinfo is not None
    assert filas[0].emitido.utcoffset() == timedelta(0)
