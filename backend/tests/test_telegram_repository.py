from collections.abc import Iterator
from datetime import UTC, date, datetime

import pytest
from app.models import Base
from app.repositories.telegram import (
    actualizar_estado_canal,
    actualizar_estado_suscripcion,
    eliminar_suscripcion,
    fijar_umbral,
    listar_suscripciones,
    obtener_estado_canal,
    obtener_suscripcion,
    reservar_cupo_diario,
)
from sqlalchemy import Engine, create_engine


@pytest.fixture
def engine() -> Iterator[Engine]:
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


# --- Estado del canal (S1/S2/A2) --------------------------------------------


def test_obtener_estado_canal_lo_crea_vacio_la_primera_vez(engine: Engine) -> None:
    estado = obtener_estado_canal(engine)

    assert estado.nivel_publicado is None
    assert estado.corridas_candidato == 0
    assert estado.ultimo_update_id is None


def test_actualizar_estado_canal_persiste_y_se_lee_de_vuelta(engine: Engine) -> None:
    ahora = datetime(2026, 9, 22, 12, 0, tzinfo=UTC)

    actualizar_estado_canal(
        engine,
        nivel_publicado="atencion",
        nivel_candidato=None,
        corridas_candidato=0,
        publicado_en=ahora,
        mensaje_id=123,
    )

    estado = obtener_estado_canal(engine)
    assert estado.nivel_publicado == "atencion"
    assert estado.publicado_en == ahora
    assert estado.mensaje_id == 123


def test_estado_persiste_a_traves_de_reinicios_simulados_s2(engine: Engine) -> None:
    """Reiniciar el worker (nueva llamada a obtener_estado_canal) no pierde el nivel publicado."""
    actualizar_estado_canal(engine, nivel_publicado="alerta_probable")

    # Simula un worker que arranca de nuevo y vuelve a leer el estado.
    estado = obtener_estado_canal(engine)

    assert estado.nivel_publicado == "alerta_probable"


# --- Tope diario (S3) --------------------------------------------------------


def test_reservar_cupo_diario_permite_hasta_el_tope_y_despues_corta(engine: Engine) -> None:
    hoy = date(2026, 9, 22)

    resultados = [reservar_cupo_diario(engine, hoy, tope=3) for _ in range(5)]

    assert resultados == [True, True, True, False, False]


def test_reservar_cupo_diario_es_independiente_por_dia(engine: Engine) -> None:
    dia1, dia2 = date(2026, 9, 22), date(2026, 9, 23)

    for _ in range(3):
        reservar_cupo_diario(engine, dia1, tope=3)

    assert reservar_cupo_diario(engine, dia1, tope=3) is False
    assert reservar_cupo_diario(engine, dia2, tope=3) is True


# --- Suscripciones por umbral propio (B1-B4) --------------------------------


def test_fijar_umbral_crea_la_suscripcion(engine: Engine) -> None:
    fijar_umbral(engine, chat_id=555, umbral_m=4.44)

    suscripcion = obtener_suscripcion(engine, 555)
    assert suscripcion is not None
    assert suscripcion.umbral_m == 4.44
    assert suscripcion.sobre_umbral is None
    assert suscripcion.corridas_candidato == 0


def test_fijar_umbral_dos_veces_actualiza_y_resetea_el_estado(engine: Engine) -> None:
    fijar_umbral(engine, chat_id=555, umbral_m=4.44)
    actualizar_estado_suscripcion(
        engine, 555, sobre_umbral=True, candidato_sobre_umbral=None, corridas_candidato=0
    )

    fijar_umbral(engine, chat_id=555, umbral_m=7.10)

    suscripcion = obtener_suscripcion(engine, 555)
    assert suscripcion is not None
    assert suscripcion.umbral_m == 7.10
    # Un umbral nuevo es una comparación nueva: el estado viejo no sobrevive.
    assert suscripcion.sobre_umbral is None


def test_eliminar_suscripcion_borra_la_fila_b3(engine: Engine) -> None:
    fijar_umbral(engine, chat_id=555, umbral_m=4.44)

    borrada = eliminar_suscripcion(engine, 555)

    assert borrada is True
    assert obtener_suscripcion(engine, 555) is None
    assert listar_suscripciones(engine) == []


def test_eliminar_suscripcion_inexistente_devuelve_false(engine: Engine) -> None:
    assert eliminar_suscripcion(engine, 999) is False


def test_actualizar_estado_suscripcion_inexistente_no_falla(engine: Engine) -> None:
    # No debe recrear la fila de alguien que ya se dio de baja.
    actualizar_estado_suscripcion(
        engine, 999, sobre_umbral=True, candidato_sobre_umbral=None, corridas_candidato=0
    )

    assert obtener_suscripcion(engine, 999) is None


def test_listar_suscripciones_devuelve_todas(engine: Engine) -> None:
    fijar_umbral(engine, chat_id=1, umbral_m=4.44)
    fijar_umbral(engine, chat_id=2, umbral_m=7.90)

    chat_ids = {s.chat_id for s in listar_suscripciones(engine)}
    assert chat_ids == {1, 2}
