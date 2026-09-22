"""Mirror of `frontend/src/domain/umbrales.ts`, only the part the Telegram messages need
(spec 014, M1): which official threshold is next above a given reading.

The VALUES come from `app.config.dominio` and are never redefined here
(CLAUDE.md §5 y §9) -- same rule the frontend module already follows for its
own `UMBRALES` array.
"""

from app.config import dominio

__all__ = ["UMBRALES_M", "proximo_umbral"]

# Mismo orden ascendente que `UMBRALES` en frontend/src/domain/umbrales.ts:
# evacuación preventiva, alerta, evacuación.
UMBRALES_M: tuple[float, ...] = (
    dominio.EVACUACION_EN_SECO_M,
    dominio.ALERTA_M,
    dominio.EVACUACION_M,
)


def proximo_umbral(altura_m: float) -> float | None:
    """El primer umbral (m) por encima de `altura_m`, o None si ya los superó todos.

    Misma semántica que `proximoUmbral` en umbrales.ts: comparación estricta
    (`altura_m < umbral`), así que estar exactamente en un umbral cuenta como
    "ya alcanzado", no como "próximo".
    """
    return next((umbral for umbral in UMBRALES_M if altura_m < umbral), None)
