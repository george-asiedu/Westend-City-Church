-- Follow-ups, bacenta rosters, events & RSVPs, milestones, announcements, visitor cards, member accounts.
-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'CONTACTED', 'VISITED', 'UNREACHABLE', 'DONE');
-- CreateEnum
CREATE TYPE "RsvpStatus" AS ENUM ('GOING', 'MAYBE', 'NOT_GOING');
-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('CHURCH', 'GROUPS', 'LEADERS');
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "memberId" UUID;
-- AlterTable
ALTER TABLE "Guest" ADD COLUMN     "howHeard" VARCHAR(160),
ADD COLUMN     "location" VARCHAR(160),
ADD COLUMN     "prayerRequest" VARCHAR(1000),
ALTER COLUMN "sessionId" DROP NOT NULL;
-- CreateTable
CREATE TABLE "FollowUp" (
    "id" UUID NOT NULL,
    "memberId" UUID,
    "guestId" UUID,
    "reason" VARCHAR(160) NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToId" UUID,
    "createdById" UUID,
    "dueOn" DATE,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "FollowUpNote" (
    "id" UUID NOT NULL,
    "followUpId" UUID NOT NULL,
    "authorId" UUID,
    "status" "FollowUpStatus",
    "text" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FollowUpNote_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "RosterSlot" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "roleId" UUID,
    "date" DATE NOT NULL,
    "service" VARCHAR(60),
    "memberId" UUID NOT NULL,
    "note" VARCHAR(200),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RosterSlot_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "ChurchEvent" (
    "id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(2000),
    "location" VARCHAR(160),
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "groupId" UUID,
    "rsvpEnabled" BOOLEAN NOT NULL DEFAULT true,
    "capacity" INTEGER,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChurchEvent_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "EventRsvp" (
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "RsvpStatus" NOT NULL,
    "guests" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventRsvp_pkey" PRIMARY KEY ("eventId","userId")
);
-- CreateTable
CREATE TABLE "Milestone" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "note" VARCHAR(300),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "Announcement" (
    "id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "linkUrl" VARCHAR(500),
    "audience" "AnnouncementAudience" NOT NULL DEFAULT 'CHURCH',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "publishAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "AnnouncementGroup" (
    "announcementId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    CONSTRAINT "AnnouncementGroup_pkey" PRIMARY KEY ("announcementId","groupId")
);
-- CreateTable
CREATE TABLE "AnnouncementRead" (
    "announcementId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnnouncementRead_pkey" PRIMARY KEY ("announcementId","userId")
);
-- CreateIndex
CREATE INDEX "FollowUp_assignedToId_status_idx" ON "FollowUp"("assignedToId", "status");
-- CreateIndex
CREATE INDEX "FollowUp_status_dueOn_idx" ON "FollowUp"("status", "dueOn");
-- CreateIndex
CREATE INDEX "FollowUpNote_followUpId_idx" ON "FollowUpNote"("followUpId");
-- CreateIndex
CREATE INDEX "RosterSlot_groupId_date_idx" ON "RosterSlot"("groupId", "date");
-- CreateIndex
CREATE INDEX "RosterSlot_memberId_date_idx" ON "RosterSlot"("memberId", "date");
-- CreateIndex
CREATE INDEX "ChurchEvent_startsAt_idx" ON "ChurchEvent"("startsAt");
-- CreateIndex
CREATE INDEX "Milestone_memberId_idx" ON "Milestone"("memberId");
-- CreateIndex
CREATE INDEX "Milestone_type_idx" ON "Milestone"("type");
-- CreateIndex
CREATE INDEX "Announcement_publishAt_idx" ON "Announcement"("publishAt");
-- CreateIndex
CREATE INDEX "AnnouncementGroup_groupId_idx" ON "AnnouncementGroup"("groupId");
-- CreateIndex
CREATE UNIQUE INDEX "User_memberId_key" ON "User"("memberId");
-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "FollowUpNote" ADD CONSTRAINT "FollowUpNote_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "FollowUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "FollowUpNote" ADD CONSTRAINT "FollowUpNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "RosterSlot" ADD CONSTRAINT "RosterSlot_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChurchGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "RosterSlot" ADD CONSTRAINT "RosterSlot_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "BacentaRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "RosterSlot" ADD CONSTRAINT "RosterSlot_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "RosterSlot" ADD CONSTRAINT "RosterSlot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ChurchEvent" ADD CONSTRAINT "ChurchEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChurchGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ChurchEvent" ADD CONSTRAINT "ChurchEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "EventRsvp" ADD CONSTRAINT "EventRsvp_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ChurchEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "EventRsvp" ADD CONSTRAINT "EventRsvp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "AnnouncementGroup" ADD CONSTRAINT "AnnouncementGroup_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "AnnouncementGroup" ADD CONSTRAINT "AnnouncementGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChurchGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'wcc_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "FollowUp", "FollowUpNote", "RosterSlot", "ChurchEvent", "EventRsvp", "Milestone", "Announcement", "AnnouncementGroup", "AnnouncementRead" TO wcc_app;
  END IF;
END $$;
