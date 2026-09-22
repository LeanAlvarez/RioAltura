"""Tests for the hourly alturas job's INA/Prefectura/CARU fallback orchestration.

These mock at the `ina` / `prefectura` / `caru` `fetch_alturas` boundary
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
    assert any("ina" in r.getMessage() for r in caplog.records)

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
    assert any("ina" in r.getMessage() for r in caplog.records)

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


# --- Tercer eslabón: CARU (spec 009) ---------------------------------------


def _altura(fecha_hora, fuente: str, altura_m: float = 4.29) -> AlturaIn:
    return AlturaIn(fecha_hora=fecha_hora, altura_m=altura_m, fuente=fuente)


def _falla(nombre: str):
    def _f(*args, **kwargs):
        raise FuenteError(f"{nombre} caída")

    return _f


def test_las_tres_fuentes_viejas_no_inventa_una_lectura_fresca(
    engine: Engine, client: httpx.Client, caplog, monkeypatch
) -> None:
    """El caso real del 2026-09-22, que motivó esta spec.

    INA y Prefectura respondían, pero con lecturas de más de 24 h. Antes el
    job daba `fuente=prefectura` y se quedaba ahí: reportaba éxito sin tener
    un dato de hoy, y un tercer eslabón nunca se habría alcanzado.
    """
    vieja = NOW - timedelta(hours=33)
    monkeypatch.setattr(alturas.ina, "fetch_alturas", lambda *a, **k: [_altura(vieja, "ina")])
    monkeypatch.setattr(
        alturas.prefectura, "fetch_alturas", lambda *a, **k: [_altura(vieja, "prefectura")]
    )
    monkeypatch.setattr(alturas.caru, "fetch_alturas", lambda *a, **k: [_altura(vieja, "caru")])

    with caplog.at_level(logging.WARNING):
        resultado = alturas.actualizar_alturas(engine, client, now=NOW)

    # Ninguna fuente tenía dato fresco: se dice, no se finge.
    assert "no source had a recent reading" in caplog.text
    # Pero el historial viejo igual se guarda: sirve para el gráfico.
    filas = list_alturas(engine, datetime(2020, 1, 1, tzinfo=UTC), datetime(2030, 1, 1, tzinfo=UTC))
    assert len(filas) == 3
    assert resultado["inserted"] == 3


def test_ina_y_prefectura_viejas_pero_caru_fresca_usa_caru(
    engine: Engine, client: httpx.Client, monkeypatch
) -> None:
    vieja = NOW - timedelta(hours=33)
    fresca = NOW - timedelta(hours=2)
    monkeypatch.setattr(alturas.ina, "fetch_alturas", lambda *a, **k: [_altura(vieja, "ina")])
    monkeypatch.setattr(
        alturas.prefectura, "fetch_alturas", lambda *a, **k: [_altura(vieja, "prefectura")]
    )
    monkeypatch.setattr(
        alturas.caru, "fetch_alturas", lambda *a, **k: [_altura(fresca, "caru", 4.31)]
    )

    resultado = alturas.actualizar_alturas(engine, client, now=NOW)

    assert resultado["fuente"] == "caru"
    # El historial viejo de las dos primeras también quedó guardado.
    filas = list_alturas(engine, datetime(2020, 1, 1, tzinfo=UTC), datetime(2030, 1, 1, tzinfo=UTC))
    assert {row.fuente for row in filas} == {"ina", "prefectura", "caru"}


def test_no_llega_a_caru_si_prefectura_tiene_dato_fresco(
    engine: Engine, client: httpx.Client, monkeypatch
) -> None:
    """El orden importa: CARU publica cada 12 h, así que va última."""
    monkeypatch.setattr(alturas.ina, "fetch_alturas", _falla("INA"))
    monkeypatch.setattr(
        alturas.prefectura,
        "fetch_alturas",
        lambda *a, **k: [_altura(NOW - timedelta(hours=1), "prefectura")],
    )

    def _caru_no_deberia_llamarse(*args, **kwargs):
        raise AssertionError("no hay que pedirle a CARU si Prefectura ya tiene dato fresco")

    monkeypatch.setattr(alturas.caru, "fetch_alturas", _caru_no_deberia_llamarse)

    assert alturas.actualizar_alturas(engine, client, now=NOW)["fuente"] == "prefectura"


def test_caru_caida_no_rompe_el_job(
    engine: Engine, client: httpx.Client, caplog, monkeypatch
) -> None:
    monkeypatch.setattr(alturas.ina, "fetch_alturas", _falla("INA"))
    monkeypatch.setattr(alturas.prefectura, "fetch_alturas", _falla("Prefectura"))
    monkeypatch.setattr(alturas.caru, "fetch_alturas", _falla("CARU"))

    with caplog.at_level(logging.WARNING):
        resultado = alturas.actualizar_alturas(engine, client, now=NOW)

    assert resultado["fuente"] is None
    assert resultado["inserted"] == 0
    assert (
        list_alturas(engine, datetime(2020, 1, 1, tzinfo=UTC), datetime(2030, 1, 1, tzinfo=UTC))
        == []
    )
