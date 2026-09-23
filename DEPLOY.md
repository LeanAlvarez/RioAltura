# Deploy a producción (Dokploy + VPS propio)

Spec: `specs/016-deploy-produccion.md`.

La app se despliega con **`docker-compose.prod.yml`**, no con `docker-compose.yml` (ese es de
desarrollo y publica puertos que en un VPS no deben existir).

---

## 1. Antes de empezar

- Un VPS con Dokploy instalado.
- Un **subdominio** apuntando por DNS (registro `A`) a la IP del VPS. Por ejemplo
  `rio.tudominio.com`. Tiene que resolver **antes** de pedir el certificado, o Let's Encrypt falla.
- La API key de Google Flood Forecasting y, si vas a usar el canal, el token del bot de Telegram.

---

## 2. Crear la aplicación en Dokploy

1. **Create Application → Docker Compose**.
2. Provider: el repositorio de GitHub, rama `main`.
3. **Compose Path**: `docker-compose.prod.yml`.
4. Guardar, pero **todavía no desplegar**: primero las variables.

---

## 3. Variables de entorno

En **Environment** de la aplicación. Dokploy las escribe en un `.env` junto al compose, que es de
donde salen los `${...}`.

### Secretos — nunca en el repo, nunca en logs

| Variable | Qué es |
|---|---|
| `POSTGRES_PASSWORD` | **Generala nueva**, larga y aleatoria. No reuses la de desarrollo. |
| `FLOODS_API_KEY` | Google Flood Forecasting. **Sólo la recibe el worker**, nunca la API ni la web. |
| `TELEGRAM_BOT_TOKEN` | Token del bot. Mismo tratamiento que la key. Si alguna vez se pega en un chat, rotalo en BotFather. |

### Configuración

| Variable | Valor sugerido | Nota |
|---|---|---|
| `POSTGRES_USER` | `rioaltura` | |
| `POSTGRES_DB` | `rioaltura` | |
| `LOG_LEVEL` | `INFO` | |
| `WEB_PORT` | `8080` | Puerto interno al que Dokploy enruta el dominio. |
| `TELEGRAM_CANAL_ID` | `@RioUruguayNotifica` | No es secreto. |
| `TELEGRAM_APP_URL` | `https://<tu-subdominio>` | **Acá va el subdominio.** Vacío = los mensajes del canal salen sin link a la app. |
| `TELEGRAM_PUBLICACION_ACTIVA` | `true` | Ponelo en `false` para el primer deploy si querés mirar antes de que empiece a publicar. |
| `TELEGRAM_TOPE_MENSAJES_DIA` | `100` | Tope duro de seguridad. |
| `TELEGRAM_HORA_ESTADO_DIARIO` | `8` | Hora local de Buenos Aires. |
| `TELEGRAM_VENTANA_DIURNA_INICIO_HORA` | `8` | |
| `TELEGRAM_VENTANA_DIURNA_FIN_HORA` | `21` | |

**`VITE_USE_MOCKS` no se define. Nunca.** El build aborta si vale `true` (spec 013) — es la defensa
contra mostrar datos inventados como si fueran la altura real del río.

`VITE_API_URL` tampoco: queda vacío a propósito, así el navegador habla con un solo dominio y nginx
proxea `/api` a la API por la red interna.

---

## 4. Dominio y HTTPS

En **Domains** de la aplicación:

- **Host**: tu subdominio.
- **Service Name**: `web` — es el único servicio que publica puerto.
- **Container Port**: `80`.
- **HTTPS**: activado, con Let's Encrypt.

Traefik llega al contenedor por la red `dokploy-network`, a la que `web` se conecta en el compose
(spec 017). **No hace falta ningún puerto abierto en el firewall del VPS** más que el 80 y el 443 de
Traefik: el puerto de `web` está atado a `127.0.0.1`.

Si el dominio devuelve un `404 page not found` en texto plano, ése es el 404 **de Traefik** (nginx
devuelve HTML): quiere decir que no registró la ruta. Revisá que el Service Name sea `web`, el
Container Port `80`, y que hayas **redesplegado** después de guardar el dominio.

---

## 5. Desplegar

**Deploy**. El primer build tarda varios minutos (compila el frontend y arma las imágenes de Python).

La API **corre las migraciones sola al arrancar** (`backend/docker-entrypoint.sh`), así que no hay
ningún paso manual de base de datos. Es idempotente: en cada redeploy no hace nada si no hay
migraciones nuevas.

El worker espera a que la API esté `healthy` antes de arrancar, que es lo mismo que decir: espera a
que las migraciones terminen. **El worker nunca migra** — si los dos lo hicieran, competirían por la
tabla `alembic_version`.

---

## 6. Paso obligatorio del PRIMER deploy: el backfill

La base arranca vacía y el worker sólo junta datos **hacia adelante**. Sin este paso, el gráfico de
"¿Cuánto acierta el pronóstico?" compara contra casi nada durante meses, y muestra un error promedio
**mejor que el real** por falta de muestra.

No es hipotético: con 7 días de datos la app decía que el pronóstico erraba **0,38 m**; con 91 días,
**0,50 m**. En una app de alerta de inundación, un número de confianza inflado es exactamente el
daño que esta app existe para evitar.

Google sirve emisiones desde 2024-07-08, así que se puede hacer el día uno. Desde la terminal del
VPS, en el directorio del compose:

```bash
# Alturas reales del INA (ajustá la fecha de inicio a lo que quieras mostrar)
docker compose -f docker-compose.prod.yml exec worker \
  python -m jobs.ina backfill --desde 2023-01-01

# Pronósticos históricos de Google (desde donde hay datos)
docker compose -f docker-compose.prod.yml exec worker \
  python -m jobs.google backfill --desde 2024-07-08

# Salto Grande: sin histórico, trae el boletín del día
docker compose -f docker-compose.prod.yml exec worker \
  python -c "from jobs.salto_grande import job_actualizar_salto_grande; job_actualizar_salto_grande()"
```

---

## 7. Verificar que quedó bien

```bash
# 1. La API está viva y ve la base
curl -s https://<tu-subdominio>/api/health
# esperado: {"status":"ok","db":"ok"}

# 2. Las capas viajan comprimidas (esto decide si el mapa carga en 3G)
curl -s -o /dev/null -w 'sin gzip: %{size_download} B\n' \
  https://<tu-subdominio>/capas/h_0300.geojson
curl -s -H 'Accept-Encoding: gzip' -o /dev/null -w 'con gzip: %{size_download} B\n' \
  https://<tu-subdominio>/capas/h_0300.geojson
# esperado: una reducción de ~5x

# 3. Hay datos de verdad
curl -s https://<tu-subdominio>/api/alturas/ultima
curl -s https://<tu-subdominio>/api/estadisticas | head -c 300

# 4. La base NO existe desde afuera (probalo desde tu máquina, no desde el VPS)
nc -zv <ip-del-vps> 5432
# esperado: connection refused / timeout
```

Y abrí el sitio en un celular de verdad: que no diga "DATOS DE PRUEBA" en ningún lado, que el mapa
cargue, y que la línea punteada del pronóstico se vea en el gráfico de precisión (si no se ve,
faltó el backfill del paso 6).

---

## 8. Actualizar

Push a `main` → **Redeploy** en Dokploy. Las migraciones corren solas.

---

## Pendientes conocidos

- **No hay política de backups de la base.** Es lo primero que haría falta después de esto, con su
  prueba de restauración — un backup que nunca se restauró no es un backup. Merece su propia spec.
- Los umbrales de aviso (`9.500` y `11.000 m³/s`) están calibrados con **2 eventos** y siguen
  marcados como provisorios en `CLAUDE.md` §5.
