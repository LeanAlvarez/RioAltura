"""Message text for the Telegram channel and per-subscriber DMs (specs 011, 014).

Every risk-level word here is copied from text already approved elsewhere in
the app -- CLAUDE.md §9 forbids inventing new risk wording:

- Aviso levels (`sin_aviso`/`atencion`/`alerta_probable`): the same labels as
  `frontend/src/domain/aviso.ts` (`NIVELES`).
- Real-reading estado (`normal`/`evacuacion_en_seco`/`alerta`/`evacuacion`):
  the same labels as `frontend/src/domain/estado.ts` (`ESTADOS`).
- Disclaimer: the same short line shown next to the map (`app.ts`).

Every message that reports a river reading also carries its date/time and
source (CLAUDE.md §6, except the short M3 aviso message -- see the spec 014
"Hallazgos" section for why), and, when `TELEGRAM_APP_URL` is configured, a
link back to the app.

Emoji discipline (spec 014, M4): only 🟢🟡🔴 (nivel de aviso), 🔼🔽➡️
(tendencia) and block-header emoji are used, and every one of them is always
next to its own text -- CLAUDE.md §7 forbids information that depends only
on color, and an emoji *is* color.
"""

from datetime import date, datetime
from typing import Literal, NamedTuple
from zoneinfo import ZoneInfo

from jobs.settings import get_settings

__all__ = [
    "DISCLAIMER",
    "NIVELES_AVISO_TEXTO",
    "ESTADO_TEXTO",
    "FUENTE_TEXTO",
    "DiaResumen",
    "Tendencia",
    "calcular_tendencia_simple",
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

# Nombre de fuente legible para el pie de mensaje ("(CARU)" en vez de
# "(caru)"). Solo formato de texto, no un dato de dominio nuevo.
FUENTE_TEXTO: dict[str, str] = {
    "ina": "INA",
    "prefectura": "Prefectura",
    "caru": "CARU",
}

_NIVEL_EMOJI: dict[str, str] = {"sin_aviso": "🟢", "atencion": "🟡", "alerta_probable": "🔴"}

Tendencia = Literal["sube", "baja", "estable"]

_TENDENCIA_EMOJI: dict[Tendencia, str] = {"sube": "🔼", "baja": "🔽", "estable": "➡️"}

# Mismo umbral que `calcularTendencia` en frontend/src/format.ts: un cambio
# menor a 5 cm no se muestra como tendencia, es ruido de medición.
_UMBRAL_ESTABLE_M = 0.05

_DIAS_SEMANA_COMPLETO = (
    "lunes",
    "martes",
    "miércoles",
    "jueves",
    "viernes",
    "sábado",
    "domingo",
)
_DIAS_SEMANA_CORTO = ("lun", "mar", "mié", "jue", "vie", "sáb", "dom")


class DiaResumen(NamedTuple):
    """Un día de pronóstico anclado, ya resumido para el mensaje diario (M1)."""

    fecha: date
    tendencia: Tendencia
    altura_min_m: float
    altura_max_m: float


def calcular_tendencia_simple(delta_m: float | None) -> Tendencia | None:
    """ "sube"/"baja"/"estable" a partir de una diferencia en metros, o None sin dato.

    Mismo umbral y semántica que `calcularTendencia` en frontend/src/format.ts.
    """
    if delta_m is None:
        return None
    if abs(delta_m) < _UMBRAL_ESTABLE_M:
        return "estable"
    return "sube" if delta_m > 0 else "baja"


def _formato_metros(valor_m: float) -> str:
    return f"{_coma(valor_m, 2)} m"


def _coma(valor: float, decimales: int) -> str:
    return f"{valor:.{decimales}f}".replace(".", ",")


def _formato_rango(min_m: float, max_m: float) -> str:
    return f"entre {_coma(min_m, 1)} y {_coma(max_m, 1)} m"


def _dia_semana_completo(fecha: date) -> str:
    return _DIAS_SEMANA_COMPLETO[fecha.weekday()]


def _dia_semana_corto(fecha: date) -> str:
    return _DIAS_SEMANA_CORTO[fecha.weekday()]


def _formato_fecha_hora(momento: datetime) -> str:
    return momento.astimezone(BUENOS_AIRES).strftime("%d/%m %H:%M")


def _momento_corto(fecha_dato: datetime, ahora: datetime) -> str:
    """ "hoy 00:00" / "ayer 00:00" / "el 20/09 00:00", siempre en hora de Buenos Aires."""
    fecha_local = fecha_dato.astimezone(BUENOS_AIRES)
    ahora_local = ahora.astimezone(BUENOS_AIRES)
    hora = fecha_local.strftime("%H:%M")
    if fecha_local.date() == ahora_local.date():
        return f"hoy {hora}"
    dias_atras = (ahora_local.date() - fecha_local.date()).days
    if dias_atras == 1:
        return f"ayer {hora}"
    return f"el {fecha_local.strftime('%d/%m')} {hora}"


def _pie_mensaje(fecha_dato: datetime, fuente: str) -> str:
    link = get_settings().telegram_app_url
    fuente_txt = FUENTE_TEXTO.get(fuente, fuente)
    pie = f"Dato del {_formato_fecha_hora(fecha_dato)} ({fuente_txt}).\n\n{DISCLAIMER}"
    return f"{pie}\n\nMás info: {link}" if link else pie


def _linea_tendencia_24h(delta_m: float | None) -> str:
    tendencia = calcular_tendencia_simple(delta_m)
    if tendencia is None:
        return "Sin dato de tendencia en el último día."
    if tendencia == "estable":
        return f"{_TENDENCIA_EMOJI['estable']} No subió ni bajó en el último día"
    # tendencia is "sube"/"baja" only when delta_m is not None (see calcular_tendencia_simple).
    cm = round(abs(delta_m or 0.0) * 100)
    verbo = "Subió" if tendencia == "sube" else "Bajó"
    return f"{_TENDENCIA_EMOJI[tendencia]} {verbo} {cm} cm en el último día"


def _linea_nivel_aviso(nivel: str) -> str:
    emoji = _NIVEL_EMOJI[nivel]
    if nivel == "sin_aviso":
        return f"{emoji} Hoy no hay alerta"
    return f"{emoji} Nivel de aviso: {NIVELES_AVISO_TEXTO[nivel]}"


def _linea_dia_pronostico(dia: DiaResumen) -> str:
    dia_corto = _dia_semana_corto(dia.fecha)
    emoji = _TENDENCIA_EMOJI[dia.tendencia]
    rango = _formato_rango(dia.altura_min_m, dia.altura_max_m)
    return f"  {dia_corto} {dia.fecha.day}  {emoji}  {rango}"


def mensaje_cambio_nivel(
    nivel: str,
    altura_hoy_m: float | None,
    primer_dia: date | None = None,
    rango_min_m: float | None = None,
    rango_max_m: float | None = None,
) -> str:
    """M3 (spec 014): cambio de nivel de aviso, corto -- no lleva el resumen de M1.

    `primer_dia`/`rango_*_m` son el día y el rango pronosticado (anclado) que
    justifica el nuevo nivel (`AvisoPronostico.primer_dia` y el día
    correspondiente de `anclar_pronostico`). Se omiten (o no aplican) cuando
    `nivel == "sin_aviso"`: la vuelta a la normalidad no proyecta un cruce.
    """
    emoji = _NIVEL_EMOJI[nivel]
    etiqueta = NIVELES_AVISO_TEXTO[nivel].upper()
    encabezado = f"{emoji} {etiqueta} — Río Uruguay en Colón"

    altura_txt = (
        f"Hoy está en {_formato_metros(altura_hoy_m)}."
        if altura_hoy_m is not None
        else "Todavía no hay una medición de hoy."
    )

    if nivel == "sin_aviso" or primer_dia is None or rango_min_m is None or rango_max_m is None:
        cuerpo = f"El nivel de aviso volvió a la normalidad.\n{altura_txt}"
    else:
        dia_txt = f"{_dia_semana_completo(primer_dia)} {primer_dia.day}"
        rango_txt = _formato_rango(rango_min_m, rango_max_m)
        cuerpo = f"El río podría llegar a {rango_txt} el {dia_txt}.\n{altura_txt}"

    pie = f"⚠️ {DISCLAIMER}\nSeguí los avisos de Prefectura y Defensa Civil."
    return f"{encabezado}\n\n{cuerpo}\n\n{pie}"


def mensaje_estado_diario(
    hoy: date,
    ahora: datetime,
    altura_m: float,
    estado: str,
    tendencia_24h_m: float | None,
    proximo_umbral_m: float | None,
    dias_pronostico: list[DiaResumen],
    nivel_aviso: str,
    fecha_dato: datetime,
    fuente: str,
    bloque_rio_arriba: str | None = None,
) -> str:
    """M1 (spec 014): estado diario completo -- altura, tendencia, cuánto falta para el
    primer umbral, pronóstico anclado a 3 días, nivel de aviso y, si aporta, el bloque
    "Río arriba" (M2, ver `jobs.telegram_rio_arriba`).
    """
    encabezado = f"🌊 Río Uruguay en Colón — {_dia_semana_completo(hoy)} {hoy.day}"

    lineas_hoy = [
        f"📏 Hoy: {_formato_metros(altura_m)} · {ESTADO_TEXTO[estado]}",
        _linea_tendencia_24h(tendencia_24h_m),
    ]
    if proximo_umbral_m is not None:
        falta_m = proximo_umbral_m - altura_m
        lineas_hoy.append(
            f"📉 Faltan {_formato_metros(falta_m)} para los {_formato_metros(proximo_umbral_m)}"
        )
    bloque_hoy = "\n".join(lineas_hoy)

    if dias_pronostico:
        lineas_pronostico = ["🔮 Próximos días"]
        lineas_pronostico.extend(_linea_dia_pronostico(dia) for dia in dias_pronostico)
        lineas_pronostico.append(_linea_nivel_aviso(nivel_aviso))
        bloque_pronostico = "\n".join(lineas_pronostico)
    else:
        bloque_pronostico = _linea_nivel_aviso(nivel_aviso)

    fuente_txt = FUENTE_TEXTO.get(fuente, fuente)
    bloque_pie = (
        f"📅 Medición del puerto: {_momento_corto(fecha_dato, ahora)} ({fuente_txt})\n"
        f"⚠️ {DISCLAIMER}"
    )

    bloques = [encabezado, bloque_hoy, bloque_pronostico]
    if bloque_rio_arriba:
        bloques.append(bloque_rio_arriba)
    bloques.append(bloque_pie)

    return "\n\n".join(bloques)


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
