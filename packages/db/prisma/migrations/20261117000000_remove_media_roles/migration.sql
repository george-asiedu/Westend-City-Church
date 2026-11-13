-- Remove the Media Admin and Media Team roles. Nobody should hold them; if anyone does,
-- they become Viewers (never more access), and role-wide grants for them are dropped.
UPDATE "User" SET "role" = 'VIEWER' WHERE "role"::text IN ('MEDIA_ADMIN', 'MEDIA_TEAM');
UPDATE "Invitation" SET "role" = 'VIEWER' WHERE "role"::text IN ('MEDIA_ADMIN', 'MEDIA_TEAM');
DELETE FROM "RolePermission" WHERE "role"::text IN ('MEDIA_ADMIN', 'MEDIA_TEAM');

-- Postgres can't drop enum values: swap in a new type.
ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'PASTOR', 'SHEPHERD', 'VIEWER');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'VIEWER';
ALTER TABLE "Invitation" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
ALTER TABLE "RolePermission" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
DROP TYPE "Role_old";
