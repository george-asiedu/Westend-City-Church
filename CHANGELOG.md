# Changelog

## 0.1.0 — 2026-11-08

- Phase 0: pnpm + Turborepo monorepo; shared + db packages; Prisma schema, extras migration, seed (11 folders incl. Bacenta and Regional services).
- Phase 1: invite-only auth (argon2id, lockout, TOTP 2FA + recovery codes, mandatory for admins), refresh rotation with reuse detection, CSRF, sessions, users/invitations admin, PolicyService with the full §6 matrix tested.
- Phase 2: categories with Year/Month timeline, events CRUD, Add-media wizard.
- Phase 3: direct-to-S3 uploads (single + resumable multipart via Uppy), worker pipeline (magic bytes, EXIF, HEIC, RAW, posters, 720p previews), s3-presign and CloudFront delivery, presigned downloads.
- Phase 4: captions, tags, featured, bulk actions, covers, search, Trash with purge, maintenance jobs, audit log.
- Phase 5: VPS setup/deploy/rollback/backup alongside the existing apps, nginx site, systemd units, AWS policies, CI/CD.
- §19: share links, ZIP exports, PWA + resumable offline-tolerant upload queue, RAW support, public highlights, storage dashboard.

## 0.2.0 — 2026-11-08

- Hosting split: web on Vercel (middleware proxies `/api/*` to the VPS with a shared key + real client IP), API + worker on the VPS, database on Neon.
- VPS: removed the web service, local database, and DB backup timer; nginx site is API-only.
- Email via Plunk with an AWS-style transactional layout.
- Fixes: BullMQ job ids, API dev mode (tsc instead of tsx), uploader under React Strict Mode, separate dev build folder.
