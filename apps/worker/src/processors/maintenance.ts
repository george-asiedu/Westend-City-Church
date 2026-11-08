import type { Job } from 'bullmq';
import { recountAllEvents } from '@wcc/db';
import { MAINTENANCE_JOBS } from '@wcc/shared';
import { env } from '../env';
import { prisma } from '../lib/prisma';
import { deleteKeys, s3, bucket } from '../lib/s3';
import { AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { log } from '../lib/log';
import { enqueue } from '../queues';

const DAY = 86_400_000;

export async function maintenance(job: Job): Promise<unknown> {
  switch (job.name) {
    case MAINTENANCE_JOBS.PURGE_TRASH: {
      const due = await prisma.mediaAsset.findMany({ where: { deletedAt: { not: null }, purgeAfter: { lt: new Date() } }, select: { id: true }, take: 5000 });
      for (const m of due) await enqueue.purge({ mediaId: m.id });
      const cutoff = new Date(Date.now() - env.TRASH_RETENTION_DAYS * DAY);
      const empty = await prisma.event.deleteMany({ where: { deletedAt: { lt: cutoff }, media: { none: {} } } });
      return { mediaQueued: due.length, eventsDeleted: empty.count };
    }
    case MAINTENANCE_JOBS.ABORT_STALE_UPLOADS: {
      const stale = await prisma.mediaAsset.findMany({ where: { status: 'PENDING_UPLOAD', createdAt: { lt: new Date(Date.now() - DAY) } }, take: 1000 });
      for (const m of stale) {
        if (m.s3UploadId) await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: m.originalKey, UploadId: m.s3UploadId })).catch(() => undefined);
        else await deleteKeys([m.originalKey]).catch(() => undefined);
        await prisma.mediaAsset.delete({ where: { id: m.id } }).catch(() => undefined);
      }
      // Uploads whose processing job was lost (e.g. Redis restart): queue them again.
      const orphaned = await prisma.mediaAsset.findMany({
        where: { status: 'UPLOADED', deletedAt: null, updatedAt: { lt: new Date(Date.now() - 3600_000) } },
        select: { id: true, type: true, processingAttempts: true },
        take: 500,
      });
      for (const m of orphaned) await enqueue.process(m.type, m.id, m.processingAttempts);
      return { aborted: stale.length, requeued: orphaned.length };
    }
    case MAINTENANCE_JOBS.RECONCILE_COUNTERS:
      return { fixed: await recountAllEvents(prisma) };
    case MAINTENANCE_JOBS.PRUNE_SESSIONS: {
      const cutoff = new Date(Date.now() - 30 * DAY);
      const res = await prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] } });
      const resets = await prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
      const invites = await prisma.invitation.deleteMany({ where: { acceptedAt: null, expiresAt: { lt: new Date(Date.now() - 90 * DAY) } } });
      return { sessions: res.count, resets: resets.count, invites: invites.count };
    }
    case MAINTENANCE_JOBS.PRUNE_AUDIT: {
      // The app role cannot DELETE audit rows; a SECURITY DEFINER function enforces a 1-year floor.
      const rows = await prisma.$queryRaw<Array<{ prune_audit_log: number }>>`SELECT prune_audit_log(${env.AUDIT_RETENTION_DAYS}::int)`;
      return { deleted: rows[0]?.prune_audit_log ?? 0 };
    }
    case MAINTENANCE_JOBS.PURGE_EXPORTS: {
      const expired = await prisma.exportJob.findMany({ where: { expiresAt: { lt: new Date() } }, take: 1000 });
      await deleteKeys(expired.map((e) => e.key).filter((k): k is string => !!k));
      await prisma.exportJob.deleteMany({ where: { id: { in: expired.map((e) => e.id) } } });
      return { deleted: expired.length };
    }
    default:
      log.warn({ name: job.name }, 'unknown maintenance job');
      return null;
  }
}
