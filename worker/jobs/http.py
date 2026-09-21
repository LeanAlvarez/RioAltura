"""Shared HTTP client for external data sources (INA, Prefectura).

Every outbound client uses a fixed timeout, retries with exponential backoff
on transport errors and 5xx responses, and an identifiable User-Agent, per
CLAUDE.md section 6.
"""

import logging
import time
from collections.abc import Callable

import httpx

logger = logging.getLogger(__name__)

USER_AGENT = "RioAltura/0.1 (+https://github.com/LeanAlvarez/RioAltura)"


class FuenteError(Exception):
    """Raised when an external source (INA, Prefectura) cannot be read or parsed."""


def build_client(timeout: float = 30.0) -> httpx.Client:
    """Build an httpx client with the shared timeout and User-Agent."""
    return httpx.Client(timeout=timeout, headers={"User-Agent": USER_AGENT})


def get_with_retries(
    client: httpx.Client,
    url: str,
    params: dict[str, object] | None = None,
    *,
    retries: int = 3,
    backoff_s: float = 1.0,
    sleep: Callable[[float], None] = time.sleep,
) -> httpx.Response:
    """GET a URL, retrying transport errors and 5xx responses with backoff.

    A 4xx response raises immediately (no retry: a client error will not go
    away on its own). Transport errors (timeouts, connection failures) and
    5xx responses are retried up to `retries` attempts, waiting
    `backoff_s * 2**attempt` between attempts, then the last failure is
    raised.
    """
    last_exc: Exception | None = None
    last_response: httpx.Response | None = None

    for attempt in range(retries):
        try:
            response = client.get(url, params=params)
        except httpx.TransportError as exc:
            last_exc = exc
            last_response = None
            logger.warning("GET %s failed (attempt %d/%d): %s", url, attempt + 1, retries, exc)
        else:
            if response.status_code < 500:
                response.raise_for_status()  # raises immediately for 4xx
                return response
            last_exc = None
            last_response = response
            logger.warning(
                "GET %s returned %d (attempt %d/%d)",
                url,
                response.status_code,
                attempt + 1,
                retries,
            )

        if attempt < retries - 1:
            sleep(backoff_s * 2**attempt)

    if last_response is not None:
        last_response.raise_for_status()
    assert last_exc is not None
    raise last_exc
