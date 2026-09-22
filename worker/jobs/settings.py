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

    # --- Telegram (spec 011). Only the worker reads these; never the frontend,
    # logs, fixtures or error messages (CLAUDE.md §6), same treatment as
    # floods_api_key. Missing token: the worker starts fine and never publishes.
    telegram_bot_token: str = ""
    # Public channel username (e.g. "@RioUruguayNotifica"). Not secret: unlike
    # the token, it is fine in .env.example and in the app's own links.
    telegram_canal_id: str = ""
    # S4: kill switch. Publishing stops without touching code or the worker
    # process; the rest of the worker (alturas, pronosticos) keeps running.
    telegram_publicacion_activa: bool = True
    # S3: hard daily cap on messages actually sent (channel + every
    # subscriber combined). Reached, it is logged and nothing more is sent
    # that day.
    telegram_tope_mensajes_dia: int = 100
    # Optional link appended to every message. Left empty (no invented
    # domain) until a real one is configured for deploy.
    telegram_app_url: str = ""


@lru_cache
def get_settings() -> WorkerSettings:
    return WorkerSettings()
