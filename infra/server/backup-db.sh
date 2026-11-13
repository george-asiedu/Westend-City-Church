#!/usr/bin/env bash
# Nightly (and pre-deploy) dump of the WCC Media database. Runs as the postgres user
# from wcc-backup.service. Keeps 14 days, and always the newest 5 whatever their age.
set -euo pipefail
DB="${WCC_DB:-wcc_media}"
PORT="${WCC_DB_PORT:-5432}"
DIR="${WCC_BACKUP_DIR:-/var/backups/wcc}"
KEEP_DAYS=14
KEEP_MIN=5

umask 077
mkdir -p "${DIR}"
FILE="${DIR}/${DB}-$(date -u +%Y%m%d-%H%M%S).dump"
pg_dump -p "${PORT}" -Fc --no-owner -d "${DB}" -f "${FILE}.part"
pg_restore -l "${FILE}.part" >/dev/null # the dump must be readable before it counts
mv "${FILE}.part" "${FILE}"
echo "backup ${FILE} ($(du -h "${FILE}" | cut -f1))"

# Prune: older than KEEP_DAYS, but never below KEEP_MIN files.
mapfile -t ALL < <(ls -1t "${DIR}/${DB}"-*.dump 2>/dev/null)
for f in "${ALL[@]:${KEEP_MIN}}"; do
  if [ -n "$(find "$f" -mtime +"${KEEP_DAYS}")" ]; then rm -f -- "$f" && echo "pruned $f"; fi
done
rm -f "${DIR}"/*.part
