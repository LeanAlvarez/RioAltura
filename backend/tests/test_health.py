from collections.abc import Iterator

import pytest
from app.main import app
from app.repositories.db import get_engine
from app.services.health import check_db
from fastapi.testclient import TestClient
from sqlalchemy import create_engine


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_health_ok_cuando_la_base_responde(client: TestClient) -> None:
    app.dependency_overrides[get_engine] = lambda: create_engine("sqlite://")

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": "ok"}


def test_health_reporta_error_cuando_la_base_falla(client: TestClient) -> None:
    app.dependency_overrides[get_engine] = lambda: create_engine("sqlite:////nonexistent/dir/x.db")

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": "error"}


def test_check_db_no_propaga_excepciones() -> None:
    assert check_db(create_engine("sqlite:////nonexistent/dir/x.db")) is False
