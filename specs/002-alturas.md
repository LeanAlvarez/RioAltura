# 002 — Alturas reales del puerto (INA + Prefectura)

- **Estado:** en revisión
- **Rama:** feat/002-alturas
- **Depende de:** 001
- **Puede ir en paralelo con:** 003, 005, 006

## Objetivo

Tener en la base la altura real del río en el puerto de Colón, actualizada cada hora y con histórico desde 2023-10-01, expuesta por la API.

## Alcance

1. **Modelo y migración** `alturas`: `id`, `fecha_hora` (timestamptz), `altura_m` (float), `fuente` (`ina` | `prefectura`), `creado_en`. Único por (`fecha_hora`, `fuente`).
2. **Cliente INA** (`worker/jobs/ina.py`), API `https://alerta.ina.gob.ar/a5`:
   - Observaciones: `GET /obs/puntual/series/80/observaciones?timestart=...&timeend=...` (ISO 8601 UTC). Campos: `timestart`, `valor`.
   - Serie 80 = Colón, río Uruguay, `var_id=2` (altura hidrométrica). Constante en `dominio.py`.
3. **Cliente Prefectura** (`worker/jobs/prefectura.py`), respaldo: `https://contenidosweb.prefecturanaval.gob.ar/alturas/?page=historico&tiempo=<días>&id=710`, parseo HTML. Solo se usa si el INA falla o no tiene datos de las últimas 24 h.
4. **Job horario** en el worker: trae las últimas 48 h e inserta sin duplicar (upsert).
5. **Backfill**: comando `uv run python -m worker.jobs.ina backfill --desde 2023-10-01` en ventanas de 90 días.
6. **Endpoints**:
   - `GET /api/alturas/ultima` → `{fecha_hora, altura_m, fuente, tendencia_24h_m, estado}`.
   - `GET /api/alturas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` → lista diaria `{fecha, altura_m}` (promedio del día; máximo 3 años por request).
7. **`estado`** calculado desde la altura con los umbrales de `dominio.py`: `normal` (<6,80), `evacuacion_en_seco` (≥6,80), `alerta` (≥7,10), `evacuacion` (≥7,90).
8. Contrato en `contracts/openapi.yaml`.

## Fuera de alcance

- Pronósticos de Google (spec 003).
- UI (spec 005).
- Alertas por Telegram.

## Diseño / decisiones

- Clientes con `httpx`, timeout 30 s, 3 reintentos con backoff, `User-Agent: RioAltura/0.1 (+https://github.com/LeanAlvarez/RioAltura)`.
- Horas: guardar en UTC; los endpoints diarios agrupan por día en `America/Argentina/Buenos_Aires`.
- Tests con fixtures grabadas (JSON del INA y HTML de Prefectura) en `worker/tests/fixtures/`. Nada de llamadas reales salvo `@pytest.mark.live`.

### Decisiones tomadas durante la implementación

- **`tendencia_24h_m`**: última altura menos la lectura más reciente dentro de la ventana [última − 36 h, última − 20 h]; `null` si no hay ninguna en esa ventana (decisión de Leandro, 2026-09-21; reemplaza "la lectura ≤ 24 h antes").
- **Promedio diario**: se agrupa por día local (`America/Argentina/Buenos_Aires`) en Python, no en SQL, para que el repositorio sea testeable en SQLite en memoria. Si un día tiene lecturas del INA se usan solo esas; Prefectura se usa únicamente en días sin INA.
- **`fuente`** se guarda como texto con `CHECK (fuente IN ('ina','prefectura'))`, no como enum de Postgres, para simplificar migraciones futuras.
- **Rangos**: `desde > hasta` o más de 3 años → 422 con mensaje en español. `GET /api/alturas/ultima` sin filas → 404.
- **Upsert** con `INSERT … ON CONFLICT DO NOTHING RETURNING id` (funciona igual en Postgres y SQLite); se cuenta lo insertado con `RETURNING` porque psycopg devuelve `rowcount = -1` en ese patrón.
- **Fallback a Prefectura**: se dispara si el INA falla o si ninguna lectura del INA tiene menos de 24 h. Si el INA devolvió datos viejos, igual se insertan antes de recurrir a Prefectura (son histórico válido). Si Prefectura también falla, se loguea `ERROR` y el job termina sin excepción para no tumbar el scheduler.
- **Prefix del router**: `/alturas` (sin `/api`), igual que `health`: el prefijo `/api` lo agregan el proxy de Vite y nginx. La ruta pública sigue siendo `/api/alturas/ultima`.
- **Primera corrida del job horario**: 60 s después de arrancar el proceso, no inmediata, para que el test de proceso del worker (que levanta `python -m jobs` de verdad) nunca llame a fuentes reales.
- **Worker y base**: el worker reutiliza `app.repositories.db.get_engine()` del backend (ya depende de ese paquete); no tiene configuración de base propia.
- **CI**: se agregó un servicio `postgres:16` al job de Python en `.github/workflows/ci.yml` con `TEST_DATABASE_URL`, para que `backend/tests/test_alturas_postgres.py` (migración real + unicidad) corra en CI (autorizado por Leandro, 2026-09-21). Sin esa variable el test se salta.
- **Comando de backfill**: el canónico es `uv run python -m jobs.ina backfill --desde 2023-10-01`; el de la spec (`python -m worker.jobs.ina …`) también funciona desde la raíz del repo.

## Archivos compartidos que puede tocar

- `backend/app/config/dominio.py`: solo agregar constantes de serie INA y puerto Prefectura si faltan.
- `contracts/openapi.yaml`: solo la sección de `/api/alturas*`.
- `backend/app/main.py`: solo para registrar el router.
- Nueva migración de Alembic (sin editar las existentes).

## Criterios de aceptación

- [x] Backfill carga ≥ 1.000 días desde 2023-10-01 (verificado a mano el 2026-09-21 contra la base del worktree: 1.848 filas, 1.073 días distintos, desde 2023-10-01 hasta 2026-09-21; ver "Cómo verificar").
- [x] El máximo del período es 9,06 m el 2024-05-14 (promedio diario: 9,06 el 14/05, 9,05 el 13/05, 9,03 el 15/05; ver Hallazgos por una lectura cruda aislada de 9,83 m).
- [x] El job horario no duplica filas al correr dos veces (`worker/tests/test_alturas_job.py` y corrida real dos veces: `inserted 0`).
- [x] Si el INA falla (fixture de error), se usa Prefectura y queda logueado (`test_alturas_job.py`, casos error 500, datos viejos y ambas fuentes caídas).
- [x] `tendencia_24h_m` y `estado` testeados en los bordes (6,79 / 6,80 / 7,09 / 7,10 / 7,89 / 7,90 en `backend/tests/test_alturas_service.py`; ventana 20–36 h con casos 19 h, 21 h, 24 h, 35 h y 37 h).
- [x] `ruff`, `pytest`, `pnpm build` y `pnpm test` pasan (86 tests Python, 2 saltados sin `TEST_DATABASE_URL`, 2 `live` deseleccionados; 7 tests de frontend).

## Cómo verificar

```bash
# Calidad y tests (sin red, sin base)
uv run ruff check . && uv run ruff format --check .
uv run pytest -q                      # 86 passed, 2 skipped, 2 deselected

# Base del worktree + migración + test contra Postgres real
scripts/wt-env.sh && docker compose up -d db
uv run alembic upgrade head && uv run alembic current        # 0002 (head)
export TEST_DATABASE_URL="postgresql+psycopg://rioaltura:rioaltura@localhost:${DB_PORT}/rioaltura"
DATABASE_URL="$TEST_DATABASE_URL" uv run pytest -q backend/tests/test_alturas_postgres.py

# Backfill real (≈ 13 ventanas de 90 días, ~1 min) y sanidad
uv run python -m jobs.ina backfill --desde 2023-10-01
uv run python -m jobs.ina backfill --desde 2024-05-01 --hasta 2024-05-31   # inserted 0
uv run python - <<'EOF'
from sqlalchemy import text
from app.repositories.db import get_engine
with get_engine().connect() as c:
    print(c.execute(text("""
        SELECT count(*), count(DISTINCT date(fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires')),
               min(fecha_hora), max(fecha_hora) FROM alturas WHERE fuente = 'ina'""")).one())
    print(c.execute(text("""
        SELECT date(fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires') d, round(avg(altura_m)::numeric, 2)
        FROM alturas WHERE fuente = 'ina' GROUP BY d ORDER BY 2 DESC, d LIMIT 3""")).all())
EOF

# Job horario dos veces (segunda corrida: inserted 0)
uv run python -c "from jobs.alturas import job_actualizar_alturas; job_actualizar_alturas()"

# API
uv run uvicorn app.main:app --app-dir backend --port "$API_PORT" &
curl -s "localhost:$API_PORT/alturas/ultima"
curl -s "localhost:$API_PORT/alturas?desde=2024-05-10&hasta=2024-05-16"

# Tests contra servicios reales (no corren en CI)
uv run pytest -q -m live worker/tests/test_live.py

# Frontend (no cambia en esta spec)
pnpm -C frontend build && pnpm -C frontend test
```

## Hallazgos

- **Lectura aislada de 9,83 m el 2023-11-07T03:00Z** en la serie 80 del INA, entre vecinas de 8,43 y 8,41 m. Es el máximo crudo de la tabla, pero claramente un dato anómalo; el promedio diario de ese día queda en 8,60 m y el máximo diario sigue siendo 9,06 m el 2024-05-14. No se filtró (CLAUDE.md §9: no borrar histórico). Conviene decidir en una spec futura si se marcan outliers o se limpian al recalibrar.
- **Cadencia irregular del INA**: un dato diario a las 03:00Z en períodos tranquilos, varios por día durante crecidas (96 observaciones en mayo 2024). No asumir una fila por día.
- **Latencia del INA**: el dato de las 03:00Z suele publicarse muchas horas después (se vio un `timeupdate` 35 h posterior). En la práctica el job horario va a caer en Prefectura con frecuencia por la regla "sin lectura en 24 h"; es el comportamiento pedido y los datos quedan separados por `fuente`.
- **Prefectura** publica dos lecturas por día (00:00 y 12:00 hora local) sin zona horaria en la página; se asume `America/Argentina/Buenos_Aires`. El HTML pesa ~295 KB; la fixture guardada es un recorte de 6 KB con la tabla.
- **OpenAPI 3.1**: el contrato usa `type: [number, "null"]` para `tendencia_24h_m`; y el `detail` de los 422 de validación de FastAPI es una lista, no un string, por eso `ErrorResponse.detail` acepta ambos.
- **Para la spec 003**: `backend/alembic/env.py` ahora importa `Base` desde `app.models`. Los modelos nuevos deben registrarse ahí (importarlos en `app/models/__init__.py`) y la migración siguiente debe partir de `0002`.
- **Alembic y `caplog`**: al correr `alembic upgrade` desde un test (el de Postgres real), `fileConfig(alembic.ini)` deshabilitaba los loggers ya creados y los tests de logging del worker que corrían después no capturaban nada. Solo se veía con `TEST_DATABASE_URL` seteado (CI). Corregido con `disable_existing_loggers=False` en `backend/alembic/env.py`.
- **CI del frontend ya fallaba en `main`** desde el PR #1: `pnpm/action-setup@v4` exige la versión de pnpm (`packageManager` en `frontend/package.json` o `version` en el action). No se tocó porque está fuera de esta spec y de lo autorizado; conviene un `chore/ci-pnpm-version` aparte.
- **Warnings de pytest** (`StarletteDeprecationWarning` sobre httpx/httpx2 y `anyio.abc.BlockingPortal`): vienen de starlette/fastapi, no de este código. Se resuelven al actualizar esas librerías.

## Resumen final

Tabla `alturas` con migración 0002, clientes INA y Prefectura con reintentos y fixtures grabadas, job horario con fallback logueado y backfill por ventanas de 90 días.
Endpoints `/api/alturas/ultima` (tendencia en ventana 20–36 h y estado por umbrales) y `/api/alturas?desde&hasta` (promedio diario en hora local), contrato OpenAPI actualizado.
Backfill real: 1.848 filas, 1.073 días, máximo diario 9,06 m el 2024-05-14; segunda corrida inserta 0.
ruff, pytest (86), test contra Postgres real y pnpm build/test en verde; CI ahora levanta `postgres:16`.
Hallazgo: lectura anómala de 9,83 m el 2023-11-07 en el INA, no filtrada.
