# Río Uruguay en Colón

**Español** · [English](README.en.md) · [Português](README.pt.md)

App web pública que muestra el estado del río Uruguay a su paso por **Colón, Entre Ríos**:
a cuánto está el río, si eso es peligroso, qué viene en los próximos días, y qué zonas de
la ciudad se inundan a cada altura.

**En producción: [rio.miraisoftware.net](https://rio.miraisoftware.net)**

Está pensada para dos públicos muy distintos: **vecinos con un celular de 360 px y conexión
mala**, y **Defensa Civil**. Eso explica casi todas las decisiones de diseño — desde el mapa
que carga sus capas bajo demanda hasta el hecho de que la primera pantalla responda una sola
pregunta: *¿me tengo que preocupar?*

## Qué hace

- **Altura actual del puerto**, con la hora de la medición y de qué fuente salió.
  Cadena de tres fuentes oficiales: INA → Prefectura Naval → CARU.
- **Pronóstico a 7 días** desde Google Flood Forecasting, convertido a metros en el puerto y
  mostrado **siempre como rango**, nunca como un número exacto.
- **Mapa de zonas inundables**, con 43 capas calculadas desde el DEM Copernicus GLO-30 y un
  control para ver qué pasa a cada altura.
- **"Mi casa"**: se marca un punto en el mapa y dice a qué altura del río se moja. El cálculo
  corre en el navegador: **la coordenada nunca sale del dispositivo**.
- **Alertas por Telegram**: un canal público con los cambios de nivel, y avisos personales
  cuando el río cruza una altura que cada persona elige.
- **Datos de Salto Grande**: caudal evacuado, nivel del embalse y lluvia en la cuenca alta.

## Cómo está armado

```
worker (cron) ─► Postgres ─► API FastAPI ─► Web (estática)
    │                                          ▲
    └─ Telegram                  capas GeoJSON servidas por nginx
```

- `worker/` — trae los datos de las fuentes externas. **Es el único que ve las credenciales.**
- `backend/` — FastAPI. Sólo lee de Postgres; **nunca llama a una API externa** cuando alguien
  abre la página.
- `frontend/` — Vite + TypeScript + Leaflet + uPlot.
- `geoprocessing/` — scripts offline que generan las capas del mapa.
- `specs/` — una spec por cambio, con su verificación. Es donde está escrito el *por qué*.

Las reglas de dominio (umbrales, curva caudal→altura, cero del hidrómetro) viven en
[`CLAUDE.md`](CLAUDE.md) y en `backend/app/config/dominio.py`. **No se cambian sin una spec**:
salen de fuentes verificadas o de calibración propia, y algunas todavía son provisorias.

---

## Credenciales: esto lo tenés que gestionar vos

> [!IMPORTANT]
> El repositorio **no incluye ninguna clave**, y no puede funcionar completo sin ellas.
> Conseguirlas y administrarlas es responsabilidad de quien despliegue su propia copia.

### Google Flood Forecasting (obligatoria para el pronóstico)

El pronóstico sale de la **Flood Forecasting API** de Google (el mismo sistema detrás de
[Flood Hub](https://sites.research.google/floods/)). Necesitás tu propia clave:

1. Pedir acceso a la API y habilitarla en un proyecto de Google Cloud.
2. Generar una clave y ponerla en `FLOODS_API_KEY`.

Sin esa clave, el worker registra el fallo y **el resto de la app sigue andando**: se ve la
altura real y un aviso de que el pronóstico no está disponible. Es degradación a propósito,
no un accidente.

Los datos de Google se publican bajo **CC BY 4.0** y la atribución es obligatoria: ya está en
el pie de la app, y si la modificás tenés que mantenerla.

### Telegram (opcional)

Si querés el canal y los avisos, hacen falta un bot de [@BotFather](https://t.me/BotFather) y
su token en `TELEGRAM_BOT_TOKEN`. Sin token, esa parte simplemente no se activa.

### Reglas que conviene no romper

- **`FLOODS_API_KEY` y `TELEGRAM_BOT_TOKEN` viven sólo en el worker.** Nunca en el frontend,
  ni en logs, ni en fixtures, ni en un commit.
- **Los tests nunca llaman a las APIs reales**: usan fixtures grabadas en `tests/fixtures/`.
- Si alguna vez pegás un token en un chat o en un issue, **rotalo**.

---

## Bajarlo y modificarlo

Requisitos: **Docker**, [`uv`](https://docs.astral.sh/uv/), **Node 20** y `pnpm`
(`corepack enable pnpm`). Python 3.12 lo instala `uv` solo.

```bash
git clone https://github.com/LeanAlvarez/RioAltura.git
cd RioAltura

scripts/wt-env.sh          # genera .env.local con puertos únicos
```

Abrí `.env.local` y completá al menos `FLOODS_API_KEY`. Después:

```bash
docker compose up -d --build     # db + api + worker + web
uv run alembic upgrade head      # crea las tablas

curl "http://localhost:$(rg '^API_PORT=' .env.local | cut -d= -f2)/health"
# {"status":"ok","db":"ok"}
```

### Cargá los datos históricos: no es opcional

Una base nueva arranca vacía y el worker sólo junta datos **hacia adelante**. Sin este paso,
la app compara el pronóstico contra casi nada y muestra **un error promedio mejor que el
real** — pasó de verdad: con 7 días de muestra decía que erraba 0,38 m; con 91, 0,50 m.

En una app de alerta de inundación, un número de confianza inflado es exactamente el daño que
esta app existe para evitar.

```bash
uv run --directory worker python -m jobs.ina backfill --desde 2023-01-01
uv run --directory worker python -m jobs.google backfill --desde 2024-07-08
```

### Desarrollar sin contenedores

Con la base del compose levantada:

```bash
uv sync
uv run uvicorn app.main:app --app-dir backend --reload --port "$(rg '^API_PORT=' .env.local | cut -d= -f2)"
uv run --directory worker python -m jobs
pnpm -C frontend install && pnpm -C frontend dev
```

### Verificar antes de abrir un PR

```bash
uv run ruff check . && uv run ruff format --check .
uv run pytest
pnpm -C frontend build && pnpm -C frontend test
```

> `ruff format` también alcanza los bloques ` ```python ` dentro de los `.md` de `specs/`.
> Correr sólo `ruff check` no alcanza.

### Desplegar

[`DEPLOY.md`](DEPLOY.md) tiene el procedimiento completo para Dokploy sobre un VPS propio:
variables separando secretos de configuración, dominio con HTTPS, y el backfill inicial.

---

## Cómo trabajamos

Una tarea = una spec = una rama = un PR. Cada spec en [`specs/`](specs/) lleva sus criterios
de aceptación, cómo verificarlos y los hallazgos del camino — incluidos los errores, que
suelen ser lo más útil de leer.

Hay una regla que atraviesa todo el proyecto y conviene entenderla antes de tocar código:

> **Un pronóstico nunca se muestra con cara de medición.**

De ahí salen el rango en vez del número exacto, los colores de las series validados para que
no se confundan entre sí, la cuarentena de lecturas implausibles, y la fecha visible al lado
de cada dato.

## Datos y atribución

- **Google Flood Forecasting** — CC BY 4.0
- **Copernicus DEM GLO-30** — capas de inundación
- **INA** (`alerta.ina.gob.ar`), **Prefectura Naval Argentina**, **CARU** — alturas del puerto
- **CTM Salto Grande** — caudales y lluvia de cuenca
- **OpenStreetMap / CARTO** y **Esri** — mapas base

La app es **orientativa y no reemplaza a Prefectura, CARU ni a Defensa Civil**. Ese aviso es
obligatorio en toda pantalla que muestre pronóstico o mapa: si modificás la app, mantenelo.

## Quién la hizo

Desarrollada por **[Mirai Software](https://miraisoftware.net)**, en y para la ciudad de
Colón, Entre Ríos.
