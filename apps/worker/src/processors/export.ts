import type { Job } from 'bullmq';
import archiver from 'archiver';
import { PassThrough } from 'node:stream';
import { Upload } from '@aws-sdk/lib-storage';
import { keys, GB, type ExportJobData } from '@wcc/shared';
import { env } from '../env';
import { prisma } from '../lib/prisma';
import { bucket, getStream, s3 } from '../lib/s3';
import { log } from '../lib/log';
import { queues } from '../queues';

function uniqueName(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${stem} (${i})${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Streams originals from S3 into a ZIP that streams back to S3 (§19).
 * Store mode (no compression): photos and videos are already compressed, and
 * it keeps CPU and memory flat on the shared VPS.
 */
export async function buildExport(job: Job<ExportJobData>): Promise<void> {
  const exp = await prisma.exportJob.findUnique({ where: { id: job.data.exportId }, include: { requestedBy: { select: { email: true } } } });
  if (!exp || exp.status === 'READY') return;
  await prisma.exportJob.update({ where: { id: exp.id }, data: { status: 'RUNNING', error: null } });

  try {
    const media = await prisma.mediaAsset.findMany({
      where: { id: { in: exp.mediaIds }, deletedAt: null, status: 'READY' },
      select: { originalKey: true, originalFilename: true, sizeBytes: true },
      orderBy: [{ takenAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    const total = media.reduce((s, m) => s + Number(m.sizeBytes), 0);
    if (total > env.EXPORT_MAX_GB * GB) throw new Error(`Selection is larger than ${env.EXPORT_MAX_GB} GB; download fewer items at a time`);

    const key = keys.export(exp.id);
    const archive = archiver('zip', { store: true, forceZip64: total > 3.5 * GB });
    const body = new PassThrough();
    archive.pipe(body);
    const upload = new Upload({ client: s3, params: { Bucket: bucket, Key: key, Body: body, ContentType: 'application/zip' }, queueSize: 2, partSize: 16 * 1024 * 1024 });
    const done = upload.done();

    const used = new Set<string>();
    for (const m of media) {
      const stream = await getStream(m.originalKey);
      archive.append(stream, { name: uniqueName(m.originalFilename, used), store: true });
      // One file at a time: wait until archiver has consumed this entry.
      await new Promise<void>((resolve, reject) => {
        stream.once('end', resolve);
        stream.once('error', reject);
      });
      await job.updateProgress(Math.round((used.size / media.length) * 100));
    }
    await archive.finalize();
    await done;

    await prisma.exportJob.update({
      where: { id: exp.id },
      data: { status: 'READY', key, fileCount: media.length, sizeBytes: BigInt(archive.pointer()), completedAt: new Date() },
    });
    if (exp.requestedBy?.email)
      if (exp.requestedBy.email) await queues.mail.add('send', { to: exp.requestedBy.email, template: 'export-ready', data: { title: exp.title, link: `${env.WEB_ORIGIN}/downloads` } }, { attempts: 3, removeOnComplete: 500 });
    log.info({ exportId: exp.id, files: media.length, bytes: archive.pointer() }, 'export ready');
  } catch (e) {
    await prisma.exportJob.update({ where: { id: exp.id }, data: { status: 'FAILED', error: (e as Error).message.slice(0, 1000) } });
    throw e;
  }
}
