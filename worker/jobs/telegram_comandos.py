"""Job: poll Telegram for bot commands (/start, /umbral, /baja) and act on them (spec 011, B3).

Short-polling (Telegram's own `timeout=0`): each run makes one `getUpdates`
call and returns immediately, so it fits inside a regular scheduled job
instead of needing its own long-lived loop. The offset is persisted in
`telegram_estado_canal.ultimo_update_id`, so a worker restart never
reprocesses updates already handled.

The web form never talks to our API (spec 011): the only way a `chat_id`
and threshold reach this database is through these commands, arriving from
Telegram itself.
"""

import logging
import re
from datetime import UTC, datetime

import httpx
from app.repositories.db import get_engine
from app.repositories.telegram import (
    actualizar_estado_canal,
    eliminar_suscripcion,
    fijar_umbral,
    obtener_estado_canal,
    obtener_suscripcion,
)
from sqlalchemy import Engine

from jobs.http import build_client
from jobs.settings import get_settings
from jobs.telegram_avisos import enviar_mensaje_seguro
from jobs.telegram_client import TelegramError, get_updates
from jobs.telegram_mensajes import (
    MENSAJE_BAJA_OK,
    MENSAJE_BAJA_SIN_SUSCRIPCION,
    MENSAJE_BIENVENIDA,
    MENSAJE_UMBRAL_INVALIDO,
    mensaje_umbral_actual,
    mensaje_umbral_fijado,
)

logger = logging.getLogger(__name__)

TELEGRAM_COMANDOS_INTERVAL_SECONDS = 20
TELEGRAM_COMANDOS_FIRST_RUN_DELAY_SECONDS = 30

# Límite de sanity check para lo que se puede tipear acá, no un umbral de
# dominio (esos viven en backend/app/config/dominio.py y no se tocan). Por
# debajo de 0 no tiene sentido; muy por encima de la crecida máxima observada
# (10 m, CLAUDE.md §5) ya no es una altura real que alguien necesite vigilar.
_UMBRAL_MIN_M = 0.01
_UMBRAL_MAX_M = 15.0

_PAYLOAD_DEEPLINK_RE = re.compile(r"^\d{1,4}$")

__all__ = [
    "parse_umbral_deeplink",
    "parse_umbral_texto",
    "procesar_actualizaciones",
    "job_procesar_comandos_telegram",
]


def parse_umbral_deeplink(payload: str) -> float | None:
    """Decodifica el payload de `?start=<payload>`: centímetros enteros -> metros.

    `frontend/src/domain/telegram.ts` genera este payload (nunca al revés);
    ver `buildTelegramDeepLink`. `None` si no matchea o queda fuera de rango.
    """
    if not _PAYLOAD_DEEPLINK_RE.match(payload):
        return None
    umbral_m = int(payload) / 100
    return umbral_m if _UMBRAL_MIN_M <= umbral_m <= _UMBRAL_MAX_M else None


def parse_umbral_texto(texto: str) -> float | None:
    """Parsea una altura tipeada a mano ("7,10" o "7.10"). `None` si no es válida."""
    texto = texto.strip().replace(",", ".")
    try:
        umbral_m = float(texto)
    except ValueError:
        return None
    return umbral_m if _UMBRAL_MIN_M <= umbral_m <= _UMBRAL_MAX_M else None


def _procesar_comando(
    engine: Engine, client: httpx.Client, chat_id: int, texto: str, ahora: datetime
) -> None:
    partes = texto.strip().split(maxsplit=1)
    comando = partes[0].split("@", 1)[0].lower()  # "/umbral@RioUruguayNotificaBot" -> "/umbral"
    resto = partes[1].strip() if len(partes) > 1 else ""

    if comando == "/start":
        if not resto:
            enviar_mensaje_seguro(
                engine, client, chat_id, MENSAJE_BIENVENIDA, ahora, es_respuesta=True
            )
            return
        umbral_m = parse_umbral_deeplink(resto)
        if umbral_m is None:
            enviar_mensaje_seguro(
                engine, client, chat_id, MENSAJE_UMBRAL_INVALIDO, ahora, es_respuesta=True
            )
            return
        fijar_umbral(engine, chat_id, umbral_m)
        enviar_mensaje_seguro(
            engine, client, chat_id, mensaje_umbral_fijado(umbral_m), ahora, es_respuesta=True
        )
        return

    if comando == "/umbral":
        if not resto:
            suscripcion = obtener_suscripcion(engine, chat_id)
            texto_respuesta = mensaje_umbral_actual(suscripcion.umbral_m if suscripcion else None)
            enviar_mensaje_seguro(
                engine, client, chat_id, texto_respuesta, ahora, es_respuesta=True
            )
            return
        umbral_m = parse_umbral_texto(resto)
        if umbral_m is None:
            enviar_mensaje_seguro(
                engine, client, chat_id, MENSAJE_UMBRAL_INVALIDO, ahora, es_respuesta=True
            )
            return
        fijar_umbral(engine, chat_id, umbral_m)
        enviar_mensaje_seguro(
            engine, client, chat_id, mensaje_umbral_fijado(umbral_m), ahora, es_respuesta=True
        )
        return

    if comando == "/baja":
        borrada = eliminar_suscripcion(engine, chat_id)
        texto_respuesta = MENSAJE_BAJA_OK if borrada else MENSAJE_BAJA_SIN_SUSCRIPCION
        enviar_mensaje_seguro(engine, client, chat_id, texto_respuesta, ahora, es_respuesta=True)
        return

    # Comando desconocido: se ignora en silencio, no hace falta responder a todo.


def procesar_actualizaciones(
    engine: Engine, client: httpx.Client, now: datetime | None = None
) -> int:
    """Fetch and act on new Telegram updates since the persisted offset.

    Returns how many updates were processed. Never raises: a failure reading
    or handling an update is logged and the rest of the batch (or worker)
    keeps going (S5).
    """
    now = now if now is not None else datetime.now(UTC)
    settings = get_settings()
    if not settings.telegram_bot_token:
        return 0

    estado = obtener_estado_canal(engine)
    offset = estado.ultimo_update_id + 1 if estado.ultimo_update_id is not None else None

    try:
        updates = get_updates(client, settings.telegram_bot_token, offset=offset)
    except TelegramError as exc:
        logger.warning("telegram: no se pudieron leer comandos, se sigue igual (S5): %s", exc)
        return 0
    except Exception:
        logger.exception("telegram: fallo inesperado leyendo comandos, se sigue igual (S5)")
        return 0

    procesados = 0
    for update in updates:
        try:
            mensaje = update.get("message")
            if mensaje is not None:
                texto = mensaje.get("text")
                chat_id = mensaje.get("chat", {}).get("id")
                if texto and chat_id is not None and texto.startswith("/"):
                    _procesar_comando(engine, client, chat_id, texto, now)
        except Exception:
            logger.exception("telegram: fallo procesando un update, se sigue con el resto")
        finally:
            actualizar_estado_canal(engine, ultimo_update_id=update["update_id"])
            procesados += 1

    return procesados


def job_procesar_comandos_telegram() -> None:
    """Zero-arg entry point registered with the scheduler. Never raises."""
    try:
        engine = get_engine()
        with build_client() as client:
            procesar_actualizaciones(engine, client)
    except Exception:
        logger.exception("telegram: job de comandos falló")
