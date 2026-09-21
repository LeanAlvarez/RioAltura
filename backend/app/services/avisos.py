"""Early-warning level for the Colón gauge, over its most recent forecast issuance.

See CLAUDE.md section 5: thresholds are calibrated with only 2 events
(provisional), and Google's own thresholds are NOT used here (they are
tuned for 2/5/20-year return periods, which in Colón arrive after
evacuation).
"""

from app.config import dominio
from app.schemas.pronostico import AvisoPronostico, DiaPronostico

__all__ = ["calcular_aviso"]

# Only days in this lead window feed the aviso: near-term enough to act on,
# far enough to give people time.
_LEAD_MIN = 1
_LEAD_MAX = 7


def calcular_aviso(dias: list[DiaPronostico]) -> AvisoPronostico:
    """Nivel de aviso a partir de los días de pronóstico con lead_dias entre 1 y 7.

    `alerta_probable` si algún día llega o supera
    `AVISO_ALERTA_PROBABLE_CAUDAL_M3S`; si no, `atencion` si alguno llega o
    supera `AVISO_ATENCION_CAUDAL_M3S`; si no, `sin_aviso`. `primer_dia` es
    el primero (por fecha) que cruza ese umbral; `caudal_max_m3s` es el
    máximo caudal pronosticado entre los días considerados (o `None` si no
    hay ninguno).
    """
    candidatos = sorted(
        (dia for dia in dias if _LEAD_MIN <= dia.lead_dias <= _LEAD_MAX),
        key=lambda dia: dia.fecha,
    )

    if not candidatos:
        return AvisoPronostico(
            nivel="sin_aviso", umbral_m3s=None, primer_dia=None, caudal_max_m3s=None
        )

    caudal_max = max(dia.caudal_m3s for dia in candidatos)

    alerta_probable = [
        dia for dia in candidatos if dia.caudal_m3s >= dominio.AVISO_ALERTA_PROBABLE_CAUDAL_M3S
    ]
    if alerta_probable:
        return AvisoPronostico(
            nivel="alerta_probable",
            umbral_m3s=dominio.AVISO_ALERTA_PROBABLE_CAUDAL_M3S,
            primer_dia=alerta_probable[0].fecha,
            caudal_max_m3s=caudal_max,
        )

    atencion = [dia for dia in candidatos if dia.caudal_m3s >= dominio.AVISO_ATENCION_CAUDAL_M3S]
    if atencion:
        return AvisoPronostico(
            nivel="atencion",
            umbral_m3s=dominio.AVISO_ATENCION_CAUDAL_M3S,
            primer_dia=atencion[0].fecha,
            caudal_max_m3s=caudal_max,
        )

    return AvisoPronostico(
        nivel="sin_aviso", umbral_m3s=None, primer_dia=None, caudal_max_m3s=caudal_max
    )
