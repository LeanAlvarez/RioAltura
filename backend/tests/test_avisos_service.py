from datetime import date

import pytest
from app.schemas.pronostico import DiaPronostico
from app.services.avisos import calcular_aviso


def _dia(lead_dias: int, caudal_m3s: float, fecha: date = date(2026, 9, 20)) -> DiaPronostico:
    return DiaPronostico(
        fecha=fecha,
        lead_dias=lead_dias,
        caudal_m3s=caudal_m3s,
        altura_est_m=0.0,
        altura_min_m=-1.0,
        altura_max_m=1.0,
        extrapolado=False,
    )


@pytest.mark.parametrize(
    ("caudal", "nivel_esperado"),
    [
        (9_499, "sin_aviso"),
        (9_500, "atencion"),
        (10_999, "atencion"),
        (11_000, "alerta_probable"),
    ],
)
def test_bordes_de_umbral(caudal: float, nivel_esperado: str) -> None:
    dias = [_dia(lead_dias=3, caudal_m3s=caudal)]

    aviso = calcular_aviso(dias)

    assert aviso.nivel == nivel_esperado


def test_sin_dias_en_ventana_1_a_7_da_sin_aviso_con_campos_none() -> None:
    dias = [_dia(lead_dias=0, caudal_m3s=20_000), _dia(lead_dias=8, caudal_m3s=20_000)]

    aviso = calcular_aviso(dias)

    assert aviso.nivel == "sin_aviso"
    assert aviso.umbral_m3s is None
    assert aviso.primer_dia is None
    assert aviso.caudal_max_m3s is None


def test_sin_dias_devuelve_sin_aviso() -> None:
    aviso = calcular_aviso([])

    assert aviso.nivel == "sin_aviso"
    assert aviso.caudal_max_m3s is None


def test_primer_dia_es_el_mas_temprano_que_cruza_el_umbral() -> None:
    dias = [
        _dia(lead_dias=1, caudal_m3s=8_000, fecha=date(2026, 9, 18)),
        _dia(lead_dias=2, caudal_m3s=11_500, fecha=date(2026, 9, 19)),
        _dia(lead_dias=3, caudal_m3s=12_000, fecha=date(2026, 9, 20)),
    ]

    aviso = calcular_aviso(dias)

    assert aviso.nivel == "alerta_probable"
    assert aviso.primer_dia == date(2026, 9, 19)
    assert aviso.umbral_m3s == 11_000
    assert aviso.caudal_max_m3s == pytest.approx(12_000)


def test_caudal_max_es_el_maximo_entre_los_dias_considerados_aunque_sin_aviso() -> None:
    dias = [
        _dia(lead_dias=1, caudal_m3s=4_000),
        _dia(lead_dias=2, caudal_m3s=9_100),
    ]

    aviso = calcular_aviso(dias)

    assert aviso.nivel == "sin_aviso"
    assert aviso.caudal_max_m3s == pytest.approx(9_100)
