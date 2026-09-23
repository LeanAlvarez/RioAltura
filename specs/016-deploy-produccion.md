# 016 — Deploy a producción en Dokploy

- **Estado:** lista
- **Rama:** feat/016-deploy-produccion
- **Depende de:** nada (toca infraestructura, no dominio)
- **Puede ir en paralelo con:** cualquier spec de producto

## Objetivo

Que la app se pueda poner en línea en un VPS propio con Dokploy, en un subdominio con HTTPS, y que
**lo que ve un vecino de Colón en su celular sea lo que vimos en desarrollo** — con los mismos datos
y sin pagar cinco veces el peso en su plan de datos.

## Estado actual

Auditado sobre el repo, no supuesto. **El 80% ya está**: `docker-compose.yml` con los cuatro
servicios (`db`, `api`, `worker`, `web`), `backend/Dockerfile` y `worker/Dockerfile` (workspace de
`uv`, contexto la raíz), `frontend/Dockerfile` (multi-stage a `nginx:1.27-alpine`),
`frontend/nginx.conf.template` con el proxy `/api/`, y las 44 capas GeoJSON commiteadas.

Falta lo que separa "corre en mi máquina" de "sirve a un pueblo".

## Alcance

### D1 — Las migraciones tienen que correr solas

`rg alembic` sobre los tres Dockerfiles y el compose devuelve **un solo match**: `COPY alembic.ini`.
El `CMD` de la API es `uvicorn` pelado. Contra una base de producción recién creada eso es **sin
tablas, API muerta al primer request**.

La API arranca con un entrypoint que corre `alembic upgrade head` y recién después levanta uvicorn.
Es idempotente: en cada redeploy no hace nada si no hay migraciones nuevas.

**Sólo la API migra, nunca el worker.** Si los dos lo hicieran, dos contenedores arrancando a la vez
compiten por la misma tabla `alembic_version`. El worker espera a que las tablas existan.

### D2 — Comprimir, que es la diferencia entre que el mapa cargue y que no

Verificado corriendo `nginx:1.27-alpine`:

```
/etc/nginx/nginx.conf:29    #gzip  on;          ← comentado, gzip APAGADO
/etc/nginx/mime.types       no tiene geojson    ← sólo "application/json json"
```

Las capas pesan **18 MB en disco y ~3,5 MB comprimidas**. Sin gzip, un vecino en 3G se baja las 18.
`CLAUDE.md` §7 dice, textual, que se diseña para 360 px y conexión 3G: servir 5 veces el peso
necesario no es un detalle de performance, es incumplir el requisito central del proyecto.

Se agrega a la plantilla de nginx: `gzip on`, el tipo `application/geo+json` para `.geojson`, y
`gzip_types` que lo incluya. Más cacheo largo de las capas, que no cambian nunca sin un redeploy.

**El criterio de aceptación no es "configuramos gzip": es medir los bytes que viajan de verdad.**

### D3 — Que la base no quede abierta a internet

El compose publica `"${DB_PORT:-5432}:5432"` en `db`. En un VPS eso expone Postgres, y acá está lo
que suele sorprender: **Docker escribe sus propias reglas de iptables y se saltea `ufw`**. El
firewall cerrado no alcanza.

Se agrega un `docker-compose.prod.yml` donde **ningún servicio publica puertos salvo `web`**, que es
a quien Traefik (el proxy de Dokploy) le manda el tráfico del subdominio. `api` y `db` se hablan por
la red interna del compose y no existen desde afuera.

El compose de desarrollo queda **igual**: ahí publicar puertos es lo que queremos.

### D4 — Healthchecks en `api` y `web`

Hoy sólo `db` tiene uno. Sin healthcheck, Dokploy no sabe si la API está viva ni cuándo reiniciarla,
y `web` puede quedar sirviendo contra una API caída sin que nadie se entere. `api` ya expone
`/health`, que además chequea la base.

### D5 — El backfill inicial, que ya nos mordió una vez

Una base de producción nueva arranca vacía. El scheduler sólo junta datos **hacia adelante**, así
que durante meses el gráfico de precisión compararía contra casi nada.

Eso no es hipotético: pasó hoy en desarrollo. Con 7 días de muestra la app decía que el pronóstico
**erraba 0,38 m**; con 91 días, **0,50 m**. Mostraba una precisión mejor que la real *porque no
tenía datos con qué compararse* — y en una app de alerta de inundación, un número de confianza
inflado es exactamente el tipo de daño que esta app existe para evitar.

Google sirve emisiones históricas desde 2024-07-08 (`CLAUDE.md` §5), así que el backfill es posible
el día uno. Queda **documentado como paso obligatorio del primer deploy**, con el comando exacto.

### D6 — Un documento de deploy que alcance para hacerlo sin adivinar

`DEPLOY.md`: los pasos en Dokploy, la checklist de variables separando **secretos** de
configuración, los comandos del primer arranque, y cómo verificar que quedó bien. Incluye el
subdominio y el `TELEGRAM_APP_URL`, que hoy está vacío y hace que los mensajes del canal salgan sin
link a la app.

## Fuera de alcance

- **No se cambian dominio, umbrales, curva ni textos de riesgo** (`CLAUDE.md` §5, §9).
- No se agregan servicios pagos, monitoreo de terceros ni analytics (§9).
- No se automatiza el deploy desde CI: Dokploy ya escucha el repo. Un pipeline propio es otra spec.
- No se toca el `docker-compose.yml` de desarrollo más que para los healthchecks (que sirven igual).
- No se migran backups: la política de respaldo de la base merece su propia spec, con su prueba de
  restauración. **Se anota como pendiente explícito, no se finge resuelto.**

## Diseño / decisiones

### Por qué un compose de producción aparte y no condicionales

Se evaluó meter todo en `docker-compose.yml` con variables. Se descarta: el archivo de desarrollo lo
leen agentes trabajando en paralelo en sus worktrees (`CLAUDE.md` §2), y un compose que hace dos
cosas distintas según variables es justamente donde se cuela el error que expone la base. Dos
archivos, cada uno evidente a la lectura.

### Por qué las migraciones en el entrypoint y no a mano

Un paso manual post-deploy se olvida, y se olvida el día que hay una crecida y estás apurado. El
entrypoint no se olvida nunca.

## Criterios de aceptación

- [x] Contra una base **vacía**, levantar el stack de producción crea las tablas solo y `/health`
      responde `{"status":"ok","db":"ok"}`. Verificado desde cero (volumen recién creado): 9 tablas y
      `alembic_version = 0006`.
- [x] Levantar el stack **dos veces seguidas** no falla: el entrypoint es idempotente. Verificado
      reiniciando la API sobre la base ya migrada.
- [x] Una capa GeoJSON se sirve comprimida, **medido en bytes transferidos**: `h_0300.geojson` pasa
      de **19.612 B a 3.652 B (5,4×)**, con `Content-Encoding: gzip` y
      `Content-Type: application/geo+json`. El JSON comprimido parsea y trae `features`.
- [x] En el stack de producción, **ni `db` ni `api` publican puertos al host**, verificado con
      `docker compose ps`. Con **control positivo**: se comprueba que `web` sí responde, porque si
      nada respondiera los dos chequeos anteriores pasarían por el motivo equivocado.
- [x] `api` y `web` tienen healthcheck y llegan a `healthy`. El de `api` chequea que `/health`
      devuelva `"db":"ok"`, así que "healthy" significa que puede responder de verdad.
- [x] `DEPLOY.md` lista todas las variables, separando **secretos** de configuración. Ningún
      secreto en el repo: verificado con `rg` sobre los archivos nuevos.
- [x] El `docker-compose.yml` de desarrollo sigue funcionando igual (sólo se le sumó el healthcheck
      de `api`, que es aditivo).
- [x] `ruff`, `pytest`, `pnpm build` y `pnpm test` pasan.

## Cómo verificar

```bash
cd /Users/leandroalvarez/orca/workspaces/RioAltura/deploy
bash scripts/verificar-deploy.sh     # 12 chequeos, desde una base VACÍA
```

El script levanta el stack de producción con **secretos de mentira** (no hace falta ninguna
credencial real para verificar infraestructura), espera a `healthy`, y mide. Salida real:

```
    api: healthy | db: healthy | web: healthy
✓ D1: contra una base VACÍA, /api/health responde ok (las tablas se crearon solas)
✓ D1: la base tiene las tablas del esquema (9 encontradas)
✓ D1: alembic dejó su versión registrada (0006)
✓ D3: la base NO publica ningún puerto al host
✓ D3: la API NO publica ningún puerto al host
✓ control positivo: la web SÍ responde en su puerto
    /capas/h_0300.geojson: 19612 B sin comprimir -> 3652 B comprimidos
    Content-Encoding: gzip | Content-Type: application/geo+json
✓ D2: reducción de al menos 4x (5x medido)
✓ D2: la capa comprimida llega íntegra (el JSON parsea y trae features)
✓ D1: reiniciar con la base ya migrada no rompe nada (entrypoint idempotente)
Todo OK
```

Repo, sin cambios de código de producto:

```bash
uv run ruff check . && uv run ruff format --check . && uv run pytest -q
pnpm -C frontend build && pnpm -C frontend test
```

## Hallazgos

- **El `nginx` de stock no comprime y no conoce `.geojson`.** Verificado corriendo la imagen:
  `nginx.conf` línea 29 trae `#gzip  on;` comentado, y `mime.types` sólo tiene
  `application/json json`. Sin los dos arreglos juntos, las capas se sirven como
  `application/octet-stream` sin comprimir: **18 MB en vez de 3,5 MB** para alguien en 3G. Un solo
  arreglo no alcanza — con `gzip on` pero sin el tipo MIME, `gzip_types` no matchea nada.
- **Publicar el puerto de Postgres en un VPS lo expone a internet aunque `ufw` esté cerrado**,
  porque Docker escribe sus propias reglas de iptables. Por eso el compose de producción no publica
  ningún puerto salvo el de `web`.
- El chequeo de "la base no publica puertos" lleva **control positivo** (que `web` sí responda): sin
  él pasaría en verde si el stack entero estuviera caído.
- **Fuera de alcance, anotado y no resuelto:** no hay política de backups de la base ni prueba de
  restauración. Es lo primero que haría falta después de esto, y merece su propia spec — un backup
  que nunca se restauró no es un backup.
- No se tocó `contracts/openapi.yaml` ni `backend/app/config/dominio.py`. Sin dependencias nuevas.

## Resumen final

La app se puede desplegar en Dokploy: la API migra sola al arrancar (antes nadie corría `alembic`, y
contra una base nueva eso era API muerta), nginx comprime las capas **5,4× medido en bytes que
viajan de verdad** (antes servía 18 MB a gente en 3G), y el compose de producción no publica ningún
puerto salvo el de la web — Postgres ya no queda expuesto a internet, cosa que `ufw` no evitaba.
`DEPLOY.md` tiene los pasos, las variables separando secretos, y el backfill inicial como paso
obligatorio, porque sin él la app muestra una precisión mejor que la real. 12 chequeos desde una
base vacía, todos verdes.
