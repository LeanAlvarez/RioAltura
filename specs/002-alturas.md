# 002 — Alturas reales del puerto (INA + Prefectura)

- **Estado:** lista
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

## Archivos compartidos que puede tocar

- `backend/app/config/dominio.py`: solo agregar constantes de serie INA y puerto Prefectura si faltan.
- `contracts/openapi.yaml`: solo la sección de `/api/alturas*`.
- `backend/app/main.py`: solo para registrar el router.
- Nueva migración de Alembic (sin editar las existentes).

## Criterios de aceptación

- [ ] Backfill carga ≥ 1.000 días desde 2023-10-01 (verificado con `@pytest.mark.live` o a mano, documentado).
- [ ] El máximo del período es 9,06 m el 2024-05-14 (chequeo de sanidad contra lo visto en el notebook).
- [ ] El job horario no duplica filas al correr dos veces.
- [ ] Si el INA falla (fixture de error), se usa Prefectura y queda logueado.
- [ ] `tendencia_24h_m` y `estado` testeados en los bordes (6,79 / 6,80 / 7,10 / 7,90).
- [ ] `ruff`, `pytest`, `pnpm build` y `pnpm test` pasan.

## Cómo verificar

(Completar.)

## Hallazgos

(Completar.)

## Resumen final

(Completar, máximo 5 líneas.)
