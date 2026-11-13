-- Shepherd role
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SHEPHERD';

-- Attendance: any kind of church-wide service, not just Sundays; several per day.
DROP INDEX IF EXISTS "AttendanceSession_sunday_date_key";
DROP INDEX IF EXISTS "AttendanceSession_group_date_key";
ALTER TABLE "AttendanceSession" DROP CONSTRAINT IF EXISTS "AttendanceSession_kind_group_check";
ALTER TYPE "AttendanceKind" RENAME VALUE 'SUNDAY_SERVICE' TO 'CHURCH_SERVICE';

ALTER TABLE "AttendanceSession" ADD COLUMN "serviceType" VARCHAR(40);
UPDATE "AttendanceSession" SET "serviceType" = CASE WHEN "kind" = 'CHURCH_SERVICE' THEN 'Sunday service' ELSE 'Meeting' END;
ALTER TABLE "AttendanceSession" ALTER COLUMN "serviceType" SET NOT NULL;

ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_kind_group_check"
  CHECK (("kind" = 'CHURCH_SERVICE' AND "groupId" IS NULL) OR ("kind" = 'GROUP_MEETING' AND "groupId" IS NOT NULL));
-- The same service can't be recorded twice for one day (a different title, e.g. "2nd service", is fine).
CREATE UNIQUE INDEX "AttendanceSession_church_unique" ON "AttendanceSession"("date", lower("serviceType"), lower(coalesce("title", ''))) WHERE "kind" = 'CHURCH_SERVICE';
CREATE UNIQUE INDEX "AttendanceSession_group_unique" ON "AttendanceSession"("groupId", "date", lower("serviceType"), lower(coalesce("title", ''))) WHERE "kind" = 'GROUP_MEETING';

-- People a member brought
ALTER TABLE "AttendanceRecord" ADD COLUMN "broughtCount" INTEGER;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_brought_check" CHECK ("broughtCount" IS NULL OR "broughtCount" >= 0);

CREATE TYPE "GuestIntent" AS ENUM ('VISIT', 'JOINING');

CREATE TABLE "GroupShepherd" (
    "groupId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupShepherd_pkey" PRIMARY KEY ("groupId","userId")
);

CREATE TABLE "Guest" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "broughtById" UUID,
    "fullName" VARCHAR(120),
    "phone" VARCHAR(30),
    "intent" "GuestIntent" NOT NULL DEFAULT 'VISIT',
    "convertedMemberId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GroupShepherd_userId_idx" ON "GroupShepherd"("userId");
CREATE UNIQUE INDEX "Guest_convertedMemberId_key" ON "Guest"("convertedMemberId");
CREATE INDEX "Guest_sessionId_idx" ON "Guest"("sessionId");
CREATE INDEX "Guest_broughtById_idx" ON "Guest"("broughtById");
CREATE INDEX "Guest_intent_convertedMemberId_idx" ON "Guest"("intent", "convertedMemberId");

ALTER TABLE "GroupShepherd" ADD CONSTRAINT "GroupShepherd_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChurchGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupShepherd" ADD CONSTRAINT "GroupShepherd_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_broughtById_fkey" FOREIGN KEY ("broughtById") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_convertedMemberId_fkey" FOREIGN KEY ("convertedMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'wcc_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "GroupShepherd", "Guest" TO wcc_app;
  END IF;
END $$;
