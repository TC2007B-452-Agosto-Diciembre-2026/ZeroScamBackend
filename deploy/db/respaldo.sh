#!/bin/bash
# Respaldo automático de la base (RNF06): un volcado cada RESPALDO_CADA_HORAS
# (24 por defecto) y se borran los de más de RESPALDO_DIAS días (30).
# Corre como el contenedor `respaldo` de docker-compose.yml, que comparte la red
# de `db` y entra como root por 127.0.0.1.
#
# Para probarlo una vez y salir: RESPALDO_UNA_VEZ=1
set -uo pipefail

DB="${MYSQL_DATABASE:-ZeroScam}"
DIR="${RESPALDO_DIR:-/respaldos}"
HOURS="${RESPALDO_CADA_HORAS:-24}"
DAYS="${RESPALDO_DIAS:-30}"
HOST="${DB_HOST:-127.0.0.1}"
export MYSQL_PWD="${MYSQL_ROOT_PASSWORD:?Falta MYSQL_ROOT_PASSWORD}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

backup() {
  local file="$DIR/${DB}-$(date +%Y-%m-%d_%H%M).sql.gz"
  # Se escribe en un .tmp y solo se renombra si el volcado y el gzip salieron bien.
  if mysqldump -h "$HOST" -uroot --single-transaction --routines --triggers --no-tablespaces "$DB" | gzip > "$file.tmp" \
     && gzip -t "$file.tmp"; then
    mv "$file.tmp" "$file"
    log "Respaldo listo: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.tmp"
    log "ERROR: el respaldo de $DB falló"
    return 1
  fi
  # Retención: fuera los de más de $DAYS días.
  find "$DIR" -maxdepth 1 -name "${DB}-*.sql.gz" -mtime +"$DAYS" -print -delete | sed 's/^/Borrado por antiguo: /'
}

mkdir -p "$DIR"
log "Respaldos de $DB en $DIR cada $HOURS h, se conservan $DAYS días."
while true; do
  backup
  status=$?
  [ "${RESPALDO_UNA_VEZ:-0}" = "1" ] && exit "$status"
  sleep $((HOURS * 3600))
done
