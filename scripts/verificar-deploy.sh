#!/usr/bin/env bash
# Verificación del stack de PRODUCCIÓN (spec 016) contra una base VACÍA.
#
# Prueba lo que separa "corre en mi máquina" de "sirve a un pueblo":
#   D1  las migraciones corren solas, y correr dos veces no rompe nada;
#   D2  las capas viajan comprimidas -- MEDIDO EN BYTES, no "configuramos gzip";
#   D3  ni la base ni la API existen desde afuera;
#   D4  api y web llegan a healthy.
#
# Usa secretos de mentira a propósito: no hace falta ninguna credencial real
# para verificar la infraestructura, y así el script se puede correr en
# cualquier lado sin pedir la API key.
#
# Uso: scripts/verificar-deploy.sh
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

PROYECTO="rioaltura-verif-deploy"
PUERTO_WEB="${PUERTO_WEB:-18080}"
ENVFILE="$(mktemp)"
FALLO=0

ok()   { echo "✓ $1"; }
malo() { echo "✗ $1"; FALLO=1; }
chequear() { if [ "$1" = "0" ]; then ok "$2"; else malo "$2"; fi; }

cat > "$ENVFILE" <<ENV
POSTGRES_USER=verif
POSTGRES_PASSWORD=verif-$(date +%s)
POSTGRES_DB=verif
FLOODS_API_KEY=clave-de-mentira-para-la-verificacion
TELEGRAM_PUBLICACION_ACTIVA=false
WEB_PORT=${PUERTO_WEB}
ENV

compose() { docker compose -p "$PROYECTO" --env-file "$ENVFILE" -f docker-compose.prod.yml "$@"; }

limpiar() {
  echo "--- limpiando ---"
  compose down -v --remove-orphans >/dev/null 2>&1
  rm -f "$ENVFILE"
}
trap limpiar EXIT

echo "=== Partiendo de cero (base vacía) ==="
compose down -v --remove-orphans >/dev/null 2>&1
compose build >/dev/null 2>&1 || { echo "falló el build"; exit 1; }

# El worker necesita internet y credenciales reales; para verificar la
# infraestructura alcanza con db + api + web.
compose up -d db api web >/dev/null 2>&1

echo "--- esperando healthy (las migraciones corren en el arranque) ---"
for _ in $(seq 1 40); do
  estado="$(compose ps --format '{{.Service}} {{.Health}}' 2>/dev/null)"
  if echo "$estado" | rg -q 'api healthy' && echo "$estado" | rg -q 'web healthy'; then break; fi
  sleep 5
done
compose ps --format '{{.Service}}: {{.Health}}' 2>/dev/null | sed 's/^/    /'

# --- D1 + D4 -------------------------------------------------------------
echo "$(compose ps --format '{{.Service}} {{.Health}}')" | rg -q 'api healthy'
chequear $? "D4: la API llega a healthy (y /health chequea la base)"
echo "$(compose ps --format '{{.Service}} {{.Health}}')" | rg -q 'web healthy'
chequear $? "D4: la web llega a healthy"

salud="$(curl -s -m 10 "http://127.0.0.1:${PUERTO_WEB}/api/health" 2>/dev/null)"
[ "$salud" = '{"status":"ok","db":"ok"}' ]
chequear $? "D1: contra una base VACÍA, /api/health responde ok (las tablas se crearon solas)"

tablas="$(compose exec -T db psql -U verif -d verif -t -c \
  "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null | tr -d ' \n')"
[ "${tablas:-0}" -ge 8 ]
chequear $? "D1: la base tiene las tablas del esquema (${tablas:-0} encontradas)"

version="$(compose exec -T db psql -U verif -d verif -t -c \
  "select version_num from alembic_version" 2>/dev/null | tr -d ' \n')"
[ -n "$version" ]
chequear $? "D1: alembic dejó su versión registrada (${version:-ninguna})"

# --- D3: lo que NO tiene que existir desde afuera ------------------------
puertos_db="$(compose ps --format '{{.Service}} {{.Ports}}' | rg '^db ' | rg -o '0\.0\.0\.0:[0-9]+' | head -1)"
[ -z "$puertos_db" ]
chequear $? "D3: la base NO publica ningún puerto al host"
puertos_api="$(compose ps --format '{{.Service}} {{.Ports}}' | rg '^api ' | rg -o '0\.0\.0\.0:[0-9]+' | head -1)"
[ -z "$puertos_api" ]
chequear $? "D3: la API NO publica ningún puerto al host"

# Control positivo: si la web tampoco respondiera, los dos chequeos de arriba
# pasarían por el motivo equivocado.
curl -s -m 10 -o /dev/null "http://127.0.0.1:${PUERTO_WEB}/"
chequear $? "control positivo: la web SÍ responde en su puerto (si no, lo de arriba no prueba nada)"

# --- D2: bytes que viajan de verdad --------------------------------------
CAPA="/capas/h_0300.geojson"
sin_gzip="$(curl -s -m 30 -o /dev/null -w '%{size_download}' "http://127.0.0.1:${PUERTO_WEB}${CAPA}")"
con_gzip="$(curl -s -m 30 -H 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download}' "http://127.0.0.1:${PUERTO_WEB}${CAPA}")"
encoding="$(curl -s -m 30 -H 'Accept-Encoding: gzip' -o /dev/null -D - "http://127.0.0.1:${PUERTO_WEB}${CAPA}" | rg -i '^content-encoding' | tr -d '\r')"
tipo="$(curl -s -m 30 -o /dev/null -D - "http://127.0.0.1:${PUERTO_WEB}${CAPA}" | rg -i '^content-type' | tr -d '\r')"

echo "    ${CAPA}: ${sin_gzip} B sin comprimir -> ${con_gzip} B comprimidos"
echo "    ${encoding:-sin content-encoding} | ${tipo:-sin content-type}"

echo "$encoding" | rg -qi 'gzip'
chequear $? "D2: la capa se sirve con content-encoding gzip"
echo "$tipo" | rg -qi 'geo\+json'
chequear $? "D2: la capa se sirve como application/geo+json (no octet-stream)"
[ "${con_gzip:-0}" -gt 0 ] && [ "$(( sin_gzip / (con_gzip > 0 ? con_gzip : 1) ))" -ge 4 ]
chequear $? "D2: reducción de al menos 4x ($(( sin_gzip / (con_gzip > 0 ? con_gzip : 1) ))x medido)"

curl -s -m 30 --compressed "http://127.0.0.1:${PUERTO_WEB}${CAPA}" | python3 -c \
  "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('features') else 1)" 2>/dev/null
chequear $? "D2: la capa comprimida llega íntegra (el JSON parsea y trae features)"

# --- D1 otra vez: idempotencia -------------------------------------------
echo "=== Segundo arranque sobre la MISMA base (idempotencia) ==="
compose restart api >/dev/null 2>&1
for _ in $(seq 1 30); do
  compose ps --format '{{.Service}} {{.Health}}' | rg -q 'api healthy' && break
  sleep 5
done
salud2="$(curl -s -m 10 "http://127.0.0.1:${PUERTO_WEB}/api/health" 2>/dev/null)"
[ "$salud2" = '{"status":"ok","db":"ok"}' ]
chequear $? "D1: reiniciar con la base ya migrada no rompe nada (entrypoint idempotente)"

echo
if [ "$FALLO" -ne 0 ]; then echo "HAY FALLAS"; exit 1; fi
echo "Todo OK"
