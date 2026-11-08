#!/usr/bin/env bash
#
# Activates one API + worker release on the VPS (the web app is on Vercel).
# GitHub Actions uploads the tarball and
# this script, then runs as deploy:
#   bash ~/incoming-wcc/deploy.sh <sha> ~/incoming-wcc/release-<sha>.tgz
#
#  1. unpack into /srv/wcc-media/releases/<time>-<sha>
#  2. install production deps (lockfile exact), generate the Prisma client
#  3. run migrations (direct DB URL) and seed categories
#  4. switch `current` atomically, restart, wait for health
#  5. roll back automatically if unhealthy
# Keep migrations additive: a rollback changes code, not the schema.

set -euo pipefail
SHA="${1:?usage: deploy.sh <sha> <tarball>}"
TARBALL="${2:?usage: deploy.sh <sha> <tarball>}"
APP_DIR=/srv/wcc-media
ENV_FILE=/etc/wcc/app.env
KEEP=5
API_HEALTH=http://127.0.0.1:5070/api/v1/health/ready
log() { printf '\n==> %s\n' "$*"; }

[ -r "${ENV_FILE}" ] || { echo "Cannot read ${ENV_FILE}: is deploy in the wcc group?"; exit 1; }
grep -qE '^AWS_ACCESS_KEY_ID=.+' "${ENV_FILE}" || { echo "${ENV_FILE}: AWS keys are empty. Fill them in first."; exit 1; }
grep -qE '^DATABASE_MIGRATION_URL=.+' "${ENV_FILE}" || { echo "${ENV_FILE}: set DATABASE_URL / DATABASE_MIGRATION_URL first."; exit 1; }

RELEASE="${APP_DIR}/releases/$(date -u +%Y%m%d%H%M%S)-${SHA:0:7}"
PREVIOUS="$(readlink -f "${APP_DIR}/current" 2>/dev/null || true)"

log "Unpacking ${SHA:0:7}"
umask 022
mkdir -p "${RELEASE}"
tar -xzf "${TARBALL}" -C "${RELEASE}"
cd "${RELEASE}"

log "Installing dependencies"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack pnpm install --frozen-lockfile --prod --filter '@wcc/api...' --filter '@wcc/worker...' --filter '@wcc/db...'
corepack pnpm --filter @wcc/db exec prisma generate

set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
set +a
export NODE_ENV=production

log "Migrating"
DATABASE_URL="${DATABASE_MIGRATION_URL}" corepack pnpm --filter @wcc/db exec prisma migrate deploy
DATABASE_URL="${DATABASE_MIGRATION_URL}" node packages/db/dist/prisma/seed.js  # direct endpoint, not the pooler

log "Switching"
ln -sfn "${RELEASE}" "${APP_DIR}/current.next"
mv -Tf "${APP_DIR}/current.next" "${APP_DIR}/current"

restart() { for s in wcc-api wcc-worker; do sudo /usr/bin/systemctl restart "$s"; done; }
healthy() {
  for _ in $(seq 1 30); do
    curl -fsS "${API_HEALTH}" >/dev/null 2>&1 && sudo /usr/bin/systemctl is-active wcc-worker >/dev/null && return 0
    sleep 2
  done
  return 1
}

restart
if healthy; then
  log "Live: $(curl -fsS "${API_HEALTH}")"
else
  echo "::error::The new release did not become healthy."
  journalctl -u wcc-api -u wcc-worker -n 40 --no-pager || true
  if [ -n "${PREVIOUS}" ] && [ -d "${PREVIOUS}" ]; then
    log "Rolling back to ${PREVIOUS}"
    ln -sfn "${PREVIOUS}" "${APP_DIR}/current.next"
    mv -Tf "${APP_DIR}/current.next" "${APP_DIR}/current"
    restart
    healthy && echo "Rolled back." || echo "::error::Rollback is unhealthy too."
  fi
  exit 1
fi

log "Pruning old releases (keeping ${KEEP})"
ls -1dt "${APP_DIR}"/releases/*/ | tail -n +$((KEEP + 1)) | while read -r old; do
  [ "$(readlink -f "${old}")" = "$(readlink -f "${APP_DIR}/current")" ] || rm -rf -- "${old}"
done
rm -f -- "${TARBALL}"
