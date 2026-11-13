#!/usr/bin/env bash
#
# Keeps Neon as an off-server restore copy of the WCC Media database.
#
# Runs after every nightly backup (wcc-backup.service → ExecStartPost) and loads the
# newest dump from /var/backups/wcc into the Neon database in /etc/wcc/neon.env,
# replacing what is there. If the VPS is ever lost, the data is still on Neon:
# point DATABASE_URL back at it, or dump it onto a new server.
#
# Safety:
#   - Refuses to run while the app itself still uses that Neon database (it would wipe
#     live data). It only starts once DATABASE_URL in /etc/wcc/app.env points elsewhere.
#   - Restores in one transaction: if anything fails, Neon keeps yesterday's copy.
#   - Checks Neon's PostgreSQL version can take this server's dumps.
#   - Never fails the backup itself: a problem here is logged, the local dump stays.
#
# Manual run:  sudo /usr/local/sbin/wcc-neon-copy
# Turn off:    sudo rm /etc/wcc/neon.env   (or leave NEON_DATABASE_URL empty)

set -euo pipefail
ENV_DIR=/etc/wcc
APP_ENV="${ENV_DIR}/app.env"
NEON_ENV="${ENV_DIR}/neon.env"
DIR="${WCC_BACKUP_DIR:-/var/backups/wcc}"
DB="${WCC_DB:-wcc_media}"
log() { echo "neon-copy: $*"; }

[ -r "${NEON_ENV}" ] || { log "no ${NEON_ENV}; skipping"; exit 0; }
# The local database port (set by setup-db.sh), for manual runs outside the backup service.
# shellcheck disable=SC1091
[ -z "${WCC_DB_PORT:-}" ] && [ -r "${ENV_DIR}/db.env" ] && . "${ENV_DIR}/db.env"
# shellcheck disable=SC1090
. "${NEON_ENV}"
[ -n "${NEON_DATABASE_URL:-}" ] || { log "NEON_DATABASE_URL is empty; skipping"; exit 0; }
NEON="${NEON_DATABASE_URL/-pooler./.}" # restores need the direct endpoint, not the pooler
host_of() { sed -E 's#^[a-z]+://[^@]*@([^/:?]+).*#\1#' <<<"$1" | sed 's/-pooler\././'; }

# Never overwrite the database the app is using.
APP_URL="$(grep -E '^DATABASE_URL=' "${APP_ENV}" | head -1 | cut -d= -f2- | tr -d "'\"")"
if [ "$(host_of "${APP_URL}")" = "$(host_of "${NEON}")" ]; then
  log "REFUSING: the app still uses ${NEON%%\?*} as its live database. Move it to this server first (setup-db.sh + import-from-neon.sh)."
  exit 0
fi

DUMP="$(ls -1t "${DIR}/${DB}"-*.dump 2>/dev/null | head -1 || true)"
[ -n "${DUMP}" ] || { log "no backup in ${DIR} yet; skipping"; exit 0; }

# The newest local client tools (they must be at least the server's version that made the dump).
BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
LOCAL_MAJOR="$(basename "$(dirname "${BIN}")")"
NEON_MAJOR="$("${BIN}/psql" "${NEON}" -qAtc 'SHOW server_version_num' | cut -c1-2)"
if [ "${NEON_MAJOR}" -lt "${LOCAL_MAJOR}" ]; then
  log "Neon runs PostgreSQL ${NEON_MAJOR} but backups come from ${LOCAL_MAJOR}. Upgrade the Neon project to ${LOCAL_MAJOR}+ (Neon console → Settings). Skipping."
  exit 0
fi

log "loading $(basename "${DUMP}") into Neon (PostgreSQL ${NEON_MAJOR})"
LIST="$(mktemp)"
trap 'rm -f "${LIST}"' EXIT
# Leave Neon's own schema and extensions alone (they already exist there and Neon manages them).
"${BIN}/pg_restore" -l "${DUMP}" | grep -vE ' (EXTENSION|SCHEMA) - | COMMENT - EXTENSION ' > "${LIST}"
if ! "${BIN}/pg_restore" --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error -L "${LIST}" -d "${NEON}" "${DUMP}"; then
  log "FAILED: Neon keeps its previous copy. The local backup ${DUMP} is fine."
  exit 0
fi

# Compare a few row counts so a silent mismatch shows up in the log.
psql_local() { sudo -u postgres "${BIN}/psql" -p "${WCC_DB_PORT:-5432}" -d "${DB}" -qAtc "$1"; }
for t in User Member AttendanceSession AttendanceRecord; do
  a="$(psql_local "SELECT count(*) FROM \"${t}\"" 2>/dev/null || echo '?')"
  b="$("${BIN}/psql" "${NEON}" -qAtc "SELECT count(*) FROM \"${t}\"")"
  [ "${a}" = "${b}" ] && log "  ${t}: ${b}" || log "  ${t}: server=${a} neon=${b}  <-- differs (rows written since the backup are expected)"
done
log "done: Neon is a copy as of $(basename "${DUMP}")"
