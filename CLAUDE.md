# CLAUDE.md — Río Uruguay en Colón (alertas y mapa de inundación)

Este archivo lo leen agentes de Claude Code que trabajan **en paralelo, cada uno en su propio git worktree** (orquestados con Orca). Leelo completo antes de tocar código.

## 1. Qué es el proyecto

App web pública que muestra el estado del río Uruguay en Colón (Entre Ríos, Argentina):
- Estado actual (altura real del puerto) y nivel de aviso.
- Pronóstico a 7 días (Google Flood Forecasting API) convertido a metros en el puerto, **como rango**.
- Mapa de la ciudad con las zonas que se inundan a cada altura (slider).
- "Mi casa": a qué altura del puerto se moja un punto del mapa.
- Alertas por Telegram cuando cambia el nivel de aviso.

Usuarios: vecinos de Colón (celular, conexión mala, poco conocimiento técnico) y Defensa Civil.

## 2. Flujo de trabajo (SDD + Orca)

- **Una tarea = una spec = un worktree = un PR.** Las specs están en `specs/NNN-slug.md` y las escribe el humano (Leandro).
- Trabajá **solo** en lo que pide tu spec. Si encontrás algo fuera de alcance, anotalo en la sección "Hallazgos" de la spec; no lo arregles.
- Si la spec es ambigua o contradice este archivo, **detenete y preguntá**. No inventes requisitos ni datos.
- Rama: `feat/NNN-slug`, `fix/NNN-slug` o `chore/NNN-slug`. Commits en formato Conventional Commits, en español.
- Al terminar, dejá en la spec:
  - Checklist de criterios de aceptación marcado.
  - Sección "Cómo verificar" con comandos concretos.
  - Un **resumen de máximo 5 líneas** al final de tu último mensaje (se lee en el celular vía Orca).

### Reglas por trabajar en paralelo

Hay otros agentes trabajando al mismo tiempo en otros worktrees. Para no pisarse:
- **Puertos y recursos propios por worktree.** Nunca uses puertos fijos: tomalos de `.env.local`, generado por `scripts/wt-env.sh` (si no existe, crealo como primera tarea de infraestructura). Usá `COMPOSE_PROJECT_NAME` derivado del nombre del worktree.
- **Base de datos propia por worktree** (la levanta el compose del worktree). Nunca apuntes a la base de otro worktree ni a producción.
- **Migraciones (Alembic):** nunca edites una migración existente. Si al rebasear hay múltiples heads, generá `alembic merge heads`, no borres migraciones ajenas.
- **Archivos compartidos sensibles**: `backend/app/config/dominio.py`, `contracts/openapi.yaml`, `docker-compose.yml`. Cambialos solo si tu spec lo pide explícitamente, y mencionalo en el PR.
- **Lockfiles** (`uv.lock`, `pnpm-lock.yaml`): no agregues dependencias sin que la spec lo permita. Si hace falta una, justificala en el PR.
- No hagas `git push --force` sobre ramas que no sean tuyas. No toques `main` directamente.

## 3. Arquitectura

```
worker (cron) ─► Postgres ─► API FastAPI ─► Web (PWA estática)
    │                                          ▲
    └─ Telegram                  capas estáticas (GeoJSON/raster)
```

- `worker/`: cada 6 h trae pronósticos de Google; cada 1 h trae alturas del INA (Prefectura como respaldo). Calcula el nivel de aviso y dispara alertas si cambia.
- `backend/`: FastAPI. Solo lee de Postgres y de archivos estáticos; **nunca llama a APIs externas en el request path**.
- `frontend/`: Vite + TypeScript + Leaflet, PWA mobile-first.
- `geoprocessing/`: scripts offline (DEM → capas de inundación por altura y raster "altura a la que se moja cada píxel"). Se corren a mano; sus salidas se versionan en `frontend/public/capas/`.
- Deploy: Dokploy en VPS propio, un `docker-compose.yml` con `db`, `api`, `worker`, `web`.

### Estructura

```
backend/        app/ (routers, services, repositories, config/), tests/
worker/         jobs/ (google.py, ina.py, prefectura.py, avisos.py), tests/
frontend/       src/, public/capas/
geoprocessing/  scripts y notebooks del DEM
contracts/      openapi.yaml (fuente de verdad del contrato API ↔ web)
specs/          specs SDD (NNN-slug.md) y _template.md
scripts/        wt-env.sh, utilidades de desarrollo
```

## 4. Stack y comandos

- Python 3.12, gestor `uv`, `ruff` (lint + format), `pytest`, SQLAlchemy 2 + Alembic, Pydantic v2.
- Node 20, `pnpm`, Vite, TypeScript estricto, Leaflet, Vitest.

```bash
scripts/wt-env.sh                 # genera .env.local con puertos únicos del worktree
docker compose up -d db           # base del worktree
uv run alembic upgrade head
uv run pytest                     # tests backend + worker
uv run ruff check . && uv run ruff format --check .
pnpm -C frontend dev
pnpm -C frontend build && pnpm -C frontend test
```

Idioma: **código, nombres y comentarios técnicos en inglés; textos de UI, specs, commits y docs en español rioplatense.** En la UI, los números llevan coma decimal (`7,10 m`, `12.836 m³/s`).

## 5. Reglas de dominio (NO cambiar sin spec)

Estos valores salen de fuentes verificadas o de calibración propia. Viven en `backend/app/config/dominio.py` (y se leen desde ahí; nunca hardcodeados en otro lado).

| Dato | Valor | Fuente / estado |
|---|---|---|
| Cero del hidrómetro del puerto de Colón | −0,26 m IGN | INA-CARU 2019 (GPS diferencial) |
| Cota del agua | `altura_puerto − 0,26` | Derivado |
| Evacuación en seco (municipio) | 6,80 m | Municipalidad |
| Alerta | 7,10 m | Prefectura |
| Evacuación | 7,90 m | Prefectura |
| Gauge Google Colón | `hybas_6121320620` | Río Uruguay, 12 km al sur |
| Gauge Google aguas arriba | `hybas_6120865460` | Zona Concordia / Salto Grande |
| Serie INA altura Colón | `80` (`var_id=2`) | API `alerta.ina.gob.ar/a5` |
| Puerto Prefectura Colón | `id=710` | Respaldo |
| Aviso "Atención" | pronóstico a 3 días ≥ 9.500 m³/s | Calibrado con 2 eventos: provisorio |
| Aviso "Alerta probable" | pronóstico a 3 días ≥ 11.000 m³/s | Calibrado con 2 eventos: provisorio |
| Curva caudal → altura | `h = 1.1926·ln(Q)² − 17.3863·ln(Q) + 64.8496` | R² 0,82; error p90 ≈ 1,1 m |

Reglas derivadas:
- **La altura estimada desde el pronóstico se muestra siempre como rango** (±1 m), nunca como un número exacto. Texto tipo: "entre 4,5 y 6,5 m".
- **No usar los umbrales de Google** (warning/danger/extreme = retornos de 2/5/20 años, ~16.000 m³/s) como alerta: en Colón llegan después de la evacuación.
- Unidades: la API de Google devuelve **caudal (m³/s)**; Prefectura e INA, **altura en metros sobre el cero local**. No mezclarlas sin convertir.
- De los pronósticos de Google, usar **solo la última emisión** (`issuedTime` máximo) para el estado vigente. Los `forecastRanges` con lead negativo o 0 son hindcast/nowcast.
- La API de Google tiene datos desde 2024-07-08 (no desde 2023-10-01 como dice su doc).
- Escenarios de referencia del mapa: 4,44 m (costanera, jul 2026), ~7,6 m (jun 2025), 9,06 m (may 2024, máximo diario INA).
- El DEM es Copernicus GLO-30 (superficie, incluye techos y árboles). El desfase de datum EGM2008 ↔ IGN no está resuelto: se absorbe calibrando `CERO_IGN` en `geoprocessing/`.

## 6. Seguridad y fuentes externas

- `FLOODS_API_KEY` vive **solo** en el worker (variable de entorno). Nunca en el frontend, en logs, en fixtures ni en commits.
- **Los tests nunca llaman a APIs reales.** Usá fixtures grabadas en `tests/fixtures/`. Los tests contra servicios reales llevan `@pytest.mark.live` y no corren en CI.
- Clientes HTTP con timeout, reintentos con backoff y `User-Agent` identificable. Respetá rate limits del INA y Prefectura (el scraping de Prefectura es último recurso).
- **Degradación elegante:** si Google falla, la app sigue mostrando la altura real del INA y un aviso de "pronóstico no disponible". Si el INA falla, probar Prefectura. Nunca mostrar datos viejos sin su fecha.
- Todo dato mostrado lleva **fecha/hora de actualización** visible.

## 7. UI y comunicación de riesgo

- Mobile-first: se diseña para 360 px y conexión 3G. Capas pesadas cargadas bajo demanda.
- **Disclaimer obligatorio y visible** en todas las pantallas con pronóstico o mapa: orientativo, no reemplaza a Prefectura, CARU ni Defensa Civil, con links a las fuentes oficiales.
- **Atribución obligatoria** en el pie: Google Flood Forecasting (CC BY 4.0), Copernicus DEM, INA, © OpenStreetMap / CARTO, Esri.
- Lenguaje simple: "El río sube", "Atención", "Alerta probable". Nada de "lead", "hybas" ni "m³/s" como dato principal (puede ir como detalle secundario).
- Colores de estado accesibles, sin depender solo del color: siempre acompañados de texto.

## 8. Definición de hecho

Un PR está listo cuando:
1. Cumple todos los criterios de aceptación de su spec.
2. `ruff`, `pytest`, `pnpm build` y `pnpm test` pasan.
3. Tiene tests para la lógica nueva (especialmente cálculos de dominio y parsers de fuentes externas).
4. Si cambia el contrato, `contracts/openapi.yaml` está actualizado y el frontend compila contra él.
5. La spec tiene "Cómo verificar" y el resumen final de ≤ 5 líneas.

## 9. Qué NO hacer

- No "mejorar" umbrales, curva, cero del hidrómetro ni textos de riesgo por tu cuenta.
- No agregar servicios pagos, trackers ni analytics de terceros.
- No borrar datos históricos de la base: son el insumo para recalibrar.
- No mostrar la altura pronosticada como número exacto.
- No commitear archivos grandes (DEM crudo, GeoTIFF sin recortar): van a `geoprocessing/data/` que está en `.gitignore`.
