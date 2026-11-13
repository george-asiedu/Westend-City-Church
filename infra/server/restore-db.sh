#!/usr/bin/env bash
# Restores a WCC Media backup over the live database.
#   sudo wcc-restore-db /var/backups/wcc/wcc_media-20261116-023000.dump
# Stops the API and worker, takes a safety dump first, restores, starts them again.
set -euo pipefail
FILE="${1:?usage: wcc-restore-db <backup.dump>}"
DB=wcc_media
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }
[ -r "${FILE}" ] || { echo "Cannot read ${FILE}"; exit 1; }
# shellcheck disable=SC1091
. /etc/wcc/db.env
PORT="${WCC_DB_PORT:-5432}"

pg_restore -l "${FILE}" >/dev/null || { echo "${FILE} is not a valid backup."; exit 1; }
read -r -p "Replace ALL data in ${DB} with ${FILE}? Type the database name to confirm: " ans
[ "${ans}" = "${DB}" ] || { echo "Cancelled."; exit 1; }

echo "Safety backup of the current data first…"
systemctl start wcc-backup.service
systemctl stop wcc-api wcc-worker
trap 'systemctl start wcc-api wcc-worker' EXIT
sudo -u postgres pg_restore -p "${PORT}" --clean --if-exists --no-owner --role=wcc_owner -d "${DB}" --single-transaction "${FILE}"
sudo -u postgres psql -p "${PORT}" -d "${DB}" -q -c 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wcc_app' \
  -c 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wcc_app' -c 'REVOKE UPDATE, DELETE ON "AuditLog" FROM wcc_app'
echo "Restored ${FILE}."
