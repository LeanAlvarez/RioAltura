"""Tests for the low-level Telegram Bot API client, including token redaction (CLAUDE.md §6)."""

import logging

import httpx
import pytest
from jobs.telegram_client import TelegramError, get_updates, install_key_redaction, send_message

TOKEN = "123456:FAKE-TEST-TOKEN-not-real"  # noqa: S105 - test fixture only, never a real token


def test_send_message_ok_devuelve_message_id() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == f"/bot{TOKEN}/sendMessage"
        body = request.read()
        assert (
            b'"chat_id": "@RioUruguayNotifica"' in body
            or b'"chat_id":"@RioUruguayNotifica"' in body
        )
        return httpx.Response(200, json={"ok": True, "result": {"message_id": 42}})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    message_id = send_message(client, TOKEN, "@RioUruguayNotifica", "hola")

    assert message_id == 42


def test_send_message_error_de_telegram_lanza_telegram_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"ok": False, "description": "chat not found"})

    client = httpx.Client(transport=httpx.MockTransport(handler))

    with pytest.raises(TelegramError):
        send_message(client, TOKEN, "999", "hola")


def test_send_message_falla_de_transporte_nunca_expone_el_token_en_el_mensaje() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"boom https://api.telegram.org/bot{TOKEN}/sendMessage")

    client = httpx.Client(transport=httpx.MockTransport(handler))

    with pytest.raises(TelegramError) as excinfo:
        send_message(client, TOKEN, "999", "hola")

    assert TOKEN not in str(excinfo.value)
    assert "/bot***/" in str(excinfo.value)


def test_get_updates_pasa_el_offset_y_devuelve_result() -> None:
    capturado = {}

    def handler(request: httpx.Request) -> httpx.Response:
        capturado["offset"] = request.url.params.get("offset")
        return httpx.Response(200, json={"ok": True, "result": [{"update_id": 5}]})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    updates = get_updates(client, TOKEN, offset=5)

    assert updates == [{"update_id": 5}]
    assert capturado["offset"] == "5"


def test_get_updates_sin_offset_no_lo_manda() -> None:
    capturado = {}

    def handler(request: httpx.Request) -> httpx.Response:
        capturado["offset"] = request.url.params.get("offset")
        return httpx.Response(200, json={"ok": True, "result": []})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    get_updates(client, TOKEN)

    assert capturado["offset"] is None


def test_install_key_redaction_scrubs_httpx_logs(caplog: pytest.LogCaptureFixture) -> None:
    install_key_redaction(lambda: TOKEN)
    logger = logging.getLogger("httpx")

    with caplog.at_level(logging.INFO, logger="httpx"):
        logger.info("HTTP Request: GET https://api.telegram.org/bot%s/getUpdates", TOKEN)

    assert TOKEN not in caplog.text
    assert "/bot***/" in caplog.text


def test_install_key_redaction_es_idempotente() -> None:
    install_key_redaction(lambda: TOKEN)
    install_key_redaction(lambda: TOKEN)

    logger = logging.getLogger("httpx")
    from jobs.telegram_client import _RedactTokenFilter

    assert sum(isinstance(f, _RedactTokenFilter) for f in logger.filters) == 1
