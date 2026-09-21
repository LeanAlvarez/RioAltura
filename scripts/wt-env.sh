#!/usr/bin/env bash
# Genera .env.local con puertos únicos y estables para este worktree.
#
# - El offset sale de un hash (cksum) del nombre de la carpeta del worktree (0..99).
# - API_PORT=8000+off, WEB_PORT=5173+off, DB_PORT=5432+off. Si alguno está ocupado
#   (lsof), se incrementa el offset hasta encontrar los tres libres.
# - COMPOSE_PROJECT_NAME=rioaltura-<nombre-worktree>.
# - No pisa variables ya presentes en .env.local, salvo los puertos y el nombre del proyecto.
#   Si .env.local no existe, se inicializa desde .env.example.
# - Deja .env -> .env.local (symlink) para que `docker compose` interpole los puertos sin flags.
#
# Variables de control (útiles para tests):
#   WT_ENV_ROOT             carpeta del worktree (default: la raíz del repo que contiene este script)
#   WT_ENV_NAME             nombre a hashear (default: basename de WT_ENV_ROOT)
#   WT_ENV_SKIP_PORT_CHECK  si vale 1, no consulta lsof
#
# Compatible con bash 3.2 (macOS) y Linux.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${WT_ENV_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ENV_FILE="$ROOT/.env.local"
EXAMPLE_FILE="$ROOT/.env.example"
MANAGED_KEYS='^(API_PORT|WEB_PORT|DB_PORT|COMPOSE_PROJECT_NAME)='

slugify() {
  local s
  s="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9\n' '-' | tr -s '-')"
  s="${s#-}"
  s="${s%-}"
  printf '%s' "${s:-worktree}"
}

hash_offset() {
  local sum
  sum="$(printf '%s' "$1" | cksum | cut -d' ' -f1)"
  echo $(( sum % 100 ))
}

port_in_use() {
  if [ "${WT_ENV_SKIP_PORT_CHECK:-0}" = "1" ]; then
    return 1
  fi
  if ! command -v lsof >/dev/null 2>&1; then
    return 1
  fi
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1
}

NAME="$(slugify "${WT_ENV_NAME:-$(basename "$ROOT")}")"
BASE_OFFSET="$(hash_offset "$NAME")"
OFFSET="$BASE_OFFSET"

while :; do
  API_PORT=$(( 8000 + OFFSET ))
  WEB_PORT=$(( 5173 + OFFSET ))
  DB_PORT=$(( 5432 + OFFSET ))
  if ! port_in_use "$API_PORT" && ! port_in_use "$WEB_PORT" && ! port_in_use "$DB_PORT"; then
    break
  fi
  OFFSET=$(( OFFSET + 1 ))
  if [ "$OFFSET" -gt $(( BASE_OFFSET + 200 )) ]; then
    echo "wt-env.sh: no encontré puertos libres a partir del offset $BASE_OFFSET" >&2
    exit 1
  fi
done

COMPOSE_PROJECT_NAME="rioaltura-$NAME"

# Base: el .env.local actual (sin las claves gestionadas) o, si no existe, .env.example.
if [ -f "$ENV_FILE" ]; then
  SOURCE_FILE="$ENV_FILE"
elif [ -f "$EXAMPLE_FILE" ]; then
  SOURCE_FILE="$EXAMPLE_FILE"
else
  SOURCE_FILE=""
fi

TMP_FILE="$(mktemp "$ROOT/.env.local.XXXXXX")"
trap 'rm -f "$TMP_FILE"' EXIT

{
  echo "# Generado por scripts/wt-env.sh para el worktree '$NAME' (offset $OFFSET)."
  echo "# Los puertos y COMPOSE_PROJECT_NAME se recalculan en cada corrida; el resto se conserva."
  echo "API_PORT=$API_PORT"
  echo "WEB_PORT=$WEB_PORT"
  echo "DB_PORT=$DB_PORT"
  echo "COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME"
  if [ -n "$SOURCE_FILE" ]; then
    echo
    grep -Ev "$MANAGED_KEYS" "$SOURCE_FILE" \
      | grep -Ev '^# (Generado por scripts/wt-env.sh|Los puertos y COMPOSE_PROJECT_NAME|Copiá este archivo|que lo genera con puertos|--- Puertos del worktree)' \
      || true
  fi
} > "$TMP_FILE"

mv "$TMP_FILE" "$ENV_FILE"
trap - EXIT

# docker compose interpola ${VAR} desde .env; lo apuntamos al .env.local del worktree.
if [ ! -e "$ROOT/.env" ] || [ -L "$ROOT/.env" ]; then
  ln -sfn .env.local "$ROOT/.env"
fi

echo "worktree=$NAME offset=$OFFSET"
echo "API_PORT=$API_PORT WEB_PORT=$WEB_PORT DB_PORT=$DB_PORT"
echo "COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME"
echo "escrito: $ENV_FILE"
