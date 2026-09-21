from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta

import pytest
from app.models import Base
from app.repositories.alturas import AlturaIn, AlturaRow, upsert_alturas
from app.services.alturas import (
    altura_en,
    calcular_estado,
    calcular_tendencia_24h,
    hoy_buenos_aires,
    obtener_ultima,
    primera_fecha,
    promediar_por_dia,
)
from sqlalchemy import Engine, create_engine


@pytest.fixture
def engine() -> Iterator[Engine]:
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.mark.parametrize(
    ("altura_m", "estado_esperado"),
    [
        (6.79, "normal"),
        (6.80, "evacuacion_en_seco"),
        (7.09, "evacuacion_en_seco"),
        (7.10, "alerta"),
        (7.89, "alerta"),
        (7.90, "evacuacion"),
        (9.06, "evacuacion"),
    ],
)
def test_calcular_estado_en_los_bordes(altura_m: float, estado_esperado: str) -> None:
    assert calcular_estado(altura_m) == estado_esperado


def test_tendencia_sin_lectura_previa_es_none() -> None:
    ultima = AlturaRow(
        fecha_hora=datetime(2024, 5, 14, 12, tzinfo=UTC), altura_m=9.06, fuente="ina"
    )
    assert calcular_tendencia_24h(ultima, None) is None


def test_tendencia_con_lectura_previa_positiva() -> None:
    ultima = AlturaRow(
        fecha_hora=datetime(2024, 5, 14, 12, tzinfo=UTC), altura_m=9.06, fuente="ina"
    )
    previa = AlturaRow(
        fecha_hora=datetime(2024, 5, 13, 12, tzinfo=UTC), altura_m=8.50, fuente="ina"
    )
    assert calcular_tendencia_24h(ultima, previa) == pytest.approx(0.56)


def test_tendencia_con_lectura_previa_negativa() -> None:
    ultima = AlturaRow(
        fecha_hora=datetime(2024, 5, 14, 12, tzinfo=UTC), altura_m=7.00, fuente="ina"
    )
    previa = AlturaRow(
        fecha_hora=datetime(2024, 5, 13, 12, tzinfo=UTC), altura_m=7.50, fuente="ina"
    )
    assert calcular_tendencia_24h(ultima, previa) == pytest.approx(-0.50)


def test_promediar_por_dia_agrupa_por_fecha_local_buenos_aires() -> None:
    rows = [
        AlturaRow(fecha_hora=datetime(2024, 5, 14, 3, tzinfo=UTC), altura_m=8.0, fuente="ina"),
        AlturaRow(fecha_hora=datetime(2024, 5, 14, 15, tzinfo=UTC), altura_m=9.0, fuente="ina"),
        # 2024-05-15T02:00Z is 2024-05-14T23:00 local (UTC-3): still the same local day.
        AlturaRow(fecha_hora=datetime(2024, 5, 15, 2, tzinfo=UTC), altura_m=10.0, fuente="ina"),
    ]

    resultado = promediar_por_dia(rows)

    assert len(resultado) == 1
    assert resultado[0].fecha.isoformat() == "2024-05-14"
    assert resultado[0].altura_m == pytest.approx(9.0)


def test_promediar_por_dia_prefiere_ina_sobre_prefectura_el_mismo_dia() -> None:
    rows = [
        AlturaRow(fecha_hora=datetime(2024, 5, 14, 12, tzinfo=UTC), altura_m=9.0, fuente="ina"),
        AlturaRow(
            fecha_hora=datetime(2024, 5, 14, 13, tzinfo=UTC), altura_m=1.0, fuente="prefectura"
        ),
    ]

    resultado = promediar_por_dia(rows)

    assert len(resultado) == 1
    assert resultado[0].altura_m == pytest.approx(9.0)


def test_promediar_por_dia_usa_prefectura_si_no_hay_ina_ese_dia() -> None:
    rows = [
        AlturaRow(
            fecha_hora=datetime(2024, 5, 14, 12, tzinfo=UTC), altura_m=8.0, fuente="prefectura"
        ),
        AlturaRow(
            fecha_hora=datetime(2024, 5, 14, 18, tzinfo=UTC), altura_m=8.4, fuente="prefectura"
        ),
    ]

    resultado = promediar_por_dia(rows)

    assert len(resultado) == 1
    assert resultado[0].altura_m == pytest.approx(8.2)


def test_promediar_por_dia_ordena_por_fecha() -> None:
    rows = [
        AlturaRow(fecha_hora=datetime(2024, 5, 15, 12, tzinfo=UTC), altura_m=1.0, fuente="ina"),
        AlturaRow(fecha_hora=datetime(2024, 5, 13, 12, tzinfo=UTC), altura_m=1.0, fuente="ina"),
        AlturaRow(fecha_hora=datetime(2024, 5, 14, 12, tzinfo=UTC), altura_m=1.0, fuente="ina"),
    ]

    resultado = promediar_por_dia(rows)

    assert [r.fecha.isoformat() for r in resultado] == [
        "2024-05-13",
        "2024-05-14",
        "2024-05-15",
    ]


# tendencia_24h_m uses the most recent reading whose fecha_hora is within
# [ultima.fecha_hora - 36h, ultima.fecha_hora - 20h] (inclusive), not a fixed 24h lookup.

_ULTIMA_FECHA_HORA = datetime(2024, 5, 14, 12, tzinfo=UTC)


def _seed_ultima_y_previa(engine: Engine, horas_antes: float, altura_previa: float) -> None:
    upsert_alturas(
        engine,
        [
            AlturaIn(fecha_hora=_ULTIMA_FECHA_HORA, altura_m=9.06, fuente="ina"),
            AlturaIn(
                fecha_hora=_ULTIMA_FECHA_HORA - timedelta(hours=horas_antes),
                altura_m=altura_previa,
                fuente="ina",
            ),
        ],
    )


def test_obtener_ultima_usa_lectura_24h_antes(engine: Engine) -> None:
    _seed_ultima_y_previa(engine, horas_antes=24, altura_previa=8.5)

    resultado = obtener_ultima(engine)

    assert resultado is not None
    assert resultado.tendencia_24h_m == pytest.approx(0.56)


def test_obtener_ultima_19h_antes_queda_fuera_de_la_ventana(engine: Engine) -> None:
    _seed_ultima_y_previa(engine, horas_antes=19, altura_previa=8.5)

    resultado = obtener_ultima(engine)

    assert resultado is not None
    assert resultado.tendencia_24h_m is None


def test_obtener_ultima_37h_antes_queda_fuera_de_la_ventana(engine: Engine) -> None:
    _seed_ultima_y_previa(engine, horas_antes=37, altura_previa=8.5)

    resultado = obtener_ultima(engine)

    assert resultado is not None
    assert resultado.tendencia_24h_m is None


def test_obtener_ultima_entre_21h_y_35h_usa_la_mas_cercana_a_la_ultima() -> None:
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng)
    upsert_alturas(
        eng,
        [
            AlturaIn(fecha_hora=_ULTIMA_FECHA_HORA, altura_m=9.06, fuente="ina"),
            AlturaIn(
                fecha_hora=_ULTIMA_FECHA_HORA - timedelta(hours=35), altura_m=8.0, fuente="ina"
            ),
            AlturaIn(
                fecha_hora=_ULTIMA_FECHA_HORA - timedelta(hours=21), altura_m=8.5, fuente="ina"
            ),
        ],
    )

    resultado = obtener_ultima(eng)

    assert resultado is not None
    assert resultado.tendencia_24h_m == pytest.approx(0.56)


# --- altura_en / primera_fecha / hoy_buenos_aires ---


def test_altura_en_devuelve_el_promedio_del_dia(engine: Engine) -> None:
    upsert_alturas(
        engine,
        [
            AlturaIn(fecha_hora=datetime(2026, 9, 21, 3, tzinfo=UTC), altura_m=4.2, fuente="ina"),
            AlturaIn(fecha_hora=datetime(2026, 9, 21, 15, tzinfo=UTC), altura_m=4.36, fuente="ina"),
        ],
    )

    assert altura_en(engine, date(2026, 9, 21)) == pytest.approx(4.29, abs=0.01)


def test_altura_en_sin_lecturas_ese_dia_devuelve_none(engine: Engine) -> None:
    assert altura_en(engine, date(2026, 9, 21)) is None


def test_primera_fecha_devuelve_la_fecha_local_mas_antigua(engine: Engine) -> None:
    upsert_alturas(
        engine,
        [
            AlturaIn(fecha_hora=datetime(2024, 5, 14, 12, tzinfo=UTC), altura_m=9.06, fuente="ina"),
            # 2023-10-01T01:00Z es 2023-09-30T22:00 local (UTC-3): día local anterior.
            AlturaIn(fecha_hora=datetime(2023, 10, 1, 1, tzinfo=UTC), altura_m=3.0, fuente="ina"),
        ],
    )

    assert primera_fecha(engine) == date(2023, 9, 30)


def test_primera_fecha_con_base_vacia_devuelve_none(engine: Engine) -> None:
    assert primera_fecha(engine) is None


def test_hoy_buenos_aires_convierte_desde_utc() -> None:
    # 2026-09-21T02:00Z es 2026-09-20T23:00 local (UTC-3): todavía el día anterior.
    assert hoy_buenos_aires(datetime(2026, 9, 21, 2, tzinfo=UTC)) == date(2026, 9, 20)
    assert hoy_buenos_aires(datetime(2026, 9, 21, 4, tzinfo=UTC)) == date(2026, 9, 21)
