import type { Job } from 'bullmq';
import { recountEvents } from '@wcc/db';
import type { PurgeMediaJob } from '@wcc/shared';
import { prisma } from '../lib/prisma';
import { deleteKeys } from '../lib/s3';
import { log } from '../lib/log';

/** Permanently removes a trashed media item: S3 objects first, then the rows (§12). */
export async function purgeMedia(job: Job<PurgeMediaJob>): Promise<void> {
  const m = await prisma.mediaAsset.findUnique({ where: { id: job.data.mediaId }, include: { variants: { select: { key: true } } } });
  if (!m) {
    if (job.data.keys?.length) await deleteKeys(job.data.keys);
    return;
  }
  if (!m.deletedAt) {
    log.warn({ mediaId: m.id }, 'purge skipped: media was restored');
    return;
  }
  await deleteKeys([m.originalKey, ...m.variants.map((v) => v.key)]);
  await prisma.$transaction(async (tx) => {
    await tx.mediaAsset.delete({ where: { id: m.id } });
    await tx.event.updateMany({ where: { coverMediaId: m.id }, data: { coverMediaId: null } });
    await tx.category.updateMany({ where: { coverMediaId: m.id }, data: { coverMediaId: null } });
    await recountEvents(tx, [m.eventId]);
    await tx.auditLog.create({ data: { action: 'MEDIA_PURGED', entityType: 'MEDIA', entityId: m.id, metadata: { filename: m.originalFilename, eventId: m.eventId } } });
    // A trashed event goes once its last media item is gone.
    const event = await tx.event.findUnique({ where: { id: m.eventId }, select: { deletedAt: true, _count: { select: { media: true } } } });
    if (event?.deletedAt && event._count.media === 0) {
      await tx.event.delete({ where: { id: m.eventId } });
      await tx.auditLog.create({ data: { action: 'EVENT_PURGED', entityType: 'EVENT', entityId: m.eventId } });
    }
  });
}
