"""Domain constants for the Uruguay river at Colón (Entre Ríos, Argentina).

Every value here comes from a verified source or from our own calibration, as
documented in CLAUDE.md section 5. Do NOT change any of them without a spec.
Read them from this module; never hardcode them elsewhere.
"""

import math

# --- Port gauge (hidrómetro del puerto de Colón) ---

# Gauge zero, metres above IGN datum. Source: INA-CARU 2019 (differential GPS).
CERO_HIDROMETRO_IGN_M = -0.26

# --- Local thresholds, metres over the port gauge zero ---

# "Evacuación en seco": Municipalidad de Colón.
EVACUACION_EN_SECO_M = 6.80
# Alert level: Prefectura Naval Argentina.
ALERTA_M = 7.10
# Evacuation level: Prefectura Naval Argentina.
EVACUACION_M = 7.90

# --- External data sources ---

# Google Flood Forecasting gauge for Colón (Río Uruguay, 12 km south of the city).
GAUGE_GOOGLE_COLON = "hybas_6121320620"
# Google gauge upstream (Concordia / Salto Grande area).
GAUGE_GOOGLE_AGUAS_ARRIBA = "hybas_6120865460"
# INA series for Colón water level, API alerta.ina.gob.ar/a5.
INA_SERIE_ALTURA_COLON = 80
INA_VAR_ID_ALTURA = 2
# Prefectura port id for Colón (backup source).
PREFECTURA_PUERTO_COLON = 710

# --- Early-warning thresholds on the 3-day forecast discharge (m³/s) ---
# Calibrated with only 2 events: PROVISIONAL.

AVISO_ATENCION_CAUDAL_M3S = 9_500
AVISO_ALERTA_PROBABLE_CAUDAL_M3S = 11_000

# --- Discharge → level rating curve (R² 0.82, p90 error ≈ 1.1 m) ---
# h = A·ln(Q)² + B·ln(Q) + C, with Q in m³/s and h in metres over the gauge zero.

CURVA_A = 1.1926
CURVA_B = -17.3863
CURVA_C = 64.8496

# Half-width of the range shown to users for any forecast-derived level.
# The forecast level is ALWAYS shown as a range, never as an exact number.
RANGO_ESTIMACION_M = 1.0

# Discharge (m³/s) up to which the rating curve was calibrated against
# observed events. Beyond this value, the estimated level is an
# extrapolation of the curve, not a calibrated result.
CAUDAL_MAX_CALIBRADO_M3S = 15_000


def cota_agua(altura_puerto: float) -> float:
    """Water surface elevation (m IGN) from the port gauge reading (m)."""
    return altura_puerto + CERO_HIDROMETRO_IGN_M


def altura_estimada(caudal_m3s: float) -> float:
    """Estimated port gauge level (m) from discharge (m³/s) using the rating curve.

    Raises ValueError for non-positive discharge, where ln(Q) is undefined.
    """
    if caudal_m3s <= 0:
        raise ValueError("caudal_m3s must be positive")
    ln_q = math.log(caudal_m3s)
    return CURVA_A * ln_q**2 + CURVA_B * ln_q + CURVA_C


def es_extrapolado(caudal_m3s: float) -> bool:
    """Whether `caudal_m3s` is above the calibrated range of the rating curve."""
    return caudal_m3s > CAUDAL_MAX_CALIBRADO_M3S


# --- Forecast anchoring (spec 007, criterion C2) ---
#
# This is a PRESENTATION correction applied on top of the rating curve
# output, never a recalibration of the curve itself: it only shifts how an
# already-computed `altura_est_m` is shown, translating the whole band by a
# fading fraction of today's observed bias. It never touches `caudal_m3s`
# nor the aviso, which keep being computed from discharge (CLAUDE.md §5).

# Days over which today's bias between the real reading and the forecast
# estimate is linearly faded out. Day 0 (today) gets the full bias; day
# HORIZONTE_ANCLAJE_DIAS and beyond get none.
HORIZONTE_ANCLAJE_DIAS = 7


def factor_anclaje(dias_desde_hoy: int) -> float:
    """Decay factor (1.0 to 0.0) for the forecast anchoring bias.

    1.0 at `dias_desde_hoy == 0` (today), decaying linearly to 0.0 at
    `HORIZONTE_ANCLAJE_DIAS` and staying at 0.0 beyond it. A negative
    `dias_desde_hoy` (a day before today) also yields 0.0: anchoring only
    ever applies to today and future days.
    """
    if dias_desde_hoy < 0:
        return 0.0
    return max(0.0, 1 - dias_desde_hoy / HORIZONTE_ANCLAJE_DIAS)


def aplicar_anclaje(altura_m: float, sesgo_m: float, dias_desde_hoy: int) -> float:
    """Shift `altura_m` towards today's observed bias `sesgo_m`.

    Presentation-only correction (see module docstring above and
    `factor_anclaje`): translates the value by a fading fraction of the
    bias, never widening it. Meant to be applied identically to
    `altura_est_m`, `altura_min_m` and `altura_max_m` so the whole band
    moves together.
    """
    return altura_m + sesgo_m * factor_anclaje(dias_desde_hoy)
