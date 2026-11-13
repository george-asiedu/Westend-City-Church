-- Church services are now head-counts recorded by the ushers (no member ticking);
-- members are recorded at basonta level only.
ALTER TABLE "ChurchGroup" ADD COLUMN "recordsServices" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AttendanceSession" ADD COLUMN "headcount" INTEGER;
ALTER TABLE "AttendanceSession" ADD COLUMN "newConvertCount" INTEGER NOT NULL DEFAULT 0;

-- Keep the numbers of services recorded the old way. Before, first-timers were counted
-- inside visitors; now total = members + visitors + new converts.
UPDATE "AttendanceSession" s
SET "headcount" = (SELECT count(*) FROM "AttendanceRecord" r WHERE r."sessionId" = s.id) + s."visitorCount",
    "newConvertCount" = LEAST(s."firstTimerCount", s."visitorCount"),
    "visitorCount" = s."visitorCount" - LEAST(s."firstTimerCount", s."visitorCount")
WHERE s."kind" = 'CHURCH_SERVICE';

ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_headcount_check"
  CHECK ("headcount" IS NULL OR ("headcount" >= 0 AND "newConvertCount" >= 0 AND "visitorCount" + "newConvertCount" <= "headcount"));
