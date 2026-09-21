"""Application settings, read from environment variables (and .env files)."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env.local", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    log_level: str = "INFO"

    # Postgres connection parts. DATABASE_URL, when set, takes precedence.
    postgres_user: str = "rioaltura"
    postgres_password: str = "rioaltura"
    postgres_db: str = "rioaltura"
    db_host: str = "localhost"
    db_port: int = 5432
    database_url_override: str | None = Field(default=None, alias="DATABASE_URL")

    @property
    def database_url(self) -> str:
        if self.database_url_override:
            return self.database_url_override
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.db_host}:{self.db_port}/{self.postgres_db}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
