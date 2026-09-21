from app.config.settings import Settings


def test_database_url_se_arma_desde_las_partes(monkeypatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    s = Settings(
        _env_file=None,
        postgres_user="u",
        postgres_password="p",
        postgres_db="d",
        db_host="h",
        db_port=5499,
    )
    assert s.database_url == "postgresql+psycopg://u:p@h:5499/d"


def test_database_url_explicita_tiene_prioridad(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://x:y@z:1/w")
    assert Settings(_env_file=None).database_url == "postgresql+psycopg://x:y@z:1/w"


def test_database_url_vacia_no_pisa_las_partes(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "")
    s = Settings(_env_file=None, db_host="h", db_port=1)
    assert s.database_url.endswith("@h:1/rioaltura")
