import json
import logging
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from app.models import Base
from app.repositories.pronosticos import list_ultima_emision, upsert_pronosticos
from jobs import google
from jobs.http import FuenteError, build_client
from jobs.settings import get_settings
from sqlalchemy import Engine, create_engine

FIXTURES = Path(__file__).parent / "fixtures"

_FAKE_KEY = "test-key-9f8e7d6c5b4a"


@pytest.fixture(autouse=True)
def _fake_api_key(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    # Deterministic key for every test in this module, independent of
    # whatever (if anything) is in the worktree's real .env.local.
    monkeypatch.setenv("FLOODS_API_KEY", _FAKE_KEY)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def engine() -> Iterator[Engine]:
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


def test_parse_forecasts_calcula_lead_dias_incluyendo_negativo() -> None:
    payload = json.loads((FIXTURES / "google_forecasts.json").read_text())

    rows = google.parse_forecasts(payload)

    colon = [r for r in rows if r.gauge_id == "hybas_6121320620"]
    # First issuance: 2026-09-19T08:15Z, forecast for 2026-09-18 -> lead -1.
    primera = [r for r in colon if r.emitido == datetime(2026, 9, 19, 8, 15, 0, 123456, tzinfo=UTC)]
    hindcast = [r for r in primera if r.fecha == date(2026, 9, 18)][0]
    assert hindcast.lead_dias == -1
    assert hindcast.caudal_m3s == pytest.approx(6100.5)


def test_parse_forecasts_separa_por_gauge() -> None:
    payload = json.loads((FIXTURES / "google_forecasts.json").read_text())

    rows = google.parse_forecasts(payload)

    gauge_ids = {r.gauge_id for r in rows}
    assert gauge_ids == {"hybas_6121320620", "hybas_6120865460"}


def test_parse_forecasts_con_payload_invalido_lanza_fuente_error() -> None:
    with pytest.raises(FuenteError):
        google.parse_forecasts({"unexpected": "shape"})


def test_parse_forecasts_con_gauge_invalido_lanza_fuente_error() -> None:
    with pytest.raises(FuenteError):
        google.parse_forecasts({"forecasts": {"hybas_x": {"forecasts": "no es una lista"}}})


def test_dos_emisiones_el_mismo_dia_la_mas_reciente_gana(engine: Engine) -> None:
    payload = json.loads((FIXTURES / "google_forecasts.json").read_text())
    rows = google.parse_forecasts(payload)

    upsert_pronosticos(engine, rows)

    ultima = list_ultima_emision(engine, "hybas_6121320620")

    assert ultima
    assert all(r.emitido == datetime(2026, 9, 19, 20, 45, 0, 987654, tzinfo=UTC) for r in ultima)
    dia_lead1 = [r for r in ultima if r.lead_dias == 1][0]
    assert dia_lead1.caudal_m3s == pytest.approx(12836.0)


def test_fetch_forecasts_manda_la_key_y_gauges_como_query_params() -> None:
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["params"] = dict(request.url.params)
        captured["full_params"] = list(request.url.params.multi_items())
        return httpx.Response(200, json={"forecasts": {}})

    client = httpx.Client(transport=httpx.MockTransport(handler))

    google.fetch_forecasts(client, ["hybas_a", "hybas_b"], date(2026, 9, 1), date(2026, 9, 5))

    assert captured["params"]["key"] == _FAKE_KEY
    assert captured["params"]["issuedTimeStart"] == "2026-09-01"
    assert captured["params"]["issuedTimeEnd"] == "2026-09-05"
    assert ("gaugeIds", "hybas_a") in captured["full_params"]
    assert ("gaugeIds", "hybas_b") in captured["full_params"]


def test_fetch_forecasts_envuelve_error_400_en_fuente_error() -> None:
    payload = json.loads((FIXTURES / "google_error_400.json").read_text())

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json=payload)

    client = httpx.Client(transport=httpx.MockTransport(handler))

    with pytest.raises(FuenteError):
        google.fetch_forecasts(client, ["hybas_a"], date(2026, 9, 1), date(2026, 9, 5))


def test_redact_url_oculta_la_key_en_query_strings() -> None:
    assert (
        google.redact_url("https://x.test/path?key=ABC123&gaugeIds=a")
        == "https://x.test/path?key=***&gaugeIds=a"
    )
    assert (
        google.redact_url("https://x.test/path?gaugeIds=a&key=ABC123")
        == "https://x.test/path?gaugeIds=a&key=***"
    )
    assert google.redact_url("sin key acá") == "sin key acá"


def test_la_key_nunca_aparece_en_ningun_log_record(caplog: pytest.LogCaptureFixture) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json={"error": {"code": 400, "message": "bad key", "status": "INVALID_ARGUMENT"}},
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))

    with caplog.at_level(logging.DEBUG):
        with pytest.raises(FuenteError) as exc_info:
            google.fetch_forecasts(client, ["hybas_a"], date(2026, 9, 1), date(2026, 9, 5))

    assert _FAKE_KEY not in str(exc_info.value)
    assert exc_info.value.__cause__ is None  # chaining suppressed on purpose (see module docstring)
    for record in caplog.records:
        assert _FAKE_KEY not in record.getMessage()


def test_la_key_nunca_aparece_en_un_pedido_exitoso_tampoco(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"forecasts": {}})

    client = httpx.Client(transport=httpx.MockTransport(handler))

    with caplog.at_level(logging.DEBUG):
        google.fetch_forecasts(client, ["hybas_a"], date(2026, 9, 1), date(2026, 9, 5))

    assert caplog.records  # httpx did log something (its own request line)
    for record in caplog.records:
        assert _FAKE_KEY not in record.getMessage()
        assert "key=***" in record.getMessage() or "key=" not in record.getMessage()


def test_windows_genera_ventanas_de_30_dias_sin_huecos_ni_solapes() -> None:
    windows = google._windows(date(2024, 7, 8), date(2024, 12, 31), 30)

    assert windows[0] == (date(2024, 7, 8), date(2024, 8, 6))
    for (_, fin), (siguiente_inicio, _) in zip(windows, windows[1:], strict=False):
        assert (siguiente_inicio - fin).days == 1
    assert windows[-1][1] == date(2024, 12, 31)


def test_backfill_pide_las_ventanas_esperadas_y_hace_upsert(engine: Engine) -> None:
    requested_ranges = []

    def handler(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        requested_ranges.append((params["issuedTimeStart"], params["issuedTimeEnd"]))
        issued = f"{params['issuedTimeStart']}T12:00:00Z"
        inicio = f"{params['issuedTimeStart']}T00:00:00Z"
        return httpx.Response(
            200,
            json={
                "forecasts": {
                    "hybas_a": {
                        "forecasts": [
                            {
                                "issuedTime": issued,
                                "forecastRanges": [{"value": 5000.0, "forecastStartTime": inicio}],
                            }
                        ]
                    }
                }
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    sleeps: list[float] = []

    inserted = google.backfill(
        engine,
        client,
        date(2024, 7, 8),
        date(2024, 9, 5),
        window_days=30,
        gauge_ids=["hybas_a"],
        sleep=sleeps.append,
    )

    assert requested_ranges == [
        ("2024-07-08", "2024-08-06"),
        ("2024-08-07", "2024-09-05"),
    ]
    assert inserted == 2
    assert len(sleeps) == 1  # a pause between windows, none after the last


def test_backfill_dos_veces_la_segunda_no_inserta(engine: Engine) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "forecasts": {
                    "hybas_a": {
                        "forecasts": [
                            {
                                "issuedTime": "2024-07-08T12:00:00Z",
                                "forecastRanges": [
                                    {"value": 5000.0, "forecastStartTime": "2024-07-08T00:00:00Z"}
                                ],
                            }
                        ]
                    }
                }
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))

    primera = google.backfill(
        engine,
        client,
        date(2024, 7, 8),
        date(2024, 7, 8),
        window_days=30,
        gauge_ids=["hybas_a"],
        sleep=lambda _: None,
    )
    segunda = google.backfill(
        engine,
        client,
        date(2024, 7, 8),
        date(2024, 7, 8),
        window_days=30,
        gauge_ids=["hybas_a"],
        sleep=lambda _: None,
    )

    assert primera == 1
    assert segunda == 0


def test_backfill_cli_help_no_falla() -> None:
    with pytest.raises(SystemExit) as exc_info:
        google._parse_args(["backfill", "--help"])
    assert exc_info.value.code == 0


def test_build_client_disponible_para_el_cli() -> None:
    client = build_client()
    client.close()


# --- Spec 022: la ventana tiene que incluir el día en curso -------------


def test_la_ventana_periodica_incluye_todo_el_dia_de_hoy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """El defecto era un borde mal calculado, así que se miran los PARÁMETROS.

    Comprobar "trajo filas" no detectaba nada: el job traía 64 filas y
    insertaba 0, informando éxito, mientras producción se quedaba con un
    pronóstico de hasta 24 h de atraso.
    """
    llamadas: list[tuple[date, date]] = []

    def _fake_fetch(client, gauge_ids, desde, hasta):  # noqa: ANN001 - test double
        llamadas.append((desde, hasta))
        return []

    monkeypatch.setattr(google, "fetch_forecasts", _fake_fetch)
    monkeypatch.setattr(google, "upsert_pronosticos", lambda engine, rows: 0)

    ahora = datetime(2026, 9, 23, 22, 21, tzinfo=UTC)
    google.actualizar_pronosticos(engine=None, client=None, now=ahora)

    (desde, hasta) = llamadas[0]
    # Google lee una fecha pelada como su medianoche: con "2026-09-23" como
    # tope, todo lo emitido durante el 23 queda afuera.
    assert hasta > ahora.date(), "el tope debe pasar el día en curso, no cortarlo al empezar"
    assert desde == date(2026, 9, 20)


def test_el_backfill_tambien_llega_hasta_hoy(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sin esto, un backfill nunca trae las emisiones del día en que se corre."""
    llamadas: list[tuple[date, date]] = []

    def _fake_fetch(client, gauge_ids, desde, hasta):  # noqa: ANN001 - test double
        llamadas.append((desde, hasta))
        return []

    monkeypatch.setattr(google, "fetch_forecasts", _fake_fetch)
    monkeypatch.setattr(google, "upsert_pronosticos", lambda engine, rows: 0)

    hoy = datetime.now(UTC).date()
    google.backfill(engine=None, client=None, desde=hoy - timedelta(days=2), sleep=lambda _s: None)

    ultimo_tope = max(hasta for _desde, hasta in llamadas)
    assert ultimo_tope > hoy


def test_tope_ventana_es_el_dia_siguiente() -> None:
    assert google.tope_ventana(datetime(2026, 9, 23, 22, 21, tzinfo=UTC)) == date(2026, 9, 24)
    # También en el borde de medianoche.
    assert google.tope_ventana(datetime(2026, 9, 23, 0, 0, tzinfo=UTC)) == date(2026, 9, 24)
