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

- [x] Backfill carga ≥ 800 emisiones desde 2024-07-08.
- [x] Tests de aviso en los bordes: 9.499 / 9.500 / 10.999 / 11.000 m³/s.
- [x] Con dos emisiones el mismo día, se usa la más reciente.
- [x] `altura_est_m` para 12.836 m³/s ≈ 7,07 m; `altura_min_m`/`altura_max_m` = ±1,0 m.
- [x] La key nunca aparece en logs (test que lo verifique con un logger capturado).
- [x] `ruff`, `pytest`, `pnpm build` y `pnpm test` pasan.

## Cómo verificar

```bash
cd <worktree>
export TEST_DATABASE_URL=postgresql+psycopg://rioaltura:rioaltura@localhost:5443/rioaltura

uv run ruff check .            # All checks passed!
uv run ruff format --check .   # 69 files already formatted

uv run pytest                  # 142 passed, 2 deselected (los @pytest.mark.live), en ~6-11s
                                # corre también contra Postgres real (test_pronostico_postgres.py)

pnpm -C frontend install --frozen-lockfile   # sin cambios en frontend, ya estaba en verde
pnpm -C frontend build                       # tsc --noEmit && vite build → OK
pnpm -C frontend test                        # 7 tests, OK (sin relación con esta spec)

# Migración + backfill real (usados para el criterio de aceptación de arriba)
uv run alembic upgrade head
uv run python -m jobs.google backfill --desde 2024-07-08
uv run python -m jobs.google backfill --desde 2024-07-08 --hasta 2024-08-06   # corrida de nuevo: inserted 0

# Sanity check del endpoint contra los datos reales cargados
uv run python -c "
from fastapi.testclient import TestClient
from app.main import app
print(TestClient(app).get('/pronostico').json())
"
```

Test específico de la key (logger capturado, corre contra `MockTransport`, nunca pega a la red real):
`worker/tests/test_google.py::test_la_key_nunca_aparece_en_ningun_log_record`.

## Hallazgos

- La spec nombra las constantes como `UMBRAL_ATENCION_M3S`, `UMBRAL_ALERTA_PROBABLE_M3S` y
  `MARGEN_ALTURA_M`, pero en `dominio.py` ya existían con otros nombres desde antes de esta
  spec: `AVISO_ATENCION_CAUDAL_M3S`, `AVISO_ALERTA_PROBABLE_CAUDAL_M3S` y `RANGO_ESTIMACION_M`
  (con el mismo valor, 1.0). Se usaron los nombres existentes en vez de duplicarlos, para no
  tener dos constantes con el mismo significado.
- Fuera del texto de esta spec, se agregó `CAUDAL_MAX_CALIBRADO_M3S = 15_000` a `dominio.py` y
  el campo `extrapolado` (booleano) en `DiaPronostico`/`HistoricoDia`, a pedido explícito fuera
  de la spec escrita: indica si el caudal pronosticado supera el máximo con el que se calibró
  la curva de altura. Cubierto con tests de borde (15.000 → `false`, 15.000,1 → `true`).
- httpx loguea la URL completa (con la key) de cada pedido a nivel INFO por default. No es algo
  que controlemos desde `params`; se resolvió instalando un `logging.Filter` sobre los loggers
  de `httpx`, `httpcore`, `jobs.http` y `jobs.google` que redacta la key antes de que el record
  llegue a cualquier handler (el propio o el de un test). Se verificó tanto en tests (con
  `caplog`) como en la corrida real del backfill (logs muestran `key=***`).
- Por el mismo motivo, `fetch_forecasts` no encadena la excepción original de httpx
  (`raise ... from None`) al envolverla en `FuenteError`: esa excepción puede traer la URL con
  la key en su mensaje, y encadenarla la expondría en un traceback no capturado (por ejemplo si
  el backfill CLI falla sin que nada la atrape).
- Se hizo **una** llamada real a la API de Google (sin loguear ni commitear la key) para
  confirmar la forma de la respuesta antes de escribir el parser: coincide exactamente con la
  documentada en la spec (`forecasts[gaugeId].forecasts[]` con `issuedTime` y
  `forecastRanges[].{value,forecastStartTime}`), con un campo extra `forecastEndTime` que se
  ignora.
- No se tocó `frontend/`: esta spec es solo backend/worker, la UI es la spec 005. `pnpm build`
  y `pnpm test` se corrieron igual para cumplir la definición de hecho del `CLAUDE.md` y
  confirmar que nada quedó roto.
- `AvisoPronostico.caudal_max_m3s` se calcula como el máximo entre los días con `lead_dias` 1-7
  aunque el nivel resultante sea `sin_aviso` (en vez de `null`), porque igual es un dato útil
  para mostrar. `umbral_m3s` y `primer_dia` sí quedan en `null` cuando no se cruzó ningún
  umbral. No está 100% explicitado en la spec así que quedó a criterio propio; si Leandro
  prefiere `caudal_max_m3s: null` en `sin_aviso`, es un cambio de una línea en
  `backend/app/services/avisos.py`.

## Resumen final

Tabla `pronosticos` (migración 0003), cliente Google con reintentos y redacción de la key en
todo log (verificado con `caplog` y en la corrida real), job cada 6 h y backfill por ventanas de
30 días. Endpoints `/api/pronostico`, `/api/pronostico/historico` y
`/api/pronostico/aguas-arriba` (sin aviso), con aviso sobre lead 1-7 y `extrapolado` cuando el
caudal supera lo calibrado (15.000 m³/s). Backfill real desde 2024-07-08: 805 emisiones por
gauge (1.610 en total), 12.880 filas; segunda corrida inserta 0.
ruff, pytest (142, incluye Postgres real), `pnpm build`/`test` en verde.
