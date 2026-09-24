# Río Uruguay at Colón

[Español](README.md) · **English** · [Português](README.pt.md)

Public web app showing the state of the Uruguay River as it passes **Colón, Entre Ríos,
Argentina**: how high the river is, whether that is dangerous, what is coming over the next
few days, and which parts of the city flood at each level.

**Live: [rio.miraisoftware.net](https://rio.miraisoftware.net)**

It is built for two very different audiences: **neighbours on a 360 px phone over a poor
connection**, and **Defensa Civil** (the local civil protection service). That explains most
of the design decisions — from the map loading its layers on demand, to the first screen
answering a single question: *should I be worried?*

The app's interface is in Río de la Plata Spanish, since that is the language of the people
it serves. This document is in English so the project can be read, reused and adapted
elsewhere.

## What it does

- **Current port gauge reading**, with the time of the measurement and which source it came
  from. A chain of three official sources: INA → Prefectura Naval → CARU.
- **7-day forecast** from Google Flood Forecasting, converted to metres at the port and always
  shown **as a range**, never as an exact number.
- **Flood zone map**, with 43 layers derived from the Copernicus GLO-30 DEM and a control to
  see what happens at each river level.
- **"Mi casa"** ("my house"): mark a point on the map and it tells you at what river level it
  gets wet. The calculation runs in the browser — **the coordinate never leaves the device**.
- **Telegram alerts**: a public channel for level changes, plus personal alerts when the river
  crosses a height each person chooses.
- **Salto Grande dam data**: discharge, reservoir level and rainfall over the upper basin.

## How it is put together

```
worker (cron) ─► Postgres ─► FastAPI ─► Web (static)
    │                                     ▲
    └─ Telegram              GeoJSON layers served by nginx
```

- `worker/` — fetches from the external sources. **It is the only component that sees the
  credentials.**
- `backend/` — FastAPI. Reads from Postgres only; it **never calls an external API** while
  serving a request.
- `frontend/` — Vite + TypeScript + Leaflet + uPlot.
- `geoprocessing/` — offline scripts that generate the map layers.
- `specs/` — one spec per change, with its verification. This is where the *why* lives.

Domain rules (thresholds, the discharge→height curve, the gauge zero) live in
[`CLAUDE.md`](CLAUDE.md) and `backend/app/config/dominio.py`. **They are not changed without a
spec**: they come from verified sources or our own calibration, and some are still
provisional.

---

## Credentials: this part is on you

> [!IMPORTANT]
> This repository **ships no keys**, and cannot run fully without them. Obtaining and managing
> them is the responsibility of whoever deploys their own copy.

### Google Flood Forecasting (required for the forecast)

The forecast comes from Google's **Flood Forecasting API** — the system behind
[Flood Hub](https://sites.research.google/floods/). You need your own key:

1. Request access to the API and enable it in a Google Cloud project.
2. Create a key and set it as `FLOODS_API_KEY`.

Without that key the worker logs the failure and **the rest of the app keeps working**: the
real gauge reading is still shown, along with a notice that the forecast is unavailable. That
degradation is deliberate, not an accident.

Google's data is published under **CC BY 4.0** and attribution is mandatory: it is already in
the app's footer, and if you modify the app you must keep it.

### Telegram (optional)

For the channel and the alerts you need a bot from [@BotFather](https://t.me/BotFather) and
its token in `TELEGRAM_BOT_TOKEN`. Without a token, that feature simply stays off.

### Rules worth not breaking

- **`FLOODS_API_KEY` and `TELEGRAM_BOT_TOKEN` live in the worker only.** Never in the
  frontend, in logs, in fixtures, or in a commit.
- **Tests never call the real APIs**: they use fixtures recorded under `tests/fixtures/`.
- If you ever paste a token into a chat or an issue, **rotate it**.

---

## Getting it and changing it

Requirements: **Docker**, [`uv`](https://docs.astral.sh/uv/), **Node 20** and `pnpm`
(`corepack enable pnpm`). `uv` installs Python 3.12 for you.

```bash
git clone https://github.com/LeanAlvarez/RioAltura.git
cd RioAltura

scripts/wt-env.sh          # generates .env.local with unique ports
```

Open `.env.local` and fill in at least `FLOODS_API_KEY`. Then:

```bash
docker compose up -d --build     # db + api + worker + web
uv run alembic upgrade head      # creates the tables

curl "http://localhost:$(rg '^API_PORT=' .env.local | cut -d= -f2)/health"
# {"status":"ok","db":"ok"}
```

### Load the historical data: this is not optional

A fresh database starts empty and the worker only collects data **going forward**. Skip this
step and the app compares its forecast against almost nothing, reporting an average error
**better than the real one** — this actually happened: with 7 days of samples it claimed
0.38 m; with 91, it was 0.50 m.

In a flood warning app, an inflated confidence number is precisely the harm the app exists to
prevent.

```bash
uv run --directory worker python -m jobs.ina backfill --desde 2023-01-01
uv run --directory worker python -m jobs.google backfill --desde 2024-07-08
```

### Developing without containers

With the compose database running:

```bash
uv sync
uv run uvicorn app.main:app --app-dir backend --reload --port "$(rg '^API_PORT=' .env.local | cut -d= -f2)"
uv run --directory worker python -m jobs
pnpm -C frontend install && pnpm -C frontend dev
```

### Checks before opening a PR

```bash
uv run ruff check . && uv run ruff format --check .
uv run pytest
pnpm -C frontend build && pnpm -C frontend test
```

> `ruff format` also reaches ` ```python ` blocks inside the `.md` files under `specs/`.
> Running only `ruff check` is not enough.

### Deploying

[`DEPLOY.md`](DEPLOY.md) has the full procedure for Dokploy on your own VPS: environment
variables separating secrets from configuration, domain with HTTPS, and the initial backfill.

---

## How we work

One task = one spec = one branch = one PR. Each spec in [`specs/`](specs/) carries its
acceptance criteria, how to verify them, and the findings along the way — including the
mistakes, which are usually the most useful part to read.

One rule runs through the whole project, and it is worth understanding before touching code:

> **A forecast is never shown looking like a measurement.**

From it follow the range instead of an exact number, series colours validated so they cannot
be confused with each other, the quarantine of implausible readings, and the date shown next
to every figure.

## Data and attribution

- **Google Flood Forecasting** — CC BY 4.0
- **Copernicus DEM GLO-30** — flood layers
- **INA** (`alerta.ina.gob.ar`), **Prefectura Naval Argentina**, **CARU** — port gauge readings
- **CTM Salto Grande** — basin discharge and rainfall
- **OpenStreetMap / CARTO** and **Esri** — base maps

The app is **indicative and does not replace Prefectura, CARU or Defensa Civil**. That notice
is mandatory on every screen showing a forecast or the map: if you modify the app, keep it.

## Who built it

Built by **[Mirai Software](https://miraisoftware.net)**, in and for the city of Colón, Entre
Ríos, Argentina.
