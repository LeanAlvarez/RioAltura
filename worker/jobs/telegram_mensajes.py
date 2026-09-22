"""Message text for the Telegram channel and per-subscriber DMs (spec 011).

Every risk-level word here is copied from text already approved elsewhere in
the app -- CLAUDE.md §9 forbids inventing new risk wording:

- Aviso levels (`sin_aviso`/`atencion`/`alerta_probable`): the same labels as
  `frontend/src/domain/aviso.ts` (`NIVELES`).
- Real-reading estado (`normal`/`evacuacion_en_seco`/`alerta`/`evacuacion`):
  the same labels as `frontend/src/domain/estado.ts` (`ESTADOS`).
- Disclaimer: the same short line shown next to the map (`app.ts`).

Every message that reports a river reading also carries its date/time and
source (CLAUDE.md §6), and, when `TELEGRAM_APP_URL` is configured, a link
back to the app.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from jobs.settings import get_settings

__all__ = [
    "DISCLAIMER",
    "NIVELES_AVISO_TEXTO",
    "ESTADO_TEXTO",
    "MENSAJE_BIENVENIDA",
    "MENSAJE_UMBRAL_INVALIDO",
    "MENSAJE_BAJA_OK",
    "MENSAJE_BAJA_SIN_SUSCRIPCION",
    "mensaje_cambio_nivel",
    "mensaje_estado_diario",
    "mensaje_umbral_propio",
    "mensaje_umbral_fijado",
    "mensaje_umbral_actual",
]

BUENOS_AIRES = ZoneInfo("America/Argentina/Buenos_Aires")

DISCLAIMER = "Orientativo. No reemplaza a Prefectura ni a Defensa Civil."

# Copiado de frontend/src/domain/aviso.ts (NIVELES). No inventar textos nuevos (CLAUDE.md §9).
NIVELES_AVISO_TEXTO: dict[str, str] = {
    "sin_aviso": "Sin aviso",
    "atencion": "Atención",
    "alerta_probable": "Alerta probable",
}

# Copiado de frontend/src/domain/estado.ts (ESTADOS[].label). No inventar textos nuevos.
ESTADO_TEXTO: dict[str, str] = {
    "normal": "Normal",
    "evacuacion_en_seco": "Evacuación preventiva",
    "alerta": "Alerta",
    "evacuacion": "Evacuación",
}


def _formato_metros(valor_m: float) -> str:
    return f"{valor_m:.2f}".replace(".", ",") + " m"


def _formato_fecha_hora(momento: datetime) -> str:
    return momento.astimezone(BUENOS_AIRES).strftime("%d/%m %H:%M")


def _pie_mensaje(fecha_dato: datetime, fuente: str) -> str:
    link = get_settings().telegram_app_url
    pie = f"Dato del {_formato_fecha_hora(fecha_dato)} ({fuente}).\n\n{DISCLAIMER}"
    return f"{pie}\n\nMás info: {link}" if link else pie


def mensaje_cambio_nivel(nivel: str, fecha_dato: datetime, fuente: str) -> str:
    """A1 (nuevo nivel de aviso) o A3 (vuelta a la normalidad), según `nivel`."""
    etiqueta = NIVELES_AVISO_TEXTO[nivel]
    titulo = (
        f"El nivel de aviso volvió a la normalidad: {etiqueta}."
        if nivel == "sin_aviso"
        else f"Nuevo nivel de aviso: {etiqueta}."
    )
    return f"{titulo}\n\n{_pie_mensaje(fecha_dato, fuente)}"


def mensaje_estado_diario(
    altura_m: float, estado: str, nivel_aviso: str, fecha_dato: datetime, fuente: str
) -> str:
    """A2: estado diario, aunque no haya cambiado nada."""
    titulo = (
        f"Estado de hoy del río Uruguay en Colón: {_formato_metros(altura_m)} "
        f"({ESTADO_TEXTO[estado]}). Nivel de aviso: {NIVELES_AVISO_TEXTO[nivel_aviso]}."
    )
    return f"{titulo}\n\n{_pie_mensaje(fecha_dato, fuente)}"


def mensaje_umbral_propio(
    sobre_umbral: bool, umbral_m: float, altura_m: float, fecha_dato: datetime, fuente: str
) -> str:
    """B1 (cruzó hacia arriba) o B2 (bajó), según `sobre_umbral`."""
    titulo = (
        f"El río superó los {_formato_metros(umbral_m)} que elegiste: "
        f"está en {_formato_metros(altura_m)}."
        if sobre_umbral
        else f"El río bajó de los {_formato_metros(umbral_m)} que elegiste: "
        f"está en {_formato_metros(altura_m)}."
    )
    return f"{titulo}\n\n{_pie_mensaje(fecha_dato, fuente)}"


MENSAJE_BIENVENIDA = (
    "Este bot avisa cuando el río Uruguay en Colón cruza la altura que vos elijas.\n\n"
    "Comandos:\n"
    "/umbral <metros> — fijar o cambiar tu umbral (ej: /umbral 7,10)\n"
    "/umbral — ver tu umbral actual\n"
    "/baja — darte de baja (borra tu umbral)\n\n" + DISCLAIMER
)

MENSAJE_UMBRAL_INVALIDO = (
    "No entendí ese valor. Mandá /umbral seguido de una altura en metros, por ejemplo: /umbral 7,10"
)

MENSAJE_BAJA_OK = "Listo, te diste de baja. Borramos tu umbral: no queda nada guardado."
MENSAJE_BAJA_SIN_SUSCRIPCION = "No tenías un umbral fijado."


def mensaje_umbral_fijado(umbral_m: float) -> str:
    return (
        f"Listo. Te vamos a avisar cuando el río cruce los {_formato_metros(umbral_m)}.\n\n"
        + DISCLAIMER
    )


def mensaje_umbral_actual(umbral_m: float | None) -> str:
    if umbral_m is None:
        return (
            "Todavía no fijaste un umbral. Mandá /umbral seguido de una altura en metros "
            "para hacerlo (ej: /umbral 7,10)."
        )
    return f"Tu umbral actual es {_formato_metros(umbral_m)}."
