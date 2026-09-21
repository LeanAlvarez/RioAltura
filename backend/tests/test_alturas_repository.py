from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from app.models import Base
from app.repositories.alturas import (
    AlturaIn,
    get_reading_in_window,
    get_ultima,
    list_alturas,
    upsert_alturas,
)
from sqlalchemy import Engine, create_engine


@pytest.fixture
def engine() -> Iterator[Engine]:
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


def test_upsert_inserta_filas_nuevas(engine: Engine) -> None:
    rows = [
        AlturaIn(fecha_hora=datetime(2024, 5, 14, 12, tzinfo=UTC), altura_m=9.0, fuente="ina"),
        AlturaIn(fecha_hora=datetime(2024, 5, 14, 13, tzinfo=UTC), altura_m=9.1, fuente="ina"),
    ]

    inserted = upsert_alturas(engine, rows)

    assert inserted == 2
    assert (
        len(
            list_alturas(engine, datetime(2024, 1, 1, tzinfo=UTC), datetime(2025, 1, 1, tzinfo=UTC))
        )
        == 2
    )


def test_reupsert_mismas_filas_no_duplica(engine: Engine) -> None:
    rows = [
        AlturaIn(fecha_hora=datetime(2024, 5, 14, 12, tzinfo=UTC), altura_m=9.0, fuente="ina"),
    ]
    upsert_alturas(engine, rows)

    inserted_segunda_vez = upsert_alturas(engine, rows)

    assert inserted_segunda_vez == 0
    todas = list_alturas(engine, datetime(2024, 1, 1, tzinfo=UTC), datetime(2025, 1, 1, tzinfo=UTC))
    assert len(todas) == 1


def test_misma_fecha_hora_distinta_fuente_son_dos_filas(engine: Engine) -> None:
    fecha_hora = datetime(2024, 5, 14, 12, tzinfo=UTC)
    rows = [
        AlturaIn(fecha_hora=fecha_hora, altura_m=9.0, fuente="ina"),
        AlturaIn(fecha_hora=fecha_hora, altura_m=8.8, fuente="prefectura"),
    ]

    inserted = upsert_alturas(engine, rows)

    assert inserted == 2


def test_upsert_con_iterable_vacio_no_toca_la_base(engine: Engine) -> None:
    assert upsert_alturas(engine, []) == 0


def test_get_ultima_devuelve_la_de_fecha_hora_mas_reciente(engine: Engine) -> None:
    upsert_alturas(
        engine,
        [
            AlturaIn(fecha_hora=datetime(2024, 5, 13, 12, tzinfo=UTC), altura_m=8.0, fuente="ina"),
            AlturaIn(fecha_hora=datetime(2024, 5, 14, 12, tzinfo=UTC), altura_m=9.06, fuente="ina"),
        ],
    )

    ultima = get_ultima(engine)

    assert ultima is not None
    assert ultima.altura_m == pytest.approx(9.06)
    assert ultima.fecha_hora == datetime(2024, 5, 14, 12, tzinfo=UTC)


def test_get_ultima_desempata_favoreciendo_ina(engine: Engine) -> None:
    fecha_hora = datetime(2024, 5, 14, 12, tzinfo=UTC)
    upsert_alturas(
        engine,
        [
            AlturaIn(fecha_hora=fecha_hora, altura_m=8.8, fuente="prefectura"),
            AlturaIn(fecha_hora=fecha_hora, altura_m=9.0, fuente="ina"),
        ],
    )

    ultima = get_ultima(engine)

    assert ultima is not None
    assert ultima.fuente == "ina"


def test_get_ultima_con_base_vacia_devuelve_none(engine: Engine) -> None:
    assert get_ultima(engine) is None


def test_get_reading_in_window_devuelve_la_mas_reciente_del_rango(engine: Engine) -> None:
    upsert_alturas(
        engine,
        [
            AlturaIn(fecha_hora=datetime(2024, 5, 13, 0, tzinfo=UTC), altura_m=7.0, fuente="ina"),
            AlturaIn(fecha_hora=datetime(2024, 5, 13, 12, tzinfo=UTC), altura_m=7.5, fuente="ina"),
        ],
    )

    encontrada = get_reading_in_window(
        engine, datetime(2024, 5, 13, 0, tzinfo=UTC), datetime(2024, 5, 14, 0, tzinfo=UTC)
    )

    assert encontrada is not None
    assert encontrada.altura_m == pytest.approx(7.5)


def test_get_reading_in_window_sin_lecturas_en_el_rango_devuelve_none(engine: Engine) -> None:
    upsert_alturas(
        engine,
        [AlturaIn(fecha_hora=datetime(2024, 5, 10, 0, tzinfo=UTC), altura_m=7.0, fuente="ina")],
    )

    encontrada = get_reading_in_window(
        engine, datetime(2024, 5, 13, 0, tzinfo=UTC), datetime(2024, 5, 14, 0, tzinfo=UTC)
    )

    assert encontrada is None


def test_list_alturas_ordena_por_fecha_hora(engine: Engine) -> None:
    upsert_alturas(
        engine,
        [
            AlturaIn(fecha_hora=datetime(2024, 5, 15, 0, tzinfo=UTC), altura_m=1.0, fuente="ina"),
            AlturaIn(fecha_hora=datetime(2024, 5, 13, 0, tzinfo=UTC), altura_m=1.0, fuente="ina"),
            AlturaIn(fecha_hora=datetime(2024, 5, 14, 0, tzinfo=UTC), altura_m=1.0, fuente="ina"),
        ],
    )

    filas = list_alturas(engine, datetime(2024, 1, 1, tzinfo=UTC), datetime(2025, 1, 1, tzinfo=UTC))

    assert [f.fecha_hora.day for f in filas] == [13, 14, 15]


def test_lecturas_devueltas_tienen_timezone_utc(engine: Engine) -> None:
    upsert_alturas(
        engine,
        [AlturaIn(fecha_hora=datetime(2024, 5, 14, 12, tzinfo=UTC), altura_m=9.0, fuente="ina")],
    )

    ultima = get_ultima(engine)

    assert ultima is not None
    assert ultima.fecha_hora.tzinfo is not None
    assert ultima.fecha_hora.utcoffset() == timedelta(0)
