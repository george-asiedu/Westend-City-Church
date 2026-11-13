-- Birthday push notifications (on by default; each person can turn them off).
ALTER TABLE "User" ADD COLUMN "notifyBirthdays" BOOLEAN NOT NULL DEFAULT true;
