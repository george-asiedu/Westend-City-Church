-- CreateEnum
CREATE TYPE "GroupType" AS ENUM ('CONSTITUENCY', 'BASONTA');

-- CreateEnum
CREATE TYPE "AttendanceKind" AS ENUM ('SUNDAY_SERVICE', 'GROUP_MEETING');

-- CreateTable
CREATE TABLE "ChurchGroup" (
    "id" UUID NOT NULL,
    "type" "GroupType" NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500),
    "meetingDay" VARCHAR(40),
    "meetingPlace" VARCHAR(160),
    "pastorId" UUID,
    "createdById" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChurchGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" UUID NOT NULL,
    "fullName" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(30),
    "email" CITEXT,
    "gender" VARCHAR(10),
    "dateOfBirth" DATE,
    "location" VARCHAR(160),
    "churchRole" VARCHAR(60) NOT NULL DEFAULT 'Member',
    "constituencyId" UUID,
    "joinedOn" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(1000),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberBasonta" (
    "memberId" UUID NOT NULL,
    "groupId" UUID NOT NULL,

    CONSTRAINT "MemberBasonta_pkey" PRIMARY KEY ("memberId","groupId")
);

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" UUID NOT NULL,
    "kind" "AttendanceKind" NOT NULL,
    "groupId" UUID,
    "date" DATE NOT NULL,
    "title" VARCHAR(120),
    "visitorCount" INTEGER NOT NULL DEFAULT 0,
    "firstTimerCount" INTEGER NOT NULL DEFAULT 0,
    "notes" VARCHAR(1000),
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "sessionId" UUID NOT NULL,
    "memberId" UUID NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("sessionId","memberId")
);

-- CreateIndex
CREATE INDEX "ChurchGroup_pastorId_idx" ON "ChurchGroup"("pastorId");

-- CreateIndex
CREATE UNIQUE INDEX "ChurchGroup_type_name_key" ON "ChurchGroup"("type", "name");

-- CreateIndex
CREATE INDEX "Member_constituencyId_idx" ON "Member"("constituencyId");

-- CreateIndex
CREATE INDEX "Member_fullName_idx" ON "Member"("fullName");

-- CreateIndex
CREATE INDEX "MemberBasonta_groupId_idx" ON "MemberBasonta"("groupId");

-- CreateIndex
CREATE INDEX "AttendanceSession_date_idx" ON "AttendanceSession"("date");

-- CreateIndex
CREATE INDEX "AttendanceSession_groupId_date_idx" ON "AttendanceSession"("groupId", "date");

-- CreateIndex
CREATE INDEX "AttendanceRecord_memberId_idx" ON "AttendanceRecord"("memberId");

-- AddForeignKey
ALTER TABLE "ChurchGroup" ADD CONSTRAINT "ChurchGroup_pastorId_fkey" FOREIGN KEY ("pastorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChurchGroup" ADD CONSTRAINT "ChurchGroup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_constituencyId_fkey" FOREIGN KEY ("constituencyId") REFERENCES "ChurchGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberBasonta" ADD CONSTRAINT "MemberBasonta_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberBasonta" ADD CONSTRAINT "MemberBasonta_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChurchGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChurchGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One Sunday service per date, and one meeting per group per date.
CREATE UNIQUE INDEX "AttendanceSession_sunday_date_key" ON "AttendanceSession"("date") WHERE "kind" = 'SUNDAY_SERVICE';
CREATE UNIQUE INDEX "AttendanceSession_group_date_key" ON "AttendanceSession"("groupId", "date") WHERE "kind" = 'GROUP_MEETING';
-- Sunday sessions have no group; group meetings always have one.
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_kind_group_check"
  CHECK (("kind" = 'SUNDAY_SERVICE' AND "groupId" IS NULL) OR ("kind" = 'GROUP_MEETING' AND "groupId" IS NOT NULL));
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_counts_check" CHECK ("visitorCount" >= 0 AND "firstTimerCount" >= 0);
CREATE INDEX "Member_fullName_trgm_idx" ON "Member" USING gin ("fullName" gin_trgm_ops);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'wcc_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ChurchGroup", "Member", "MemberBasonta", "AttendanceSession", "AttendanceRecord" TO wcc_app;
  END IF;
END $$;
