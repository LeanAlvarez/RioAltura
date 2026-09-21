import httpx
import pytest
from jobs.http import USER_AGENT, build_client, get_with_retries


def test_build_client_incluye_user_agent() -> None:
    client = build_client()

    assert client.headers["User-Agent"] == USER_AGENT
    client.close()


def test_reintenta_en_503_y_despues_funciona() -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) < 3:
            return httpx.Response(503)
        return httpx.Response(200, json={"ok": True})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    sleeps: list[float] = []

    response = get_with_retries(
        client, "https://example.test/x", retries=3, backoff_s=1.0, sleep=sleeps.append
    )

    assert response.status_code == 200
    assert len(calls) == 3
    assert sleeps == [1.0, 2.0]


def test_se_rinde_despues_de_agotar_los_reintentos() -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(503)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    sleeps: list[float] = []

    with pytest.raises(httpx.HTTPStatusError):
        get_with_retries(
            client, "https://example.test/x", retries=3, backoff_s=1.0, sleep=sleeps.append
        )

    assert len(calls) == 3
    assert sleeps == [1.0, 2.0]


def test_404_no_reintenta() -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    sleeps: list[float] = []

    with pytest.raises(httpx.HTTPStatusError):
        get_with_retries(client, "https://example.test/x", sleep=sleeps.append)

    assert len(calls) == 1
    assert sleeps == []


def test_reintenta_en_error_de_transporte() -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) < 2:
            raise httpx.ConnectError("boom", request=request)
        return httpx.Response(200, json={"ok": True})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    sleeps: list[float] = []

    response = get_with_retries(
        client, "https://example.test/x", retries=3, backoff_s=1.0, sleep=sleeps.append
    )

    assert response.status_code == 200
    assert sleeps == [1.0]
