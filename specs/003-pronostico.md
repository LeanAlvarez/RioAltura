# 003 — Pronóstico de Google y nivel de aviso

- **Estado:** lista
- **Rama:** feat/003-pronostico
- **Depende de:** 001
- **Puede ir en paralelo con:** 002, 005, 006

## Objetivo

Guardar los pronósticos de caudal de Google para Colón, convertirlos a altura estimada (como rango) y calcular el nivel de aviso, expuesto por la API.

## Alcance

1. **Modelo y migración** `pronosticos`: `id`, `gauge_id`, `emitido` (timestamptz), `fecha` (date), `lead_dias` (int), `caudal_m3s` (float). Único por (`gauge_id`, `emitido`, `fecha`).
2. **Cliente Google** (`worker/jobs/google.py`):
   - `GET https://floodforecasting.googleapis.com/v1/gauges:queryGaugeForecasts` con `key`, `gaugeIds`, `issuedTimeStart`, `issuedTimeEnd` (YYYY-MM-DD).
   - Respuesta: `forecasts[gaugeId].forecasts[]` con `issuedTime` y `forecastRanges[]` (`value`, `forecastStartTime`).
   - `lead_dias = fecha(forecastStartTime) − fecha(issuedTime)`. Puede ser negativo (hindcast).
   - Gauges: Colón `hybas_6121320620` y aguas arriba `hybas_6120865460` (constantes de `dominio.py`).
   - Key: `FLOODS_API_KEY`, solo en el worker.
3. **Job cada 6 h** que trae las emisiones de los últimos 3 días (upsert).
4. **Backfill**: `uv run python -m worker.jobs.google backfill --desde 2024-07-08` en ventanas de 30 días (la API no tiene datos anteriores).
5. **Lógica de aviso** (`backend/app/services/avisos.py`), sobre la **última emisión** del gauge de Colón:
   - Mirar los días con `lead_dias` de 1 a 7.
   - `alerta_probable` si algún día ≥ 11.000 m³/s; `atencion` si algún día ≥ 9.500 m³/s; si no, `sin_aviso`.
   - Devolver también el primer día que supera el umbral y el caudal máximo pronosticado.
   - Umbrales en `dominio.py`, marcados como provisorios (calibrados con 2 eventos).
6. **Conversión a altura**: `altura_estimada(caudal)` de `dominio.py`, siempre acompañada de rango `±1,0 m` (constante `MARGEN_ALTURA_M = 1.0`).
7. **Endpoints**:
   - `GET /api/pronostico` → `{emitido, gauge_id, dias: [{fecha, lead_dias, caudal_m3s, altura_est_m, altura_min_m, altura_max_m}], aviso: {nivel, umbral_m3s, primer_dia, caudal_max_m3s}}`. Solo `lead_dias ≥ 0`.
   - `GET /api/pronostico/historico?lead=3&desde=YYYY-MM-DD` → `[{fecha, caudal_m3s, altura_est_m}]` (para comparar con la altura real en el gráfico).
   - `GET /api/pronostico/aguas-arriba` → mismo formato que `/api/pronostico` para el gauge aguas arriba, sin aviso.
8. Contrato en `contracts/openapi.yaml`.

## Fuera de alcance

- Alturas reales (spec 002).
- UI (spec 005).
- Envío de alertas (Telegram va en una spec posterior).
- Recalibración automática de la curva o de los umbrales.

## Diseño / decisiones

- NO usar los `thresholds` de Google (warning/danger/extreme) para el aviso. Ver sección 5 del `CLAUDE.md`.
- Si Google falla, el endpoint devuelve la última emisión guardada con su fecha; si no hay ninguna, 503 con mensaje claro.
- Tests con fixtures JSON grabadas en `worker/tests/fixtures/`. Incluir una fixture con dos emisiones el mismo día para verificar que se usa la de `issuedTime` máximo.

## Archivos compartidos que puede tocar

- `backend/app/config/dominio.py`: agregar `UMBRAL_ATENCION_M3S`, `UMBRAL_ALERTA_PROBABLE_M3S`, `MARGEN_ALTURA_M` si faltan.
- `contracts/openapi.yaml`: solo la sección `/api/pronostico*`.
- `backend/app/main.py`: solo para registrar el router.
- Nueva migración de Alembic (sin editar las existentes).

## Criterios de aceptación

- [ ] Backfill carga ≥ 800 emisiones desde 2024-07-08.
- [ ] Tests de aviso en los bordes: 9.499 / 9.500 / 10.999 / 11.000 m³/s.
- [ ] Con dos emisiones el mismo día, se usa la más reciente.
- [ ] `altura_est_m` para 12.836 m³/s ≈ 7,07 m; `altura_min_m`/`altura_max_m` = ±1,0 m.
- [ ] La key nunca aparece en logs (test que lo verifique con un logger capturado).
- [ ] `ruff`, `pytest`, `pnpm build` y `pnpm test` pasan.

## Cómo verificar

(Completar.)

## Hallazgos

(Completar.)

## Resumen final

(Completar, máximo 5 líneas.)
