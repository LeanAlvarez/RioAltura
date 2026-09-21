from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta

import pytest
from app.config import dominio
from app.models import Base
from app.repositories.alturas import AlturaIn, upsert_alturas
from app.repositories.pronosticos import PronosticoIn, PronosticoRow, upsert_pronosticos
from app.services.pronosticos import (
    anclar_pronostico,
    dia_desde_row,
    listar_historico,
    obtener_dias,
)
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
    # Sin anclar todavía: los campos anclados arrancan iguales a los originales.
    assert dia.altura_anclada_m == pytest.approx(dia.altura_est_m)
    assert dia.altura_anclada_min_m == pytest.approx(dia.altura_min_m)
    assert dia.altura_anclada_max_m == pytest.approx(dia.altura_max_m)


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


def test_obtener_dias_filtra_fechas_pasadas_y_ordena_por_fecha(engine: Engine) -> None:
    # C3 (spec 007): filtra por `fecha >= hoy`, no por `lead_dias >= 0` — la
    # última emisión de Google suele ser del día anterior, así que su
    # `lead_dias == 0` cae en ayer, no en hoy.
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

    resultado = obtener_dias(engine, "hybas_colon", hoy=date(2026, 9, 19))

    assert resultado is not None
    emitido_resultado, dias = resultado
    assert emitido_resultado == emitido
    assert [d.lead_dias for d in dias] == [0, 1]
    assert [d.fecha for d in dias] == [date(2026, 9, 19), date(2026, 9, 20)]


def test_obtener_dias_hoy_posterior_a_todos_los_dias_devuelve_vacio(engine: Engine) -> None:
    emitido = datetime(2026, 9, 19, 8, tzinfo=UTC)
    upsert_pronosticos(
        engine,
        [
            PronosticoIn(
                gauge_id="hybas_colon",
                emitido=emitido,
                fecha=date(2026, 9, 19),
                lead_dias=0,
                caudal_m3s=5_050.0,
            ),
        ],
    )

    resultado = obtener_dias(engine, "hybas_colon", hoy=date(2026, 9, 20))

    assert resultado is not None
    _, dias = resultado
    assert dias == []


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


# --- anclar_pronostico (spec 007, C2) ---

_HOY = date(2026, 9, 21)


def _dias_pronostico(caudales_por_dia: dict[date, float]) -> list:
    return [
        dia_desde_row(
            PronosticoRow(
                gauge_id="hybas_colon",
                emitido=datetime(2026, 9, 21, 8, tzinfo=UTC),
                fecha=fecha,
                lead_dias=(fecha - _HOY).days,
                caudal_m3s=caudal,
            )
        )
        for fecha, caudal in caudales_por_dia.items()
    ]


def test_anclar_pronostico_hoy_queda_igual_a_la_altura_real(engine: Engine) -> None:
    dias = _dias_pronostico({_HOY: 6_000.0})
    upsert_alturas(
        engine,
        [AlturaIn(fecha_hora=datetime(2026, 9, 21, 15, tzinfo=UTC), altura_m=4.29, fuente="ina")],
    )

    dias_anclados, anclaje = anclar_pronostico(engine, dias, hoy=_HOY)

    assert anclaje.aplicado is True
    assert anclaje.altura_real_m == pytest.approx(4.29)
    assert anclaje.fecha_referencia == _HOY
    assert anclaje.motivo is None
    dia_hoy = next(d for d in dias_anclados if d.fecha == _HOY)
    assert dia_hoy.altura_anclada_m == pytest.approx(4.29, abs=0.01)


def test_anclar_pronostico_sesgo_esperado() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    caudal_hoy = 6_000.0
    altura_est_hoy = round(dominio.altura_estimada(caudal_hoy), 2)
    altura_real_hoy = 4.29
    dias = _dias_pronostico({_HOY: caudal_hoy})
    upsert_alturas(
        engine,
        [
            AlturaIn(
                fecha_hora=datetime(2026, 9, 21, 15, tzinfo=UTC),
                altura_m=altura_real_hoy,
                fuente="ina",
            )
        ],
    )

    _, anclaje = anclar_pronostico(engine, dias, hoy=_HOY)

    assert anclaje.sesgo_m == pytest.approx(round(altura_real_hoy - altura_est_hoy, 2), abs=0.01)


def test_anclar_pronostico_dia_7_no_tiene_correccion() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    dia_7 = _HOY + timedelta(days=7)
    dias = _dias_pronostico({_HOY: 6_000.0, dia_7: 6_000.0})
    upsert_alturas(
        engine,
        [AlturaIn(fecha_hora=datetime(2026, 9, 21, 15, tzinfo=UTC), altura_m=4.29, fuente="ina")],
    )

    dias_anclados, _ = anclar_pronostico(engine, dias, hoy=_HOY)

    dia_7_anclado = next(d for d in dias_anclados if d.fecha == dia_7)
    assert dia_7_anclado.altura_anclada_m == pytest.approx(dia_7_anclado.altura_est_m)


def test_anclar_pronostico_sesgo_negativo() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    caudal_hoy = 12_836.0
    altura_est_hoy = round(dominio.altura_estimada(caudal_hoy), 2)
    altura_real_hoy = altura_est_hoy - 1.0  # a propósito, más baja que la estimada
    dias = _dias_pronostico({_HOY: caudal_hoy})
    upsert_alturas(
        engine,
        [
            AlturaIn(
                fecha_hora=datetime(2026, 9, 21, 15, tzinfo=UTC),
                altura_m=altura_real_hoy,
                fuente="ina",
            )
        ],
    )

    dias_anclados, anclaje = anclar_pronostico(engine, dias, hoy=_HOY)

    assert anclaje.sesgo_m == pytest.approx(-1.0, abs=0.01)
    dia_hoy = next(d for d in dias_anclados if d.fecha == _HOY)
    assert dia_hoy.altura_anclada_m < dia_hoy.altura_est_m


def test_anclar_pronostico_sin_dia_de_hoy_no_ancla() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    otro_dia = _HOY + timedelta(days=1)
    dias = _dias_pronostico({otro_dia: 6_000.0})
    upsert_alturas(
        engine,
        [AlturaIn(fecha_hora=datetime(2026, 9, 21, 15, tzinfo=UTC), altura_m=4.29, fuente="ina")],
    )

    dias_anclados, anclaje = anclar_pronostico(engine, dias, hoy=_HOY)

    assert anclaje.aplicado is False
    assert anclaje.sesgo_m is None
    assert anclaje.altura_real_m is None
    assert anclaje.motivo is not None
    assert dias_anclados == dias


def test_anclar_pronostico_sin_altura_real_no_ancla() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    dias = _dias_pronostico({_HOY: 6_000.0})

    dias_anclados, anclaje = anclar_pronostico(engine, dias, hoy=_HOY)

    assert anclaje.aplicado is False
    assert anclaje.sesgo_m is None
    assert anclaje.altura_real_m is None
    assert anclaje.motivo is not None
    assert dias_anclados == dias


def test_anclar_pronostico_no_modifica_caudal_ni_aviso() -> None:
    from app.services.avisos import calcular_aviso

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    dia_alerta = _HOY + timedelta(days=1)
    dias = _dias_pronostico({_HOY: 6_000.0, dia_alerta: 12_836.0})
    upsert_alturas(
        engine,
        [AlturaIn(fecha_hora=datetime(2026, 9, 21, 15, tzinfo=UTC), altura_m=4.29, fuente="ina")],
    )

    aviso_antes = calcular_aviso(dias)
    dias_anclados, _ = anclar_pronostico(engine, dias, hoy=_HOY)
    aviso_despues = calcular_aviso(dias_anclados)

    assert aviso_antes == aviso_despues
    assert [d.caudal_m3s for d in dias_anclados] == [d.caudal_m3s for d in dias]
