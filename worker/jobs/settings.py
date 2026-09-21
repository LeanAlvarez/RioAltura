"""Worker settings, read from environment variables (and .env files)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env.local", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    log_level: str = "INFO"
    # Google Flood Forecasting API key. Only the worker reads it; never log it.
    floods_api_key: str = ""


@lru_cache
def get_settings() -> WorkerSettings:
    return WorkerSettings()
