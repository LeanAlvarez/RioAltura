"""Hourly job: publish to the Telegram channel (A1-A3) and to per-subscriber thresholds (B1-B4).

Every actual send goes through `enviar_mensaje_seguro`, which is where S3
(daily cap), S4 (kill switch) and S5 (fail silently) all live in one place.
S1 (antirebote) and S2 (dedup) are the same `evaluar_transicion` state
machine (see `app.services.telegram_estado`), applied once for the channel's
aviso level and once per subscriber's own threshold.
"""

import logging
from datetime import UTC, date, datetime

import httpx
from app.config.dominio import GAUGE_GOOGLE_COLON
from app.repositories.db import get_engine
from app.repositories.telegram import (
    actualizar_estado_canal,
    actualizar_estado_suscripcion,
    listar_suscripciones,
    obtener_estado_canal,
    reservar_cupo_diario,
)
from app.services.alturas import hoy_buenos_aires, obtener_ultima
from app.services.avisos import calcular_aviso
from app.services.pronosticos import obtener_dias
from app.services.telegram_estado import evaluar_transicion
from sqlalchemy import Engine

from jobs.http import build_client
from jobs.settings import get_settings
from jobs.telegram_client import TelegramError, install_key_redaction, send_message
from jobs.telegram_mensajes import (
    mensaje_cambio_nivel,
    mensaje_estado_diario,
    mensaje_umbral_propio,
)

logger = logging.getLogger(__name__)

TELEGRAM_AVISOS_INTERVAL_SECONDS = 3600
# After the alturas job's own first-run delay, so the first pass has a
# reading to work with; never touches Telegram right at startup either.
TELEGRAM_AVISOS_FIRST_RUN_DELAY_SECONDS = 120

_FUENTE_PRONOSTICO = "Google Flood Forecasting"

install_key_redaction(lambda: get_settings().telegram_bot_token)


def enviar_mensaje_seguro(
    engine: Engine, client: httpx.Client, chat_id: str | int, texto: str, ahora: datetime
) -> int | None:
    """Send `texto` to `chat_id`, or don't -- and never raise. Returns the message_id or None.

    Every guard that keeps this feature from ever spamming or breaking the
    worker lives here, in order: no token configured, S4 (kill switch), S3
    (daily cap), then S5 (a Telegram failure is logged and swallowed).
    """
    settings = get_settings()
    if not settings.telegram_bot_token:
        logger.info("telegram: sin TELEGRAM_BOT_TOKEN configurado, no se publica")
        return None
    if not settings.telegram_publicacion_activa:
        logger.info("telegram: publicación desactivada (TELEGRAM_PUBLICACION_ACTIVA=false, S4)")
        return None
    if not reservar_cupo_diario(
        engine, hoy_buenos_aires(ahora), settings.telegram_tope_mensajes_dia
    ):
        logger.warning("telegram: tope diario de mensajes alcanzado (S3), no se publica")
        return None

    try:
        return send_message(client, settings.telegram_bot_token, chat_id, texto)
    except TelegramError as exc:
        logger.warning("telegram: fallo al enviar, se sigue igual (S5): %s", exc)
        return None
    except Exception:
        logger.exception("telegram: fallo inesperado al enviar, se sigue igual (S5)")
        return None


def _nivel_aviso_actual(engine: Engine, hoy: date) -> tuple[str, datetime] | None:
    """`(nivel, emitido)` de la última emisión de pronóstico guardada, o None si no hay ninguna."""
    resultado = obtener_dias(engine, GAUGE_GOOGLE_COLON, hoy)
    if resultado is None:
        return None
    emitido, dias = resultado
    return calcular_aviso(dias).nivel, emitido


def _publicar_canal(engine: Engine, client: httpx.Client, now: datetime, hoy: date) -> None:
    canal_id = get_settings().telegram_canal_id
    if not canal_id:
        logger.info("telegram: sin TELEGRAM_CANAL_ID configurado, no se publica en el canal")
        return

    altura = obtener_ultima(engine)
    nivel_info = _nivel_aviso_actual(engine, hoy)
    estado_canal = obtener_estado_canal(engine)

    # A2: estado diario, una vez por día local, con la altura real de hoy.
    if altura is not None and estado_canal.estado_diario_fecha != hoy:
        nivel_para_hoy = nivel_info[0] if nivel_info is not None else "sin_aviso"
        texto = mensaje_estado_diario(
            altura.altura_m, altura.estado, nivel_para_hoy, altura.fecha_hora, altura.fuente
        )
        if enviar_mensaje_seguro(engine, client, canal_id, texto, now) is not None:
            actualizar_estado_canal(engine, estado_diario_fecha=hoy)

    # A1/A3: cambio de nivel de aviso, con antirebote (S1) y dedup persistido (S2).
    if nivel_info is None:
        return  # sin pronóstico guardado todavía: nada que comparar
    nivel_observado, emitido = nivel_info

    transicion = evaluar_transicion(
        estado_canal.nivel_publicado,
        estado_canal.nivel_candidato,
        estado_canal.corridas_candidato,
        nivel_observado,
    )
    if transicion.debe_publicar:
        texto = mensaje_cambio_nivel(nivel_observado, emitido, _FUENTE_PRONOSTICO)
        mensaje_id = enviar_mensaje_seguro(engine, client, canal_id, texto, now)
        if mensaje_id is not None:
            actualizar_estado_canal(
                engine,
                nivel_publicado=nivel_observado,
                nivel_candidato=None,
                corridas_candidato=0,
                publicado_en=now,
                mensaje_id=mensaje_id,
            )
            return

    # No se publicó (todavía no tocaba, o el envío falló): igual se guarda el
    # avance del antirebote para que la próxima corrida siga donde quedó.
    actualizar_estado_canal(
        engine,
        nivel_candidato=transicion.nivel_candidato,
        corridas_candidato=transicion.corridas_candidato,
    )


def _publicar_umbrales_propios(engine: Engine, client: httpx.Client, now: datetime) -> None:
    altura = obtener_ultima(engine)
    if altura is None:
        return  # nada que comparar todavía contra ningún umbral

    for suscripcion in listar_suscripciones(engine):
        observado = altura.altura_m >= suscripcion.umbral_m
        transicion = evaluar_transicion(
            suscripcion.sobre_umbral,
            suscripcion.candidato_sobre_umbral,
            suscripcion.corridas_candidato,
            observado,
        )

        if transicion.debe_publicar:
            texto = mensaje_umbral_propio(
                observado, suscripcion.umbral_m, altura.altura_m, altura.fecha_hora, altura.fuente
            )
            if enviar_mensaje_seguro(engine, client, suscripcion.chat_id, texto, now) is not None:
                actualizar_estado_suscripcion(
                    engine,
                    suscripcion.chat_id,
                    sobre_umbral=observado,
                    candidato_sobre_umbral=None,
                    corridas_candidato=0,
                )
                continue

        actualizar_estado_suscripcion(
            engine,
            suscripcion.chat_id,
            sobre_umbral=suscripcion.sobre_umbral,
            candidato_sobre_umbral=transicion.nivel_candidato,
            corridas_candidato=transicion.corridas_candidato,
        )


def publicar_avisos(engine: Engine, client: httpx.Client, now: datetime | None = None) -> None:
    now = now if now is not None else datetime.now(UTC)
    hoy = hoy_buenos_aires(now)

    _publicar_canal(engine, client, now, hoy)
    _publicar_umbrales_propios(engine, client, now)


def job_publicar_avisos_telegram() -> None:
    """Zero-arg entry point registered with the scheduler. Never raises."""
    try:
        engine = get_engine()
        with build_client() as client:
            publicar_avisos(engine, client)
    except Exception:
        logger.exception("telegram: job de avisos falló")
