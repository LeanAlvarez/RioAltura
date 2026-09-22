"""Tests for the bot command poller: /start, /umbral, /baja (spec 011, B3) and S2/S5."""

from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from app.models import Base
from app.repositories.telegram import fijar_umbral, obtener_estado_canal, obtener_suscripcion
from jobs import telegram_comandos
from jobs.settings import get_settings
from jobs.telegram_client import TelegramError
from sqlalchemy import Engine, create_engine

TOKEN = "123456:FAKE-TEST-TOKEN-not-real"  # noqa: S105 - test fixture only
NOW = datetime(2026, 9, 22, 15, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)
    monkeypatch.setenv("TELEGRAM_PUBLICACION_ACTIVA", "true")
    monkeypatch.setenv("TELEGRAM_TOPE_MENSAJES_DIA", "100")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def engine() -> Iterator[Engine]:
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def respuestas(monkeypatch: pytest.MonkeyPatch) -> list[tuple[int, str]]:
    enviados: list[tuple[int, str]] = []

    def _fake_enviar(engine, client, chat_id, texto, ahora):  # noqa: ANN001 - test double
        enviados.append((chat_id, texto))
        return 1

    monkeypatch.setattr(telegram_comandos, "enviar_mensaje_seguro", _fake_enviar)
    return enviados


class _FakeClient:
    """Stand-in for `httpx.Client`; `get_updates` is monkeypatched so this is never used."""


def _mensaje(update_id: int, chat_id: int, texto: str) -> dict:
    return {"update_id": update_id, "message": {"chat": {"id": chat_id}, "text": texto}}


def _con_updates(monkeypatch: pytest.MonkeyPatch, updates: list[dict]) -> None:
    monkeypatch.setattr(telegram_comandos, "get_updates", lambda *a, **kw: updates)


# --- Parsing ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("payload", "esperado"),
    [("444", 4.44), ("710", 7.10), ("100", 1.00)],
)
def test_parse_umbral_deeplink_centimetros_a_metros(payload: str, esperado: float) -> None:
    assert telegram_comandos.parse_umbral_deeplink(payload) == pytest.approx(esperado)


@pytest.mark.parametrize("payload", ["", "abc", "-5", "999999", "7.10", "0"])
def test_parse_umbral_deeplink_invalido_devuelve_none(payload: str) -> None:
    assert telegram_comandos.parse_umbral_deeplink(payload) is None


@pytest.mark.parametrize(
    ("texto", "esperado"), [("7,10", 7.10), ("7.10", 7.10), (" 4,44 ", 4.44), ("6.8", 6.8)]
)
def test_parse_umbral_texto_admite_coma_o_punto(texto: str, esperado: float) -> None:
    assert telegram_comandos.parse_umbral_texto(texto) == pytest.approx(esperado)


@pytest.mark.parametrize("texto", ["", "no es un numero", "-1", "0", "1000"])
def test_parse_umbral_texto_invalido_devuelve_none(texto: str) -> None:
    assert telegram_comandos.parse_umbral_texto(texto) is None


# --- /start (deep link y sin payload) ------------------------------------------


def test_start_con_payload_fija_el_umbral(
    engine: Engine, respuestas: list, monkeypatch: pytest.MonkeyPatch
) -> None:
    _con_updates(monkeypatch, [_mensaje(1, 555, "/start 444")])

    procesados = telegram_comandos.procesar_actualizaciones(engine, _FakeClient(), now=NOW)

    assert procesados == 1
    suscripcion = obtener_suscripcion(engine, 555)
    assert suscripcion is not None
    assert suscripcion.umbral_m == pytest.approx(4.44)
    assert respuestas == [(555, telegram_comandos.mensaje_umbral_fijado(4.44))]


def test_start_sin_payload_manda_bienvenida_y_no_suscribe(
    engine: Engine, respuestas: list, monkeypatch: pytest.MonkeyPatch
) -> None:
    _con_updates(monkeypatch, [_mensaje(1, 555, "/start")])

    telegram_comandos.procesar_actualizaciones(engine, _FakeClient(), now=NOW)

    assert obtener_suscripcion(engine, 555) is None
    assert respuestas == [(555, telegram_comandos.MENSAJE_BIENVENIDA)]


def test_start_con_payload_invalido_no_suscribe(
    engine: Engine, respuestas: list, monkeypatch: pytest.MonkeyPatch
) -> None:
    _con_updates(monkeypatch, [_mensaje(1, 555, "/start no-es-un-umbral")])

    telegram_comandos.procesar_actualizaciones(engine, _FakeClient(), now=NOW)

    assert obtener_suscripcion(engine, 555) is None
    assert respuestas == [(555, telegram_comandos.MENSAJE_UMBRAL_INVALIDO)]


# --- /umbral --------------------------------------------------------------------


def test_umbral_sin_argumentos_informa_que_no_hay_suscripcion(
    engine: Engine, respuestas: list, monkeypatch: pytest.MonkeyPatch
) -> None:
    _con_updates(monkeypatch, [_mensaje(1, 555, "/umbral")])

    telegram_comandos.procesar_actualizaciones(engine, _FakeClient(), now=NOW)

    assert respuestas == [(555, telegram_comandos.mensaje_umbral_actual(None))]


def test_umbral_sin_argumentos_informa_el_actual(
    engine: Engine, respuestas: list, monkeypatch: pytest.MonkeyPatch
) -> None:
    fijar_umbral(engine, chat_id=555, umbral_m=7.10)
    _con_updates(monkeypatch, [_mensaje(1, 555, "/umbral")])

    telegram_comandos.procesar_actualizaciones(engine, _FakeClient(), now=NOW)

    assert respuestas == [(555, telegram_comandos.mensaje_umbral_actual(7.10))]


def test_umbral_con_valor_lo_fija(
    engine: Engine, respuestas: list, monkeypatch: pytest.MonkeyPatch
) -> None:
    _con_updates(monkeypatch, [_mensaje(1, 555, "/umbral 7,10")])

    telegram_comandos.procesar_actualizaciones(engine, _FakeClient(), now=NOW)

    suscripcion = obtener_suscripcion(engine, 555)
    assert suscripcion is not None
    assert suscripcion.umbral_m == pytest.approx(7.10)


def test_umbral_con_valor_invalido_no_cambia_nada(
    engine: Engine, respuestas: list, monkeypatch: pytest.MonkeyPatch
) -> None:
    fijar_umbral(engine, chat_id=555, umbral_m=7.10)
    _con_updates(monkeypatch, [_mensaje(1, 555, "/umbral mil")])

    telegram_comandos.procesar_actualizaciones(engine, _FakeClient(), now=NOW)

    suscripcion = obtener_suscripcion(engine, 555)
    assert suscripcion is not None and suscripcion.umbral_m == pytest.approx(7.10)
    assert respuestas == [(555, telegram_comandos.MENSAJE_UMBRAL_INVALIDO)]


# --- /baja: B3, borra la fila ---------------------------------------------------


def test_baja_borra_la_fila(
    engine: Engine, respuestas: list, monkeypatch: pytest.MonkeyPatch
) -> None:
    fijar_umbral(engine, chat_id=555, umbral_m=7.10)
    _con_updates(monkeypatch, [_mensaje(1, 555, "/baja")])

    telegram_comandos.procesar_actualizaciones(engine, _FakeClient(), now=NOW)

    assert obtener_suscripcion(engine, 555) is None
    assert respuestas == [(555, telegram_comandos.MENSAJE_BAJA_OK)]


def test_baja_sin_suscripcion_lo_dice_sin_romper(
    engine: Engine, respuestas: list, monkeypatch: pytest.MonkeyPatch
) -> None:
    _con_updates(monkeypatch, [_mensaje(1, 555, "/baja")])

    telegram_comandos.procesar_actualizaciones(engine, _FakeClient(), now=NOW)

    assert respuestas == [(555, telegram_comandos.MENSAJE_BAJA_SIN_SUSCRIPCION)]


# --- Offset persistido (S2 aplicado al poller): no reprocesa tras un reinicio --


def test_offset_se_persiste_y_no_se_reprocesa_tras_reinicio(
    engine: Engine, respuestas: list, monkeypatch: pytest.MonkeyPatch
) -> None:
    capturado = {}

    def _get_updates(client, token, offset=None, **kw):
        capturado["offset"] = offset
        return [_mensaje(10, 555, "/umbral 4,44")]

    monkeypatch.setattr(telegram_comandos, "get_updates", _get_updates)
    telegram_comandos.procesar_actualizaciones(engine, _FakeClient(), now=NOW)

    assert capturado["offset"] is None  # primera corrida: sin offset previo
    assert obtener_estado_canal(engine).ultimo_update_id == 10

    # "Reinicio": una nueva llamada vuelve a leer el offset de la base.
    telegram_comandos.procesar_actualizaciones(engine, _FakeClient(), now=NOW)
    assert capturado["offset"] == 11


# --- S5: falla al leer comandos no rompe el worker ------------------------------


def test_falla_leyendo_updates_no_rompe(engine: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    def _boom(*a, **kw):
        raise TelegramError("boom")

    monkeypatch.setattr(telegram_comandos, "get_updates", _boom)

    procesados = telegram_comandos.procesar_actualizaciones(engine, _FakeClient(), now=NOW)
    assert procesados == 0

    monkeypatch.setattr(telegram_comandos, "get_engine", lambda: engine)
    telegram_comandos.job_procesar_comandos_telegram()  # must not raise


def test_sin_token_no_llama_a_telegram(engine: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "")
    get_settings.cache_clear()

    def _no_deberia_llamarse(*a, **kw):
        raise AssertionError("no debe llamar a Telegram sin token")

    monkeypatch.setattr(telegram_comandos, "get_updates", _no_deberia_llamarse)

    assert telegram_comandos.procesar_actualizaciones(engine, _FakeClient(), now=NOW) == 0
