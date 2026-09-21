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

/**
 * Curva caudal → altura (mirror de `backend/app/config/dominio.py`). Solo se
 * usa en `mocks/data.ts` para generar fixtures realistas; el backend es la
 * fuente de verdad de `altura_est_m` en las respuestas reales de la API.
 */
export const CURVA_A = 1.1926;
export const CURVA_B = -17.3863;
export const CURVA_C = 64.8496;

/** Mirror de `RANGO_ESTIMACION_M` en `backend/app/config/dominio.py`. */
export const RANGO_ESTIMACION_M = 1.0;

/** Mirror de `CAUDAL_MAX_CALIBRADO_M3S` en `backend/app/config/dominio.py`. */
export const CAUDAL_MAX_CALIBRADO_M3S = 15_000;
