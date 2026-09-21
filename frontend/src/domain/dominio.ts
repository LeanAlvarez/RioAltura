/**
 * Frontend mirror of the thresholds in `backend/app/config/dominio.py`
 * (CLAUDE.md sección 5). Read-only display values — do NOT change without a
 * spec, and keep in sync with that file if it ever changes.
 */

/** "Evacuación en seco": Municipalidad de Colón. */
export const EVACUACION_EN_SECO_M = 6.8;
/** Alerta: Prefectura Naval Argentina. */
export const ALERTA_M = 7.1;
/** Evacuación: Prefectura Naval Argentina. */
export const EVACUACION_M = 7.9;

/** Una lectura se considera vieja después de esta cantidad de horas. */
export const HORAS_DATO_VIEJO = 6;
