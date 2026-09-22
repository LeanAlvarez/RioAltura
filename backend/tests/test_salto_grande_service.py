from collections.abc import Iterator
from datetime import date

import pytest
from app.models import Base
from app.repositories.salto_grande import (
    CaudalCascadaIn,
    ComunicadoIn,
    LluviaIn,
    upsert_caudales_cascada,
    upsert_comunicado,
    upsert_lluvia,
)
from app.services.salto_grande import hay_datos, obtener_salto_grande
from sqlalchemy import Engine, create_engine

_HOY = date(2026, 9, 22)


def _lluvia(subcuenca: str, fecha: date, tipo: str, lluvia_mm: float) -> LluviaIn:
    return LluviaIn(subcuenca=subcuenca, fecha=fecha, tipo=tipo, lluvia_mm=lluvia_mm)


@pytest.fixture
def engine() -> Iterator[Engine]:
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


def test_obtener_salto_grande_base_vacia_no_hay_datos(engine: Engine) -> None:
    resultado = obtener_salto_grande(engine, hoy=_HOY)

    assert resultado.comunicado is None
    assert resultado.comunicado_anterior is None
    assert resultado.caudales_cascada == []
    assert resultado.lluvia_observada == []
    assert resultado.lluvia_pronostico == []
    assert hay_datos(resultado) is False


def test_obtener_salto_grande_devuelve_ultimo_y_anterior_comunicado(engine: Engine) -> None:
    upsert_comunicado(
        engine,
        [
            ComunicadoIn(
                fecha=date(2026, 9, 21),
                aporte_m3s=10559.0,
                evacuado_m3s=9692.0,
                nivel_embalse_m=34.88,
                estado_vertedero="Cerrado",
                texto_proyeccion="ayer",
            ),
            ComunicadoIn(
                fecha=date(2026, 9, 22),
                aporte_m3s=7553.0,
                evacuado_m3s=7821.0,
                nivel_embalse_m=34.81,
                estado_vertedero="Cerrado",
                texto_proyeccion="hoy",
            ),
        ],
    )

    resultado = obtener_salto_grande(engine, hoy=_HOY)

    assert resultado.comunicado is not None
    assert resultado.comunicado.fecha == date(2026, 9, 22)
    assert resultado.comunicado.texto_proyeccion == "hoy"
    assert resultado.comunicado_anterior is not None
    assert resultado.comunicado_anterior.fecha == date(2026, 9, 21)
    assert hay_datos(resultado) is True


def test_obtener_salto_grande_un_solo_comunicado_sin_anterior(engine: Engine) -> None:
    upsert_comunicado(
        engine,
        [
            ComunicadoIn(
                fecha=date(2026, 9, 22),
                aporte_m3s=7553.0,
                evacuado_m3s=7821.0,
                nivel_embalse_m=34.81,
                estado_vertedero="Cerrado",
                texto_proyeccion="hoy",
            )
        ],
    )

    resultado = obtener_salto_grande(engine, hoy=_HOY)

    assert resultado.comunicado is not None
    assert resultado.comunicado_anterior is None


def test_obtener_salto_grande_lluvia_pronostico_excluye_fechas_pasadas(engine: Engine) -> None:
    upsert_lluvia(
        engine,
        [
            _lluvia("El Soberbio", date(2026, 9, 20), "pronostico", 5.0),
            _lluvia("El Soberbio", date(2026, 9, 27), "pronostico", 6.0),
        ],
    )

    resultado = obtener_salto_grande(engine, hoy=_HOY)

    assert [f.fecha for f in resultado.lluvia_pronostico] == [date(2026, 9, 27)]


def test_obtener_salto_grande_lluvia_observada_ventana_10_dias(engine: Engine) -> None:
    upsert_lluvia(
        engine,
        [
            _lluvia("El Soberbio", date(2026, 9, 1), "observada", 1.0),
            _lluvia("El Soberbio", date(2026, 9, 20), "observada", 58.0),
        ],
    )

    resultado = obtener_salto_grande(engine, hoy=_HOY)

    assert [f.fecha for f in resultado.lluvia_observada] == [date(2026, 9, 20)]


def test_obtener_salto_grande_incluye_caudales_cascada(engine: Engine) -> None:
    upsert_caudales_cascada(
        engine, [CaudalCascadaIn(estacion="Machadinho", fecha=date(2026, 9, 22), caudal_m3s=2441.0)]
    )

    resultado = obtener_salto_grande(engine, hoy=_HOY)

    assert len(resultado.caudales_cascada) == 1
    assert resultado.caudales_cascada[0].estacion == "Machadinho"


def test_hay_datos_true_con_solo_lluvia(engine: Engine) -> None:
    upsert_lluvia(engine, [_lluvia("El Soberbio", date(2026, 9, 20), "observada", 58.0)])

    resultado = obtener_salto_grande(engine, hoy=_HOY)

    assert hay_datos(resultado) is True
