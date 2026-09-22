"""Domain logic for stored Salto Grande data: only reads what the worker already stored.

Never calls CTM from the request path (CLAUDE.md §3). Builds the response
from whatever categories are actually available -- the worker persists the
four sources independently, so any one of them can be missing while the
others are not (spec 012, "no es todo o nada").
"""

from datetime import date, timedelta

from sqlalchemy import Engine

from app.repositories.salto_grande import (
    list_lluvia,
    list_ultimos_caudales_cascada,
    list_ultimos_comunicados,
)
from app.schemas.salto_grande import (
    CaudalCascada,
    ComunicadoSaltoGrande,
    LluviaSubcuenca,
    SaltoGrande,
)
from app.services.alturas import hoy_buenos_aires

__all__ = ["obtener_salto_grande", "hay_datos"]

# Ventana de lluvia observada mostrada (el propio reporte trae ~8 días).
_LLUVIA_OBSERVADA_VENTANA_DIAS = 10

TIPO_OBSERVADA = "observada"
TIPO_PRONOSTICO = "pronostico"


def hay_datos(salto_grande: SaltoGrande) -> bool:
    """Whether there is anything at all to show (used by the router for 503 vs 200)."""
    return bool(
        salto_grande.comunicado
        or salto_grande.caudales_cascada
        or salto_grande.lluvia_observada
        or salto_grande.lluvia_pronostico
    )


def obtener_salto_grande(engine: Engine, hoy: date | None = None) -> SaltoGrande:
    """Latest known Salto Grande data of every kind stored."""
    if hoy is None:
        hoy = hoy_buenos_aires()

    comunicados = list_ultimos_comunicados(engine, limite=2)
    comunicado = (
        ComunicadoSaltoGrande(
            fecha=comunicados[0].fecha,
            aporte_m3s=comunicados[0].aporte_m3s,
            evacuado_m3s=comunicados[0].evacuado_m3s,
            nivel_embalse_m=comunicados[0].nivel_embalse_m,
            estado_vertedero=comunicados[0].estado_vertedero,
            texto_proyeccion=comunicados[0].texto_proyeccion,
        )
        if comunicados
        else None
    )
    comunicado_anterior = (
        ComunicadoSaltoGrande(
            fecha=comunicados[1].fecha,
            aporte_m3s=comunicados[1].aporte_m3s,
            evacuado_m3s=comunicados[1].evacuado_m3s,
            nivel_embalse_m=comunicados[1].nivel_embalse_m,
            estado_vertedero=comunicados[1].estado_vertedero,
            texto_proyeccion=comunicados[1].texto_proyeccion,
        )
        if len(comunicados) > 1
        else None
    )

    caudales_cascada = [
        CaudalCascada(estacion=row.estacion, fecha=row.fecha, caudal_m3s=row.caudal_m3s)
        for row in list_ultimos_caudales_cascada(engine)
    ]

    lluvia_observada = [
        LluviaSubcuenca(subcuenca=row.subcuenca, fecha=row.fecha, lluvia_mm=row.lluvia_mm)
        for row in list_lluvia(
            engine, TIPO_OBSERVADA, hoy - timedelta(days=_LLUVIA_OBSERVADA_VENTANA_DIAS)
        )
    ]
    lluvia_pronostico = [
        LluviaSubcuenca(subcuenca=row.subcuenca, fecha=row.fecha, lluvia_mm=row.lluvia_mm)
        for row in list_lluvia(engine, TIPO_PRONOSTICO, hoy)
    ]

    return SaltoGrande(
        comunicado=comunicado,
        comunicado_anterior=comunicado_anterior,
        caudales_cascada=caudales_cascada,
        lluvia_observada=lluvia_observada,
        lluvia_pronostico=lluvia_pronostico,
    )
