#!/usr/bin/env bash
#
# Adds the WCC Media API + worker to the Contabo VPS that already runs Nichelle and Zuri.
# (The web app is hosted on Vercel; the database is Neon. Neither is set up here.)
#
#   scp -r infra/server deploy@SERVER_IP:/tmp/wcc-setup
#   ssh -t deploy@SERVER_IP 'sudo API_DOMAIN=<optional> bash /tmp/wcc-setup/setup.sh'
#
# It changes NOTHING that belongs to the other apps. The server base (deploy
# user, SSH hardening, UFW 22/80/443, fail2ban, unattended upgrades, swap,
# Node 22, Redis, Nginx, Certbot) came from nichelle-api's setup.sh. This adds:
#   - user `wcc` (runs the app; no login)
#   - Redis database 2 (Nichelle uses 0, Zuri 1)
#   - ffmpeg + libheif tools for the worker
#   - /srv/wcc-media releases, /etc/wcc/app.env, /var/lib/wcc/tmp
#   - wcc-api (127.0.0.1:5070) and wcc-worker under systemd; the nginx site
#   - a shared secret so nginx can trust the visitor IP Vercel forwards
# Ports 5050 (nichelle) and 5060 (zuri) are untouched. Safe to re-run.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR=/srv/wcc-media
ENV_DIR=/etc/wcc
log() { printf '\n\033[1;31m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }
id deploy >/dev/null 2>&1 || { echo "No deploy user: run nichelle-api's setup.sh first."; exit 1; }
command -v nginx >/dev/null && command -v node >/dev/null || { echo "Nginx/Node missing: run nichelle-api's setup.sh first."; exit 1; }
[ -r /etc/nichelle/redis-password ] || { echo "Cannot read /etc/nichelle/redis-password."; exit 1; }
if ss -ltn "sport = :5070" | grep -q LISTEN && ! systemctl is-active --quiet wcc-api; then
  echo "Port 5070 is already in use by something else. Aborting."; exit 1
fi

# No domain yet: an sslip.io hostname resolves to this IP, so Let's Encrypt can issue for it.
# Only Vercel calls it (browsers talk to the Vercel URL).
if [ -z "${API_DOMAIN:-}" ]; then
  IP="$(curl -fsS -4 https://ifconfig.me)"
  API_DOMAIN="${IP//./-}.sslip.io"
fi
echo "API domain: ${API_DOMAIN}"

log "Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
# heif-convert + the HEVC plugin decode iPhone HEIC photos; exiftool needs perl (present).
apt-get install -y ffmpeg libheif-examples libheif-plugin-libde265

log "User"
id wcc >/dev/null 2>&1 || adduser --system --group --no-create-home --shell /usr/sbin/nologin wcc
usermod -aG wcc deploy
install -m 440 "${HERE}/sudoers-wcc" /etc/sudoers.d/wcc-deploy
visudo -cf /etc/sudoers.d/wcc-deploy

log "Directories and settings"
install -d -m 755 -o deploy -g deploy "${APP_DIR}" "${APP_DIR}/releases"
install -d -m 750 -o wcc -g wcc /var/lib/wcc /var/lib/wcc/tmp
install -d -m 750 -o root -g wcc "${ENV_DIR}"
PROXY_SECRET_FILE="${ENV_DIR}/proxy-secret"
[ -s "${PROXY_SECRET_FILE}" ] || { openssl rand -hex 32 > "${PROXY_SECRET_FILE}"; chmod 640 "${PROXY_SECRET_FILE}"; chgrp wcc "${PROXY_SECRET_FILE}"; }
PROXY_SECRET="$(cat "${PROXY_SECRET_FILE}")"
if [ ! -f "${ENV_DIR}/app.env" ]; then
  REDIS_PW="$(cat /etc/nichelle/redis-password)"
  install -m 640 -o root -g wcc "${HERE}/app.env.example" "${ENV_DIR}/app.env"
  sed -i -e "s|__REDIS_PASSWORD__|${REDIS_PW}|" \
         -e "s|^JWT_ACCESS_SECRET=$|JWT_ACCESS_SECRET='$(openssl rand -base64 64 | tr -d '\n')'|" \
         -e "s|^APP_ENCRYPTION_KEY=$|APP_ENCRYPTION_KEY='$(openssl rand -base64 32)'|" "${ENV_DIR}/app.env"
  echo "Wrote ${ENV_DIR}/app.env. Fill in WEB_ORIGIN (your Vercel URL), the database URLs, AWS and PLUNK_SECRET before the first deploy."
fi

log "systemd"
for u in wcc-api.service wcc-worker.service; do
  install -m 644 "${HERE}/${u}" "/etc/systemd/system/${u}"
done
systemctl daemon-reload
systemctl enable wcc-api wcc-worker   # started by the first deploy

log "Nginx"
SITE=/etc/nginx/sites-available/wcc-media.conf
# Regenerate unless certbot has already added TLS to it.
if [ ! -f "${SITE}" ] || ! grep -q 'managed by Certbot' "${SITE}"; then
  sed -e "s/__API_DOMAIN__/${API_DOMAIN}/g" -e "s/__PROXY_SECRET__/${PROXY_SECRET}/g" "${HERE}/nginx/wcc-media.conf" > "${SITE}"
  chmod 640 "${SITE}"   # contains the proxy secret
fi
ln -sf "${SITE}" /etc/nginx/sites-enabled/wcc-media.conf
if ! nginx -t; then
  # Never leave a broken site enabled: it would block reloads for the other apps.
  rm -f /etc/nginx/sites-enabled/wcc-media.conf
  echo "nginx test failed; wcc-media site disabled, other sites untouched." >&2
  exit 1
fi
systemctl reload nginx

log "Done"
cat <<NEXT

Next (docs/DEPLOYMENT.md):
  1. TLS:    sudo certbot --nginx -d ${API_DOMAIN} --redirect -m YOUR_EMAIL --agree-tos -n
  2. Fill:   sudoedit ${ENV_DIR}/app.env   (WEB_ORIGIN = your Vercel URL, database URLs, AWS keys, PLUNK_SECRET)
  3. Vercel: set these Environment Variables on the web project:
       API_INTERNAL_URL=https://${API_DOMAIN}
       API_PROXY_SECRET=${PROXY_SECRET}
  4. Deploy the API from GitHub Actions (push to main), then create the first admin:
       sudo -u wcc bash -c 'set -a; . /etc/wcc/app.env; cd /srv/wcc-media/current && node apps/api/dist/cli.js create-admin'
NEXT
