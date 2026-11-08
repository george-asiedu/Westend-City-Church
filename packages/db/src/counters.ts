import { Prisma } from '@prisma/client';

/**
 * Recomputes Event.mediaCount/photoCount/videoCount/totalBytes from READY,
 * non-deleted media (§5.4).
 * DECISION: recompute the touched events inside the caller's transaction
 * instead of increment/decrement — same atomicity, and it cannot drift.
 */
export async function recountEvents(tx: Prisma.TransactionClient, eventIds: Iterable<string>): Promise<void> {
  const ids = [...new Set(eventIds)];
  if (!ids.length) return;
  await tx.$executeRaw`
    UPDATE "Event" e SET
      "mediaCount" = COALESCE(s.total, 0),
      "photoCount" = COALESCE(s.photos, 0),
      "videoCount" = COALESCE(s.videos, 0),
      "totalBytes" = COALESCE(s.bytes, 0)
    FROM (SELECT unnest(${ids}::uuid[]) AS id) t
    LEFT JOIN (
      SELECT "eventId",
             count(*)::int AS total,
             count(*) FILTER (WHERE type = 'IMAGE')::int AS photos,
             count(*) FILTER (WHERE type = 'VIDEO')::int AS videos,
             sum("sizeBytes")::bigint AS bytes
      FROM "MediaAsset"
      WHERE status = 'READY' AND "deletedAt" IS NULL AND "eventId" = ANY(${ids}::uuid[])
      GROUP BY "eventId"
    ) s ON s."eventId" = t.id
    WHERE e.id = t.id`;
}

/** Nightly full reconciliation (§12). */
export async function recountAllEvents(client: { $executeRaw: Prisma.TransactionClient['$executeRaw'] }): Promise<number> {
  return client.$executeRaw`
    UPDATE "Event" e SET
      "mediaCount" = COALESCE(s.total, 0),
      "photoCount" = COALESCE(s.photos, 0),
      "videoCount" = COALESCE(s.videos, 0),
      "totalBytes" = COALESCE(s.bytes, 0)
    FROM "Event" e2
    LEFT JOIN (
      SELECT "eventId", count(*)::int AS total,
             count(*) FILTER (WHERE type = 'IMAGE')::int AS photos,
             count(*) FILTER (WHERE type = 'VIDEO')::int AS videos,
             sum("sizeBytes")::bigint AS bytes
      FROM "MediaAsset" WHERE status = 'READY' AND "deletedAt" IS NULL GROUP BY "eventId"
    ) s ON s."eventId" = e2.id
    WHERE e.id = e2.id
      AND (e."mediaCount", e."photoCount", e."videoCount", e."totalBytes")
          IS DISTINCT FROM (COALESCE(s.total, 0), COALESCE(s.photos, 0), COALESCE(s.videos, 0), COALESCE(s.bytes, 0)::bigint)`;
}
