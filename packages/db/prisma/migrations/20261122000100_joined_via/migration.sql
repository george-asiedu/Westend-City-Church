




-- AlterTable
ALTER TABLE "User" ADD COLUMN     "joinedViaId" UUID;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_joinedViaId_fkey" FOREIGN KEY ("joinedViaId") REFERENCES "JoinLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

