# WCC Media — The Life Cathedral

Private, invite-only media gallery for Westend City Church. Pastors and the
Media Bacenta post, find, edit and share photos and videos from every
service and event. Spec: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Monorepo

| Path | What |
|---|---|
| `apps/web` | Next.js 15 PWA (App Router, Tailwind v4, TanStack Query, Uppy, YARL) |
| `apps/api` | NestJS 11 API (`/api/v1`) |
| `apps/worker` | BullMQ worker: sharp, ffmpeg, exiftool, ZIP exports, cleanup, mail |
| `packages/shared` | Enums, category seed, limits, zod schemas, queue contracts |
| `packages/db` | Prisma schema, migrations, seed, counter helpers |
| `infra/server` | VPS setup/deploy/rollback scripts, systemd units, nginx site (API + worker) |
| `infra/aws` | S3 bucket policy, CORS, lifecycle, IAM policies |

## Folders

Sunday 1st Service · Sunday 2nd Service · Impartation Service · Turning Point
Service · The Y Element Service · **Bacenta Service** · **Regional Service** ·
The Save Church (Kids) · Other Church Programs · Camps · Conferences.
Each holds dated events; the Year → Month tree is derived from event dates.

## Local development

Prerequisites: Node 22+, pnpm 11 (`corepack enable`), a Neon database (or local PostgreSQL 16+),
Docker (for Redis), ffmpeg, and for iPhone photos `heif-convert`
(`sudo apt install libheif-examples libheif-plugin-libde265`).

```bash
pnpm install
cp .env.example .env          # fill JWT_ACCESS_SECRET, APP_ENCRYPTION_KEY, AWS dev keys
# DATABASE_URL = Neon pooled URL, DATABASE_MIGRATION_URL = Neon direct URL
pnpm dev:services             # Redis :6379
set -a; . ./.env; set +a; pnpm db:deploy && pnpm db:seed
pnpm dev                      # web :3000 (proxies /api), api :4000, worker
```

Sign in at http://localhost:3000 with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`;
you will be asked to set up 2FA first (admins). The dev S3 bucket needs the
CORS rules in `infra/aws/s3-cors.json` with `http://localhost:3000` added.

Commands: `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm db:migrate` (new migration).

## How it fits together

- **Hosting:** web on Vercel, API + worker on the VPS, database on Neon.
- **One origin.** The browser only talks to the web origin; its middleware
  proxies `/api/*` to the API (localhost in dev, the VPS in production). Auth
  cookies are host-only, httpOnly, with CSRF double-submit + Origin checks.
- **Bytes never touch the API.** Uppy uploads straight to S3 with presigned
  PUT/multipart URLs signed by the API; the worker verifies magic bytes,
  extracts EXIF, renders variants (GPS stripped) and video posters/720p previews
  (ffmpeg reads the original from S3 over HTTPS — no 20 GB temp files).
- **Delivery** is `s3-presign` (works today) or `cloudfront` (signed cookies,
  once the domain exists) — an env switch; the web app never builds media URLs.

## Beyond the v1 spec (from §19)

- **Share links** for outsiders: whole event or a selection, expiry (1–90 days),
  optional password, download on/off, view/download counts, revoke anytime,
  "Download all" ZIP for the family. Tokens are stored hashed; pages are noindex.
- **ZIP downloads** of an event or a selection (streamed S3 → ZIP → S3, emailed when ready).
- **PWA**: installable, offline shell, update prompt, and an upload queue that
  survives reloads, crashes and dropped connections (Uppy Golden Retriever +
  resumable multipart).
- **RAW photos** (.cr2 .cr3 .nef .arw .dng): originals kept, previews from the embedded JPEG.
- **Public highlights** page (`/highlights`, off by default): only items an admin marks.
- **Storage dashboard** per folder and year, with a rough monthly cost.

Not built (and why): AI tagging/face grouping (needs a privacy review first),
download watermarking, and ministry/branch scoping (needs a decision on how
the church wants to model it).
