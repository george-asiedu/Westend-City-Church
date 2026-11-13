-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notifyReminders" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyStats" BOOLEAN NOT NULL DEFAULT true;
-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");
-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'wcc_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "PushSubscription" TO wcc_app;
  END IF;
END $$;
