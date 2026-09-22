"""Tests for `proximo_umbral` (spec 014, M1): mirrors frontend/src/domain/umbrales.test.ts."""

import pytest
from app.config import dominio
from app.services.umbrales import UMBRALES_M, proximo_umbral


def test_umbrales_m_coincide_con_dominio_en_orden_ascendente() -> None:
    assert UMBRALES_M == (
        dominio.EVACUACION_EN_SECO_M,
        dominio.ALERTA_M,
        dominio.EVACUACION_M,
    )


@pytest.mark.parametrize(
    ("altura_m", "esperado"),
    [
        (0.0, dominio.EVACUACION_EN_SECO_M),
        (4.29, dominio.EVACUACION_EN_SECO_M),
        (dominio.EVACUACION_EN_SECO_M - 0.01, dominio.EVACUACION_EN_SECO_M),
        # Exactamente en un umbral: ya alcanzado, el próximo es el siguiente.
        (dominio.EVACUACION_EN_SECO_M, dominio.ALERTA_M),
        (dominio.ALERTA_M, dominio.EVACUACION_M),
        # Por encima de todos: no hay próximo.
        (dominio.EVACUACION_M, None),
        (dominio.EVACUACION_M + 5, None),
    ],
)
def test_proximo_umbral(altura_m: float, esperado: float | None) -> None:
    assert proximo_umbral(altura_m) == esperado
