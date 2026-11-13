



-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "checkedInAt" TIMESTAMP(3),
ADD COLUMN     "via" VARCHAR(10);

-- AlterTable
ALTER TABLE "AttendanceSession" ADD COLUMN     "checkinCode" VARCHAR(40),
ADD COLUMN     "checkinUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Guest" ADD COLUMN     "relation" VARCHAR(40);

-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "joinLinkId" UUID,
ADD COLUMN     "needsApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "guardianId" UUID;

-- CreateTable
CREATE TABLE "JoinLink" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "role" "Role" NOT NULL,
    "categoryIds" UUID[],
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JoinLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JoinLink_code_key" ON "JoinLink"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSession_checkinCode_key" ON "AttendanceSession"("checkinCode");

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_joinLinkId_fkey" FOREIGN KEY ("joinLinkId") REFERENCES "JoinLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JoinLink" ADD CONSTRAINT "JoinLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The app's runtime role (production) needs access to the new table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wcc_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "JoinLink" TO wcc_app;
  END IF;
END $$;
