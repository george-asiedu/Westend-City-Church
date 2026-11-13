-- The ministries recorded so far as "basontas" (media, choir…) are bacentas.
UPDATE "ChurchGroup" SET "type" = 'BACENTA' WHERE "type" = 'BASONTA';

-- Their memberships keep their data: rename the table and its constraints.
ALTER TABLE "MemberBasonta" RENAME TO "MemberBacenta";
ALTER TABLE "MemberBacenta" RENAME CONSTRAINT "MemberBasonta_pkey" TO "MemberBacenta_pkey";
ALTER TABLE "MemberBacenta" RENAME CONSTRAINT "MemberBasonta_memberId_fkey" TO "MemberBacenta_memberId_fkey";
ALTER TABLE "MemberBacenta" RENAME CONSTRAINT "MemberBasonta_groupId_fkey" TO "MemberBacenta_groupId_fkey";
ALTER INDEX "MemberBasonta_groupId_idx" RENAME TO "MemberBacenta_groupId_idx";

-- Basontas sit inside a constituency; each member has one basonta.
ALTER TABLE "ChurchGroup" ADD COLUMN "parentId" UUID;
ALTER TABLE "ChurchGroup" ADD CONSTRAINT "ChurchGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ChurchGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ChurchGroup_parentId_idx" ON "ChurchGroup"("parentId");
ALTER TABLE "ChurchGroup" ADD CONSTRAINT "ChurchGroup_parent_check" CHECK ("parentId" IS NULL OR "type" = 'BASONTA');

ALTER TABLE "Member" ADD COLUMN "basontaId" UUID;
ALTER TABLE "Member" ADD CONSTRAINT "Member_basontaId_fkey" FOREIGN KEY ("basontaId") REFERENCES "ChurchGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Member_basontaId_idx" ON "Member"("basontaId");

-- A bacenta's overall team lead (a member).
ALTER TABLE "ChurchGroup" ADD COLUMN "leadMemberId" UUID;
ALTER TABLE "ChurchGroup" ADD CONSTRAINT "ChurchGroup_leadMemberId_fkey" FOREIGN KEY ("leadMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Team roles inside a bacenta (mixing, projecting, live streaming…).
CREATE TABLE "BacentaRole" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "leadId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BacentaRole_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BacentaRole_groupId_name_key" ON "BacentaRole"("groupId", "name");
ALTER TABLE "BacentaRole" ADD CONSTRAINT "BacentaRole_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BacentaRole" ADD CONSTRAINT "BacentaRole_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChurchGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MemberBacentaRole" (
    "memberId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    CONSTRAINT "MemberBacentaRole_pkey" PRIMARY KEY ("memberId","groupId","roleId")
);
CREATE INDEX "MemberBacentaRole_roleId_idx" ON "MemberBacentaRole"("roleId");
ALTER TABLE "MemberBacentaRole" ADD CONSTRAINT "MemberBacentaRole_memberId_groupId_fkey" FOREIGN KEY ("memberId", "groupId") REFERENCES "MemberBacenta"("memberId", "groupId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberBacentaRole" ADD CONSTRAINT "MemberBacentaRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "BacentaRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'wcc_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "MemberBacenta", "BacentaRole", "MemberBacentaRole" TO wcc_app;
  END IF;
END $$;
