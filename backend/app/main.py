from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config.settings import get_settings
from app.logging_config import configure_logging
from app.routers import alturas, estadisticas, health, pronostico


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="Río Uruguay en Colón",
        version="0.1.0",
        description="Estado del río, pronóstico y mapa de inundación para Colón (Entre Ríos).",
    )
    # Public, read-only API: allow the web app from any origin.
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"])
    app.include_router(health.router)
    app.include_router(alturas.router)
    app.include_router(pronostico.router)
    app.include_router(estadisticas.router)
    return app


app = create_app()
