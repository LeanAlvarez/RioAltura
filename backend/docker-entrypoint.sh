#!/bin/sh
# D1 (spec 016): la API migra la base antes de aceptar tráfico.
#
# Sin esto, un deploy contra una base recién creada levanta uvicorn sobre un
# esquema vacío y muere en el primer request. Un paso manual post-deploy no
# sirve: se olvida, y se olvida justo el día que hay una crecida.
#
# `alembic upgrade head` es idempotente -- si no hay migraciones nuevas no
# hace nada--, así que corre en cada arranque sin condicionales.
#
# Sólo la API migra, nunca el worker: si los dos lo hicieran, dos contenedores
# arrancando a la vez competirían por la misma tabla `alembic_version`.
set -e

echo "entrypoint: alembic upgrade head"
alembic upgrade head

echo "entrypoint: iniciando API"
# `exec` para que uvicorn sea el PID 1 y reciba SIGTERM directo: si quedara
# como hijo del shell, un redeploy lo mataría de golpe en vez de dejarlo
# cerrar las conexiones abiertas.
exec "$@"
