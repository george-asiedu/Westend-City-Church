import { Prisma, recountEvents, type VariantKind } from '@wcc/db';
import { prisma } from './prisma';
import { deleteKeys } from './s3';
import { log } from './log';

export interface VariantOut {
  kind: VariantKind;
  key: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
}

/** Claims an UPLOADED/PROCESSING/FAILED row for processing; null if it's gone or already READY. */
export async function claim(mediaId: string) {
  const res = await prisma.mediaAsset.updateMany({
    where: { id: mediaId, status: { in: ['UPLOADED', 'PROCESSING', 'FAILED'] } },
    data: { status: 'PROCESSING' },
  });
  if (res.count !== 1) return null;
  return prisma.mediaAsset.findUnique({ where: { id: mediaId } });
}

/** Writes variants + metadata, flips to READY and recomputes counters in one transaction (§5.4). */
export async function markReady(mediaId: string, eventId: string, data: Prisma.MediaAssetUpdateInput, variants: VariantOut[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const v of variants) {
      await tx.mediaVariant.upsert({
        where: { mediaId_kind: { mediaId, kind: v.kind } },
        update: { key: v.key, mimeType: v.mimeType, width: v.width, height: v.height, sizeBytes: BigInt(v.sizeBytes) },
        create: { mediaId, kind: v.kind, key: v.key, mimeType: v.mimeType, width: v.width, height: v.height, sizeBytes: BigInt(v.sizeBytes) },
      });
    }
    await tx.mediaAsset.update({ where: { id: mediaId }, data: { ...data, status: 'READY', processingError: null } });
    // The current event (the row may have been moved while processing).
    const fresh = await tx.mediaAsset.findUniqueOrThrow({ where: { id: mediaId }, select: { eventId: true } });
    await recountEvents(tx, [eventId, fresh.eventId]);
    // First READY item becomes the cover if the event has none.
    await tx.event.updateMany({ where: { id: fresh.eventId, coverMediaId: null }, data: { coverMediaId: mediaId } });
  });
}

export async function markFailed(mediaId: string, error: string): Promise<void> {
  await prisma.mediaAsset.updateMany({ where: { id: mediaId }, data: { status: 'FAILED', processingError: error.slice(0, 1000) } });
}

/**
 * The file is not what it claimed to be: fail it, delete the original and
 * audit (§8.3 step 1). Not retried.
 */
export async function rejectContent(m: { id: string; originalKey: string; originalFilename: string; uploadedById: string }, reason: string): Promise<void> {
  await deleteKeys([m.originalKey]).catch((e) => log.error({ err: e, mediaId: m.id }, 'failed to delete rejected original'));
  await markFailed(m.id, reason);
  await prisma.auditLog.create({
    data: { actorId: m.uploadedById, action: 'MEDIA_REJECTED', entityType: 'MEDIA', entityId: m.id, metadata: { filename: m.originalFilename, reason } },
  });
}
