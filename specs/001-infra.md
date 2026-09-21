# 001 — Infraestructura y esqueleto del repo

- **Estado:** lista
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

- \[ \] Estructura de carpetas igual a la sección 3 del [`CLAUDE.md`](http://CLAUDE.md).
- \[ \] `scripts/[wt-env.sh](http://wt-env.sh)` genera puertos distintos en dos carpetas con nombres distintos, e iguales si se corre dos veces en la misma. Tiene un test (bats o un test de pytest que lo invoque).
- \[ \] `docker compose up -d` levanta los 4 servicios y `GET /health` devuelve `{"status":"ok","db":"ok"}`.
- \[ \] Dos worktrees pueden tener el compose levantado a la vez sin conflicto de puertos ni de base.
- \[ \] `uv run alembic upgrade head` corre sin errores.
- \[ \] Tests de [`dominio.py`](http://dominio.py): `cota_agua(4.44) == 4.18`; `altura_estimada(12836)` da 7,1 ± 0,05; las constantes coinciden con la tabla del [`CLAUDE.md`](http://CLAUDE.md).
- \[ \] El worker arranca, loguea el heartbeat y se detiene limpio.
- \[ \] La página del frontend muestra el mapa de Colón y el estado de la API.
- \[ \] CI configurado y en verde.
- \[ \] `ruff`, `pytest`, `pnpm build` y `pnpm test` pasan localmente.

## Cómo verificar

(Completar.)

## Hallazgos

(Completar.)

## Resumen final

(Completar, máximo 5 líneas.)