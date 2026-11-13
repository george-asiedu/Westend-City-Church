-- Invitations can be for a church member: accepting links the new login to that member.
ALTER TABLE "Invitation" ADD COLUMN "memberId" UUID;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
