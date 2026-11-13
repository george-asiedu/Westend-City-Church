#!/usr/bin/env bash
#
# Puts the WCC Media database on this server's own PostgreSQL (replacing Neon).
#
#   scp -r infra/server deploy@SERVER_IP:/tmp/wcc-setup
#   ssh -t deploy@SERVER_IP 'sudo bash /tmp/wcc-setup/setup-db.sh'
#
# Uses the PostgreSQL cluster already on the box (Zuri installed 17 on loopback);
# installs one only if there is none. It touches nothing of Zuri's: WCC gets its own
# database and two roles of its own:
#   wcc_owner  owns the database; used only by migrations (DATABASE_MIGRATION_URL)
#   wcc_app    what the API and worker use (DATABASE_URL): read/write rows, no DDL,
#              audit log append-only (granted by the migrations)
# Also installs a nightly pg_dump (wcc-backup.timer, 14 days kept) and lets deploys
# take a backup before migrating. Passwords live in /etc/wcc/db.env (root only).
# The current DATABASE_* lines in /etc/wcc/app.env are saved to /etc/wcc/neon.env
# so import-from-neon.sh can copy the data across. Safe to re-run.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR=/etc/wcc
APP_ENV="${ENV_DIR}/app.env"
DB=wcc_media
BACKUP_DIR=/var/backups/wcc
log() { printf '\n\033[1;31m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }
[ -f "${APP_ENV}" ] || { echo "${APP_ENV} missing: run setup.sh first."; exit 1; }

log "PostgreSQL"
if ! command -v pg_lsclusters >/dev/null || ! pg_lsclusters --no-header | grep -q online; then
  echo "No running PostgreSQL cluster found; installing the distribution's PostgreSQL."
  apt-get update -y && DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql
fi
# The newest online cluster (Zuri's 17 on a normal box).
read -r PG_VER PG_CLUSTER PG_PORT _ < <(pg_lsclusters --no-header | awk '$4 == "online"' | sort -k1,1nr | head -1)
echo "Using PostgreSQL ${PG_VER}/${PG_CLUSTER} on port ${PG_PORT}"
LISTEN="$(sudo -u postgres psql -p "${PG_PORT}" -tAc 'SHOW listen_addresses')"
case "${LISTEN}" in
  localhost | 127.0.0.1 | '127.0.0.1,::1' | 'localhost,127.0.0.1') ;;
  *) echo "Note: this cluster listens on '${LISTEN}'. WCC connects over 127.0.0.1 only; UFW keeps 5432 closed." ;;
esac
psql_su() { sudo -u postgres psql -p "${PG_PORT}" -v ON_ERROR_STOP=1 -q "$@"; }

log "Roles and database"
install -m 600 -o root -g root /dev/null "${ENV_DIR}/db.env.tmp"
if [ -f "${ENV_DIR}/db.env" ]; then
  # shellcheck disable=SC1091
  . "${ENV_DIR}/db.env"
fi
OWNER_PW="${WCC_DB_OWNER_PASSWORD:-$(openssl rand -hex 24)}"
APP_PW="${WCC_DB_APP_PASSWORD:-$(openssl rand -hex 24)}"
printf 'WCC_DB_OWNER_PASSWORD=%s\nWCC_DB_APP_PASSWORD=%s\nWCC_DB_PORT=%s\n' "${OWNER_PW}" "${APP_PW}" "${PG_PORT}" > "${ENV_DIR}/db.env.tmp"
mv "${ENV_DIR}/db.env.tmp" "${ENV_DIR}/db.env"

psql_su <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'wcc_owner') THEN CREATE ROLE wcc_owner LOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'wcc_app') THEN CREATE ROLE wcc_app LOGIN CONNECTION LIMIT 30; END IF;
END \$\$;
ALTER ROLE wcc_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${OWNER_PW}';
ALTER ROLE wcc_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 30 PASSWORD '${APP_PW}';
SQL
psql_su -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB}'" | grep -q 1 || sudo -u postgres createdb -p "${PG_PORT}" -O wcc_owner -E UTF8 -T template0 "${DB}"

psql_su -d "${DB}" <<'SQL'
-- Only WCC's roles may connect; nobody but the owner creates objects.
REVOKE ALL ON DATABASE wcc_media FROM PUBLIC;
GRANT CONNECT, TEMP ON DATABASE wcc_media TO wcc_owner, wcc_app;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER SCHEMA public OWNER TO wcc_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO wcc_app;
-- Tables the migrations create later are usable by the app (the migrations narrow some, e.g. the audit log).
ALTER DEFAULT PRIVILEGES FOR ROLE wcc_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wcc_app;
ALTER DEFAULT PRIVILEGES FOR ROLE wcc_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO wcc_app;
ALTER DEFAULT PRIVILEGES FOR ROLE wcc_owner IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO wcc_app;
-- Re-runs: cover anything that already exists.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wcc_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wcc_app;
DO $$ BEGIN
  IF to_regclass('public."AuditLog"') IS NOT NULL THEN REVOKE UPDATE, DELETE ON "AuditLog" FROM wcc_app; END IF;
END $$;
SQL

log "Connection settings"
# Keep the old (Neon) URLs for the one-off data import, then point the app here.
if grep -qE '^DATABASE_MIGRATION_URL=.*neon\.tech' "${APP_ENV}" && [ ! -f "${ENV_DIR}/neon.env" ]; then
  install -m 600 -o root -g root /dev/null "${ENV_DIR}/neon.env"
  grep -E '^DATABASE_MIGRATION_URL=' "${APP_ENV}" | sed 's/^DATABASE_MIGRATION_URL=/NEON_DATABASE_URL=/' > "${ENV_DIR}/neon.env"
  echo "Saved the Neon URL to ${ENV_DIR}/neon.env for import-from-neon.sh"
fi
APP_URL="postgresql://wcc_app:${APP_PW}@127.0.0.1:${PG_PORT}/${DB}?connection_limit=10"
OWNER_URL="postgresql://wcc_owner:${OWNER_PW}@127.0.0.1:${PG_PORT}/${DB}"
cp -p "${APP_ENV}" "${APP_ENV}.bak-$(date +%Y%m%d%H%M%S)"
sed -i -e "/^DATABASE_URL=/d" -e "/^DATABASE_MIGRATION_URL=/d" "${APP_ENV}"
printf "DATABASE_URL='%s'\nDATABASE_MIGRATION_URL='%s'\n" "${APP_URL}" "${OWNER_URL}" >> "${APP_ENV}"
chown root:wcc "${APP_ENV}" && chmod 640 "${APP_ENV}"
echo "Updated DATABASE_URL / DATABASE_MIGRATION_URL in ${APP_ENV} (old file kept as ${APP_ENV}.bak-*)"

log "Backups"
install -d -m 700 -o postgres -g postgres "${BACKUP_DIR}"
install -m 755 "${HERE}/backup-db.sh" /usr/local/sbin/wcc-backup-db
install -m 755 "${HERE}/restore-db.sh" /usr/local/sbin/wcc-restore-db
for u in wcc-backup.service wcc-backup.timer wcc-api.service wcc-worker.service; do
  install -m 644 "${HERE}/${u}" "/etc/systemd/system/${u}"
done
sed -i "s/__PG_PORT__/${PG_PORT}/" /etc/systemd/system/wcc-backup.service
install -m 440 "${HERE}/sudoers-wcc" /etc/sudoers.d/wcc-deploy
visudo -cf /etc/sudoers.d/wcc-deploy
systemctl daemon-reload
systemctl enable --now wcc-backup.timer
systemctl list-timers wcc-backup.timer --no-pager | head -3

log "Done"
cat <<NEXT

The app now points at PostgreSQL ${PG_VER} on this server (database ${DB}).
Next:
  1. Create the tables: re-run the latest GitHub deploy (Actions → Deploy → Re-run),
     or push to main. Migrations run as wcc_owner.
  2. Copy your data from Neon:  sudo bash /tmp/wcc-setup/import-from-neon.sh
  3. Check:  curl -fsS http://127.0.0.1:5070/api/v1/health/ready
Backups: ${BACKUP_DIR} nightly at 02:30 (14 days). Restore: sudo wcc-restore-db <file>
NEXT
