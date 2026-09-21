import json
from collections.abc import Iterator
from datetime import UTC, date, datetime
from pathlib import Path

import httpx
import pytest
from app.models import Base
from app.repositories.alturas import list_alturas
from jobs import ina
from jobs.http import FuenteError, build_client
from sqlalchemy import Engine, create_engine

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def engine() -> Iterator[Engine]:
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


def test_parse_observaciones_devuelve_fechas_aware_utc_y_valores() -> None:
    payload = json.loads((FIXTURES / "ina_observaciones.json").read_text())

    rows = ina.parse_observaciones(payload)

    assert len(rows) == 2
    assert rows[0].fecha_hora == datetime(2026, 9, 19, 3, 0, tzinfo=UTC)
    assert rows[0].altura_m == pytest.approx(4.12)
    assert rows[0].fuente == "ina"
    assert rows[1].fecha_hora == datetime(2026, 9, 20, 3, 0, tzinfo=UTC)
    assert rows[1].altura_m == pytest.approx(4.29)


def test_parse_observaciones_con_payload_invalido_lanza_fuente_error() -> None:
    payload = json.loads((FIXTURES / "ina_error_400.json").read_text())

    with pytest.raises(FuenteError):
        ina.parse_observaciones(payload)


def test_parse_observaciones_mayo_2024_maximo_es_9_06() -> None:
    payload = json.loads((FIXTURES / "ina_may2024.json").read_text())

    rows = ina.parse_observaciones(payload)

    assert max(row.altura_m for row in rows) == pytest.approx(9.06)
    pico = [row for row in rows if row.altura_m == pytest.approx(9.06)][0]
    assert pico.fecha_hora.date() in (date(2024, 5, 13), date(2024, 5, 14), date(2024, 5, 15))


def test_fetch_alturas_formatea_timestart_timeend_en_utc() -> None:
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["params"] = dict(request.url.params)
        return httpx.Response(200, json=[])

    client = httpx.Client(transport=httpx.MockTransport(handler))

    ina.fetch_alturas(
        client, datetime(2023, 10, 1, tzinfo=UTC), datetime(2023, 10, 1, 23, 59, 59, tzinfo=UTC)
    )

    assert captured["params"] == {
        "timestart": "2023-10-01T00:00:00Z",
        "timeend": "2023-10-01T23:59:59Z",
    }


def test_fetch_alturas_envuelve_error_400_en_fuente_error() -> None:
    payload = json.loads((FIXTURES / "ina_error_400.json").read_text())

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json=payload)

    client = httpx.Client(transport=httpx.MockTransport(handler))

    with pytest.raises(FuenteError):
        ina.fetch_alturas(
            client, datetime(2023, 10, 1, tzinfo=UTC), datetime(2023, 10, 2, tzinfo=UTC)
        )


def test_windows_genera_ventanas_de_90_dias_sin_huecos_ni_solapes() -> None:
    windows = ina._windows(date(2023, 10, 1), date(2024, 3, 31), 90)

    assert windows[0] == (date(2023, 10, 1), date(2023, 12, 29))
    for (_, fin), (siguiente_inicio, _) in zip(windows, windows[1:], strict=False):
        assert siguiente_inicio == fin + (siguiente_inicio - fin)
        assert (siguiente_inicio - fin).days == 1
    assert windows[-1][1] == date(2024, 3, 31)


def test_backfill_pide_las_ventanas_esperadas_y_hace_upsert(engine: Engine) -> None:
    requested_ranges = []

    def handler(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        requested_ranges.append((params["timestart"], params["timeend"]))
        # One reading per window, at the start of the window.
        timestart = params["timestart"]
        return httpx.Response(
            200,
            json=[
                {
                    "id": 1,
                    "tipo": "puntual",
                    "series_id": 80,
                    "timestart": timestart,
                    "timeend": timestart,
                    "timeupdate": timestart,
                    "valor": 5.0,
                    "stats": None,
                }
            ],
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    sleeps: list[float] = []

    inserted = ina.backfill(
        engine, client, date(2023, 10, 1), date(2024, 3, 31), window_days=90, sleep=sleeps.append
    )

    assert requested_ranges == [
        ("2023-10-01T00:00:00Z", "2023-12-29T23:59:59Z"),
        ("2023-12-30T00:00:00Z", "2024-03-28T23:59:59Z"),
        ("2024-03-29T00:00:00Z", "2024-03-31T23:59:59Z"),
    ]
    assert inserted == 3
    assert len(sleeps) == 2  # a pause between windows, none after the last

    filas = list_alturas(engine, datetime(2023, 1, 1, tzinfo=UTC), datetime(2025, 1, 1, tzinfo=UTC))
    assert len(filas) == 3


def test_backfill_dos_veces_la_segunda_no_inserta(engine: Engine) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=[
                {
                    "id": 1,
                    "tipo": "puntual",
                    "series_id": 80,
                    "timestart": "2023-10-01T00:00:00.000Z",
                    "timeend": "2023-10-01T00:00:00.000Z",
                    "timeupdate": "2023-10-01T00:00:00.000Z",
                    "valor": 5.0,
                    "stats": None,
                }
            ],
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))

    primera = ina.backfill(
        engine, client, date(2023, 10, 1), date(2023, 10, 1), window_days=90, sleep=lambda _: None
    )
    segunda = ina.backfill(
        engine, client, date(2023, 10, 1), date(2023, 10, 1), window_days=90, sleep=lambda _: None
    )

    assert primera == 1
    assert segunda == 0


def test_backfill_cli_help_no_falla() -> None:
    with pytest.raises(SystemExit) as exc_info:
        ina._parse_args(["backfill", "--help"])
    assert exc_info.value.code == 0


def test_build_client_disponible_para_el_cli() -> None:
    client = build_client()
    client.close()
