from collections.abc import Iterator
from datetime import date

import pytest
from app.models import Base
from app.repositories.salto_grande import (
    CaudalCascadaIn,
    ComunicadoIn,
    LluviaIn,
    list_lluvia,
    list_ultimos_caudales_cascada,
    list_ultimos_comunicados,
    upsert_caudales_cascada,
    upsert_comunicado,
    upsert_lluvia,
)
from sqlalchemy import Engine, create_engine


@pytest.fixture
def engine() -> Iterator[Engine]:
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


def _lluvia(subcuenca: str, fecha: date, tipo: str, lluvia_mm: float) -> LluviaIn:
    return LluviaIn(subcuenca=subcuenca, fecha=fecha, tipo=tipo, lluvia_mm=lluvia_mm)


def _comunicado(fecha: date = date(2026, 9, 22), evacuado_m3s: float = 7821.0) -> ComunicadoIn:
    return ComunicadoIn(
        fecha=fecha,
        aporte_m3s=7553.0,
        evacuado_m3s=evacuado_m3s,
        nivel_embalse_m=34.81,
        estado_vertedero="Cerrado",
        texto_proyeccion="Hasta la hora 15:00 de mañana...",
    )


# --- comunicado ---


def test_upsert_comunicado_inserta_y_no_duplica(engine: Engine) -> None:
    inserted = upsert_comunicado(engine, [_comunicado()])
    assert inserted == 1

    inserted_de_nuevo = upsert_comunicado(engine, [_comunicado()])
    assert inserted_de_nuevo == 0
    assert len(list_ultimos_comunicados(engine)) == 1


def test_upsert_comunicado_vacio_no_toca_la_base(engine: Engine) -> None:
    assert upsert_comunicado(engine, []) == 0


def test_list_ultimos_comunicados_orden_mas_reciente_primero(engine: Engine) -> None:
    upsert_comunicado(
        engine,
        [
            _comunicado(fecha=date(2026, 9, 21), evacuado_m3s=9692.0),
            _comunicado(fecha=date(2026, 9, 22), evacuado_m3s=7821.0),
        ],
    )

    ultimos = list_ultimos_comunicados(engine, limite=2)

    assert [c.fecha for c in ultimos] == [date(2026, 9, 22), date(2026, 9, 21)]
    assert ultimos[0].evacuado_m3s == pytest.approx(7821.0)


def test_list_ultimos_comunicados_base_vacia(engine: Engine) -> None:
    assert list_ultimos_comunicados(engine) == []


# --- caudal cascada ---


def test_upsert_caudales_cascada_inserta_y_no_duplica(engine: Engine) -> None:
    filas = [
        CaudalCascadaIn(estacion="Machadinho", fecha=date(2026, 9, 22), caudal_m3s=2441.0),
        CaudalCascadaIn(estacion="Itá", fecha=date(2026, 9, 22), caudal_m3s=2586.0),
    ]

    assert upsert_caudales_cascada(engine, filas) == 2
    assert upsert_caudales_cascada(engine, filas) == 0


def test_list_ultimos_caudales_cascada_usa_la_fecha_mas_reciente(engine: Engine) -> None:
    upsert_caudales_cascada(
        engine,
        [
            CaudalCascadaIn(estacion="Machadinho", fecha=date(2026, 9, 21), caudal_m3s=1145.0),
            CaudalCascadaIn(estacion="Machadinho", fecha=date(2026, 9, 22), caudal_m3s=2441.0),
            CaudalCascadaIn(estacion="Itá", fecha=date(2026, 9, 22), caudal_m3s=2586.0),
        ],
    )

    ultimos = list_ultimos_caudales_cascada(engine)

    assert len(ultimos) == 2
    assert all(fila.fecha == date(2026, 9, 22) for fila in ultimos)
    por_estacion = {fila.estacion: fila.caudal_m3s for fila in ultimos}
    assert por_estacion["Machadinho"] == pytest.approx(2441.0)


def test_list_ultimos_caudales_cascada_base_vacia(engine: Engine) -> None:
    assert list_ultimos_caudales_cascada(engine) == []


# --- lluvia ---


def test_upsert_lluvia_inserta_y_no_duplica(engine: Engine) -> None:
    filas = [_lluvia("El Soberbio", date(2026, 9, 20), "observada", 58.0)]

    assert upsert_lluvia(engine, filas) == 1
    assert upsert_lluvia(engine, filas) == 0


def test_upsert_lluvia_mismo_dia_distinto_tipo_no_choca(engine: Engine) -> None:
    filas = [
        _lluvia("El Soberbio", date(2026, 9, 27), "observada", 0.0),
        _lluvia("El Soberbio", date(2026, 9, 27), "pronostico", 6.0),
    ]

    assert upsert_lluvia(engine, filas) == 2


def test_list_lluvia_filtra_por_tipo_y_desde(engine: Engine) -> None:
    upsert_lluvia(
        engine,
        [
            _lluvia("El Soberbio", date(2026, 9, 19), "observada", 13.0),
            _lluvia("El Soberbio", date(2026, 9, 20), "observada", 58.0),
            _lluvia("El Soberbio", date(2026, 9, 27), "pronostico", 6.0),
        ],
    )

    observada = list_lluvia(engine, "observada", date(2026, 9, 20))
    pronostico = list_lluvia(engine, "pronostico", date(2026, 9, 1))

    assert [f.lluvia_mm for f in observada] == [pytest.approx(58.0)]
    assert [f.lluvia_mm for f in pronostico] == [pytest.approx(6.0)]


def test_list_lluvia_base_vacia(engine: Engine) -> None:
    assert list_lluvia(engine, "observada", date(2026, 1, 1)) == []
