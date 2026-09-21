"""Tests for the hourly alturas job's INA/Prefectura fallback orchestration.

These mock at the `ina.fetch_alturas` / `prefectura.fetch_alturas` boundary
(monkeypatched directly, no HTTP involved) rather than through
`httpx.MockTransport`: retry/backoff behaviour is already covered by
`test_http.py`, and going through it here would only add real sleep delays
without testing anything new.
"""

import logging
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from app.models import Base
from app.repositories.alturas import AlturaIn, list_alturas
from jobs import alturas
from jobs.http import FuenteError
from sqlalchemy import Engine, create_engine

NOW = datetime(2026, 9, 21, 12, 0, tzinfo=UTC)


@pytest.fixture
def engine() -> Iterator[Engine]:
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def client() -> Iterator[httpx.Client]:
    # actualizar_alturas needs a client to pass along; the mocked
    # ina/prefectura fetch_alturas never actually use it here.
    c = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200)))
    yield c
    c.close()


def test_ina_ok_usa_ina_y_no_duplica_al_correr_dos_veces(
    engine: Engine, client: httpx.Client, monkeypatch
) -> None:
    reciente = NOW - timedelta(hours=1)
    monkeypatch.setattr(
        alturas.ina,
        "fetch_alturas",
        lambda *a, **kw: [AlturaIn(fecha_hora=reciente, altura_m=4.5, fuente="ina")],
    )

    def _prefectura_should_not_be_called(*a, **kw):
        raise AssertionError("Prefectura should not be called when INA has a recent reading")

    monkeypatch.setattr(alturas.prefectura, "fetch_alturas", _prefectura_should_not_be_called)

    resumen1 = alturas.actualizar_alturas(engine, client, now=NOW)
    resumen2 = alturas.actualizar_alturas(engine, client, now=NOW)

    assert resumen1["fuente"] == "ina"
    assert resumen1["inserted"] == 1
    assert resumen2["inserted"] == 0  # second run inserts nothing new

    filas = list_alturas(engine, datetime(2020, 1, 1, tzinfo=UTC), datetime(2030, 1, 1, tzinfo=UTC))
    assert len(filas) == 1
    assert filas[0].fuente == "ina"


def test_ina_falla_usa_prefectura_y_loguea_warning(
    engine: Engine, client: httpx.Client, caplog, monkeypatch
) -> None:
    def _ina_fails(*a, **kw):
        raise FuenteError("INA request failed: 500")

    monkeypatch.setattr(alturas.ina, "fetch_alturas", _ina_fails)
    monkeypatch.setattr(
        alturas.prefectura,
        "fetch_alturas",
        lambda *a, **kw: [
            AlturaIn(fecha_hora=NOW - timedelta(hours=1), altura_m=4.3, fuente="prefectura")
        ],
    )

    with caplog.at_level(logging.WARNING, logger="jobs.alturas"):
        resumen = alturas.actualizar_alturas(engine, client, now=NOW)

    assert resumen["fuente"] == "prefectura"
    assert resumen["inserted"] == 1
    assert any("falling back to Prefectura" in r.getMessage() for r in caplog.records)

    filas = list_alturas(engine, datetime(2020, 1, 1, tzinfo=UTC), datetime(2030, 1, 1, tzinfo=UTC))
    assert all(row.fuente == "prefectura" for row in filas)


def test_ina_solo_lecturas_viejas_se_upsertean_y_ademas_se_usa_prefectura(
    engine: Engine, client: httpx.Client, caplog, monkeypatch
) -> None:
    vieja = NOW - timedelta(hours=40)
    monkeypatch.setattr(
        alturas.ina,
        "fetch_alturas",
        lambda *a, **kw: [AlturaIn(fecha_hora=vieja, altura_m=3.9, fuente="ina")],
    )
    monkeypatch.setattr(
        alturas.prefectura,
        "fetch_alturas",
        lambda *a, **kw: [
            AlturaIn(fecha_hora=NOW - timedelta(hours=1), altura_m=4.3, fuente="prefectura")
        ],
    )

    with caplog.at_level(logging.WARNING, logger="jobs.alturas"):
        resumen = alturas.actualizar_alturas(engine, client, now=NOW)

    assert resumen["fuente"] == "prefectura"
    assert any("falling back to Prefectura" in r.getMessage() for r in caplog.records)

    filas = list_alturas(engine, datetime(2020, 1, 1, tzinfo=UTC), datetime(2030, 1, 1, tzinfo=UTC))
    fuentes = {row.fuente for row in filas}
    assert fuentes == {"ina", "prefectura"}  # the stale INA row was kept, not discarded


def test_ambas_fuentes_fallan_loguea_error_y_no_lanza(
    engine: Engine, client: httpx.Client, caplog, monkeypatch
) -> None:
    def _fails(*a, **kw):
        raise FuenteError("boom")

    monkeypatch.setattr(alturas.ina, "fetch_alturas", _fails)
    monkeypatch.setattr(alturas.prefectura, "fetch_alturas", _fails)

    with caplog.at_level(logging.WARNING, logger="jobs.alturas"):
        resumen = alturas.actualizar_alturas(engine, client, now=NOW)

    assert resumen["fuente"] is None
    assert any(r.levelno == logging.ERROR for r in caplog.records)

    filas = list_alturas(engine, datetime(2020, 1, 1, tzinfo=UTC), datetime(2030, 1, 1, tzinfo=UTC))
    assert filas == []


def test_job_actualizar_alturas_nunca_lanza(monkeypatch, caplog) -> None:
    """The zero-arg scheduler entry point must never propagate an exception."""

    def _boom():
        raise RuntimeError("db unreachable")

    monkeypatch.setattr(alturas, "get_engine", _boom)

    with caplog.at_level(logging.ERROR, logger="jobs.alturas"):
        alturas.job_actualizar_alturas()  # must not raise

    assert any("alturas job failed" in r.getMessage() for r in caplog.records)
