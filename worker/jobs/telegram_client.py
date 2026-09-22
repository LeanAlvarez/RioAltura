"""Thin client for the Telegram Bot API (`sendMessage`, `getUpdates`).

Per CLAUDE.md §6, `TELEGRAM_BOT_TOKEN` is read only by the worker and must
never reach a log, an exception message, or a fixture. Unlike the Google API
key (a query parameter), the Telegram token is part of the URL *path*
(`https://api.telegram.org/bot<TOKEN>/sendMessage`), so this module redacts
it there too -- including from httpx's own request logging, which by default
logs the full request URL at INFO level (same rationale as `jobs.google`).
"""

import logging
import re
from collections.abc import Callable

import httpx

logger = logging.getLogger(__name__)

API_BASE = "https://api.telegram.org"

_TOKEN_PATH_RE = re.compile(r"/bot[0-9A-Za-z:_-]+/")


def redact_token(text: str) -> str:
    """Redact the bot token from a Telegram API URL or an error message containing one."""
    return _TOKEN_PATH_RE.sub("/bot***/", text)


class _RedactTokenFilter(logging.Filter):
    """Scrubs the Telegram bot token from every log record it sees.

    Same mechanism as `jobs.google._RedactApiKeyFilter`: attached directly to
    the loggers that could ever emit a raw request URL, so records are
    already redacted before any handler (ours, or a test's `caplog`) sees
    them.
    """

    def __init__(self, get_token: Callable[[], str]) -> None:
        super().__init__()
        self._get_token = get_token

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        redacted = redact_token(message)
        token = self._get_token()
        if token:
            redacted = redacted.replace(token, "***")
        if redacted != message:
            record.msg = redacted
            record.args = ()
        return True


_REDACTED_LOGGERS = ("httpx", "httpcore", __name__)


def install_key_redaction(get_token: Callable[[], str]) -> None:
    """Install the token-redaction filter on every logger that could leak it.

    Idempotent: safe to call more than once. Unlike `jobs.google`, this is
    called explicitly by callers that hold the token (not at import time),
    since the token lives in `jobs.settings`, not in this module.
    """
    token_filter = _RedactTokenFilter(get_token)
    for name in _REDACTED_LOGGERS:
        target_logger = logging.getLogger(name)
        if not any(isinstance(f, _RedactTokenFilter) for f in target_logger.filters):
            target_logger.addFilter(token_filter)


class TelegramError(Exception):
    """Raised when the Telegram Bot API cannot be reached or returns an error.

    The message is always pre-redacted (never includes the raw token), so it
    is safe to log.
    """


def send_message(
    client: httpx.Client, token: str, chat_id: str | int, text: str, *, timeout: float = 10.0
) -> int:
    """Send a text message; returns the Telegram `message_id`.

    No retries: a failed send is handled by the caller (S5 -- fail silently,
    log, keep going), not by hammering Telegram again inside the same run.
    """
    url = f"{API_BASE}/bot{token}/sendMessage"
    try:
        response = client.post(
            url,
            json={"chat_id": chat_id, "text": text, "disable_web_page_preview": True},
            timeout=timeout,
        )
    except httpx.HTTPError as exc:
        raise TelegramError(f"sendMessage failed: {redact_token(str(exc))}") from None

    try:
        payload = response.json()
    except ValueError as exc:
        raise TelegramError(f"sendMessage: respuesta no es JSON válido: {exc}") from exc

    if response.status_code >= 400 or not payload.get("ok"):
        raise TelegramError(f"sendMessage: Telegram respondió {response.status_code}: {payload}")

    return payload["result"]["message_id"]


def get_updates(
    client: httpx.Client,
    token: str,
    offset: int | None = None,
    *,
    limit: int = 100,
    timeout: float = 10.0,
) -> list[dict]:
    """Fetch new updates since `offset` (short-polling: Telegram's own `timeout` is 0).

    Returns the raw `result` list of update objects. Each update's
    `update_id` is the offset to pass next time (advanced by the caller,
    which persists it -- see `jobs.telegram_comandos`).
    """
    url = f"{API_BASE}/bot{token}/getUpdates"
    params: dict[str, object] = {"limit": limit, "timeout": 0}
    if offset is not None:
        params["offset"] = offset

    try:
        response = client.get(url, params=params, timeout=timeout)
    except httpx.HTTPError as exc:
        raise TelegramError(f"getUpdates failed: {redact_token(str(exc))}") from None

    try:
        payload = response.json()
    except ValueError as exc:
        raise TelegramError(f"getUpdates: respuesta no es JSON válido: {exc}") from exc

    if response.status_code >= 400 or not payload.get("ok"):
        raise TelegramError(f"getUpdates: Telegram respondió {response.status_code}: {payload}")

    return payload["result"]
