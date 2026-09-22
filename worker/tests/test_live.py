"""Tests against the real INA and Prefectura services. Not run by default.

Run explicitly with: uv run pytest -q -m live worker/tests/test_live.py
"""

from datetime import UTC, datetime

import pytest
from jobs import ina, prefectura, salto_grande
from jobs.http import build_client

pytestmark = pytest.mark.live


def test_ina_mayo_2024_maximo_real_es_9_06() -> None:
    with build_client() as client:
        rows = ina.fetch_alturas(
            client, datetime(2024, 5, 1, tzinfo=UTC), datetime(2024, 5, 31, 23, 59, 59, tzinfo=UTC)
        )

    assert rows
    assert max(row.altura_m for row in rows) == pytest.approx(9.06)


def test_prefectura_devuelve_al_menos_una_fila() -> None:
    with build_client() as client:
        rows = prefectura.fetch_alturas(client, dias=3)

    assert len(rows) >= 1


def test_salto_grande_parsea_los_cuatro_pdfs_reales() -> None:
    with build_client() as client:
        comunicado = salto_grande.fetch_comunicado(client)
        caudales = salto_grande.fetch_caudales_cascada(client)
        lluvia_obs = salto_grande.fetch_precipitaciones(client)
        lluvia_pron = salto_grande.fetch_pronostico_precipitaciones(client)

    print(f"\ncomunicado: {comunicado}")
    print(f"caudales_cascada: {len(caudales)} filas")
    print(f"lluvia_observada: {len(lluvia_obs)} filas")
    print(f"lluvia_pronostico: {len(lluvia_pron)} filas")

    assert comunicado.aporte_m3s > 0
    assert comunicado.evacuado_m3s > 0
    assert caudales
    assert lluvia_obs
    assert lluvia_pron
