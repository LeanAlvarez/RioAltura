"""M2 (spec 014): the optional "Río arriba" block for the daily Telegram message.

Pure decision + text logic over Salto Grande data the worker already stored
(spec 012, `app.services.salto_grande.obtener_salto_grande`) -- no new
source, no new call to CTM.

Two thresholds below ("lluvia fuerte", "subida marcada") decide whether a
fact is worth *showing*, not a risk level: they are not domain thresholds
under CLAUDE.md §5 and are documented, with the reasoning for their values,
in specs/014-mensajes-utiles-y-horarios.md, sección "Hallazgos".
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.schemas.salto_grande import ComunicadoSaltoGrande, LluviaSubcuenca, SaltoGrande

__all__ = ["LLUVIA_FUERTE_MM", "SUBIDA_MARCADA_RELATIVA", "construir_bloque_rio_arriba"]

BUENOS_AIRES = ZoneInfo("America/Argentina/Buenos_Aires")

# Piso de lluvia observada, en el evento más fuerte de la ventana, para
# incluir el bloque. Más alto que LLUVIA_SIGNIFICATIVA_MM (5 mm) en
# frontend/src/components/saltoGrande.ts -- ese piso solo decide si la
# tarjeta web (que siempre está visible) muestra o no una frase de lluvia;
# acá decide si vale la pena interrumpir el mensaje diario con un bloque
# nuevo, así que el piso es más alto para no repetirlo en días de lluvia
# rutinaria. 30 mm es, en la muestra de la spec 012, claramente el evento
# que se salió de lo normal (13, 58, 1, 10 mm en cuatro días consecutivos).
LLUVIA_FUERTE_MM = 30.0

# Suba relativa día a día del caudal evacuado para considerarla "marcada".
# Más alto que el 3 % que usa `tendenciaCaudal` en
# frontend/src/components/saltoGrande.ts, que solo filtra ruido operativo
# normal de la represa para decidir la flechita ▲/▼/→ de la tarjeta web.
SUBIDA_MARCADA_RELATIVA = 0.15


def _vertedero_abierto(estado_vertedero: str) -> bool:
    """Igual regla que `esVertederoAbierto` en saltoGrande.ts."""
    return "cerrado" not in estado_vertedero.lower()


def _dias_calendario_desde(fecha: date, ahora: datetime) -> int:
    ahora_local = ahora.astimezone(BUENOS_AIRES).date()
    return (ahora_local - fecha).days


def _frase_hace_dias(dias: int) -> str:
    if dias <= 0:
        return "hoy"
    if dias == 1:
        return "ayer"
    return f"hace {dias} días"


def _formato_mm(valor_mm: float) -> str:
    return f"{round(valor_mm)} mm"


def _formato_caudal(valor_m3s: float) -> str:
    return f"{round(valor_m3s):,}".replace(",", ".") + " m³/s"


def _lluvia_fuerte_frase(lluvia_observada: list[LluviaSubcuenca], ahora: datetime) -> str | None:
    """El evento de lluvia más fuerte de la ventana, si supera `LLUVIA_FUERTE_MM`."""
    if not lluvia_observada:
        return None
    maxima = max(lluvia_observada, key=lambda fila: fila.lluvia_mm)
    if maxima.lluvia_mm < LLUVIA_FUERTE_MM:
        return None
    cuando = _frase_hace_dias(_dias_calendario_desde(maxima.fecha, ahora))
    return f"🌧️ Llovió {_formato_mm(maxima.lluvia_mm)} {cuando}"


def _subida_marcada(
    comunicado: ComunicadoSaltoGrande | None, anterior: ComunicadoSaltoGrande | None
) -> bool:
    if comunicado is None or anterior is None:
        return False
    if anterior.evacuado_m3s <= 0:
        return comunicado.evacuado_m3s > 0
    delta_relativo = (comunicado.evacuado_m3s - anterior.evacuado_m3s) / anterior.evacuado_m3s
    return delta_relativo >= SUBIDA_MARCADA_RELATIVA


def construir_bloque_rio_arriba(salto_grande: SaltoGrande, ahora: datetime) -> str | None:
    """M2: el bloque "Río arriba", o None si ninguno de los tres criterios aplica hoy.

    Criterios (spec 014, M2): vertedero abierto, lluvia fuerte río arriba en
    los últimos días, o caudal erogado subiendo de forma marcada. Una vez
    decidido que el bloque aporta, la línea de lluvia solo aparece si de
    verdad hubo un evento fuerte (aunque el disparador haya sido otro
    criterio), y la línea de caudal/vertedero aparece siempre que haya un
    comunicado -- es el dato de estado actual, no el que disparó el bloque.
    """
    comunicado = salto_grande.comunicado
    vertedero_abierto = comunicado is not None and _vertedero_abierto(comunicado.estado_vertedero)
    lluvia_frase = _lluvia_fuerte_frase(salto_grande.lluvia_observada, ahora)
    subida_marcada = _subida_marcada(comunicado, salto_grande.comunicado_anterior)

    if not (vertedero_abierto or lluvia_frase or subida_marcada):
        return None

    lineas = ["🏞️ Río arriba"]
    if lluvia_frase:
        lineas.append(lluvia_frase)
    if comunicado is not None:
        vertedero_txt = comunicado.estado_vertedero.lower()
        lineas.append(
            f"🚧 Salto Grande suelta {_formato_caudal(comunicado.evacuado_m3s)} "
            f"(vertedero {vertedero_txt})"
        )
    return "\n".join(lineas)
