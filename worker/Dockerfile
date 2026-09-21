# Build context: repo root (uv workspace). See docker-compose.yml.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /srv

COPY pyproject.toml uv.lock .python-version ./
COPY backend/pyproject.toml backend/
COPY worker/pyproject.toml worker/
RUN uv sync --frozen --no-dev --no-install-workspace

COPY backend/ backend/
COPY worker/ worker/
RUN uv sync --frozen --no-dev

ENV PATH="/srv/.venv/bin:$PATH"
# SIGTERM reaches python directly (exec form, no shell) for a clean shutdown.
CMD ["python", "-m", "jobs"]
