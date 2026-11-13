#!/usr/bin/env bash
#
# One-off: copies all WCC Media data from Neon into the server's own PostgreSQL.
#
#   sudo bash /tmp/wcc-setup/import-from-neon.sh
#
# Before running: setup-db.sh has run, and a deploy has created the tables locally
# (both databases must be on the same migration). What it does:
#   1. checks both databases have exactly the same migrations applied
#   2. refuses if the local database already has users (unless FORCE=1)
#   3. stops the API + worker, takes a local backup
#   4. copies rows only (schema comes from the migrations) with a pg_dump at least as
#      new as Neon's server, loading with triggers off so foreign keys load in any order
#   5. compares row counts per table, starts the API + worker again
# Neon is only read, never changed.

set -euo pipefail
DB=wcc_media
log() { printf '\n\033[1;31m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }
[ -r /etc/wcc/neon.env ] || { echo "No /etc/wcc/neon.env: put NEON_DATABASE_URL='postgresql://…neon.tech/…?sslmode=require' (the direct, non-pooler URL) in it."; exit 1; }
# shellcheck disable=SC1091
. /etc/wcc/neon.env
# shellcheck disable=SC1091
. /etc/wcc/db.env
PORT="${WCC_DB_PORT:-5432}"
NEON="${NEON_DATABASE_URL:?NEON_DATABASE_URL is empty}"
NEON="${NEON/-pooler./.}" # dumps need the direct endpoint
local_sql() { sudo -u postgres psql -p "${PORT}" -d "${DB}" -v ON_ERROR_STOP=1 -qAt "$@"; }

log "Checking versions"
NEON_MAJOR="$(psql "${NEON}" -qAtc 'SHOW server_version_num' | cut -c1-2)"
DUMP=""
for v in $(ls -1 /usr/lib/postgresql/ | sort -nr); do
  if [ -x "/usr/lib/postgresql/${v}/bin/pg_dump" ] && [ "${v}" -ge "${NEON_MAJOR}" ]; then DUMP="/usr/lib/postgresql/${v}/bin"; break; fi
done
if [ -z "${DUMP}" ]; then
  cat <<MSG
Neon runs PostgreSQL ${NEON_MAJOR}; pg_dump must be ${NEON_MAJOR} or newer. Install just the client
(it doesn't touch the running server):
  sudo apt-get install -y postgresql-client-${NEON_MAJOR}
If apt can't find it, add the PostgreSQL apt repository first:
  sudo apt-get install -y postgresql-common && sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
Then run this script again.
MSG
  exit 1
fi
echo "Neon: PostgreSQL ${NEON_MAJOR}; using ${DUMP}/pg_dump"

log "Checking both databases are on the same migrations"
q="SELECT string_agg(migration_name, ',' ORDER BY migration_name) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL"
LOCAL_M="$(local_sql -c "${q}" 2>/dev/null || true)"
NEON_M="$(psql "${NEON}" -qAtc "${q}")"
[ -n "${LOCAL_M}" ] || { echo "The local database has no tables yet: run a deploy first."; exit 1; }
if [ "${LOCAL_M}" != "${NEON_M}" ]; then
  echo "Migrations differ."
  echo "  local: ${LOCAL_M//,/ }"
  echo "  neon:  ${NEON_M//,/ }"
  echo "Deploy the same version to both (or let the deploy migrate Neon too) and retry."
  exit 1
fi
echo "Both on $(echo "${LOCAL_M}" | tr ',' '\n' | wc -l) migrations."

USERS="$(local_sql -c 'SELECT count(*) FROM "User"')"
if [ "${USERS}" != "0" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "The local database already has ${USERS} user(s). Run with FORCE=1 to replace ALL local data with Neon's."
  exit 1
fi

log "Stopping the API and worker; backing up the local database"
systemctl stop wcc-api wcc-worker
trap 'systemctl start wcc-api wcc-worker' EXIT
systemctl start wcc-backup.service

TABLES="$(local_sql -c "SELECT string_agg(format('%I', tablename), ',') FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'")"

log "Copying data"
TMP="$(mktemp -d)"
chmod 700 "${TMP}"
"${DUMP}/pg_dump" "${NEON}" --data-only --no-owner --no-privileges --schema=public --exclude-table=_prisma_migrations -f "${TMP}/data.sql"
chown postgres "${TMP}" "${TMP}/data.sql"
{
  echo "BEGIN;"
  echo "SET session_replication_role = replica;" # skip FK/trigger checks while loading
  echo "TRUNCATE ${TABLES//,/, } CASCADE;"
  echo "\\i ${TMP}/data.sql"
  echo "COMMIT;"
} > "${TMP}/load.sql"
chown postgres "${TMP}/load.sql"
sudo -u postgres "${DUMP}/psql" -p "${PORT}" -d "${DB}" -v ON_ERROR_STOP=1 -q -f "${TMP}/load.sql" >/dev/null
rm -rf "${TMP}"

log "Comparing row counts"
fail=0
for t in ${TABLES//,/ }; do
  t="${t//\"/}"
  a="$(psql "${NEON}" -qAtc "SELECT count(*) FROM \"${t}\"")"
  b="$(local_sql -c "SELECT count(*) FROM \"${t}\"")"
  if [ "${a}" = "${b}" ]; then printf '  %-24s %s\n' "${t}" "${b}"; else printf '  %-24s neon=%s local=%s  <-- MISMATCH\n' "${t}" "${a}" "${b}"; fail=1; fi
done
local_sql -c 'ANALYZE' >/dev/null
[ "${fail}" = 0 ] || { echo "Row counts differ; the pre-import backup is in /var/backups/wcc."; exit 1; }

log "Done"
echo "All data copied. The API and worker are starting again on the local database."
echo "Keep /etc/wcc/neon.env: from tonight, each backup is copied back to this Neon database as an off-server restore copy (wcc-neon-copy)."
