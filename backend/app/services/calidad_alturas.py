"""Quality rules for incoming gauge readings (spec 020).

Pure functions, no DB and no I/O: the thresholds come from `dominio.py` and
everything here is decided from the values alone, so each rule is tested
against the real incident and against the real floods it must NOT reject.

The motivating failure: on 2026-09-23 INA published 6.24 m for Colón while
CARU read 3.98 m the same day and the previous fortnight sat between 3.5 and
4.3 m. Nothing stopped it, the forecast anchor propagated it (+2.06 m of
bias over seven days), and the site announced the river could reach 7.3 m --
above the 7.10 m Alerta threshold.
"""

from dataclasses import dataclass
from datetime import date

from app.config.dominio import DESACUERDO_MAX_FUENTES_M, DESVIO_PICO_MAX_M


@dataclass(frozen=True)
class LecturaDiaria:
    """One source's value for one local day."""

    fecha: date
    fuente: str
    altura_m: float


def desacuerdo(lecturas: list[LecturaDiaria]) -> float:
    """Pure: spread between the highest and lowest reading of a day, or 0."""
    if len(lecturas) < 2:
        return 0.0
    alturas = [lectura.altura_m for lectura in lecturas]
    return max(alturas) - min(alturas)


def sospechosas_por_desacuerdo(
    lecturas: list[LecturaDiaria],
    referencia_m: float | None,
) -> list[LecturaDiaria]:
    """Pure: which readings of a day to quarantine because the sources disagree.

    `referencia_m` is the last confirmed height before this day. When two
    sources disagree beyond the threshold we cannot know which one is wrong
    from the values alone, so the tie-breaker is continuity: the reading
    furthest from what the river was actually doing is the suspect one.

    That is exactly what would have saved CARU (3.98, right after three days
    of 4.29) and quarantined INA (6.24) on 2026-09-23.

    With no reference to compare against (the very first day of the series)
    we quarantine none: marking a reading suspect on no evidence would be
    worse than showing it with its date.
    """
    if desacuerdo(lecturas) <= DESACUERDO_MAX_FUENTES_M:
        return []
    if referencia_m is None:
        return []

    distancia = {lectura.fuente: abs(lectura.altura_m - referencia_m) for lectura in lecturas}
    minima = min(distancia.values())
    # Everything that is not the closest-to-reality reading is quarantined.
    return [lectura for lectura in lecturas if distancia[lectura.fuente] > minima]


def desvio_contra_vecinos(anterior: float, actual: float, siguiente: float) -> float:
    """Pure: how far a day sits from the straight line between its neighbours."""
    return abs(actual - (anterior + siguiente) / 2)


def fechas_pico(serie: list[tuple[date, float]]) -> list[date]:
    """Pure: which days of a daily series are spikes (spec 020 D3).

    `serie` must be ordered ascending by date. Only days with both an
    immediately previous and an immediately following day are testable.

    Iterative, worst-first, recomputing after each removal: a spike inflates
    its own neighbours' deviation, so a single pass would also flag the
    *shoulders* of a spike, which are innocent.
    """
    valores = dict(serie)
    marcadas: list[date] = []

    while True:
        fechas = sorted(valores)
        peor_fecha: date | None = None
        peor_desvio = DESVIO_PICO_MAX_M

        for i in range(1, len(fechas) - 1):
            anterior, actual, siguiente = fechas[i - 1], fechas[i], fechas[i + 1]
            # Only consecutive calendar days: a gap is not a spike.
            if (actual - anterior).days != 1 or (siguiente - actual).days != 1:
                continue
            d = desvio_contra_vecinos(valores[anterior], valores[actual], valores[siguiente])
            if d > peor_desvio:
                peor_desvio = d
                peor_fecha = actual

        if peor_fecha is None:
            return marcadas
        marcadas.append(peor_fecha)
        del valores[peor_fecha]
