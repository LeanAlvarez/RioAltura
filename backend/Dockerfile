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

ENV PATH="/srv/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
