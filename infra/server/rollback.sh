#!/usr/bin/env bash
# Points `current` at the previous release and restarts. Code only; the schema stays.
set -euo pipefail
APP_DIR=/srv/wcc-media
CUR="$(readlink -f "${APP_DIR}/current")"
PREV="$(ls -1dt "${APP_DIR}"/releases/*/ | sed 's#/$##' | grep -vx "${CUR}" | head -1)"
[ -n "${PREV}" ] || { echo "No previous release."; exit 1; }
ln -sfn "${PREV}" "${APP_DIR}/current.next" && mv -Tf "${APP_DIR}/current.next" "${APP_DIR}/current"
for s in wcc-api wcc-worker; do sudo /usr/bin/systemctl restart "$s"; done
echo "Now serving ${PREV}"
