"""Tests against the real INA and Prefectura services. Not run by default.

Run explicitly with: uv run pytest -q -m live worker/tests/test_live.py
"""

from datetime import UTC, datetime

import pytest
from jobs import ina, prefectura
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
