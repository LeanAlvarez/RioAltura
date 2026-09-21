import math

import pytest
from app.config import dominio


def test_constantes_coinciden_con_claude_md() -> None:
    assert dominio.CERO_HIDROMETRO_IGN_M == -0.26
    assert dominio.EVACUACION_EN_SECO_M == 6.80
    assert dominio.ALERTA_M == 7.10
    assert dominio.EVACUACION_M == 7.90
    assert dominio.GAUGE_GOOGLE_COLON == "hybas_6121320620"
    assert dominio.GAUGE_GOOGLE_AGUAS_ARRIBA == "hybas_6120865460"
    assert dominio.INA_SERIE_ALTURA_COLON == 80
    assert dominio.INA_VAR_ID_ALTURA == 2
    assert dominio.PREFECTURA_PUERTO_COLON == 710
    assert dominio.AVISO_ATENCION_CAUDAL_M3S == 9_500
    assert dominio.AVISO_ALERTA_PROBABLE_CAUDAL_M3S == 11_000
    assert (dominio.CURVA_A, dominio.CURVA_B, dominio.CURVA_C) == (1.1926, -17.3863, 64.8496)
    assert dominio.RANGO_ESTIMACION_M == 1.0


def test_cota_agua_resta_el_cero_del_hidrometro() -> None:
    assert dominio.cota_agua(4.44) == pytest.approx(4.18)
    assert dominio.cota_agua(0.0) == pytest.approx(-0.26)


def test_altura_estimada_caudal_de_alerta() -> None:
    assert dominio.altura_estimada(12_836) == pytest.approx(7.1, abs=0.05)


def test_altura_estimada_es_monotona_en_el_rango_util() -> None:
    caudales = [2_000, 5_000, 9_500, 11_000, 12_836, 16_000]
    alturas = [dominio.altura_estimada(q) for q in caudales]
    assert alturas == sorted(alturas)
    assert all(math.isfinite(h) for h in alturas)


@pytest.mark.parametrize("caudal", [0, -1])
def test_altura_estimada_rechaza_caudal_no_positivo(caudal: float) -> None:
    with pytest.raises(ValueError):
        dominio.altura_estimada(caudal)


def test_caudal_max_calibrado_m3s() -> None:
    assert dominio.CAUDAL_MAX_CALIBRADO_M3S == 15_000


@pytest.mark.parametrize(
    ("caudal", "esperado"),
    [
        (15_000, False),
        (15_000.1, True),
    ],
)
def test_es_extrapolado_en_el_borde(caudal: float, esperado: bool) -> None:
    assert dominio.es_extrapolado(caudal) is esperado
