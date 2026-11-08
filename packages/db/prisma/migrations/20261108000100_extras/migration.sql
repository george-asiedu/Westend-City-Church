-- §5.2: things Prisma cannot express.

-- Trigram search indexes
CREATE INDEX IF NOT EXISTS event_title_trgm ON "Event" USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS media_caption_trgm ON "MediaAsset" USING gin (caption gin_trgm_ops);
CREATE INDEX IF NOT EXISTS media_filename_trgm ON "MediaAsset" USING gin ("originalFilename" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tag_name_trgm ON "Tag" USING gin ((name::text) gin_trgm_ops);

-- endDate must be >= eventDate
ALTER TABLE "Event" ADD CONSTRAINT event_dates_chk
  CHECK ("endDate" IS NULL OR "endDate" >= "eventDate");

-- Non-negative counters
ALTER TABLE "Event" ADD CONSTRAINT event_counts_chk
  CHECK ("mediaCount" >= 0 AND "photoCount" >= 0 AND "videoCount" >= 0 AND "totalBytes" >= 0);

-- A share link targets an event, or a hand-picked selection (event NULL).
ALTER TABLE "ShareLink" ADD CONSTRAINT share_expiry_chk CHECK ("expiresAt" > "createdAt");

-- Audit retention without giving the app DELETE on the audit log:
-- runs as the owner, and never deletes anything younger than one year.
CREATE OR REPLACE FUNCTION prune_audit_log(keep_days int) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  DELETE FROM "AuditLog" WHERE "createdAt" < now() - make_interval(days => GREATEST(keep_days, 365));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Runtime role privileges (§5.3). Skipped where the role doesn't exist (local dev with one role).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'wcc_app') THEN
    GRANT USAGE ON SCHEMA public TO wcc_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wcc_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wcc_app;
    -- The audit log is append-only for the app.
    REVOKE UPDATE, DELETE ON "AuditLog" FROM wcc_app;
    REVOKE ALL ON FUNCTION prune_audit_log(int) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION prune_audit_log(int) TO wcc_app;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'wcc_backup') THEN
    GRANT USAGE ON SCHEMA public TO wcc_backup;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO wcc_backup;
    GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO wcc_backup;
  END IF;
END $$;
