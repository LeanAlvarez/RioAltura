from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
from jobs import prefectura
from jobs.http import FuenteError

FIXTURES = Path(__file__).parent / "fixtures"


def _fixture_html() -> str:
    return (FIXTURES / "prefectura_historico.html").read_text(encoding="utf-8")


def test_parse_historico_cuenta_filas_primera_y_ultima() -> None:
    rows = prefectura.parse_historico(_fixture_html())

    assert len(rows) == 18
    # Sorted ascending: the oldest row in the fixture comes first.
    assert rows[0].fecha_hora == datetime(2025, 9, 21, 15, 0, tzinfo=UTC)
    assert rows[-1].fecha_hora == datetime(2026, 9, 21, 3, 0, tzinfo=UTC)
    assert all(row.fuente == "prefectura" for row in rows)


def test_parse_historico_convierte_zona_horaria_local_a_utc() -> None:
    rows = prefectura.parse_historico(_fixture_html())

    ultima = rows[-1]
    # 2026-09-21 00:00 America/Argentina/Buenos_Aires (UTC-3) -> 03:00 UTC.
    assert ultima.fecha_hora == datetime(2026, 9, 21, 3, 0, tzinfo=UTC)
    assert ultima.altura_m == pytest.approx(4.29)


def test_parse_historico_acepta_valores_enteros_sin_decimales() -> None:
    rows = prefectura.parse_historico(_fixture_html())

    fila_entera = [row for row in rows if row.altura_m == pytest.approx(4.0)]
    assert fila_entera, "expected a row with an integer value (4 Mts) in the fixture"


def test_parse_historico_sin_tabla_lanza_fuente_error() -> None:
    with pytest.raises(FuenteError):
        prefectura.parse_historico("<html><body>no data here</body></html>")


def test_parse_historico_tabla_vacia_lanza_fuente_error() -> None:
    html = """
    <table class="table table-hover fpTable">
        <thead><tr><th>#</th><th>Fecha</th><th>Registro (Mts)</th></tr></thead>
        <tbody></tbody>
    </table>
    """
    with pytest.raises(FuenteError):
        prefectura.parse_historico(html)


def test_fetch_alturas_pide_los_dias_indicados() -> None:
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["params"] = dict(request.url.params)
        return httpx.Response(200, text=_fixture_html())

    client = httpx.Client(transport=httpx.MockTransport(handler))

    rows = prefectura.fetch_alturas(client, dias=3)

    assert captured["params"]["tiempo"] == "3"
    assert captured["params"]["page"] == "historico"
    assert len(rows) == 18


def test_fetch_alturas_envuelve_fallas_http_en_fuente_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    client = httpx.Client(transport=httpx.MockTransport(handler))

    # get_with_retries uses its default (real) backoff here: 3 attempts,
    # 1s + 2s of sleep, so this test takes ~3s.
    with pytest.raises(FuenteError):
        prefectura.fetch_alturas(client, dias=3)
