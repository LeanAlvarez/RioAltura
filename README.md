# Río Uruguay en Colón

App web pública con el estado del río Uruguay en Colón (Entre Ríos): altura actual del
puerto, nivel de aviso, pronóstico a 7 días como rango, mapa de zonas inundables por
altura y alertas por Telegram. Pensada para vecinos con celular y conexión mala, y para
Defensa Civil.

Las reglas del proyecto (dominio, arquitectura, convenciones) están en [`CLAUDE.md`](CLAUDE.md).
Cada tarea es una spec en [`specs/`](specs/).

## Levantar el entorno en un worktree

Requisitos: Docker, `uv`, Node 20 y `pnpm` (`corepack enable pnpm`).

```bash
scripts/wt-env.sh                       # .env.local con puertos únicos para este worktree
docker compose up -d --build            # db + api + worker + web
uv run alembic upgrade head             # migraciones sobre la base del worktree
curl "http://localhost:$(grep API_PORT= .env.local | cut -d= -f2)/health"
```

Para desarrollar sin contenedores (con la base del compose levantada):

```bash
uv sync
uv run uvicorn app.main:app --app-dir backend --reload --port "$(grep API_PORT= .env.local | cut -d= -f2)"
uv run --directory worker python -m jobs
pnpm -C frontend install && pnpm -C frontend dev
```

## Verificar

```bash
uv run ruff check . && uv run ruff format --check .
uv run pytest
pnpm -C frontend build && pnpm -C frontend test
```
