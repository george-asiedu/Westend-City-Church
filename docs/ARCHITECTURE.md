# Westend City Church (The Life Cathedral) — Media Gallery Platform

## System Architecture & Implementation Specification

> **Audience:** Claude Code, the implementer. This document is the source of truth. Where it is silent, follow the conventions in §17. Where it is ambiguous, pick the more secure option and leave a `// DECISION:` comment.

| Item | Value |
|---|---|
| Owner | Media Bacenta, Westend City Church |
| Primary users | Pastors, Media Bacenta team, Church admins |
| Frontend | Next.js 15 (App Router, TypeScript) |
| Backend API | NestJS 11 (TypeScript) |
| Database | PostgreSQL 16 (local + pgAdmin in dev; on the Contabo VPS in prod) |
| ORM | Prisma 6 |
| Media storage | AWS S3 (private bucket) |
| Media delivery | AWS CloudFront (Origin Access Control + signed cookies) |
| Background jobs | BullMQ + Redis 7 (image/video processing, cleanup) |
| Hosting | Contabo VPS (Ubuntu 24.04 LTS), Docker Compose, Caddy reverse proxy (auto-TLS) |

---

## Table of Contents

1. [Goals & Scope](#1-goals--scope)
2. [Domain Model: Folders, Sub-folders, Media](#2-domain-model)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Repository Layout](#4-repository-layout)
5. [Database Schema (Prisma)](#5-database-schema)
6. [Roles & Permissions](#6-roles--permissions)
7. [Authentication & Session Security](#7-authentication--session-security)
8. [Media Pipeline: Upload → Process → Deliver](#8-media-pipeline)
9. [S3 & CloudFront Configuration](#9-s3--cloudfront-configuration)
10. [API Specification](#10-api-specification)
11. [Frontend (Next.js) Specification](#11-frontend-specification)
12. [Background Workers](#12-background-workers)
13. [Security Controls Checklist](#13-security-controls-checklist)
14. [Environments & Configuration](#14-environments--configuration)
15. [VPS Deployment (Contabo)](#15-vps-deployment-contabo)
16. [Backups, Monitoring & Operations](#16-backups-monitoring--operations)
17. [Coding Conventions for Implementation](#17-coding-conventions)
18. [Implementation Phases & Acceptance Criteria](#18-implementation-phases)
19. [Future Enhancements](#19-future-enhancements)

---

## 1. Goals & Scope

### 1.1 Problem
The Media Bacenta photographs and films every church service and event. Pastors need one secure place to **post, view, edit and delete** that media, organised so they can find "the photos from Turning Point Service on 18 October" in seconds.

### 1.2 In scope (v1)
- Private, invite-only web dashboard.
- Nine fixed **categories** (main folders):
  1. Sunday 1st Service
  2. Sunday 2nd Service
  3. Impartation Service
  4. Turning Point Service
  5. The Y Element Service
  6. The Save Church (Kids)
  7. Other Church Programs
  8. Camps
  9. Conferences
- Each category holds **events** (date sub-folders), e.g. `Sunday 1st Service / 2026-11-08`.
- Upload photos and videos (large files, resumable, direct-to-S3).
- Thumbnails, previews and video posters generated automatically.
- View in grid and lightbox, download a single file, bulk-select, bulk-delete, move media between events.
- Edit event details (title, date, description, cover image) and media details (caption, tags, featured).
- Soft delete with a 30-day Trash and restore.
- Audit log of every create/update/delete.
- Role-based access control (see §6).

### 1.3 Out of scope for v1 (see §19)
Public gallery, share links for non-users, face recognition, livestream integration, mobile app, ZIP download of a whole event (Phase 2).

### 1.4 Non-functional targets
| Concern | Target |
|---|---|
| Upload size | Images ≤ 60 MB each; videos ≤ 20 GB each (multipart) |
| Batch upload | 500+ files in one session, resumable after network drop |
| Gallery load | First 60 thumbnails visible < 1.5 s on 4G |
| Availability | Single VPS; restore from backup in < 2 h |
| Security | OWASP ASVS L2 practices; no public access to any media object |

---

## 2. Domain Model

```
Category (main folder, fixed list, seeded)
 └── Event (date sub-folder: one occurrence of a service/program)
      └── MediaAsset (a photo or video)
           └── MediaVariant (thumbnail, preview, poster, 720p preview video)
```

### 2.1 Rules
- **Category** — seeded, renamable by Super Admin, never hard-deleted. Has `allowsMultiDay` (true for Camps and Conferences).
- **Event** — belongs to exactly one category. Has `eventDate` (start) and optional `endDate` (only when the category allows multiple days).
  - For the Sunday services and the weekly services, one event per date is the norm, but allow more than one (unique on `categoryId + eventDate + slug`).
  - The default title is generated as `"{Category name} — {D MMM YYYY}"`; users can edit it (e.g. "Swollen Sunday", "Baby Christening — Ama & Kofi", "Funeral of Elder X").
  - **Other Church Programs** is where outreach, christenings, funerals and similar go. A free-text `programType` field plus tags let these be filtered.
- **Date grouping** in the UI is *derived*: Category → Year → Month → Event. There are no physical folders; S3 keys use IDs (§9.3), so renaming or redating an event never moves objects.
- **MediaAsset** belongs to exactly one event; it can be *moved* to another event (a DB update only).

### 2.2 Seed data (exact)

| sortOrder | slug | name | allowsMultiDay |
|---|---|---|---|
| 1 | `sunday-1st-service` | Sunday 1st Service | false |
| 2 | `sunday-2nd-service` | Sunday 2nd Service | false |
| 3 | `impartation-service` | Impartation Service | false |
| 4 | `turning-point-service` | Turning Point Service | false |
| 5 | `y-element-service` | The Y Element Service | false |
| 6 | `save-church-kids` | The Save Church (Kids) | false |
| 7 | `other-church-programs` | Other Church Programs | true |
| 8 | `camps` | Camps | true |
| 9 | `conferences` | Conferences | true |

---

## 3. High-Level Architecture

```mermaid
flowchart LR
    subgraph Client
      B[Browser<br/>Next.js app]
    end

    subgraph VPS["Contabo VPS (Docker Compose)"]
      C[Caddy<br/>TLS + reverse proxy]
      W[web<br/>Next.js server]
      A[api<br/>NestJS]
      K[worker<br/>NestJS + BullMQ<br/>sharp / ffmpeg]
      R[(Redis)]
      P[(PostgreSQL 16)]
    end

    subgraph AWS
      S3[(S3 bucket<br/>private)]
      CF[CloudFront<br/>OAC + signed cookies]
    end

    B -- HTTPS app.domain --> C --> W
    B -- HTTPS api.domain --> C --> A
    A --> P
    A --> R
    K --> R
    K --> P
    A -- presigned PUT/multipart URLs --> B
    B -- direct upload (PUT) --> S3
    K -- GetObject / PutObject variants --> S3
    B -- thumbnails/previews<br/>cdn.domain (signed cookie) --> CF --> S3
    A -- presigned GET (downloads) --> B
```

### 3.1 Key design decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Browser uploads straight to S3** with presigned URLs (S3 multipart for files > 100 MB). The API never handles file bytes. | VPS bandwidth and RAM are protected; uploads can resume; the 20 GB videos work. |
| D2 | **Bucket is fully private**; CloudFront reaches it through **Origin Access Control (OAC)**; viewers need **CloudFront signed cookies**, issued by the API to logged-in users. | No media is ever publicly reachable. Signed cookies (not signed URLs) keep thumbnail URLs stable, so browser caching works for galleries with hundreds of images. |
| D3 | **Downloads of originals** use short-lived (5 min) **S3 presigned GET URLs** with `response-content-disposition=attachment`. | You get the correct filename on download, the access is audited per file, and the link expires quickly. |
| D4 | **Processing runs on the VPS** (BullMQ worker with `sharp` + `ffmpeg`). | Simple, one codebase, no Lambda packaging. Each original is fetched once (S3 egress is small). Concurrency is capped so the API stays responsive. |
| D5 | **Folder hierarchy is virtual** (DB rows); S3 keys are ID-based. | Rename, redate or move without copying objects. |
| D6 | **Auth tokens live in httpOnly, Secure, SameSite=Lax cookies** on the parent domain, with a CSRF double-submit token for mutations. | JavaScript cannot read the tokens (XSS-resistant), and CSRF is mitigated. |
| D7 | **Monorepo** (pnpm workspaces + Turborepo) with a shared package for types and constants. | One source of truth for enums, DTO shapes and the category list. |

### 3.2 Domains (example; replace with real ones)
| Purpose | Host |
|---|---|
| Web app | `media.westendcity.church` |
| API | `api.media.westendcity.church` |
| CDN (CloudFront CNAME) | `cdn.media.westendcity.church` |

**All three must share the same registrable parent domain.** The cookies (auth and CloudFront) are set with `Domain=.media.westendcity.church`.

---

## 4. Repository Layout

```
wcc-media/
├── apps/
│   ├── web/                      # Next.js 15 app
│   │   ├── app/
│   │   │   ├── (auth)/login/page.tsx
│   │   │   ├── (auth)/accept-invite/[token]/page.tsx
│   │   │   ├── (auth)/forgot-password/page.tsx
│   │   │   ├── (auth)/reset-password/[token]/page.tsx
│   │   │   ├── (dashboard)/layout.tsx
│   │   │   ├── (dashboard)/page.tsx                       # Home: categories + recent events
│   │   │   ├── (dashboard)/c/[categorySlug]/page.tsx      # Category: year/month → events
│   │   │   ├── (dashboard)/e/[eventId]/page.tsx           # Event gallery
│   │   │   ├── (dashboard)/e/[eventId]/upload/page.tsx
│   │   │   ├── (dashboard)/search/page.tsx
│   │   │   ├── (dashboard)/trash/page.tsx
│   │   │   ├── (dashboard)/admin/users/page.tsx
│   │   │   ├── (dashboard)/admin/audit/page.tsx
│   │   │   ├── (dashboard)/admin/categories/page.tsx
│   │   │   └── (dashboard)/account/page.tsx               # Profile, password, 2FA, sessions
│   │   ├── components/ (ui/, gallery/, upload/, layout/)
│   │   ├── lib/ (api-client.ts, auth.ts, query-keys.ts, format.ts)
│   │   ├── middleware.ts
│   │   └── next.config.ts
│   ├── api/                      # NestJS HTTP API
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       ├── config/           # typed config + zod env validation
│   │       ├── common/           # guards, interceptors, filters, decorators, pipes
│   │       ├── prisma/
│   │       ├── auth/
│   │       ├── users/
│   │       ├── invitations/
│   │       ├── categories/
│   │       ├── events/
│   │       ├── media/
│   │       ├── uploads/
│   │       ├── delivery/         # CloudFront cookies, presigned downloads
│   │       ├── tags/
│   │       ├── trash/
│   │       ├── audit/
│   │       ├── mail/
│   │       ├── storage/          # S3 client wrapper (StorageService)
│   │       ├── queue/            # BullMQ producers
│   │       └── health/
│   └── worker/                   # NestJS standalone app (no HTTP) — BullMQ consumers
│       └── src/
│           ├── main.ts
│           ├── processors/ (image.processor.ts, video.processor.ts, cleanup.processor.ts)
│           └── lib/ (sharp.ts, ffmpeg.ts, file-type.ts)
├── packages/
│   ├── shared/                   # enums, zod schemas, constants (categories, limits), API types
│   ├── db/                       # prisma/schema.prisma, migrations, seed.ts, generated client
│   ├── eslint-config/
│   └── tsconfig/
├── infra/
│   ├── docker/ (api.Dockerfile, worker.Dockerfile, web.Dockerfile)
│   ├── compose/ (docker-compose.prod.yml, docker-compose.dev.yml)
│   ├── caddy/Caddyfile
│   ├── aws/ (s3-bucket-policy.json, s3-cors.json, s3-lifecycle.json, iam-api-policy.json, iam-backup-policy.json)
│   └── scripts/ (backup-db.sh, restore-db.sh, vps-bootstrap.sh)
├── .github/workflows/ (ci.yml, deploy.yml)
├── turbo.json
├── pnpm-workspace.yaml
├── .env.example
└── README.md
```

---

## 5. Database Schema

PostgreSQL 16. Prisma is the schema source of truth (`packages/db/prisma/schema.prisma`). Use the `citext` extension for case-insensitive emails and `pg_trgm` for search.

### 5.1 Prisma schema

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions", "fullTextSearchPostgres"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [citext, pg_trgm]
}

// ───────────────────────── Enums ─────────────────────────

enum Role {
  SUPER_ADMIN     // church admin / tech lead: everything incl. users & categories
  MEDIA_ADMIN     // Media Bacenta lead: manage all media/events, invite MEDIA_TEAM & PASTOR
  MEDIA_TEAM      // Media Bacenta member: upload + manage own uploads in granted categories
  PASTOR          // view/download all; create events, upload, edit/delete own content in granted categories
  VIEWER          // view/download only (e.g. church office, graphics team)
}

enum UserStatus {
  INVITED
  ACTIVE
  SUSPENDED
}

enum MediaType {
  IMAGE
  VIDEO
}

enum MediaStatus {
  PENDING_UPLOAD  // row created, upload not completed
  UPLOADED        // object verified in S3, waiting for processing
  PROCESSING
  READY
  FAILED
}

enum VariantKind {
  THUMB          // 400px longest edge, webp
  PREVIEW        // 1600px longest edge, webp
  POSTER         // video poster frame, jpg 1280px
  VIDEO_PREVIEW  // 720p H.264/AAC mp4, faststart
}

enum EventStatus {
  DRAFT          // visible only to creator + admins (e.g. still uploading)
  PUBLISHED
}

// ───────────────────────── Identity ─────────────────────────

model User {
  id                 String     @id @default(uuid()) @db.Uuid
  email              String     @unique @db.Citext
  fullName           String     @db.VarChar(120)
  title              String?    @db.VarChar(40)    // "Rev.", "Pastor", "Bishop", "Bro."
  phone              String?    @db.VarChar(30)
  role               Role       @default(VIEWER)
  status             UserStatus @default(INVITED)
  passwordHash       String?                       // argon2id; null until invite accepted
  passwordChangedAt  DateTime?
  totpSecretEnc      String?                       // AES-256-GCM encrypted
  totpEnabled        Boolean    @default(false)
  failedLoginCount   Int        @default(0)
  lockedUntil        DateTime?
  lastLoginAt        DateTime?
  avatarKey          String?
  createdAt          DateTime   @default(now())
  updatedAt          DateTime   @updatedAt

  sessions           Session[]
  categoryAccess     UserCategoryAccess[]
  eventsCreated      Event[]    @relation("EventCreatedBy")
  mediaUploaded      MediaAsset[] @relation("MediaUploadedBy")
  invitationsSent    Invitation[] @relation("InvitedBy")
  auditLogs          AuditLog[]
  passwordResets     PasswordResetToken[]
  recoveryCodes      RecoveryCode[]

  @@index([role])
  @@index([status])
}

model Session {
  id            String    @id @default(uuid()) @db.Uuid
  userId        String    @db.Uuid
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  familyId      String    @db.Uuid               // refresh-token rotation family
  refreshHash   String    @unique                // sha256 of refresh token
  userAgent     String?   @db.VarChar(400)
  ipAddress     String?   @db.Inet
  expiresAt     DateTime
  lastUsedAt    DateTime  @default(now())
  revokedAt     DateTime?
  revokedReason String?   @db.VarChar(60)        // LOGOUT | ROTATED | REUSE_DETECTED | ADMIN | PASSWORD_CHANGE
  createdAt     DateTime  @default(now())

  @@index([userId])
  @@index([familyId])
  @@index([expiresAt])
}

model Invitation {
  id           String    @id @default(uuid()) @db.Uuid
  email        String    @db.Citext
  role         Role
  categoryIds  String[]  @db.Uuid                // initial category grants
  tokenHash    String    @unique                 // sha256 of the emailed token
  invitedById  String    @db.Uuid
  invitedBy    User      @relation("InvitedBy", fields: [invitedById], references: [id])
  expiresAt    DateTime                          // 72h
  acceptedAt   DateTime?
  revokedAt    DateTime?
  createdAt    DateTime  @default(now())

  @@index([email])
}

model PasswordResetToken {
  id         String    @id @default(uuid()) @db.Uuid
  userId     String    @db.Uuid
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique
  expiresAt  DateTime                            // 30 min
  usedAt     DateTime?
  createdAt  DateTime  @default(now())
}

model RecoveryCode {
  id        String    @id @default(uuid()) @db.Uuid
  userId    String    @db.Uuid
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  codeHash  String                               // argon2id
  usedAt    DateTime?

  @@index([userId])
}

// ───────────────────────── Taxonomy ─────────────────────────

model Category {
  id             String   @id @default(uuid()) @db.Uuid
  slug           String   @unique @db.VarChar(60)
  name           String   @db.VarChar(80)
  description    String?  @db.VarChar(500)
  sortOrder      Int
  allowsMultiDay Boolean  @default(false)
  isActive       Boolean  @default(true)
  coverMediaId   String?  @db.Uuid
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  events         Event[]
  userAccess     UserCategoryAccess[]
}

/// Grants upload/manage rights in a category to MEDIA_TEAM / PASTOR users.
/// All ACTIVE users can VIEW all categories (configurable later via canView).
model UserCategoryAccess {
  userId     String   @db.Uuid
  categoryId String   @db.Uuid
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  category   Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  canView    Boolean  @default(true)
  canUpload  Boolean  @default(false)
  canManage  Boolean  @default(false)   // edit/delete ANY content in this category
  grantedAt  DateTime @default(now())
  grantedBy  String?  @db.Uuid

  @@id([userId, categoryId])
}

// ───────────────────────── Content ─────────────────────────

model Event {
  id            String      @id @default(uuid()) @db.Uuid
  categoryId    String      @db.Uuid
  category      Category    @relation(fields: [categoryId], references: [id])
  title         String      @db.VarChar(160)
  slug          String      @db.VarChar(180)
  eventDate     DateTime    @db.Date
  endDate       DateTime?   @db.Date
  programType   String?     @db.VarChar(60)   // e.g. "Outreach", "Christening", "Funeral", "Swollen Sunday"
  location      String?     @db.VarChar(160)
  description   String?     @db.Text
  status        EventStatus @default(PUBLISHED)
  coverMediaId  String?     @db.Uuid
  mediaCount    Int         @default(0)       // denormalized; maintained in a transaction
  photoCount    Int         @default(0)
  videoCount    Int         @default(0)
  totalBytes    BigInt      @default(0)
  createdById   String      @db.Uuid
  createdBy     User        @relation("EventCreatedBy", fields: [createdById], references: [id])
  updatedById   String?     @db.Uuid
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
  deletedAt     DateTime?
  deletedById   String?     @db.Uuid

  media         MediaAsset[]

  @@unique([categoryId, eventDate, slug])
  @@index([categoryId, eventDate(sort: Desc)])
  @@index([eventDate])
  @@index([deletedAt])
}

model MediaAsset {
  id               String      @id @default(uuid()) @db.Uuid
  eventId          String      @db.Uuid
  event            Event       @relation(fields: [eventId], references: [id])
  uploadedById     String      @db.Uuid
  uploadedBy       User        @relation("MediaUploadedBy", fields: [uploadedById], references: [id])
  type             MediaType
  status           MediaStatus @default(PENDING_UPLOAD)

  originalFilename String      @db.VarChar(255)
  originalKey      String      @unique                 // S3 key of the original
  mimeType         String      @db.VarChar(100)        // claimed at init; verified by worker
  detectedMime     String?     @db.VarChar(100)        // from magic bytes
  sizeBytes        BigInt
  checksumSha256   String?     @db.VarChar(64)
  s3UploadId       String?                              // multipart upload id while in progress

  width            Int?
  height           Int?
  durationSec      Decimal?    @db.Decimal(10, 2)
  takenAt          DateTime?                            // EXIF DateTimeOriginal / video creation_time
  cameraModel      String?     @db.VarChar(120)

  caption          String?     @db.VarChar(1000)
  isFeatured       Boolean     @default(false)
  sortOrder        Int         @default(0)

  processingError  String?     @db.VarChar(1000)
  processingAttempts Int       @default(0)

  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt
  deletedAt        DateTime?
  deletedById      String?     @db.Uuid
  purgeAfter       DateTime?                            // deletedAt + 30 days

  variants         MediaVariant[]
  tags             MediaTag[]

  @@index([eventId, status, deletedAt])
  @@index([eventId, takenAt])
  @@index([uploadedById])
  @@index([status])
  @@index([purgeAfter])
}

model MediaVariant {
  id         String      @id @default(uuid()) @db.Uuid
  mediaId    String      @db.Uuid
  media      MediaAsset  @relation(fields: [mediaId], references: [id], onDelete: Cascade)
  kind       VariantKind
  key        String      @unique
  mimeType   String      @db.VarChar(100)
  width      Int?
  height     Int?
  sizeBytes  BigInt
  createdAt  DateTime    @default(now())

  @@unique([mediaId, kind])
}

model Tag {
  id        String     @id @default(uuid()) @db.Uuid
  name      String     @unique @db.Citext        // "Bishop", "Choir", "Ushers", "Baptism"
  createdAt DateTime   @default(now())
  media     MediaTag[]
}

model MediaTag {
  mediaId String     @db.Uuid
  tagId   String     @db.Uuid
  media   MediaAsset @relation(fields: [mediaId], references: [id], onDelete: Cascade)
  tag     Tag        @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([mediaId, tagId])
  @@index([tagId])
}

// ───────────────────────── Audit ─────────────────────────

model AuditLog {
  id         BigInt   @id @default(autoincrement())
  actorId    String?  @db.Uuid
  actor      User?    @relation(fields: [actorId], references: [id], onDelete: SetNull)
  action     String   @db.VarChar(60)    // e.g. MEDIA_UPLOADED, MEDIA_DELETED, EVENT_UPDATED, USER_INVITED, LOGIN_FAILED, MEDIA_DOWNLOADED
  entityType String   @db.VarChar(30)    // USER | EVENT | MEDIA | CATEGORY | SESSION | INVITATION
  entityId   String?  @db.VarChar(64)
  metadata   Json?                       // before/after diff, counts, filenames (no secrets)
  ipAddress  String?  @db.Inet
  userAgent  String?  @db.VarChar(400)
  createdAt  DateTime @default(now())

  @@index([entityType, entityId])
  @@index([actorId, createdAt(sort: Desc)])
  @@index([createdAt(sort: Desc)])
  @@index([action])
}
```

### 5.2 Additional raw SQL migration (after Prisma init)

Prisma cannot express everything. Add a migration such as `xxxx_extras/migration.sql`:

```sql
-- Event title trigram search
CREATE INDEX IF NOT EXISTS event_title_trgm ON "Event" USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS media_caption_trgm ON "MediaAsset" USING gin (caption gin_trgm_ops);
CREATE INDEX IF NOT EXISTS media_filename_trgm ON "MediaAsset" USING gin ("originalFilename" gin_trgm_ops);

-- endDate must be >= eventDate
ALTER TABLE "Event" ADD CONSTRAINT event_dates_chk
  CHECK ("endDate" IS NULL OR "endDate" >= "eventDate");

-- Non-negative counters
ALTER TABLE "Event" ADD CONSTRAINT event_counts_chk
  CHECK ("mediaCount" >= 0 AND "photoCount" >= 0 AND "videoCount" >= 0 AND "totalBytes" >= 0);

-- Audit log is append-only for the app role
REVOKE UPDATE, DELETE ON "AuditLog" FROM wcc_app;
```

### 5.3 Database roles
- `wcc_owner` runs migrations (owns the schema). It is used only by `prisma migrate deploy` in the deploy step.
- `wcc_app` is the runtime role for the API and worker. It has `SELECT, INSERT, UPDATE, DELETE` on all tables except AuditLog, where it has `INSERT, SELECT` only. It has no DDL rights.
- `wcc_backup` has read-only access and is used by `pg_dump`.

### 5.4 Counter maintenance
`Event.mediaCount/photoCount/videoCount/totalBytes` count only `READY`, non-deleted media. Update them in the **same transaction** as the status change, delete, restore or move (`increment`/`decrement`). Add a nightly reconciliation job (§12) that recomputes them from scratch.

---

## 6. Roles & Permissions

### 6.1 Matrix

| Capability | SUPER_ADMIN | MEDIA_ADMIN | MEDIA_TEAM | PASTOR | VIEWER |
|---|:-:|:-:|:-:|:-:|:-:|
| View all categories/events/media (published) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Download originals | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create event | ✅ | ✅ | granted cats (`canUpload`) | granted cats (`canUpload`) | ❌ |
| Upload media | ✅ | ✅ | granted cats | granted cats | ❌ |
| Edit/delete **own** events & media | ✅ | ✅ | ✅ | ✅ | ❌ |
| Edit/delete **any** content in a category | ✅ | ✅ | if `canManage` | if `canManage` | ❌ |
| Move media between events | ✅ | ✅ | if `canManage` on both | if `canManage` on both | ❌ |
| View Trash / restore | ✅ all | ✅ all | own items | own items | ❌ |
| Permanently delete from Trash | ✅ | ✅ | ❌ | ❌ | ❌ |
| Invite users | ✅ any role | ✅ MEDIA_TEAM/PASTOR/VIEWER | ❌ | ❌ | ❌ |
| Change roles / suspend users | ✅ | ✅ (not admins) | ❌ | ❌ | ❌ |
| Manage categories | ✅ | ❌ | ❌ | ❌ | ❌ |
| View audit log | ✅ | ✅ | ❌ | ❌ | ❌ |

`DRAFT` events are visible only to their creator, to users with `canManage` on the category, and to admins.

### 6.2 Implementation
- `@Roles(...)` decorator plus `RolesGuard` for coarse checks.
- `PolicyService` (CASL-like but hand-written, kept simple) with methods such as `canCreateEvent(user, categoryId)`, `canEditMedia(user, media)`, `canDeleteEvent(user, event)`. Every service method that mutates content **must** call the policy. Controllers must not do authorisation logic inline.
- Policy decisions load `UserCategoryAccess` once per request (cache it on `req.user`).
- Unit-test every cell of the matrix (table-driven tests).

---

## 7. Authentication & Session Security

### 7.1 Onboarding (invite-only, no public sign-up)
1. An admin calls `POST /invitations` with `{ email, role, categoryIds[] }`.
2. The API generates a 32-byte random token, stores its `sha256` and emails the link `https://media.../accept-invite/{token}` (it expires in 72 h).
3. The user opens the link, sets their name and a password (min 12 chars, checked against the zxcvbn score ≥ 3 and the HaveIBeenPwned k-anonymity API—optional, behind a flag). The user becomes `ACTIVE`.
4. 2FA (TOTP) is **mandatory for SUPER_ADMIN and MEDIA_ADMIN** (enforced at next login) and optional for others.

### 7.2 Login
- `POST /auth/login { email, password, totp? }`
- Passwords are hashed with **argon2id** (`memoryCost=19456, timeCost=2, parallelism=1`).
- Error messages are generic ("Invalid email or password"). Run a constant-time dummy hash when the user doesn't exist.
- Lockout: after 5 failures the account is locked for 15 min (`lockedUntil`). The throttle also applies per IP (§13).
- When TOTP is enabled and not supplied, return `401 { code: "TOTP_REQUIRED" }`.

### 7.3 Tokens
| Token | Format | Lifetime | Storage |
|---|---|---|---|
| Access | JWT (HS256 by default, secret ≥ 64 bytes; or EdDSA), claims: `sub`, `role`, `sid`, `iat`, `exp` | 15 min | Cookie `wcc_at`: httpOnly, Secure, SameSite=Lax, Domain=parent, Path=/ |
| Refresh | 32-byte random, opaque | 14 days (sliding), 60 days absolute | Cookie `wcc_rt`: httpOnly, Secure, SameSite=Strict, **Path=/auth/refresh** |
| CSRF | 32-byte random | session | Cookie `wcc_csrf` (readable by JS); client echoes it in the `X-CSRF-Token` header |
| CloudFront | Signed cookies (`CloudFront-Policy`, `-Signature`, `-Key-Pair-Id`) | 2 h | Domain=parent, Path=/, Secure, httpOnly |

- **Refresh rotation with reuse detection:** each refresh issues a new token and revokes the old one (`ROTATED`). If a revoked token is presented again, revoke the whole `familyId` (`REUSE_DETECTED`) and write an audit entry.
- On password change or admin suspension, revoke all the user's sessions.
- `JwtAuthGuard` also checks that `sid` is still active (a lookup in a Redis cache with a 60 s TTL, falling back to the DB), so revocation takes effect within 1 minute.
- `GET /auth/sessions` and `DELETE /auth/sessions/:id` let users see and kill their devices.

### 7.4 CSRF
For every non-GET request: the `X-CSRF-Token` header must equal the `wcc_csrf` cookie (constant-time compare), **and** the `Origin` header must be in `CORS_ORIGINS`. This is implemented as a global guard that skips `GET/HEAD/OPTIONS`, `/auth/login` (Origin check only), and `/health`.

### 7.5 Password reset
`POST /auth/forgot-password` always returns 204. It emails a single-use 30-minute token. Resetting revokes all sessions.

---

## 8. Media Pipeline

### 8.1 Sequence

```mermaid
sequenceDiagram
    autonumber
    participant U as Browser (Uppy)
    participant A as API
    participant S3 as S3
    participant Q as Redis/BullMQ
    participant W as Worker
    participant DB as Postgres

    U->>A: POST /uploads/init {eventId, files:[{name,size,mime,clientId}]}
    A->>A: policy.canUpload + validate type/size
    A->>DB: insert MediaAsset rows (PENDING_UPLOAD)
    A->>S3: CreateMultipartUpload (if size > 100MB)
    A-->>U: [{mediaId, key, strategy: "single"|"multipart", uploadId?, putUrl?}]
    alt single PUT (≤100MB)
        U->>S3: PUT presigned URL (Content-Type fixed)
    else multipart
        loop each part (16MB parts; 4 parallel)
            U->>A: POST /uploads/:mediaId/parts {partNumbers:[...]}
            A-->>U: presigned UploadPart URLs (15 min)
            U->>S3: PUT part → ETag
        end
        U->>A: POST /uploads/:mediaId/complete {parts:[{PartNumber,ETag}]}
        A->>S3: CompleteMultipartUpload
    end
    U->>A: POST /uploads/:mediaId/finalize (single PUT path; multipart does it inside /complete)
    A->>S3: HeadObject → verify size matches
    A->>DB: status = UPLOADED
    A->>Q: enqueue media.process {mediaId}
    W->>Q: consume
    W->>DB: status = PROCESSING
    W->>S3: GetObject (stream)
    W->>W: magic-byte check, EXIF, sharp/ffmpeg variants
    W->>S3: PutObject variants
    W->>DB: insert MediaVariant, metadata, status = READY, bump Event counters
    U->>A: GET /events/:id/media (polls every 3s while any item ≠ READY, or SSE)
```

### 8.2 Upload rules (enforced at `/uploads/init`, and again by the worker)
| | Images | Videos |
|---|---|---|
| Allowed MIME | `image/jpeg`, `image/png`, `image/heic`, `image/heif`, `image/webp`, `image/tiff` | `video/mp4`, `video/quicktime`, `video/x-matroska`, `video/webm` |
| Allowed ext | `.jpg .jpeg .png .heic .heif .webp .tif .tiff` | `.mp4 .mov .mkv .webm` |
| Max size | 60 MB | 20 GB |
| RAW files | Phase 2 (`.cr2 .cr3 .nef .arw .dng`): store as originals, generate preview from embedded JPEG | — |

- Max 1,000 files per `init` call. The client batches by 100.
- The presigned PUT URL embeds `Content-Type` and `Content-Length`, so the client cannot swap them.
- The S3 key is **server-generated**. The client filename is used only for display and stored after sanitisation (strip path components and control chars, max 255).
- Orphan cleanup: `PENDING_UPLOAD` rows older than 24 h are aborted (AbortMultipartUpload) and deleted by the cleanup job. A lifecycle rule also aborts incomplete multipart uploads after 3 days.

### 8.3 Processing (worker)
**Images (sharp):**
1. Stream the original to a temp file (`/tmp/wcc/{mediaId}`) and verify the magic bytes with `file-type`. On a mismatch with the allowed list, set `FAILED`, delete the original and write an audit entry.
2. Read the EXIF data: `DateTimeOriginal` becomes `takenAt`; also take the camera model and the dimensions (after auto-orient).
3. Generate the `THUMB` (400px long edge, webp q=72) and the `PREVIEW` (1600px, webp q=80). Apply `.rotate()` (auto-orient) and **strip all metadata** (GPS included) from the variants. Originals are untouched.
4. HEIC/HEIF: requires sharp built with libheif (use the `sharp` prebuilt binaries, which include HEIF decoding; if that fails, fall back to `heif-convert` from `libheif-examples` in the Docker image).
5. Set `Cache-Control: private, max-age=31536000, immutable` on the variants.

**Videos (ffmpeg / ffprobe):**
1. Run `ffprobe` for the duration, dimensions, codec and `creation_time`.
2. `POSTER`: a frame at `min(3s, 10% of duration)` → jpg at 1280px long edge.
3. `VIDEO_PREVIEW` (only if the original isn't already browser-friendly H.264/AAC mp4 ≤ 1080p **or** the original is > 2 GB): `ffmpeg -i in -vf "scale=-2:720" -c:v libx264 -preset veryfast -crf 26 -c:a aac -b:a 128k -movflags +faststart out.mp4`.
4. Config: `VIDEO_TRANSCODE_ENABLED` (default true) and `VIDEO_TRANSCODE_MAX_DURATION_SEC` (default 3h); above that, generate the poster only.
5. Worker concurrency: `image` queue 4, `video` queue **1**. Run ffmpeg with `nice -n 10` and a configurable `-threads` (default: half the vCPUs).
6. Temp disk: stream to `/var/lib/wcc/tmp` (a mounted volume). Check that free space is > 2× the file size before downloading; otherwise delay the job.

**Retries:** 3 attempts with exponential backoff (30 s, 2 m, 10 m). After the final failure: `FAILED` + `processingError`. The UI shows a "Retry processing" action for admins (`POST /media/:id/reprocess`).

**Idempotency:** the job id is `media-{mediaId}-v{processingAttempts}`; variant keys are deterministic, so re-runs overwrite safely.

### 8.4 Delivery
| What | How |
|---|---|
| Thumbnails/previews/posters/preview video in the gallery | `https://cdn.../{variantKey}` — authorised by the CloudFront **signed cookies** |
| Play an original video in the browser | CloudFront (signed cookie) — `/{originalKey}` (CloudFront supports range requests) |
| Download an original (photo or video) | `GET /media/:id/download` → 302 to an **S3 presigned GET**, 5 min, `ResponseContentDisposition: attachment; filename*=UTF-8''{sanitised name}` + audit `MEDIA_DOWNLOADED` |
| Bulk download (Phase 2) | A worker builds a ZIP via stream into `exports/{jobId}.zip` → presigned link emailed/shown, expires in 24 h |

**CloudFront cookie issuance:** `GET /delivery/cdn-session` (authenticated) sets the three CloudFront cookies with a **custom policy** for `https://cdn.../media/*` that expires in 2 h. The web app calls it on dashboard mount and every 90 min (and on a 403 from an image, retry once after refreshing). On logout, clear the cookies.

> In **development** (`MEDIA_DELIVERY_MODE=s3-presign`), CloudFront isn't used: list endpoints return per-variant S3 presigned GET URLs (1 h). The frontend reads `url` fields from the API in both modes and must never construct CDN URLs itself.

---

## 9. S3 & CloudFront Configuration

### 9.1 Buckets
| Bucket | Purpose | Region |
|---|---|---|
| `wcc-media-prod` | Originals + variants | `eu-west-1` (Ireland) or `af-south-1` (Cape Town — closest to Ghana; check pricing) |
| `wcc-media-dev` | Development | same |
| `wcc-backups-prod` | Encrypted DB dumps | a **different** region from the media bucket |

Settings for all buckets: **Block Public Access: ON (all four)**, **Object Ownership: BucketOwnerEnforced**, **Default encryption: SSE-S3**, **Versioning: ON** for media prod (protects against accidental/malicious deletes; noncurrent versions expire after 30 days), TLS-only bucket policy.

### 9.2 Lifecycle (`infra/aws/s3-lifecycle.json`)
- Abort incomplete multipart uploads after 3 days.
- `media/` originals: transition to **Intelligent-Tiering** after 0 days (services are rarely revisited after a few months).
- Noncurrent versions: expire after 30 days.
- `exports/`: expire after 2 days.

### 9.3 Key layout (ID-based, never name-based)
```
media/{eventId}/{mediaId}/original.{ext}
media/{eventId}/{mediaId}/thumb.webp
media/{eventId}/{mediaId}/preview.webp
media/{eventId}/{mediaId}/poster.jpg
media/{eventId}/{mediaId}/preview-720p.mp4
exports/{jobId}.zip
avatars/{userId}/{uuid}.webp
```
> On a **move** between events, the DB `eventId` changes but the S3 keys stay as they are (the key is just an opaque identifier). Do **not** parse eventId out of keys anywhere.

### 9.4 CORS (`s3-cors.json`)
```json
[
  {
    "AllowedOrigins": ["https://media.westendcity.church", "http://localhost:3000"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-Length", "Content-MD5", "x-amz-*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```
(Remove `localhost` from the prod bucket.)

### 9.5 Bucket policy (prod)
- Allow `s3:GetObject` to the CloudFront service principal, with the condition `AWS:SourceArn = arn:aws:cloudfront::<acct>:distribution/<id>` (OAC).
- Deny any request where `aws:SecureTransport = false`.

### 9.6 IAM — API/worker user `wcc-media-app` (least privilege)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "MediaObjects",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject", "s3:GetObject", "s3:DeleteObject",
        "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"
      ],
      "Resource": [
        "arn:aws:s3:::wcc-media-prod/media/*",
        "arn:aws:s3:::wcc-media-prod/exports/*",
        "arn:aws:s3:::wcc-media-prod/avatars/*"
      ]
    },
    {
      "Sid": "ListForCleanup",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:ListBucketMultipartUploads"],
      "Resource": "arn:aws:s3:::wcc-media-prod"
    }
  ]
}
```
- **No** `s3:DeleteObjectVersion`, `s3:PutBucketPolicy` or `s3:PutLifecycleConfiguration` for the app, so a compromised VPS can't destroy the version history.
- Separate IAM user `wcc-backup` with `s3:PutObject` only on `wcc-backups-prod/db/*` (no delete; enable Object Lock in governance mode, 30 days, on the backup bucket).
- Rotate access keys every 90 days. Store them only in `/opt/wcc/.env` on the VPS (chmod 600), never in git.

### 9.7 CloudFront distribution
- Origin: `wcc-media-prod` via **OAC** (sign requests: always).
- Alternate domain `cdn.media.westendcity.church`, with an ACM certificate in **us-east-1**.
- Viewer protocol: redirect HTTP → HTTPS; TLSv1.2_2021 minimum; HTTP/2 + HTTP/3.
- Behaviour `media/*`: **Restrict viewer access: Yes → Trusted key groups** (`wcc-media-keygroup`); allowed methods GET/HEAD/OPTIONS. Cache policy: CachingOptimized (no cookies or query strings in the cache key — signed-cookie validation happens before the cache). Response headers policy: CORS for the app origin with credentials allowed, plus `X-Content-Type-Options: nosniff`.
- Default behaviour (`*`): restricted too (deny by default).
- Key group: an RSA-2048 public key uploaded to CloudFront. The private key is stored on the VPS as a file at `/opt/wcc/secrets/cf_private_key.pem` (chmod 400, mounted read-only into the api container).
- Price class: `PriceClass_All` (Africa edge locations are only included in All).

---

## 10. API Specification

- Base URL: `https://api.media.../v1`. All JSON; dates are ISO 8601; event dates are `YYYY-MM-DD` (church local time **Africa/Accra**, UTC+0).
- OpenAPI docs via `@nestjs/swagger` at `/v1/docs`, **enabled only in non-prod** (or behind SUPER_ADMIN auth in prod).
- Pagination is cursor-based: `?limit=60&cursor=<opaque>` → `{ items, nextCursor }`. Max limit 200.
- Error envelope: `{ "statusCode": 403, "code": "FORBIDDEN", "message": "…", "requestId": "…" }`. Never leak stack traces or Prisma errors.
- Validation: global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` with class-validator DTOs. UUID params use `ParseUUIDPipe`.

### 10.1 Auth
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/login` | `{email, password, totp?}` | Sets cookies; returns `{user}` |
| POST | `/auth/refresh` | — | Rotates the refresh token |
| POST | `/auth/logout` | — | Revokes the session, clears all cookies (incl. CloudFront) |
| GET | `/auth/me` | — | Current user + category grants + effective permissions |
| POST | `/auth/forgot-password` | `{email}` | Always 204 |
| POST | `/auth/reset-password` | `{token, password}` | |
| POST | `/auth/change-password` | `{currentPassword, newPassword}` | Revokes the other sessions |
| POST | `/auth/2fa/setup` | — | Returns the otpauth URI + QR data URL |
| POST | `/auth/2fa/enable` | `{totp}` | Returns 10 recovery codes (shown once) |
| POST | `/auth/2fa/disable` | `{password, totp}` | Not allowed for admins |
| GET | `/auth/sessions` | — | |
| DELETE | `/auth/sessions/:id` | — | |

### 10.2 Invitations & Users (admin)
| Method | Path | Notes |
|---|---|---|
| POST | `/invitations` | `{email, role, categoryIds[]}` |
| GET | `/invitations` | Pending invitations |
| DELETE | `/invitations/:id` | Revoke |
| POST | `/invitations/:id/resend` | |
| GET | `/invitations/verify/:token` | Public; returns `{email, role}` when valid |
| POST | `/invitations/accept` | Public; `{token, fullName, title?, phone?, password}` |
| GET | `/users` | Filter by `role`, `status`, `q` |
| GET | `/users/:id` | |
| PATCH | `/users/:id` | `{role?, status?, fullName?, title?, phone?}` |
| PUT | `/users/:id/category-access` | `[{categoryId, canView, canUpload, canManage}]` (replaces all) |
| POST | `/users/:id/revoke-sessions` | |
| PATCH | `/users/me` | Profile self-update (name, title, phone) |

### 10.3 Categories
| Method | Path | Notes |
|---|---|---|
| GET | `/categories` | Includes `eventCount`, `latestEventDate`, `coverThumbUrl` |
| GET | `/categories/:slug` | |
| GET | `/categories/:slug/timeline` | `[{year, months:[{month, eventCount}]}]` for the folder tree |
| PATCH | `/categories/:id` | SUPER_ADMIN: `{name?, description?, sortOrder?, isActive?, coverMediaId?}` |

### 10.4 Events
| Method | Path | Notes |
|---|---|---|
| GET | `/events` | `?categoryId&from&to&year&month&programType&q&status&cursor&limit` sorted `eventDate desc` |
| POST | `/events` | `{categoryId, eventDate, endDate?, title?, programType?, location?, description?, status?}`. The title is defaulted; the slug is derived from the title (unique per category+date, suffixed `-2`, `-3`) |
| GET | `/events/:id` | Includes the category, counts, cover URL, creator, `canEdit`, `canDelete`, `canUpload` |
| PATCH | `/events/:id` | Partial update; changing `categoryId` requires `canManage` on both |
| DELETE | `/events/:id` | Soft-deletes the event **and** all its media (one transaction); everything goes to the Trash |
| POST | `/events/:id/restore` | |
| GET | `/events/lookup` | `?categoryId&date=YYYY-MM-DD` → existing events on that date (used by the "Add media" flow to avoid duplicates) |

### 10.5 Media
| Method | Path | Notes |
|---|---|---|
| GET | `/events/:id/media` | `?type=IMAGE|VIDEO&status&tag&uploadedBy&sort=takenAt|createdAt|sortOrder&cursor&limit`. Each item: `{id, type, status, width, height, durationSec, caption, isFeatured, takenAt, uploadedBy:{id,name}, thumbUrl, previewUrl, posterUrl, playbackUrl, tags[], canEdit, canDelete}` |
| GET | `/media/:id` | Full detail + EXIF summary |
| PATCH | `/media/:id` | `{caption?, isFeatured?, sortOrder?, tags?: string[]}` |
| DELETE | `/media/:id` | Soft delete |
| POST | `/media/bulk` | `{action: "delete"|"move"|"tag"|"untag"|"feature"|"unfeature", mediaIds[≤500], targetEventId?, tags?}`. Policy-checks every item; returns `{succeeded[], failed[{id, code}]}` |
| POST | `/media/:id/restore` | |
| POST | `/media/:id/reprocess` | Admin |
| GET | `/media/:id/download` | 302 to a presigned S3 URL; audited |
| POST | `/events/:id/cover` | `{mediaId}` |

### 10.6 Uploads
| Method | Path | Notes |
|---|---|---|
| POST | `/uploads/init` | `{eventId, files:[{clientId, filename, size, mimeType}]}` → `[{clientId, mediaId, strategy, putUrl?, uploadId?, partSize?}]` (rejected files are returned with `error`) |
| POST | `/uploads/:mediaId/parts` | `{partNumbers: number[≤100]}` → `[{partNumber, url}]` |
| GET | `/uploads/:mediaId/parts` | Lists the uploaded parts (for resume) |
| POST | `/uploads/:mediaId/complete` | `{parts:[{partNumber, etag}]}` |
| POST | `/uploads/:mediaId/finalize` | For single-PUT uploads |
| DELETE | `/uploads/:mediaId` | Aborts the upload, deletes the row |

The uploader of a media row is the only one who can call its part/complete/finalize/abort endpoints.

### 10.7 Search, Tags, Trash, Audit, Delivery, Health
| Method | Path | Notes |
|---|---|---|
| GET | `/search` | `?q&categoryId&from&to&type` → `{events[], media[]}` (trigram on title/caption/filename/tag) |
| GET | `/tags` | `?q` autocomplete |
| GET | `/trash` | Admin: everything; others: their own. `{events[], media[]}` with `purgeAfter` |
| DELETE | `/trash/media/:id` | Permanent delete (admin) — enqueues an S3 delete |
| DELETE | `/trash/events/:id` | Permanent delete (admin) |
| GET | `/audit` | Admin; `?actorId&action&entityType&entityId&from&to&cursor` |
| GET | `/delivery/cdn-session` | Sets the CloudFront signed cookies; returns `{expiresAt}` |
| GET | `/health/live` | Liveness (no deps) |
| GET | `/health/ready` | DB + Redis checks (S3 check optional, cached) |

### 10.8 Real-time processing status (optional, Phase 2)
`GET /events/:id/media/stream` (Server-Sent Events) pushes `{mediaId, status}` from Redis pub/sub. In Phase 1, polling is fine.

---

## 11. Frontend Specification

### 11.1 Stack
- Next.js 15 App Router, React 19, TypeScript strict.
- Tailwind CSS v4 + **shadcn/ui** (Radix) + `lucide-react` icons.
- **TanStack Query** for server state; `react-hook-form` + `zod` (schemas from `packages/shared`).
- **Uppy** (`@uppy/core`, `@uppy/dashboard`, `@uppy/aws-s3` with custom `createMultipartUpload / signPart / completeMultipartUpload / getUploadParameters` hooks that call our API) — it handles resume, retries and parallel parts.
- Lightbox: `yet-another-react-lightbox` (zoom, video, thumbnails plugins).
- Virtualised grid: `@tanstack/react-virtual` (events can have 1,500+ photos).
- Dates: `date-fns` + `date-fns-tz`, with the display zone fixed to `Africa/Accra`.
- `next/image` with `unoptimized` for CDN images (the variants are already optimised, and the Next optimiser can't send the CloudFront cookies), or plain `<img loading="lazy" decoding="async">` with explicit width and height from the API to avoid layout shift.

### 11.2 Branding
- App name: **"WCC Media — The Life Cathedral"**.
- A clean, modern, light theme by default with dark mode. Primary colour is a configurable token (`--brand`) so the church's colours can be dropped in. Leave a placeholder for the logo at `public/logo.svg`.
- Mobile-first: pastors will mostly use phones. Every screen must work at 360px width; the upload screen must work from a phone gallery.

### 11.3 Screens
1. **Login** — email, password, then a TOTP step when required. "Forgot password".
2. **Home** — the nine category cards (cover image, name, event count, latest date) in seed order, a "Recent events" strip (last 12 across all categories), a global search bar, and an "Add media" primary button (if the user can upload anywhere).
3. **Category page** `/c/[slug]` — left: a collapsible **Year → Month** tree (from `/timeline`); right: event cards grouped under month headings (cover, title, date or date range, photo/video counts, programType badge). Filters: date range, programType (Other Programs), search within the category. A "New event" button.
4. **Event gallery** `/e/[id]`
   - Header: breadcrumb `Home / Sunday 1st Service / 2026 / November / 8 Nov 2026`, title, date, location, description, counts, and actions (Upload, Edit, Delete, Set cover).
   - Tabs: All · Photos · Videos · Featured.
   - Virtualised justified/masonry grid. Hover or long-press reveals a select checkbox. Items still processing show a skeleton with a "Processing…" badge; `FAILED` items show an error badge (with a Retry button for admins).
   - A selection toolbar: Download (each file individually via the presigned redirect; ZIP in Phase 2), Move to event…, Tag…, Feature, Delete.
   - Lightbox: keyboard and swipe navigation; info panel (caption edit inline if permitted, tags, uploaded by, taken at, camera, dimensions, size); Download original.
5. **Upload** `/e/[id]/upload` (also reachable through the "Add media" wizard: pick category → pick date → choose an existing event on that date or create one → upload).
   - Uppy Dashboard: drag-and-drop, folder selection, per-file progress, an overall progress bar, pause and resume, and a "keep this tab open" warning (`beforeunload` while uploading).
   - Client-side pre-validation of type and size, mirroring the server limits.
6. **Search** — results grouped into Events and Media, with filters.
7. **Trash** — a list with "Restore" and (admin) "Delete forever"; shows the days remaining.
8. **Admin › Users** — table of users, invite dialog (email, role, category grants as a checkbox grid with View/Upload/Manage), edit role and status, revoke sessions, pending invitations.
9. **Admin › Audit log** — a filterable table showing a human-readable description.
10. **Admin › Categories** (SUPER_ADMIN) — rename, reorder, description, activate/deactivate.
11. **Account** — profile, change password, 2FA setup (QR + recovery codes), active sessions.

### 11.4 Auth handling in the web app
- `middleware.ts`: if the `wcc_at` **or** `wcc_rt` cookie is missing on a `(dashboard)` route → redirect to `/login?next=…`. (Presence check only; the API is the real enforcer.)
- `api-client.ts`: a `fetch` wrapper with `credentials: "include"` that adds `X-CSRF-Token` from the cookie on mutations. On a 401, it calls `/auth/refresh` once (with a single-flight lock), retries, and redirects to login on a second failure.
- Server Components render only the shell; data fetching happens client-side with TanStack Query (simpler cookie handling across domains). This is acceptable because the app is private and has no SEO requirement.
- After login and every 90 min: call `/delivery/cdn-session`.

### 11.5 Next.js security headers (`next.config.ts`)
- `Content-Security-Policy`:
  `default-src 'self'; img-src 'self' data: blob: https://cdn.media.westendcity.church https://*.s3.*.amazonaws.com; media-src 'self' blob: https://cdn.media.westendcity.church https://*.s3.*.amazonaws.com; connect-src 'self' https://api.media.westendcity.church https://*.s3.*.amazonaws.com; script-src 'self' 'nonce-{nonce}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
  (Use the per-request nonce through middleware. Restrict the S3 host to the exact bucket host in prod.)
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- Set `poweredByHeader: false`.

---

## 12. Background Workers

The `apps/worker` service runs a NestJS application context with BullMQ. Its queues:

| Queue | Job | Trigger | Concurrency |
|---|---|---|---|
| `media-image` | `process` | upload finalize | 4 |
| `media-video` | `process` | upload finalize | 1 |
| `media-delete` | `purge` | permanent delete / trash purge | 4 |
| `maintenance` | `purge-trash` | cron daily 02:00 | 1 |
| `maintenance` | `abort-stale-uploads` | cron hourly | 1 |
| `maintenance` | `reconcile-counters` | cron daily 03:00 | 1 |
| `maintenance` | `prune-sessions` | cron daily 04:00 (deletes expired/revoked > 30 days) | 1 |
| `maintenance` | `prune-audit` | cron monthly (keep 2 years) | 1 |
| `mail` | `send` | invitations, resets | 2 |

- **purge-trash:** for media with `purgeAfter < now()`, delete the S3 original and all variants, delete the DB rows, and write an audit entry `MEDIA_PURGED`. Events whose `deletedAt` is older than 30 days, and that have no remaining media, are hard-deleted.
- Each job is idempotent and logs `jobId`, `mediaId` and duration.
- Use the Bull Board UI at `/admin/queues` on the API, protected by SUPER_ADMIN (or skip it and rely on logs).
- Email: SMTP via **Amazon SES** (or Brevo/Postmark). Templates: invite, password reset, 2FA enabled, new login from a new device (optional). Use `nodemailer` with `SMTP_*` env vars.

---

## 13. Security Controls Checklist

**Transport & edge**
- [ ] HTTPS everywhere (Caddy auto-TLS with Let's Encrypt; CloudFront with ACM). HSTS.
- [ ] Only ports 22 (or a custom SSH port), 80 and 443 are open (UFW). Postgres and Redis are **never** exposed publicly; they're bound to the internal Docker network.
- [ ] Optional: put Cloudflare (proxy) in front of `media.` and `api.` for DDoS protection and WAF. If you do, restrict 80/443 to Cloudflare IP ranges and set Caddy `trusted_proxies`.

**API**
- [ ] `helmet()` with a strict default config. CORS allowlist = `[WEB_ORIGIN]`, `credentials: true`.
- [ ] `@nestjs/throttler` with Redis storage: global 300 req/min/IP; `/auth/login` 10/min/IP plus 5/15min per email; `/auth/forgot-password` 3/hour per email; `/uploads/init` 30/min/user.
- [ ] Global `ValidationPipe` (whitelist + forbidNonWhitelisted). Body size limit of 1 MB (uploads never pass through the API).
- [ ] Every mutating service method goes through `PolicyService` and records an audit entry.
- [ ] IDs are UUIDv4 (no enumeration). A 404 rather than a 403 for content in categories the user cannot view.
- [ ] `trust proxy` set to the Caddy hop only, so the client IP comes from `X-Forwarded-For` correctly.
- [ ] Structured logging with `nestjs-pino`; redact `authorization`, `cookie`, `password`, `token`, `totp`, `set-cookie`.
- [ ] Secrets are validated at boot with zod; the app refuses to start when any is missing or weak.
- [ ] Dependency scanning: `pnpm audit` and GitHub Dependabot; CodeQL in CI.

**Data**
- [ ] Postgres: `scram-sha-256` auth, separate least-privilege roles (§5.3), `ssl=on` if it is ever accessed remotely (it is accessed only over an SSH tunnel for pgAdmin).
- [ ] TOTP secrets are encrypted with AES-256-GCM using `APP_ENCRYPTION_KEY` (32 bytes, base64).
- [ ] Tokens (refresh, invite, reset) are stored only as SHA-256 hashes.
- [ ] Audit log is append-only for the app role.
- [ ] GPS metadata is stripped from all generated variants. Originals keep their EXIF data. Note this in the UI: "Original files may contain location data."

**Storage**
- [ ] Bucket is private; OAC; TLS-only policy; versioning; least-privilege IAM; no delete-version permission for the app.
- [ ] Presigned URL TTLs: PUT 15 min, part 15 min, download GET 5 min, dev preview GET 1 h.
- [ ] The server builds every key; content type and length are pinned in the presign; magic bytes are verified after upload.

**Host (VPS)**
- [ ] SSH: key-only, `PermitRootLogin no`, `PasswordAuthentication no`, non-root deploy user with sudo, `fail2ban`.
- [ ] `unattended-upgrades` for security patches.
- [ ] Docker: containers run as non-root users, `read_only: true` where possible, `no-new-privileges`, resource limits (cpus/memory) per service, and the worker has a tmp volume.
- [ ] `.env` and keys are mode 600 and owned by the deploy user.

---

## 14. Environments & Configuration

### 14.1 Local development
- Postgres: your local install (managed with pgAdmin). Create the DB `wcc_media_dev`, and the roles `wcc_owner` and `wcc_app` (in dev, a single owner role is acceptable).
- Redis: `docker compose -f infra/compose/docker-compose.dev.yml up -d redis` (Redis only, plus optional MailHog/Mailpit for emails on :8025).
- S3: a real `wcc-media-dev` bucket with a dev IAM user, and `MEDIA_DELIVERY_MODE=s3-presign` (no CloudFront needed locally).
- Run everything with `pnpm dev` (Turborepo runs web on :3000, api on :4000, and worker).
- Cookies in dev: `Domain` is unset (host-only on `localhost`), `Secure=false` only when `NODE_ENV=development`.
- Seed: `pnpm db:seed` creates the 9 categories and a SUPER_ADMIN from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (dev only; in prod, use `pnpm --filter api cli create-admin` interactively).

### 14.2 `.env.example`
```dotenv
# ── General ──
NODE_ENV=development
APP_NAME="WCC Media"
WEB_ORIGIN=http://localhost:3000
API_ORIGIN=http://localhost:4000
COOKIE_DOMAIN=                       # prod: .media.westendcity.church
TZ=Africa/Accra

# ── Database ──
DATABASE_URL=postgresql://wcc_app:CHANGE_ME@localhost:5432/wcc_media_dev?schema=public
DATABASE_MIGRATION_URL=postgresql://wcc_owner:CHANGE_ME@localhost:5432/wcc_media_dev?schema=public

# ── Redis ──
REDIS_URL=redis://localhost:6379

# ── Auth ──
JWT_ACCESS_SECRET=                   # >= 64 random bytes, base64
JWT_ACCESS_TTL=15m
REFRESH_TTL_DAYS=14
REFRESH_ABSOLUTE_TTL_DAYS=60
APP_ENCRYPTION_KEY=                  # 32 bytes base64 (TOTP secret encryption)
REQUIRE_2FA_FOR_ADMINS=true

# ── AWS ──
AWS_REGION=eu-west-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET=wcc-media-dev
S3_MULTIPART_THRESHOLD_MB=100
S3_PART_SIZE_MB=16

# ── Delivery ──
MEDIA_DELIVERY_MODE=s3-presign       # s3-presign | cloudfront
CLOUDFRONT_DOMAIN=                   # cdn.media.westendcity.church
CLOUDFRONT_KEY_PAIR_ID=
CLOUDFRONT_PRIVATE_KEY_PATH=/run/secrets/cf_private_key.pem
CDN_COOKIE_TTL_MIN=120

# ── Upload limits ──
MAX_IMAGE_MB=60
MAX_VIDEO_GB=20
MAX_FILES_PER_INIT=1000

# ── Processing ──
VIDEO_TRANSCODE_ENABLED=true
VIDEO_TRANSCODE_MAX_DURATION_SEC=10800
FFMPEG_THREADS=2
WORKER_TMP_DIR=/var/lib/wcc/tmp
IMAGE_CONCURRENCY=4
VIDEO_CONCURRENCY=1

# ── Trash ──
TRASH_RETENTION_DAYS=30

# ── Mail ──
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=
SMTP_PASS=
MAIL_FROM="WCC Media <no-reply@westendcity.church>"

# ── Seed (dev only) ──
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=ChangeMe-Str0ng!

# ── Web (public) ──
NEXT_PUBLIC_API_URL=http://localhost:4000/v1
NEXT_PUBLIC_APP_NAME="WCC Media — The Life Cathedral"
```

---

## 15. VPS Deployment (Contabo)

### 15.1 Recommended VPS
Contabo **Cloud VPS 20/30** class (6–8 vCPU, 12–24 GB RAM, NVMe). Video transcoding is the heaviest workload. Ubuntu 24.04 LTS.

### 15.2 Bootstrap (`infra/scripts/vps-bootstrap.sh`, run once as root, idempotent)
1. Create the `deploy` user, add the SSH key, disable root and password SSH login.
2. `ufw default deny incoming; ufw allow OpenSSH; ufw allow 80,443/tcp; ufw enable`
3. `apt install fail2ban unattended-upgrades` and enable both.
4. Install Docker Engine + the Compose plugin; add `deploy` to the `docker` group.
5. `mkdir -p /opt/wcc/{secrets,backups} /var/lib/wcc/{pgdata,redis,tmp,caddy}`; set `chown` and `chmod`.
6. Configure swap (4 GB) and set `vm.swappiness=10`.
7. Set the timezone to `Africa/Accra`.

### 15.3 `docker-compose.prod.yml` (outline)
```yaml
name: wcc
services:
  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - /var/lib/wcc/caddy:/data
    restart: unless-stopped
    depends_on: [web, api]

  web:
    image: ghcr.io/<org>/wcc-web:${TAG}
    env_file: /opt/wcc/.env
    user: "1000:1000"
    read_only: true
    tmpfs: [/tmp]
    restart: unless-stopped
    deploy: { resources: { limits: { cpus: "1.0", memory: 768M } } }

  api:
    image: ghcr.io/<org>/wcc-api:${TAG}
    env_file: /opt/wcc/.env
    user: "1000:1000"
    read_only: true
    tmpfs: [/tmp]
    secrets: [cf_private_key]
    security_opt: ["no-new-privileges:true"]
    depends_on: { postgres: { condition: service_healthy }, redis: { condition: service_healthy } }
    healthcheck: { test: ["CMD", "wget", "-qO-", "http://localhost:4000/v1/health/ready"], interval: 30s }
    restart: unless-stopped
    deploy: { resources: { limits: { cpus: "1.5", memory: 1G } } }

  worker:
    image: ghcr.io/<org>/wcc-worker:${TAG}   # includes ffmpeg, libvips, libheif
    env_file: /opt/wcc/.env
    user: "1000:1000"
    volumes: ["/var/lib/wcc/tmp:/var/lib/wcc/tmp"]
    security_opt: ["no-new-privileges:true"]
    depends_on: { postgres: { condition: service_healthy }, redis: { condition: service_healthy } }
    restart: unless-stopped
    deploy: { resources: { limits: { cpus: "4.0", memory: 6G } } }

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: wcc_media
      POSTGRES_USER: wcc_owner
      POSTGRES_PASSWORD_FILE: /run/secrets/pg_owner_password
      POSTGRES_INITDB_ARGS: "--auth-host=scram-sha-256"
    secrets: [pg_owner_password]
    volumes: ["/var/lib/wcc/pgdata:/var/lib/postgresql/data"]
    ports: ["127.0.0.1:5432:5432"]          # localhost only → reach via SSH tunnel from pgAdmin
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U wcc_owner"], interval: 10s }
    restart: unless-stopped
    deploy: { resources: { limits: { memory: 2G } } }

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "${REDIS_PASSWORD}", "--maxmemory-policy", "noeviction"]
    volumes: ["/var/lib/wcc/redis:/data"]
    healthcheck: { test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"], interval: 10s }
    restart: unless-stopped

secrets:
  cf_private_key: { file: /opt/wcc/secrets/cf_private_key.pem }
  pg_owner_password: { file: /opt/wcc/secrets/pg_owner_password }
```
> Note: `noeviction` is required for BullMQ.

### 15.4 Caddyfile
```caddy
{
  email admin@westendcity.church
  servers { trusted_proxies static private_ranges }
}

media.westendcity.church {
  encode zstd gzip
  reverse_proxy web:3000
}

api.media.westendcity.church {
  encode zstd gzip
  request_body { max_size 2MB }
  reverse_proxy api:4000
  header {
    Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
    X-Content-Type-Options nosniff
    -Server
  }
}
```

### 15.5 pgAdmin access to production
Never expose 5432 publicly. From your laptop, open a tunnel with `ssh -L 5433:127.0.0.1:5432 deploy@<vps-ip>`, then connect pgAdmin to `localhost:5433`.

### 15.6 CI/CD (GitHub Actions)
- `ci.yml` (on PR): install → lint → typecheck → unit tests → e2e API tests (Postgres + Redis service containers) → build.
- `deploy.yml` (on tag `v*` or push to `main`): build three images (multi-stage, `node:22-alpine` / `node:22-slim` for the worker with ffmpeg), push to GHCR, SSH into the VPS (deploy key in GitHub secrets), then run `docker compose pull && docker compose run --rm api pnpm prisma migrate deploy && docker compose up -d`.
- Run migrations with `DATABASE_MIGRATION_URL` (the owner role) inside a one-off container.
- Roll back by redeploying the previous `TAG`. Migrations must be backward-compatible (expand → migrate → contract).

---

## 16. Backups, Monitoring & Operations

### 16.1 Backups
- **Database:** a nightly `pg_dump -Fc` at 01:30 via host cron (`infra/scripts/backup-db.sh`), encrypted with `age` (public key on the server, private key kept offline by the admin), uploaded to `s3://wcc-backups-prod/db/YYYY/MM/DD.dump.age`. Keep 7 local copies. In S3: Object Lock for 30 days, then a lifecycle rule moves backups to Glacier for 1 year.
- **Media:** S3 is durable; versioning protects against deletes. Optional: Cross-Region Replication to a cheaper storage class for disaster recovery.
- **Restore drill:** `infra/scripts/restore-db.sh` restores to a scratch DB. Test it monthly; document the steps in `README.md`.

### 16.2 Monitoring
- **Uptime Kuma** (another tiny container or an external service such as UptimeRobot) on `/v1/health/ready` and the web root.
- Logs: JSON to stdout → Docker `local` log driver with rotation (`max-size: 20m, max-file: 5`). Optional: Grafana Loki.
- Error tracking: Sentry (free tier) for web, api and worker, with PII scrubbing.
- Alerts: disk usage > 80% (the worker tmp dir and pgdata), failed jobs > 10/h, a failed backup (the script exits non-zero and sends an email).
- AWS: a **Budget alarm** (e.g. $30/month) and CloudWatch S3 metrics.

### 16.3 Cost notes (rough)
- S3 storage: ~$0.023/GB-month standard, cheaper with Intelligent-Tiering. A heavy year might be about 2 TB, roughly $25–45 a month.
- CloudFront egress for thumbnails and previews is small; the first 1 TB/month is in the AWS free tier.
- Presigned S3 downloads of originals are billed as S3 egress (~$0.09/GB).

---

## 17. Coding Conventions

1. **TypeScript strict** everywhere; no `any` without a `// eslint-disable-next-line` and a justification.
2. **Shared contracts:** enums, limits, category seed and zod schemas live in `packages/shared` and are imported by web, api and worker. Generate the API client types from OpenAPI (`openapi-typescript`) into `apps/web/lib/api-types.ts`.
3. **NestJS module pattern:** `*.module.ts`, `*.controller.ts` (thin), `*.service.ts` (business logic), `dto/*.dto.ts`, `*.policy.ts` where relevant. Use Prisma via `PrismaService` only; wrap multi-step writes in `prisma.$transaction`.
4. **Storage abstraction:** all S3/CloudFront calls go through `StorageService` / `DeliveryService` (AWS SDK v3: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/cloudfront-signer`). No other module imports the AWS SDK.
5. **Audit:** use an `AuditService.record({actor, action, entityType, entityId, metadata, req})` call inside the same transaction as the change where possible.
6. **Errors:** throw Nest `HttpException` subclasses with a stable `code` string. A global filter maps Prisma `P2002` to 409 and `P2025` to 404.
7. **Testing:**
   - Unit: Jest/Vitest for services and policies (the matrix in §6 is fully covered).
   - E2E API: Supertest against a real Postgres (Testcontainers or CI service), with S3 mocked by `aws-sdk-client-mock`.
   - Web: Playwright smoke tests (login, browse category, open event, upload a small image with S3 mocked via MSW, delete and restore).
8. **Lint/format:** ESLint (typescript-eslint strict) + Prettier; Husky + lint-staged pre-commit.
9. **Commits:** Conventional Commits.
10. **No secrets in code or git.** `.env*` is git-ignored except `.env.example`.
11. **Accessibility:** all interactive elements are keyboard reachable; images get `alt` (caption, or "Photo from {event title}"); target WCAG AA contrast.

---

## 18. Implementation Phases

Implement in order. Each phase ends with tests passing and a short `CHANGELOG.md` entry.

### Phase 0 — Foundation
- Monorepo scaffold (pnpm, Turborepo, TS configs, ESLint/Prettier), `packages/shared`, `packages/db`.
- Prisma schema (§5.1) + extras migration (§5.2) + seed (§2.2).
- NestJS api skeleton: config validation, Pino logging, helmet, CORS, throttler, global pipes and filters, health endpoints.
- Next.js skeleton with Tailwind, shadcn/ui, layout shell and security headers.
- `docker-compose.dev.yml` (Redis, Mailpit).
- **Accept:** `pnpm dev` boots all three apps; `/v1/health/ready` returns 200; the seed creates 9 categories and the admin.

### Phase 1 — Auth & Users
- Login/logout/refresh with rotation + reuse detection, CSRF guard, `/auth/me`, sessions list.
- Invitations (email via Mailpit), accept invite, password reset, change password.
- TOTP 2FA + recovery codes; enforced for admins.
- Users admin: list, edit role/status, category access grid, revoke sessions.
- `PolicyService` + full matrix unit tests. Audit log for auth events.
- Web: login, accept invite, forgot/reset, account page, admin users page, middleware redirect.
- **Accept:** e2e: invite → accept → login → refresh → logout; reuse of an old refresh token kills the family; 6th bad password locks the account.

### Phase 2 — Categories & Events
- Categories list/detail/timeline; events CRUD, slug generation, date lookup, soft delete and restore.
- Web: home, category page with Year/Month tree, event header, create/edit event dialogs, "Add media" wizard (category → date → event).
- **Accept:** a PASTOR with `canUpload` on Turning Point can create an event there but not in Camps; the timeline groups correctly.

### Phase 3 — Uploads & Processing
- `StorageService`, the upload endpoints (single + multipart), Uppy integration with resume.
- Worker: image pipeline (sharp, EXIF, HEIC), video pipeline (ffprobe, poster, optional 720p), retries, counters.
- `DeliveryService`: dev `s3-presign` mode + prod CloudFront signed cookies, presigned download endpoint.
- Web: upload page, event gallery (virtualised grid, processing states), lightbox, download.
- **Accept:** upload 200 JPEGs + 1 HEIC + one 3 GB MOV; all reach `READY`; thumbnails render; the download gives the original filename; a file renamed `.jpg` that is really a `.exe` is rejected and deleted.

### Phase 4 — Manage, Search, Trash, Audit
- Media edit (caption, tags, featured, sort), bulk actions (delete/move/tag/feature), set cover.
- Search endpoint + page; tags autocomplete.
- Trash page; purge job; abort-stale-uploads; reconcile-counters; prune jobs.
- Audit log page.
- **Accept:** a deleted item disappears from the gallery, appears in Trash, restores correctly, and is purged from S3 after the retention period (test with a 1-minute retention in the e2e env).

### Phase 5 — Production hardening & deploy
- Dockerfiles (multi-stage, non-root), `docker-compose.prod.yml`, Caddyfile, bootstrap script, backup and restore scripts.
- AWS JSON policies in `infra/aws/` + a `README` section with step-by-step AWS console/CLI setup (bucket, OAC, CloudFront, key group, ACM, IAM users, budgets).
- GitHub Actions CI/CD.
- Sentry, uptime checks, log rotation.
- **Accept:** a fresh VPS can be brought up by following the `README` alone; securityheaders.com rates the web app grade A; the SSL Labs result is A+; no port other than 22/80/443 is reachable (verify with `nmap`).

---

## 19. Future Enhancements
- ZIP download of a whole event or a selection (worker streams the ZIP to S3 via `archiver`).
- Time-limited **share links** for people outside the system (e.g. send a family the christening photos), with optional password protection and a download toggle.
- Public "highlights" gallery for the church website (featured media only, separate public CloudFront behaviour serving `PREVIEW` variants).
- AI auto-tagging and face grouping (AWS Rekognition), opt-in, with a privacy review first.
- RAW photo support (embedded preview extraction).
- PWA install + offline-capable upload queue for the media team on phones.
- Branches/organisations within the church (e.g. a bacenta or ministry) as a scoping dimension on events.
- Watermarking of downloaded previews.
- Storage usage dashboard per category/year.

---

*End of specification.*
