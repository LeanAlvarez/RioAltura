# Build context: repo root (uv workspace). See docker-compose.yml.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /srv

COPY pyproject.toml uv.lock .python-version alembic.ini ./
COPY backend/pyproject.toml backend/
COPY worker/pyproject.toml worker/
RUN uv sync --frozen --no-dev --no-install-workspace

COPY backend/ backend/
COPY worker/ worker/
RUN uv sync --frozen --no-dev

COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENV PATH="/srv/.venv/bin:$PATH"
EXPOSE 8000
# D1 (spec 016): migra antes de servir. Ver el comentario del script.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
