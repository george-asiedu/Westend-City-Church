# Deploying WCC Media

| Piece | Where | Notes |
|---|---|---|
| Web app (Next.js PWA) | **Vercel** | Gives the HTTPS URL users open. Proxies `/api/*` to the VPS. |
| API + worker | **Contabo VPS** (systemd, beside Nichelle and Zuri) | `infra/server/*`, deployed by GitHub Actions |
| Database | **PostgreSQL on the VPS** (the cluster Zuri already runs) | `setup-db.sh` once; migrations run on each API deploy, after a backup |
| Media | S3 bucket `wcc-media-prod` (+ CloudFront later) | |
| Queues | Redis on the VPS, database 2 | |

```
Browser ──HTTPS──▶ <project>.vercel.app ──(/api/* + X-WCC-Proxy-Key)──▶ <ip>.sslip.io (nginx) ──▶ API :5070
   │                                                                                           worker
   └──── uploads / thumbnails directly ────▶ S3 (presigned URLs)
```

The browser only ever talks to the Vercel origin, so auth cookies are
first-party and CSRF/CSP need no cross-origin exceptions.

## The VPS (Cloud VPS 4: 4 vCPU, 8 GB, 100 GB)

| Shared resource | Nichelle | Zuri | **WCC Media** |
|---|---|---|---|
| Nginx (80/443, certbot) | `nichelle-api.conf` | `zuri-api.conf` | `wcc-media.conf` (API only) |
| App port (loopback) | 5050 | 5060 | **5070** |
| Redis (loopback, noeviction) | db 0 | db 1 | **db 2**, prefix `wcc` |
| systemd | nichelle-api/worker | zuri-api | **wcc-api, wcc-worker** |
| Memory cap | 1 G + 1.5 G | 1.5 G | **640 M + 1.5 G** |

The worker (sharp/ffmpeg) is capped at 2 of 4 cores, `Nice=10`, idle I/O, one
video + two image jobs at a time, and keeps 15 GB of disk free. Set
`VIDEO_TRANSCODE_ENABLED=false` if the box is ever tight.

### 1. Server (once)

```bash
scp -r infra/server deploy@SERVER_IP:/tmp/wcc-setup
ssh -t deploy@SERVER_IP 'sudo bash /tmp/wcc-setup/setup.sh'
sudo certbot --nginx -d <ip-with-dashes>.sslip.io --redirect -m you@example.com --agree-tos -n
sudoedit /etc/wcc/app.env     # WEB_ORIGIN (Vercel URL), DATABASE_URL + DATABASE_MIGRATION_URL, AWS, PLUNK_SECRET
```

`<ip-with-dashes>.sslip.io` (e.g. `13-140-180-190.sslip.io`) is a public name
for the server's IP, so Let's Encrypt can issue a certificate without a domain.
`setup.sh` prints the **API_PROXY_SECRET** for Vercel at the end (also in
`/etc/wcc/proxy-secret`).

### 2. GitHub (API deploys)

Settings → Environments → `production`:
- variables: `SSH_HOST`, `SSH_KNOWN_HOSTS` (`ssh-keyscan SERVER_IP`), `API_URL` (`https://13-140-180-190.sslip.io`), optional `SSH_USER`
- secret: `SSH_PRIVATE_KEY`

Push to `main` → CI → Deploy builds the API + worker, uploads, installs, runs
`prisma migrate deploy` + the category seed, restarts, health-checks and rolls
back on failure. First admin after the first deploy:

```bash
sudo -u wcc bash -c 'set -a; . /etc/wcc/app.env; cd /srv/wcc-media/current && node apps/api/dist/cli.js create-admin'
```

Roll back: `bash /srv/wcc-media/current/infra/server/rollback.sh`.
Logs: `journalctl -u wcc-api -u wcc-worker -f`.

## Vercel (web)

1. New Project → import the repo → **Root Directory: `apps/web`** (framework: Next.js; `apps/web/vercel.json` sets the monorepo install/build commands).
2. Environment Variables:
   | Name | Value |
   |---|---|
   | `API_INTERNAL_URL` | `https://13-140-180-190.sslip.io` |
   | `API_PROXY_SECRET` | from `setup.sh` |
   | `MEDIA_ORIGINS` | `https://wcc-media-prod.s3.eu-north-1.amazonaws.com,https://d2ud7dnsrj488l.cloudfront.net` |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1` (uses the repo's pinned pnpm) |
3. Deploy, then put the Vercel URL into `WEB_ORIGIN` in `/etc/wcc/app.env` and restart: `sudo systemctl restart wcc-api wcc-worker`.
4. Add the Vercel URL to the S3 bucket's CORS `AllowedOrigins` (uploads go browser → S3).

Preview deployments get different URLs; add any you want to use to
`CORS_ORIGINS` (comma separated) in `app.env`, or test on the production URL.

## Later: a real domain

Point e.g. `media.westendcity.church` at Vercel (Vercel → Domains), then set
`WEB_ORIGIN` to it, add it to the S3 CORS rules, and send password-reset/invite
links from there. The API can keep its sslip.io name or get `api.…` + certbot —
only `API_INTERNAL_URL` in Vercel changes. CloudFront signed cookies
(`MEDIA_DELIVERY_MODE=cloudfront`) need the web app and CDN on one parent
domain (`COOKIE_DOMAIN`), so switch that on only after the domain exists.

## Push notifications (once)

Attendance reminders (Sat 20:00, Sun 13:00) and the day's numbers (Sat 22:00,
Sun 18:00), Ghana time, are sent by the worker with Web Push.

```bash
cd /srv/wcc-media/current/apps/worker && npx web-push generate-vapid-keys
sudoedit /etc/wcc/app.env      # paste VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY
sudo systemctl restart wcc-api wcc-worker
```

Generate the pair **once** and keep it: changing it cuts off every device that
already turned notifications on. Times are in `NOTIFY_TZ` and can be changed with
`REMINDER_CRON_*` / `STATS_CRON_*`; `NOTIFICATIONS_ENABLED=false` stops them.
On iPhone, notifications work only in the installed app (iOS 16.4+).

## Database on the VPS (once)

WCC uses its own database (`wcc_media`) on the PostgreSQL already on the server,
with two roles: `wcc_owner` (migrations) and `wcc_app` (the API and worker: rows
only, audit log append-only). Nothing of Zuri's is touched.

```bash
scp -r infra/server deploy@SERVER_IP:/tmp/wcc-setup
ssh -t deploy@SERVER_IP 'sudo bash /tmp/wcc-setup/setup-db.sh'   # roles, database, backups; rewrites DATABASE_* in app.env
# GitHub → Actions → Deploy → Re-run (creates the tables as wcc_owner)
ssh -t deploy@SERVER_IP 'sudo bash /tmp/wcc-setup/import-from-neon.sh'   # one-off copy of the Neon data
```

- `setup-db.sh` saves the old Neon URL to `/etc/wcc/neon.env` for the import; delete
  that file once you're happy.
- The import needs `pg_dump` at least as new as Neon's PostgreSQL; the script says how
  to install just the client if it's missing.
- Backups: `/var/backups/wcc`, nightly at 02:30 and before every deploy's migrations,
  14 days kept (always the newest 5). Restore: `sudo wcc-restore-db <file>`.
- Backups stay on the same disk. For off-site copies, sync `/var/backups/wcc` elsewhere.
