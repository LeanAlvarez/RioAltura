"""Hourly job: publish to the Telegram channel (A1-A3) and to per-subscriber thresholds (B1-B4).

Every actual send goes through `enviar_mensaje_seguro`, which is where S3
(daily cap), S4 (kill switch) and S5 (fail silently) all live in one place.
S1 (antirebote) and S2 (dedup) are the same `evaluar_transicion` state
machine (see `app.services.telegram_estado`), applied once for the channel's
aviso level and once per subscriber's own threshold.

Spec 014 (M5) adds *when* each kind of message is allowed to actually go
out, on top of the antirebote/dedup state above:

- A2 (estado diario): only the run whose local hour is at or after
  `TELEGRAM_HORA_ESTADO_DIARIO` (default 8), once per local day.
- A1/A3 (cambio de nivel de aviso, forecast-based): only inside the daytime
  window `TELEGRAM_VENTANA_DIURNA_INICIO_HORA`..`TELEGRAM_VENTANA_DIURNA_FIN_HORA`
  (default 8-21). A change confirmed by the antirebote (S1) at night is
  *not* published then: it simply isn't sent this run, and the existing
  `nivel_candidato`/`corridas_candidato` bookkeeping (already persisted for
  S1) keeps holding it -- no new column needed -- until a run lands inside
  the window, which publishes it then, still exactly once (S2 still checks
  against `nivel_publicado`).
- B1/B2 (umbral propio, a real measurement crossing): no time restriction,
  same as before this spec -- a real reading never waits for morning.
"""

import logging
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

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
from app.schemas.pronostico import AvisoPronostico, DiaPronostico
from app.services.alturas import hoy_buenos_aires, obtener_ultima
from app.services.avisos import calcular_aviso
from app.services.pronosticos import anclar_pronostico, obtener_dias
from app.services.salto_grande import obtener_salto_grande
from app.services.telegram_estado import evaluar_transicion
from app.services.umbrales import proximo_umbral
from sqlalchemy import Engine

from jobs.http import build_client
from jobs.settings import get_settings
from jobs.telegram_client import TelegramError, install_key_redaction, send_message
from jobs.telegram_mensajes import (
    DiaResumen,
    calcular_tendencia_simple,
    mensaje_cambio_nivel,
    mensaje_estado_diario,
    mensaje_umbral_propio,
)
from jobs.telegram_rio_arriba import construir_bloque_rio_arriba

logger = logging.getLogger(__name__)

TELEGRAM_AVISOS_INTERVAL_SECONDS = 3600
# After the alturas job's own first-run delay, so the first pass has a
# reading to work with; never touches Telegram right at startup either.
TELEGRAM_AVISOS_FIRST_RUN_DELAY_SECONDS = 120

_BUENOS_AIRES = ZoneInfo("America/Argentina/Buenos_Aires")

# Cuántos días de pronóstico anclado se muestran en el estado diario (M1):
# "tres días, no siete" -- en un celular siete filas hacen que nadie lea
# ninguna (spec 014).
_DIAS_PRONOSTICO_MENSAJE = 3

install_key_redaction(lambda: get_settings().telegram_bot_token)


def _hora_local(momento: datetime) -> int:
    return momento.astimezone(_BUENOS_AIRES).hour


def _hora_del_estado_diario_ya_paso(now: datetime) -> bool:
    """M5: A2 solo sale en la corrida cuya hora local ya alcanzó la hora configurada."""
    return _hora_local(now) >= get_settings().telegram_hora_estado_diario


def _en_ventana_diurna(now: datetime) -> bool:
    """M5: A1/A3 solo salen dentro de la ventana horaria diurna configurada."""
    settings = get_settings()
    hora = _hora_local(now)
    return (
        settings.telegram_ventana_diurna_inicio_hora
        <= hora
        <= settings.telegram_ventana_diurna_fin_hora
    )


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


def _dia_pronostico_anclado(
    dias_anclados: list[DiaPronostico], fecha: date
) -> DiaPronostico | None:
    return next((dia for dia in dias_anclados if dia.fecha == fecha), None)


def _resumen_dias_pronostico(
    dias_anclados: list[DiaPronostico], hoy: date, altura_hoy_m: float
) -> list[DiaResumen]:
    """Los próximos `_DIAS_PRONOSTICO_MENSAJE` días (M1), con su tendencia día a día.

    La tendencia del primer día se mide contra la altura real de hoy; la de
    cada día siguiente, contra el día anterior del mismo pronóstico -- así
    el mensaje cuenta una trayectoria, no compara cada día contra hoy.
    """
    futuros = sorted((dia for dia in dias_anclados if dia.fecha > hoy), key=lambda dia: dia.fecha)[
        :_DIAS_PRONOSTICO_MENSAJE
    ]

    resumen: list[DiaResumen] = []
    previa_m = altura_hoy_m
    for dia in futuros:
        tendencia = calcular_tendencia_simple(dia.altura_anclada_m - previa_m) or "estable"
        resumen.append(
            DiaResumen(dia.fecha, tendencia, dia.altura_anclada_min_m, dia.altura_anclada_max_m)
        )
        previa_m = dia.altura_anclada_m
    return resumen


def _publicar_canal(engine: Engine, client: httpx.Client, now: datetime, hoy: date) -> None:
    canal_id = get_settings().telegram_canal_id
    if not canal_id:
        logger.info("telegram: sin TELEGRAM_CANAL_ID configurado, no se publica en el canal")
        return

    altura = obtener_ultima(engine)
    resultado_pronostico = obtener_dias(engine, GAUGE_GOOGLE_COLON, hoy)
    aviso: AvisoPronostico | None = None
    dias_anclados: list[DiaPronostico] = []
    if resultado_pronostico is not None:
        _emitido, dias = resultado_pronostico
        aviso = calcular_aviso(dias)
        dias_anclados, _anclaje = anclar_pronostico(engine, dias, hoy)

    estado_canal = obtener_estado_canal(engine)

    # A2: estado diario (M1), a la hora configurada (M5), una vez por día local.
    if (
        altura is not None
        and estado_canal.estado_diario_fecha != hoy
        and _hora_del_estado_diario_ya_paso(now)
    ):
        nivel_para_hoy = aviso.nivel if aviso is not None else "sin_aviso"
        salto_grande = obtener_salto_grande(engine, hoy)
        texto = mensaje_estado_diario(
            hoy,
            now,
            altura.altura_m,
            altura.estado,
            altura.tendencia_24h_m,
            proximo_umbral(altura.altura_m),
            _resumen_dias_pronostico(dias_anclados, hoy, altura.altura_m),
            nivel_para_hoy,
            altura.fecha_hora,
            altura.fuente,
            construir_bloque_rio_arriba(salto_grande, now),
        )
        if enviar_mensaje_seguro(engine, client, canal_id, texto, now) is not None:
            actualizar_estado_canal(engine, estado_diario_fecha=hoy)

    # A1/A3: cambio de nivel de aviso, con antirebote (S1), dedup persistido
    # (S2) y ventana diurna (M5) -- ver el docstring del módulo.
    if aviso is None:
        return
    nivel_observado = aviso.nivel

    transicion = evaluar_transicion(
        estado_canal.nivel_publicado,
        estado_canal.nivel_candidato,
        estado_canal.corridas_candidato,
        nivel_observado,
    )
    if transicion.debe_publicar and _en_ventana_diurna(now):
        dia_cruce = (
            _dia_pronostico_anclado(dias_anclados, aviso.primer_dia)
            if aviso.primer_dia is not None
            else None
        )
        texto = mensaje_cambio_nivel(
            nivel_observado,
            altura.altura_m if altura is not None else None,
            altura.fecha_hora if altura is not None else now,
            altura.fuente if altura is not None else "",
            dia_cruce.fecha if dia_cruce is not None else None,
            dia_cruce.altura_anclada_min_m if dia_cruce is not None else None,
            dia_cruce.altura_anclada_max_m if dia_cruce is not None else None,
        )
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

    # No se publicó (todavía no tocaba el antirebote, fuera de la ventana
    # diurna, o el envío falló): igual se guarda el avance del antirebote
    # para que la próxima corrida siga donde quedó -- esto es, a la vez, lo
    # que hace que un cambio detectado de noche espere a la mañana sin
    # perderse ni duplicarse (ver docstring del módulo).
    actualizar_estado_canal(
        engine,
        nivel_candidato=transicion.nivel_candidato,
        corridas_candidato=transicion.corridas_candidato,
    )


def _publicar_umbrales_propios(engine: Engine, client: httpx.Client, now: datetime) -> None:
    """B1/B2/B4: una medición real cruzando el umbral propio de un suscriptor.

    Sin restricción horaria (M5): es una medición real, no un pronóstico, y
    se publica ni bien se detecta, a cualquier hora.
    """
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
