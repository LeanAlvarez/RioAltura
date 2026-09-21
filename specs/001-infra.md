# 001 — Infraestructura y esqueleto del repo

- **Estado:** en revisión
- **Rama:** feat/001-infra
- **Depende de:** nada
- **Puede ir en paralelo con:** nada (todas las demás dependen de esta)

## Objetivo

Dejar el repo listo para que varios agentes trabajen en paralelo en worktrees distintos sin pisarse: estructura de carpetas, servicios mínimos levantando, puertos y base de datos aislados por worktree, y CI.

## Alcance

1. **Estructura de carpetas** exactamente como la sección 3 del [`CLAUDE.md`](http://CLAUDE.md).
2. **Python con** `uv` **workspace** en la raíz, con dos miembros: `backend` y `worker`.
   - `worker` depende de `backend` como paquete del workspace, para importar `app.config.dominio`.
   - Python 3.12. Dependencias permitidas: `fastapi`, `uvicorn[standard]`, `sqlalchemy>=2`, `alembic`, `psycopg[binary]`, `pydantic>=2`, `pydantic-settings`, `httpx`, `apscheduler`. Dev: `pytest`, `ruff`.
3. **Backend FastAPI mínimo**:
   - `GET /health` → `{"status": "ok", "db": "ok" | "error"}` (chequea conexión a Postgres).
   - Configuración con `pydantic-settings` leyendo variables de entorno.
4. `backend/app/config/[dominio.py](http://dominio.py)` con todas las constantes de la tabla de la sección 5 del [`CLAUDE.md`](http://CLAUDE.md), con su fuente en comentario, más una función `cota_agua(altura_puerto: float) -> float` y `altura_estimada(caudal_m3s: float) -> float` (curva caudal→altura).
5. **Alembic** inicializado en `backend/` con una migración base vacía.
6. **Worker mínimo**: proceso con APScheduler que arranca, registra un job `heartbeat` cada minuto (solo loguea) y termina limpio con SIGTERM. Sin jobs reales.
7. **Frontend mínimo**: Vite + TypeScript estricto + Leaflet. Una página que muestra un mapa centrado en Colón (`-32.215, -58.145`, zoom 14) y el resultado de `GET /health`. La URL de la API sale de variable de entorno.
8. `contracts/openapi.yaml` con el endpoint `/health`.
9. `scripts/[wt-env.sh](http://wt-env.sh)`:
   - Genera `.env.local` en la raíz del worktree.
   - Calcula un offset a partir del nombre de la carpeta del worktree (hash → 0..99), así cada worktree tiene puertos distintos y estables.
   - Puertos: `API_PORT=8000+off`, `WEB_PORT=5173+off`, `DB_PORT=5432+off`. Si un puerto está ocupado (`lsof`), incrementa el offset hasta encontrar uno libre.
   - Define `COMPOSE_PROJECT_NAME=rioaltura-<nombre-worktree>`.
   - No pisa variables que ya existan en `.env.local` salvo los puertos y el nombre del proyecto.
   - Funciona en macOS (bash 3.2 / zsh) y en Linux.
10. `docker-compose.yml` con `db` (postgres:16), `api`, `worker`, `web`, todos leyendo `.env.local`. Volumen de datos por proyecto de compose.
11. `.env.example` con todas las variables (incluida `FLOODS_API_KEY=` vacía) y `.gitignore` que excluya `.env*` (salvo `.env.example`), `geoprocessing/data/`, `node_modules/`, `.venv/`.
12. **CI en GitHub Actions**: en cada PR corre `ruff check`, `ruff format --check`, `pytest`, `pnpm build` y `pnpm test`.
13. [**README.md**](http://README.md) breve: qué es y cómo levantar el entorno en un worktree (3-5 comandos).

## Fuera de alcance

- Clientes de Google, INA o Prefectura.
- Modelos de datos reales y tablas de negocio.
- UI más allá del mapa + health.
- Geoprocessing y capas de inundación.
- Deploy en Dokploy.

## Diseño / decisiones

- Frontend con `pnpm`. Nada de frameworks de UI (React, etc.) en esta spec.
- Logs en formato texto simple, nivel por variable de entorno.
- La API key de Google no se usa todavía, pero ya queda declarada solo en el servicio `worker` del compose.

## Archivos compartidos que puede tocar

Todos (esta spec los crea).

## Criterios de aceptación

- \[x\] Estructura de carpetas igual a la sección 3 del [`CLAUDE.md`](http://CLAUDE.md).
- \[x\] `scripts/[wt-env.sh](http://wt-env.sh)` genera puertos distintos en dos carpetas con nombres distintos, e iguales si se corre dos veces en la misma. Tiene un test (bats o un test de pytest que lo invoque).
- \[x\] `docker compose up -d` levanta los 4 servicios y `GET /health` devuelve `{"status":"ok","db":"ok"}`.
- \[x\] Dos worktrees pueden tener el compose levantado a la vez sin conflicto de puertos ni de base.
- \[x\] `uv run alembic upgrade head` corre sin errores.
- \[x\] Tests de [`dominio.py`](http://dominio.py): `cota_agua(4.44) == 4.18`; `altura_estimada(12836)` da 7,1 ± 0,05; las constantes coinciden con la tabla del [`CLAUDE.md`](http://CLAUDE.md).
- \[x\] El worker arranca, loguea el heartbeat y se detiene limpio.
- \[x\] La página del frontend muestra el mapa de Colón y el estado de la API.
- \[ \] CI configurado y en verde.
- \[x\] `ruff`, `pytest`, `pnpm build` y `pnpm test` pasan localmente.

## Cómo verificar

Todo desde la raíz del worktree (Docker corriendo, `uv`, Node 20 y `pnpm` vía `corepack enable pnpm`).

```bash
# 1. Lint + tests Python (backend, worker y scripts/wt-env.sh): 23 tests
uv sync
uv run ruff check . && uv run ruff format --check .
uv run pytest

# 2. Frontend: typecheck + build + 7 tests de vitest
pnpm -C frontend install && pnpm -C frontend build && pnpm -C frontend test

# 3. Puertos por worktree (estables y distintos por carpeta)
scripts/wt-env.sh            # imprime offset y puertos; deja .env.local y .env -> .env.local
scripts/wt-env.sh            # segunda corrida: mismos puertos
WT_ENV_ROOT=/tmp/otro-wt scripts/wt-env.sh   # otra carpeta: otros puertos (crear la carpeta antes)

# 4. Compose completo + health + migración base
docker compose up -d --build
docker compose ps
API_PORT=$(grep '^API_PORT=' .env.local | cut -d= -f2); WEB_PORT=$(grep '^WEB_PORT=' .env.local | cut -d= -f2)
curl "http://localhost:$API_PORT/health"          # {"status":"ok","db":"ok"}
curl "http://localhost:$WEB_PORT/api/health"      # lo mismo, vía nginx del servicio web
open "http://localhost:$WEB_PORT"                 # mapa de Colón + "API en línea" con fecha
uv run alembic upgrade head && uv run alembic current   # 0001 (head)

# 5. Worker: heartbeat y parada limpia
docker compose logs worker | grep heartbeat
docker compose stop worker && docker inspect -f '{{.State.ExitCode}}' "$(docker compose ps -aq worker)"   # 0

# 6. Dos worktrees a la vez: repetir 3 y 4 en otro worktree; los COMPOSE_PROJECT_NAME,
#    puertos y volúmenes (rioaltura-<nombre>_pgdata) no chocan.
```

## Hallazgos

- **CI "en verde" queda pendiente de abrir el PR**: el workflow está en `.github/workflows/ci.yml` y replica los comandos locales, pero solo corre al pushear. Verificar en el primer PR.
- **`alembic.ini` vive en la raíz** (apunta a `backend/alembic/`) para que `uv run alembic upgrade head` funcione desde la raíz como dice el `CLAUDE.md`. Las migraciones siguen en `backend/alembic/versions/`.
- **`docker compose` interpola `${VAR}` desde `.env`, no desde `.env.local`**: `wt-env.sh` deja un symlink `.env -> .env.local`. Si alguien borra el symlink, compose cae a los puertos por defecto; volver a correr el script.
- **`.gitignore` incluye también `odd/` y `.atl/`** (artefactos locales de las herramientas de agentes), además de lo que pedía la spec.
- **Entorno local (no del repo)**: en esta máquina `docker build/pull` se colgaba en el credential helper (`credsStore: desktop`); se resolvió usando un `DOCKER_CONFIG` temporal sin `credsStore`. Puede afectar a otros agentes en la misma máquina.
- **Node local es 24, CI usa 20** como pide el `CLAUDE.md`. Vite 7 requiere Node ≥ 20.19; `setup-node@v4` con `20` cumple.
- **Warnings de terceros en pytest**: Starlette avisa que `httpx` con `TestClient` está deprecado a favor de `httpx2`, y `anyio` deprecó un alias. No afectan; conviene revisarlo cuando se actualicen dependencias.
- **CORS abierto (`*`, solo GET)** en la API: es pública y de solo lectura, y permite que `VITE_API_URL` apunte a otro origen. Revisar si en algún momento se agregan endpoints no públicos.

## Resumen final

Repo listo para trabajo paralelo: `uv` workspace (backend + worker), FastAPI con `/health` y `dominio.py` testeado, worker APScheduler con heartbeat y SIGTERM limpio, frontend Vite+TS+Leaflet con mapa de Colón y estado de la API, `wt-env.sh` con puertos estables por worktree (+ tests), compose de 4 servicios con volumen por proyecto, OpenAPI, CI y README.
Verificado local: ruff, 23 tests pytest, build + 7 tests vitest, compose arriba con `/health` OK directo y vía nginx, alembic `0001 (head)`, y dos worktrees corriendo a la vez sin conflictos.
Pendiente: abrir el PR para ver el CI en verde.
